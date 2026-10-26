// Damage-relevant perks, statuses and potions for the Test tab, transcribed from the Voxlpedia
// perk / status pages. Each perk entry declares what it changes through the effect builder `E`
// (see VoxlDamage.collect). `a` is the perk amount, `S` the current situation and statuses.
(function () {
  // ------------------------------------------------------------ attack filters
  const W = (a) => a.kind === "m1" || a.kind === "m2";              // weapon attacks (LMB/RMB)
  const FIN = (a) => !!a.finisher;
  const AR = (a) => a.kind === "art" || a.kind === "rune";
  const ART = (a) => a.kind === "art";
  const NODOT = (a) => a.kind !== "dot";
  const ALL = () => true;
  const and = (...fs) => (a, t) => fs.every((f) => f(a, t));
  const hasType = (type) => (a, types) => (types[type] || 0) > 0;
  const UNBALANCED = ["Unbalanced Sword", "Dual Unbalanced Swords", "Great Spear"];
  const PIERCER_FULL = ["1-Handed Sword", "Spear", "Dagger", "Fists", "Rapier", "Rifle"];
  const slam = (a) => (a.kind === "m1" && a.finisher && ["War Hammer", "Dual Mallets"].includes(a.form)) || (a.kind === "m2" && a.form === "Mallet");
  const decay = (n) => 1 / (1 + (n - 1) / 3); // finisher-hit falloff used by Gale Bursts, Dragon Breath, ...
  const potencyMult = (p) => (!p ? 1 : p < 10 ? Math.pow(1 + p / 10, 1 + p / 10) : Math.pow(1 + p / 10, 2));
  const SLAM_ARTS = ["slam", "earth-slam", "grand-quake", "warrior-stomp", "storm-stomp", "earthquake"];
  const slamAny = (a) => slam(a) || SLAM_ARTS.includes(a.artId);
  // weapon arts and runes that summon minions (Summons page)
  const SUMMON_ARTS = ["mage-bomber-summon", "blessedlings-summon", "toaladin-summon", "undead-buni-summon", "skeletal-woof-summon", "infernal-legion"];
  const SUMMON_RUNES = ["croakernaut-rune", "pack-leader-rune", "sporeling-toss-rune", "swarm-rune"];
  const SUMMONER = (a) => SUMMON_ARTS.includes(a.artId) || SUMMON_RUNES.includes(a.runeId);

  const T = (o) => o;
  const PHYS_MAGIC_HALF = { Physical: 0.5, Magic: 0.5 };

  // ------------------------------------------------------------ situation inputs
  // Shared numbers a perk may depend on. Only shown when an enabled perk uses them.
  const SITUATION = {
    targetHp: { label: "Target HP %", def: 100, min: 0, max: 100, step: 5 },
    selfHp: { label: "Your HP %", def: 100, min: 1, max: 100, step: 5 },
    extraTargetDebuffs: { label: "Other debuffs on target", def: 0, min: 0, max: 20, step: 1 },
    extraSelfDebuffs: { label: "Other debuffs on you", def: 0, min: 0, max: 20, step: 1 },
    summons: { label: "Active minions", def: 3, min: 0, max: 30, step: 1 },
    voxos: { label: "Voxos", def: 100000, min: 0, max: 100000, step: 5000 },
    items: { label: "Inventory items", def: 250, min: 0, max: 300, step: 10 },
    distance: { label: "Distance (studs)", def: 60, min: 0, max: 300, step: 10 },
    tailwind: { label: "Tailwind potency", def: 0.2, min: 0, max: 2, step: 0.1 },
    bounce: { label: "Bounce potency", def: 0.3, min: 0, max: 2, step: 0.1 },
    bloodlust: { label: "Bloodlust potency", def: 2.5, min: 0, max: 10, step: 0.5 },
    perfection: { label: "Perfection stacks", def: 5, min: 0, max: 50, step: 1 },
    element: { label: "Draconic color", def: "Fire", options: ["Fire", "Air", "Earth", "Water", "Holy", "Hex"] },
    emotional: { label: "Emotional state", def: "debuffs", options: ["debuffs", "buffs", "both"] },
    blocksPer10: { label: "Attacks you block per 10s", def: 2, min: 0, max: 50, step: 1 },
    hitsPer10: { label: "Hits you take per 10s", def: 2, min: 0, max: 50, step: 1 },
    shieldBreaksPerMin: { label: "Shield breaks per minute", def: 1, min: 0, max: 30, step: 1 },
    healsPerSec: { label: "Heals per second", def: 1, min: 0, max: 10, step: 0.5 },
    healAmount: { label: "HP per heal", def: 5, min: 0, max: 200, step: 1 },
    summonsFired: { label: "Minions in Cannonball", def: 3, min: 0, max: 30, step: 1 },
    lastCroak: { label: "Last Croak stacks", def: 15, min: 0, max: 30, step: 1 },
    enemies: { label: "Enemies in range", def: 1, min: 1, max: 20, step: 1 },
    summonsPerCast: { label: "Minions per summon", def: 1, min: 1, max: 10, step: 1 },
  };

  // ------------------------------------------------------------ statuses
  // Shared statuses: a toggle appears only when the build (or a picked potion) provides a source.
  // sources(ctx, p) returns [label, potency]; p(id) is the perk amount.
  const rune = (ctx, id) => ctx.rune && ctx.rune.id === id;
  const STATUSES = [
    { id: "rage", name: "Rage", side: "self", potency: true, sources: (ctx, p) => [
      ...(ctx.rune && ctx.rune.attack && (ctx.rune.attack.applies || []).filter((x) => x.status === "Rage").map((x) => [ctx.rune.name, x.potency]) || []),
      ctx.potions.has("rage-potion") && ["Rage Potion", 0.4 * ctx.potionMult],
      p("wrathful-crits") && ["Wrathful Crits", 0.1 * p("wrathful-crits")],
      p("cursed-experiment") && ["Cursed Experiment", 0.3 + 0.1 * p("cursed-experiment")],
      p("beastial-rage") && ["Beastial Rage (kill)", 0.3 * p("beastial-rage")],
      p("toadzerker-spirit") && ["Toadzerker Spirit", 0.2],
      p("true-balance") && ["True Balance", 0.1 * p("true-balance")],
      p("vassals-croak") && ["Vassals Croak", 0.1 + 0.15 * p("vassals-croak")],
      p("slayer-rage") && ["Slayer Rage (held rune)", 0.2 * p("slayer-rage")],
      p("blessing") && ["Blessing (heal proc)", 0.5],
    ] },
    // potencies include the Tailwind perk's +0.1/amt to every source (what the game shows); Whirlwind converts it
    { id: "tailwind", name: "Tailwind / Whirlwind", side: "self", potency: true, sources: (ctx, p) => [
      p("tailwind") && ["Tailwind", 0.1], p("runic-winds") && ["Runic Winds", 0.1 * p("runic-winds")],
      p("guiding-winds") && ["Guiding Winds", 0.1 * p("guiding-winds")], p("cryo-engine") && ["Cryo Engine", 0.2 + 0.1 * p("cryo-engine")],
      p("true-balance") && ["True Balance", 0.1 * p("true-balance")], p("whirl-foot") && ["Whirl Foot", 0.1 * p("whirl-foot")],
      p("emergency-exit") && ["Emergency Exit (when hit)", 0.4 * p("emergency-exit")], p("blessing") && ["Blessing", 0.2],
    ].map((x) => x && [x[0], x[1] + 0.1 * p("tailwind")]) },
    { id: "lightning-cloak", name: "Lightning Cloak", side: "self", sources: (ctx) => [
      ctx.wpn.art && ctx.wpn.art.id === "lightning-cloak" && ["Lightning Cloak (weapon art, 40s)", 1],
    ] },
    { id: "bounce", name: "Bounce", side: "self", potency: true, sources: (ctx, p) => [
      rune(ctx, "bounce-rune") && ["Bounce Rune", 0.3], p("spring-step") && ["Spring Step", 0.2 * p("spring-step")],
      p("spring-powered") && ["Spring Powered", 0.1 * p("spring-powered")], p("toadzerker-spirit") && ["Toadzerker Spirit", 0.2],
      p("springblast") && ["Springblast", 0.1 * p("springblast")], p("iron-bounce") && ["Iron Bounce", 0.3 * p("iron-bounce")],
      p("blessing") && ["Blessing", 0.2],
    ] },
    { id: "inspired", name: "Inspired", side: "self", potency: true, sources: (ctx, p) => [
      p("inspiration") && ["Inspiration", 0.1 + 0.025 * p("inspiration")], p("true-balance") && ["True Balance", 0.1 * p("true-balance")],
    ] },
    { id: "reinforce", name: "Reinforce", side: "self", potency: true, sources: (ctx, p) => [
      rune(ctx, "reinforce-rune") && ["Reinforce Rune", 0.5], p("sacred-grounds") && ["Sacred Grounds", 0.2 * p("sacred-grounds")],
      p("croakernaut-spirit") && ["Croakernaut Spirit", 0.5], p("iron-bounce") && ["Iron Bounce", 0.25 * p("iron-bounce")],
      p("swift-guard") && ["Swift Guard (dodge)", 0.2 * p("swift-guard")], p("emergency-exit") && ["Emergency Exit", 0.3 * p("emergency-exit")],
      p("warding-tides") && ["Warding Tides", 0.15 + 0.1 * p("warding-tides")], p("queens-guard") && ["Queens Guard", 0.5 + 0.1 * p("queens-guard")],
      p("sticky-guard") && ["Sticky Guard", 0.2 * p("sticky-guard")], p("shielding-gong") && ["Shielding Gong", 0.1 * p("shielding-gong")],
      p("blessing") && ["Blessing", 0.5], p("bastion-bless") && ["Bastion Bless", 0.5],
    ] },
    { id: "draconic-infusion", name: "Draconic Infusion", side: "self", potency: true, sources: (ctx, p) => [
      ctx.draconic && ctx.draconic.ability.id === "infusion" && p("draconic-blood") && ["Dragon Infusion", 0.1 * p("draconic-blood")],
    ] },
    { id: "critical-boost", name: "Critical Boost", side: "self", sources: (ctx, p) => [
      p("royal-parry") && ["Royal Parry", 1], p("cursed-experiment") && ["Cursed Experiment", 1], ctx.build.race === "bunikin" && ["Bunikin dodge", 1],
    ] },
    { id: "regen", name: "Regen", side: "self", sources: (ctx, p) => [
      p("marsh-flow") && ["Marsh Flow", 1], p("cursed-experiment") && ["Cursed Experiment", 1], p("standoff") && ["Standoff", 1],
      p("true-balance") && ["True Balance", 1], p("healing-arts") && ["Healing Arts", 1], p("fragrant-flesh") && ["Fragrant Flesh", 1],
      p("blessing") && ["Blessing", 1], p("bastion-bless") && ["Bastion Bless", 1],
    ] },
    { id: "self-poison", name: "Poisoned (you)", side: "self", debuff: true, sources: (ctx, p) => [
      ctx.potions.has("poison-potion") && ["Poison Potion", 1], p("deep-spider-spirit") && ["Deep Spider Spirit", 1],
      p("spore-burst") && ["Spore Burst", 1], p("sacrificial-summoning") && ["Sacrificial Summoning", 1],
    ] },
    { id: "self-burn", name: "Burning (you)", side: "self", debuff: true, sources: (ctx, p) => [
      p("smoldering") && ["Smoldering", 1], p("steam-powered") && ["Steam Powered", 1], p("cinder-soul") && ["Cinder Soul", 1],
    ] },
    { id: "self-bleed", name: "Bleeding (you)", side: "self", debuff: true, sources: (ctx, p) => [
      p("barbskin") && ["Barbskin", 1], p("fragrant-flesh") && ["Fragrant Flesh", 1],
    ] },
    { id: "self-slow", name: "Slowed (you)", side: "self", debuff: true, sources: (ctx, p) => [
      p("unmoving") && ["Unmoving", 1], p("ice-barge") && ["Ice Barge", 1], p("cursed-experiment") && ["Cursed Experiment", 1],
    ] },
    { id: "shatter", name: "Shatter", side: "target", potency: true, sources: (ctx, p) => [
      p("cleave") && ["Cleave", 0.1], p("mine") && ["Mine", 0.1 * p("mine")], p("gravitational-enforcer") && ["Gravitational Enforcer", 0.1 * p("gravitational-enforcer")],
      p("erosion") && ["Erosion", 0.1 + 0.1 * p("erosion")], p("shattering-justice") && ["Shattering Justice", 0.2 * p("shattering-justice")],
      (ctx.form.m1 === "Saw Sword" || ctx.form.m1 === "Saw Fists") && ["Chainsaw stance", 0.2],
      p("winter-woof-spirit") && ["Winter Woof Spirit", 0.2], p("void-root-spirit") && ["Void Root Spirit", 0.2],
      p("wild-bolt") && ["Wild Bolt", 0.2], ctx.build.race === "dark-elf" && ["Dark Elf", 0.2], rune(ctx, "pack-leader-rune") && ["Pack Leader Rune", 0.5],
    ] },
    { id: "electrical-rend", name: "Electrical Rend", side: "target", potency: true, sources: (ctx, p) => [p("storm-rend") && ["Storm Rend", 0.1 * p("storm-rend")]] },
    { id: "hypnotized", name: "Hypnotized", side: "target", potency: true, sources: (ctx, p) => [p("hypnotist") && ["Hypnotist", 0.1 + 0.025 * p("hypnotist")]] },
    { id: "sticky", name: "Sticky", side: "target", variants: true, sources: (ctx, p) => [
      p("melting-slime") && ["Melting Slime", "melting"], p("sickness") && ["Sickness (green)", "green"],
      rune(ctx, "hex-web-rune") && ["Hex Web Rune (purple)", "purple"], rune(ctx, "brainblast-rune") && ["Brainblast Rune (red)", "red"],
      p("sticky-swings") && ["Sticky Swings", "base"], p("explosive-honey") && ["Explosive Honey", "base"], p("honey-arts") && ["Honey Arts", "base"],
      p("queen-bumblz-spirit") && ["Queen Bumblz Spirit", "base"], p("sticky-summons") && ["Sticky Summons", "base"], p("sickly-sweetness") && ["Sickly Sweetness", "base"],
    ] },
    { id: "frostbite", name: "Frostbite", side: "target", sources: (ctx, p) => [p("cryo-engine") && ["Cryo Engine", 1], rune(ctx, "snoeball-rune") && ["Snoeball Rune", 1]] },
    { id: "slowed", name: "Slowed", side: "target", potency: true, sources: (ctx, p) => [
      p("frostbite") && ["Frostbite", 0.5 * p("frostbite")], p("counting-sheep") && ["Counting Sheep", 0.5 * p("counting-sheep")],
      p("icestorm") && ["Icestorm", 0.25 * p("icestorm")], p("frozen-waste") && ["Frozen Waste", 1], p("mycotic-bloom") && ["Mycotic Bloom", 0.2 * p("mycotic-bloom")],
      p("snoeman-spirit") && ["Snoeman Spirit", 1.5], p("cryo-engine") && ["Cryo Engine (Frostbite)", 0.2 * p("cryo-engine")],
      p("void-root-spirit") && ["Void Root Spirit", 0.2], p("wild-bolt") && ["Wild Bolt", 0.2], ctx.build.race === "dark-elf" && ["Dark Elf", 0.2],
    ] },
    { id: "taunted", name: "Taunted", side: "target", sources: (ctx, p) => [
      p("valor") && ["Valor", 1], p("apollo-boost") && ["Apollo Boost", 1], p("aggressive-personality") && ["Aggressive Personality", 1],
      p("screeching-sound") && ["Screeching Sound", 1], p("defensive-stance") && ["Defensive Stance", 1], rune(ctx, "taunting-rune") && ["Taunting Rune", 1],
    ] },
    { id: "weakened", name: "Weakened", side: "target", potency: true, sources: (ctx, p) => [
      rune(ctx, "weakening-roar-rune") && ["Weakening Roar Rune", 0.5], p("weakening") && ["Weakening", 0.2 * p("weakening")], p("woof-spirit") && ["Woof Spirit", 1],
      p("slayer-rage") && ["Slayer Rage", 0.5], p("iron-slayer-spirit") && ["Iron Slayer Spirit", 0.2], ctx.build.race === "dark-elf" && ["Dark Elf", 0.5],
      ctx.draconic && ctx.draconic.blooded && ctx.draconic.color === "Hex" && ctx.draconic.ability.id !== "infusion" && p("draconic-blood") && [`${ctx.draconic.ability.name} (Hex)`, 0.1 * p("draconic-blood")],
      p("void-root-spirit") && ["Void Root Spirit", 0.5], p("wild-bolt") && ["Wild Bolt", 0.5],
    ] },
  ];

  // Sources that can keep each DoT on the target.
  const DOT_SOURCES = {
    Burn: ["ignition", "dragon-breath", "bellowing-ember", "echo-incineration", "exhaust", "fiery-pursuit", "heat-drill", "sunburn", "pyre-bloom",
      "wild-bolt", "void-root-spirit", "dragigator-spirit", "solar-light", "propelling-fun", "cursed-bark"],
    Bleed: ["vicious-edge", "serrated-edge", "penance", "phalanx-stab", "sharp-claws", "splinter", "gorecast", "gelid-lance", "whirlwind",
      "ichor-spark", "thorns", "ice-burst", "caci-spirit", "gremlin-spirit", "winter-woof-spirit", "saw-stance", "saw-heart", "wild-bolt", "void-root-spirit", "cursed-bark"],
    Poison: ["poisonous", "venom-spitter", "fungal-prototype", "gaseous-smash", "toxin-transfer", "toxin-caster", "proto-tech", "spore-burst",
      "fragrance-aura", "pure-rot", "ghastly-rot", "infection", "virulent-core", "wild-bolt", "void-root-spirit", "cursed-bark"],
  };
  const DOT_RUNES = { Burn: ["fireball-rune", "brainblast-rune"], Bleed: ["cacitrops-rune", "sanguine-bolt-rune", "glacial-snapper-mount-rune"], Poison: ["boostshroom-rune", "proto-grappler-rune", "sporeling-toss-rune"] };
  const POTENCY_PERKS = {
    Burn: ["burn-potency", "ignition", "echo-incineration", "pyre-bloom", "sunburn", "cinder-soul", "trickster"],
    Bleed: ["bleed-potency", "blood-thirsty", "sharp-claws", "slow-leak", "splinter", "thorns", "gorecast", "barbskin", "trickster"],
    Poison: ["poison-potency", "fungal-prototype", "gnawing-poison", "spore-burst", "toxin-transfer", "venom-eater", "caustic-slow", "infection", "siphoning-rot", "trickster"],
  };

  // ------------------------------------------------------------ potions
  const POTIONS = [
    { id: "rage-potion", name: "Rage Potion", desc: "Rage at 0.4 potency for 15s" },
    { id: "poison-potion", name: "Poison Potion", desc: "Poison on yourself (0 potency, 10s)" },
    { id: "throwable-damage-potion", name: "Throwable Damage Potion", desc: "12 Physical damage in an area (level scaling only)" },
    { id: "throwable-poison-potion", name: "Throwable Poison Potion", desc: "Poisons the target for 10s" },
  ];

  // Monk spirits released with RMB (or rune), usable as Test attacks. null types/scalings = weapon's.
  const SPIRITS = {
    "basic-spirit": { hits: [[9, 3]], finisher: true },
    "bomber-spirit": { hits: [[9, 4]], types: { Holy: 0.5, Magic: 0.5 }, scalings: { Holy: 1, Magic: 1 } },
    "bowldur-spirit": { hits: [[5, 1]], types: { Earth: 0.5, Physical: 0.5 }, scalings: { Earth: 1, Physical: 1 } },
    "bulfrogg-spirit": { hits: [[23, 1]], types: { Water: 1 }, scalings: { Water: 1 } },
    "buni-spirit": { hits: [[2, 20]], finisher: true },
    "caci-spirit": { hits: [[5, 7], [15, 3]], types: { Physical: 1 }, scalings: { Physical: 1, Dexterity: 1 } },
    "dire-buni-spirit": { hits: [[25, 1]], types: { Physical: 1 }, finisher: true },
    "dragigator-spirit": { hits: [[5, 4]], types: { Fire: 1 }, scalings: { Fire: 1 } },
    "gremlin-spirit": { hits: [[2.5, 10]], types: { Physical: 1 }, scalings: { Physical: 1, Dexterity: 1 } },
    "mageling-spirit": { hits: [[27.5, 1]], types: { Magic: 1 }, scalings: { Magic: 1 }, kind: "rune" },
    "queen-bumblz-spirit": { hits: [[8, 9]], types: { Magic: 0.5, Holy: 0.5 }, scalings: { Magic: 1, Holy: 1, Summon: 1 } },
    "roguent-spirit": { hits: [[4, 4]], types: { Physical: 1 }, scalings: { Dexterity: 1 }, alwaysCrit: true },
    "snoeman-spirit": { hits: [[12, 1], [4.5, 10]], types: { Water: 0.5, Magic: 0.5 }, scalings: { Water: 1, Magic: 1 } },
    "toadzerker-spirit": { hits: [[30, 1]], types: { Physical: 1 }, scalings: { Physical: 1 } },
    "void-root-spirit": { hits: [[1, 23]], types: { Hex: 0.5, Physical: 0.5 }, scalings: { Hex: 1, Physical: 1 } },
    "winter-woof-spirit": { hits: [[6, 1]], types: { Physical: 1 }, scalings: { Physical: 1, Dexterity: 1 } },
    "woof-spirit": { hits: [[24, 1]], types: { Hex: 1 }, scalings: { Physical: 1, Hex: 1 } },
  };

  // ------------------------------------------------------------ perks
  // def: default toggle state (situational perks start off). uses: situation inputs it reads.
  const P = {};
  const perk = (id, label, def, fx, uses) => { P[id] = { id, label, def, fx, uses: uses || [] }; };

  // ---- general damage multipliers
  perk("bellowing-ember", "≤(40+5×amt)% HP: +10%/amt damage (+23%/amt on attacks with Fire)", true, (E, a, S) => {
    if (S.selfHp > 40 + 5 * a) return;
    E.mult("Bellowing Ember", (atk, types) => 1 + (types.Fire > 0 ? 0.23 : 0.1) * a, ALL);
  }, ["selfHp"]);
  perk("berserking-strength", "Unbalanced weaponry: +10%/amt damage, +(10+10×amt)% attack speed", true, (E, a, S, ctx) => {
    const ok = (atk) => W(atk) && UNBALANCED.includes(atk.form);
    E.mult("Berserking Strength", 1 + 0.1 * a, ok);
    E.atkSpeed("Berserking Strength", 10 + 10 * a, ok);
  });
  perk("blood-thirsty", "Consumes your Bleed: +17.5%/amt damage", false, (E, a, S) => { if (S.target.Bleed) E.mult("Blood Thirsty", 1 + 0.175 * a, NODOT); });
  perk("civilian", "Weapon sheathed 3s: runes +40%/amt", false, (E, a) => E.mult("Civilian", 1 + 0.4 * a, (atk) => atk.kind === "rune"));
  perk("cleave", "+10%/amt damage to Shattered targets", true, (E, a, S) => { if (S.shatter > 0) E.mult("Cleave", 1 + 0.1 * a, ALL); });
  perk("curse-rip", "Debuffed target: +(10×amt−10+5×debuffs)% damage", true, (E, a, S) => {
    if (S.targetDebuffs > 0) E.mult("Curse Rip", 1 + Math.max(0, 10 * a - 10 + 5 * S.targetDebuffs) / 100, NODOT);
  }, ["extraTargetDebuffs"]);
  perk("cut-down", "+30%/amt × target HP% damage", true, (E, a, S) => E.mult("Cut Down", 1 + 0.3 * a * S.targetHp / 100, ALL), ["targetHp"]);
  perk("dark-one", "+6.67%/amt per debuff on you", true, (E, a, S) => { if (S.selfDebuffs) E.mult("Dark One", 1 + (a * S.selfDebuffs) / 15, ALL); }, ["extraSelfDebuffs"]);
  perk("deltabit", "M2 +10%/amt damage", true, (E, a) => E.mult("Deltabit", 1 + 0.1 * a, (atk) => atk.kind === "m2"));
  perk("energize", "Fully charged: weapon art +50%/amt", false, (E, a) => E.mult("Energize", 1 + 0.5 * a, ART));
  perk("executioner", "+60%/amt × target missing HP% damage", true, (E, a, S) => E.mult("Executioner", 1 + 0.6 * a * (1 - S.targetHp / 100), ALL), ["targetHp"]);
  perk("frequent-flier", "Airborne: +20%/amt damage", false, (E, a) => E.mult("Frequent Flier", 1 + 0.2 * a, ALL));
  perk("guiding-winds", "Charged by moving: +40%/amt (+30%/amt arts & runes)", false, (E, a) => E.mult("Guiding Winds", (atk) => 1 + (AR(atk) ? 0.3 : 0.4) * a, ALL));
  perk("highlander", "Arts & runes +20%/amt damage, +10/amt armor pen", true, (E, a) => { E.mult("Highlander", 1 + 0.2 * a, AR); E.pen("Highlander", 10 * a, AR); });
  perk("juggernaut", "+0.75%/amt per 1% negative speed & attack speed stat", true, (E, a, S, ctx) => {
    const neg = Math.max(0, -(ctx.stats["Speed Boost"] || 0)) + Math.max(0, -(ctx.stats["Attack Speed"] || 0));
    if (neg) E.mult("Juggernaut", 1 + 0.0075 * neg * a, ALL);
  });
  perk("marsh-flow", "While you have Regen: +20%/amt damage", true, (E, a, S) => { if (S.self.regen) E.mult("Marsh Flow", 1 + 0.2 * a, ALL); });
  perk("money-smart", "+Voxos/500k ×amt damage", true, (E, a, S) => E.mult("Money Smart", 1 + (Math.min(S.voxos, 100000) / 500000) * a, ALL), ["voxos"]);
  perk("packaged-power", "+15%/amt × inventory fullness (250 items)", true, (E, a, S) => E.mult("Packaged Power", 1 + 0.15 * a * Math.min(1, S.items / 250), ALL), ["items"]);
  perk("penance", "Low HP: up to +25%/amt (max at 35% HP)", true, (E, a, S) => {
    const x = S.selfHp / 100;
    E.mult("Penance", 1 + a * Math.min(0.25, (0.25 * (1 - x)) / 0.65), ALL);
  }, ["selfHp"]);
  perk("reaper", "+5%/amt per debuff on target", true, (E, a, S) => { if (S.targetDebuffs) E.mult("Reaper", 1 + 0.05 * a * S.targetDebuffs, ALL); }, ["extraTargetDebuffs"]);
  perk("rider", "Mounted: +20%/amt damage", false, (E, a) => E.mult("Rider", 1 + 0.2 * a, ALL));
  perk("sharpshooter", "Hitting from range: +20%/amt damage", false, (E, a) => E.mult("Sharpshooter", 1 + 0.2 * a, ALL));
  perk("smoldering", "While burning: +20%/amt damage", true, (E, a, S) => { if (S.self["self-burn"]) E.mult("Smoldering", 1 + 0.2 * a, ALL); });
  perk("spring-powered", "+1%/amt per Jump Boost", true, (E, a, S, ctx) => { const j = ctx.stats["Jump Boost"] || 0; if (j > 0) E.mult("Spring Powered", 1 + 0.01 * j * a, ALL); });
  perk("standoff", "Standing still: up to +20%/amt damage", false, (E, a) => E.mult("Standoff", 1 + 0.2 * a, ALL));
  perk("stealth", "Target not aggroed on you (always on dummies): +10%/amt", true, (E, a) => E.mult("Stealth", 1 + 0.1 * a, ALL));
  perk("steam-powered", "+0.133%/amt per 1% Air Boost", true, (E, a, S, ctx) => { const air = ctx.stats["Air Boost"] || 0; if (air > 0) E.mult("Steam Powered", 1 + (2 / 15) * a * air / 100, ALL); });
  perk("vampire", "In darkness: +6.67%/amt (half outside)", true, (E, a, S) => E.mult("Vampire", 1 + (S.shadows ? 0.0666 : 0.0333) * a, ALL));
  perk("vassals-croak", "+2%/amt per active minion; RMB consumes Last Croak for an explosion", true, (E, a, S) => {
    if (S.summons) E.mult("Vassals Croak", 1 + 0.02 * S.summons * a, ALL);
    if (S.lastCroak > 0) E.echo({ name: "Last Croak explosion", frac: (S.lastCroak * (1 + a)) / 15, types: { Physical: 1 }, when: (atk) => atk.kind === "m2" });
  }, ["summons", "lastCroak"]);
  perk("void-contract", "Marked target: +30%/amt (not DoTs)", false, (E, a) => E.mult("Void Contract", 1 + 0.3 * a, NODOT));
  perk("hex-shield", "Converted Energy after blocking a debuff: +10%/amt", false, (E, a) => E.mult("Converted Energy", 1 + 0.1 * a, ALL));
  perk("minion-absorption", "Minion Absorbed: +0.2%/amt per 1% Summon Boost", false, (E, a, S, ctx) => E.mult("Minion Absorbed", 1 + 0.002 * (ctx.stats["Summon Boost"] || 0) * a, ALL));
  perk("true-balance", "+0.125%/amt per 1% Holy Boost (Hex & Holy are averaged ×1.5 in your stats)", true, (E, a) => {
    E.mult("True Balance", (atk, types, st) => 1 + (st["Holy Boost"] || 0) * a / 800, ALL);
  });
  perk("raging-bounce", "With Bounce: +70% × Bounce potency per amt damage", true, (E, a, S) => {
    if (S.self.bounce && S.bouncePotency) E.mult("Raging Bounce", 1 + 0.7 * S.bouncePotency * a, ALL);
  });
  perk("quickcast", "Weapon arts cast (20+10×amt)% faster", true, (E, a) => E.artCast(20 + 10 * a));
  perk("wildfire", "DoTs hit every enemy in range (AoE)", true, (E, a, S) => {
    if (S.enemies > 1) ["Burn", "Bleed", "Poison"].forEach((k) => E.dot(k, { mult: S.enemies }));
  }, ["enemies"]);
  perk("echo-blast", "Summoning a minion fires a tornado: (3.5+1.5×amt) Air per minion", true, (E, a, S, ctx) => {
    const n = S.summonsPerCast * (ctx.perks.swarm ? 2 : 1);
    E.proc({ name: "Echo Blast", on: "cast", when: SUMMONER, hits: [[3.5 + 1.5 * a, n]], types: { Air: 1 }, scalings: { Air: 1, Summon: 1 } });
  }, ["summonsPerCast"]);
  perk("undead-might", "Arts & runes +25%/amt damage", true, (E, a) => E.mult("Undead Might", 1 + 0.25 * a, AR));
  perk("valor", "+6.67%/amt vs Taunted", true, (E, a, S) => { if (S.target.taunted) E.mult("Valor", 1 + 0.0666 * a, ALL); });
  perk("grounded-despair", "Despair after landing a jump: +8.5%/amt", false, (E, a) => E.mult("Despair", 1 + 0.085 * a, ALL));
  perk("quickdraw", "Quickdraw (5s after drawing weapon): arts & runes +30%/amt", false, (E, a) => E.mult("Quickdraw", 1 + 0.3 * a, AR));
  perk("toxin-caster", "Arts & runes with Magic: +5% × Poison Potency × amt", true, (E, a, S) => {
    E.mult("Toxin Caster", 1 + 0.05 * S.potency.Poison * a, (atk, types) => AR(atk) && types.Magic > 0);
  });
  perk("dark-magic", "30%/amt weapon Magic → Hex; +20%/amt on attacks with Hex", true, (E, a) => {
    E.convert("Dark Magic", "Magic", "Hex", Math.min(1, 0.3 * a), (atk) => atk.weaponTypes, true);
    E.mult("Dark Magic", 1 + 0.2 * a, hasType("Hex"));
  });
  perk("true-moon", "30%/amt weapon Magic → True; +15%/amt with True; 50% True moon proc", true, (E, a) => {
    E.convert("True Moon", "Magic", "True", Math.min(1, 0.3 * a), (atk) => atk.weaponTypes, true);
    E.mult("True Moon", 1 + 0.15 * a, hasType("True"));
    E.proc({ name: "True Moon", on: "hit", chance: 0.5, hits: [[2 + 1.5 * a, 1]], types: { True: 1 }, scalings: { Magic: 1 } });
  });

  // ---- conditional on target debuffs
  perk("dragon-breath", "+10%/amt vs Burning; finisher fire blasts", true, (E, a, S) => {
    if (S.target.Burn) E.mult("Dragon Breath", 1 + 0.1 * a, ALL);
    E.proc({ name: "Dragon Breath", on: "finisherHit", decay: true, hits: [[2 + 0.6 * a, 1]], types: { Fire: 1 }, scalings: { Fire: 1 } });
  });
  perk("explosive-honey", "+10%/amt vs Sticky; finisher honey burst", true, (E, a, S) => {
    if (S.target.sticky) E.mult("Explosive Honey", 1 + 0.1 * a, ALL);
    E.proc({ name: "Explosive Honey", on: "finisher", hits: [[3 * a, 1]], types: { Magic: 1 }, scalings: { Magic: 1, Physical: 1 } });
  });
  perk("extinguish", "Water damage +50%/amt vs Burning", true, (E, a, S) => { if (S.target.Burn) E.typeMult("Extinguish", ["Water"], 1 + 0.5 * a); });
  perk("frostbite", "+10%/amt vs Slowed", true, (E, a, S) => { if (S.target.slowed || S.target.frostbite) E.mult("Frostbite", 1 + 0.1 * a, ALL); });
  perk("gelid-lance", "+10%/amt vs Bleeding; Bleed +0.5/amt Water scaling", true, (E, a, S) => {
    if (S.target.Bleed) E.mult("Gelid Lance", 1 + 0.1 * a, ALL);
    E.dot("Bleed", { addScal: { Water: 0.5 * a } });
  });
  perk("gorecast", "Weapon arts +20%/amt vs Bleeding", true, (E, a, S) => { if (S.target.Bleed) E.mult("Gorecast", 1 + 0.2 * a, ART); });
  perk("hemorrhage", "Bleeding target: +(10+10×amt)% damage, +0.1/amt True type", true, (E, a, S) => {
    if (!S.target.Bleed) return;
    E.mult("Hemorrhage", 1 + 0.1 + 0.1 * a, ALL);
    E.addType("Hemorrhage", "True", 0.1 * a, NODOT);
  });
  perk("sticky-swings", "+15%/amt vs Sticky", true, (E, a, S) => { if (S.target.sticky) E.mult("Sticky Swings", 1 + 0.15 * a, ALL); });
  perk("sunburn", "Burning target: +10%/amt (+15%/amt with Holy), incl. DoTs", true, (E, a, S) => {
    if (S.target.Burn) E.mult("Sunburn", (atk, types) => 1 + (types.Holy > 0 ? 0.15 : 0.1) * a, ALL);
  });
  perk("venom-spitter", "+10%/amt vs Poisoned; finisher venom blasts", true, (E, a, S) => {
    if (S.target.Poison) E.mult("Venom Spitter", 1 + 0.1 * a, ALL);
    E.proc({ name: "Venom Spitter", on: "finisherHit", decay: true, hits: [[2 + 0.6 * a, 1]], types: { Hex: 1 }, scalings: { Hex: 1, Earth: 1 } });
  });
  perk("vicious-edge", "+20%/amt vs Bleeding", true, (E, a, S) => { if (S.target.Bleed) E.mult("Vicious Edge", 1 + 0.2 * a, ALL); });
  perk("mycotic-bloom", "Poison +25%/amt on targets below 50% HP", true, (E, a, S) => { if (S.targetHp < 50) E.dot("Poison", { mult: 1 + 0.25 * a }); }, ["targetHp"]);
  perk("melting-slime", "Sticky: +20% Fire & Earth taken, Fire/Earth DoT", true, (E, a, S) => {
    if (S.target.sticky) E.tick({ name: "Melting Slime", perSecond: 1, hits: [[2.5, 1]], types: { Fire: 0.5, Earth: 0.5 }, scalings: { Fire: 0.75 + 0.25 * a, Earth: 1.5 + 0.25 * a }, noBonus: true });
  });

  // ---- type and damage-type perks
  perk("channeled-weapon", "+0.05/amt Magic type (not DoTs); weapon art cooldown ×(0.8−0.05×amt)", true, (E, a) => {
    E.addType("Channeled Weapon", "Magic", 0.05 * a, NODOT);
    E.cd("art", "mult", Math.max(0.05, 0.8 - 0.05 * a));
  });
  perk("concealed-edge", "In shadows: +0.25/amt Hex type on everything", true, (E, a, S) => { if (S.shadows) E.addType("Concealed Edge", "Hex", 0.25 * a, ALL); });
  perk("echo-incineration", "Fire ↔ Air swapped by half; fiery tornado proc", true, (E, a) => {
    E.swap("Echo Incineration", "Fire", "Air");
    E.proc({ name: "Echo Incineration", on: "hit", chance: (10 + 2.5 * a) / 100, hits: [[7 + 1.25 * a, 1]], types: { Air: 0.5, Fire: 0.5 }, scalings: { Air: 1, Fire: 1 } });
  });
  perk("emotional", "Only debuffs: +20%/amt attack speed, +0.1/amt Fire · only buffs: art CDR, +0.1/amt Hex on arts", true, (E, a, S) => {
    if (S.emotional === "debuffs") { E.atkSpeed("Emotional", 20 * a, ALL); E.addType("Emotional", "Fire", 0.1 * a, NODOT); }
    if (S.emotional === "buffs") { E.cd("art", "speed", 0.5 * a); E.addType("Emotional", "Hex", 0.1 * a, ART); }
  }, ["emotional"]);
  perk("glyph-conduit", "Glyph Conduit (after RMB/rune): pure Magic +20%/amt", false, (E, a) => E.typeMult("Glyph Conduit", ["Magic"], 1 + 0.2 * a));
  perk("melting-shred", "DoTs +0.15/amt True type", true, (E, a) => E.dotAll({ addType: { True: 0.15 * a } }));
  perk("mortal-will", "Finishers +0.1/amt Holy type, +0.15%/amt per 1% Holy Boost", true, (E, a) => {
    E.addType("Mortal Will", "Holy", 0.1 * a, FIN);
    E.mult("Mortal Will", (atk, types, st) => 1 + 0.0015 * (st["Holy Boost"] || 0) * a, FIN);
  });
  perk("photosynthesis", "In sunlight: Holy & Earth damage +25%/amt", true, (E, a, S) => { if (S.sun) E.typeMult("Photosynthesis", ["Holy", "Earth"], 1 + 0.25 * a); });
  perk("piercer", "Finishers become True damage +0.1/amt, +20%/amt (10% on other weapons)", true, (E, a) => {
    E.convert("Piercer", "*", "True", 1, FIN);
    E.addType("Piercer", "True", 0.1 * a, FIN);
    E.mult("Piercer", (atk) => 1 + (PIERCER_FULL.includes(atk.form) ? 0.2 : 0.1) * a, FIN);
  });
  perk("spirit-winds", "Tailwind: +(Tailwind/3 + 13.3%/amt) damage, 10%/amt Air → Magic", true, (E, a, S) => {
    if (!S.self.tailwind) return;
    E.mult("Spirit Winds", 1 + S.tailwindPotency / 3 + (2 / 15) * a, ALL);
    E.convert("Spirit Winds", "Air", "Magic", Math.min(1, 0.1 * a), ALL);
  });
  perk("stone-weapon", "+0.3/amt Earth on weapon damage; attack time ×(1+0.07×amt)", true, (E, a) => {
    E.addType("Stone Weapon", "Earth", 0.3 * a, (atk) => atk.weaponTypes);
    E.atkTime(1 + 0.07 * a);
  });
  perk("toxin-transfer", "While you're Poisoned: +0.1/amt Hex type", true, (E, a, S) => { if (S.self["self-poison"]) E.addType("Toxin Transfer", "Hex", 0.1 * a, ALL); });
  perk("wind-walker", "Tailwind: weapon arts +10/amt pen, +0.15/amt Air", true, (E, a, S) => {
    if (!S.self.tailwind) return;
    E.pen("Wind Walker", 10 * a, ART);
    E.addType("Wind Walker", "Air", 0.15 * a, ART);
  });
  perk("cursed-flames", "Burn becomes 0.5 Fire / 0.5 Hex with 1.0 Fire + 1.0 Hex scaling", true, (E) => E.dot("Burn", { setTypes: { Fire: 0.5, Hex: 0.5 }, setScal: { Fire: 1, Hex: 1 } }));
  perk("ghastly-rot", "Poison deals True damage instead of Hex", true, (E) => E.dot("Poison", { setTypes: { True: 1 } }));
  perk("kindling", "Burn deals +50%/amt damage (80% shorter)", true, (E, a) => E.dot("Burn", { mult: 1 + 0.5 * a }));
  perk("sandy-wounds", "Bleed gains Air & Earth type and 0.5 Air/Earth scaling", true, (E, a, S, ctx) => {
    const add = 0.2 * (1 + ((ctx.stats["Earth Boost"] || 0) + (ctx.stats["Air Boost"] || 0)) / 100 * a);
    E.dot("Bleed", { addType: { Air: add / 2, Earth: add / 2 }, addScal: { Air: 0.5, Earth: 0.5 } });
  });
  perk("draconic-runes", "Runes (and your draconic rune) +0.05/amt type of your draconic color", true, (E, a, S, ctx) => {
    E.addType("Draconic Runes", ctx.build.race === "dragon-blooded" ? S.element : "Physical", 0.05 * a, (atk) => atk.kind === "rune");
  });
  perk("draconic-blood", "Draconic rune infusion; Dragon Infusion adds your color's type (+0.1 per 0.1 potency) to attacks", true, (E, a, S, ctx) => {
    const d = ctx.draconic;
    if (!d || d.ability.id !== "infusion") return;
    const st = ctx.statuses["draconic-infusion"];
    const pot = st && st.potency !== null ? st.potency : 0.1 * a;
    // the Draconic Infusion toggle for single hits; in the timeline only inside the buff windows
    const up = (atk) => atk.kind !== "dot" && (atk.dracInf !== undefined ? atk.dracInf : !!S.self["draconic-infusion"]);
    E.addType("Draconic Infusion", d.type, pot, up);
    if (d.blooded && d.color === "Air") E.atkSpeed("Draconic Infusion (Air)", 100 * pot, up);
  });
  perk("rejuvenating-flame", "Cinder Surge: +(0.025+0.025×amt) Fire type", false, (E, a) => E.addType("Cinder Surge", "Fire", 0.025 + 0.025 * a, NODOT));

  // ---- weapon attack (M1/M2) modifiers
  perk("aggressive-personality", "Hammer slam finishers +30%/amt", true, (E, a) => E.mult("Aggressive Personality", 1 + 0.3 * a, slam));
  perk("pursuit", "M1s ×(0.6+0.2×amt), no knockback", true, (E, a) => E.mult("Pursuit", 0.6 + 0.2 * a, (atk) => atk.kind === "m1"));
  perk("rotating-blades", "M1/M2 hit twice at (0.5+0.1×amt)× damage", true, (E, a) => E.hitsMult(2, 0.5 + 0.1 * a, W));
  perk("savage-combo", "+15%/amt per M1/M2 in the chain (max 3)", true, (E, a) => E.mult("Savage Combo", (atk) => 1 + 0.15 * a * Math.min(3, atk.chain || 1), W));
  perk("scourge", "50%/amt chance: +50% damage; True affected by Rage", true, (E, a) => {
    E.mult("Scourge (expected)", 1 + 0.5 * Math.min(1, 0.5 * a), ALL);
    E.rageTypes(["True"]);
  });
  perk("serrated-edge", "Finishers +20%/amt, apply Bleed", true, (E, a) => E.mult("Serrated Edge", 1 + 0.2 * a, FIN));
  perk("queens-power", "Queens Power (after summoning): +(20+10×amt)% atk speed, M1/M2 +0.2%/amt per 1% Summon", false, (E, a, S, ctx) => {
    E.atkSpeed("Queens Power", 20 + 10 * a, W);
    E.mult("Queens Power", 1 + 0.002 * a * (ctx.stats["Summon Boost"] || 0), W);
  });
  perk("cleansed-blade", "Oceanic Blade (after Cleanse): M1/M2 +0.15%/amt per 1% Water Boost", false, (E, a, S, ctx) => {
    E.mult("Oceanic Blade", 1 + 0.0015 * a * (ctx.stats["Water Boost"] || 0), W);
  });
  perk("delta-drill", "M1 finisher repeats amt times at reduced damage", true, (E, a) => E.deltaDrill(Math.round(a)));
  perk("storm-caster", "Chain lightning for 1/6 of M1/M2 damage", true, (E, a, S, ctx) => {
    if (ctx.form.m1 === "Storm Caster") E.chain({ name: "Storm Caster chain", frac: 1 / 6, extra: 2, types: { Air: 0.5, Magic: 0.5 }, when: W });
  });

  // ---- weapon art / rune modifiers & overrides
  perk("guardian-spin", "Spin +(15+17.25×amt)%", true, (E, a) => E.mult("Guardian Spin", 1 + 0.15 + 0.1725 * a, (atk) => atk.artId === "spin"));
  perk("weighty-slam", "Slam base +20%/amt, pure Physical", true, (E, a) => E.override((atk) => atk.artId === "slam" ? { ...atk, hits: atk.hits.map(([d, n]) => [d * (1 + 0.2 * a), n]), types: { Physical: 1 } } : atk));
  perk("wild-bolt", "Laser 18.75 base, +25%/amt", true, (E, a) => {
    E.override((atk) => atk.artId === "laser" ? { ...atk, hits: [[18.75, 1]] } : atk);
    E.mult("Wild Bolt", 1 + 0.25 * a, (atk) => atk.artId === "laser");
  });
  perk("essence-ray", "Magical Ray → (1.1+0.275×amt)×23 True", true, (E, a) => E.override((atk) => atk.artId === "magical-ray" ? { ...atk, hits: [[1.1 + 0.275 * a, 23]], types: { True: 1 } } : atk));
  perk("heat-drill", "Lunge/Barrage → fiery dash (15 s cooldown)", true, (E, a) => E.override((atk) => (atk.artId === "lunge" || atk.artId === "barrage") ? {
    ...atk, cooldownBase: 15, hits: [[15 + 7.5 * a, 1], [15 + 7.5 * a, 1], [3.75 + 1.875 * a, 4]], types: { __highest__: 0.4, Fire: 0.3, Air: 0.3 },
  } : atk));
  perk("bomber-charge", "Retaliate → Bomber Charge (missing HP scaling)", true, (E, a, S) => E.override((atk) => atk.artId === "retaliate" ? {
    ...atk, hits: [[12.5 * (1 + 0.15 * a) * (1 + 12.8 * Math.min(0.5, 1 - S.selfHp / 100)), 1]], types: { Holy: 0.5, True: 0.5 }, scalings: { Holy: 0.4, Magic: 0.4 },
  } : atk), ["selfHp"]);
  perk("solar-light", "Lesser Heal → sun beam (needs sunlight)", true, (E, a, S) => E.override((atk) => atk.artId === "lesser-heal" && S.sun ? {
    ...atk, hits: [[(1.65 + 0.5 * a) * 1.05, 15]], types: { Holy: 1 }, scalings: { Holy: 1 },
  } : atk));

  // ---- crits
  perk("flowing-crits", "+0.0875%/amt crit chance per 1% Air Boost", true, (E, a, S, ctx) => E.natCrit("Flowing Crits", 0.0875 * (ctx.stats["Air Boost"] || 0) * a));
  perk("seismic-momentum", "Crit from Earth Boost (0.075%/amt) instead of Dexterity", true, (E, a, S, ctx) => { E.noDexCrit(); E.natCrit("Seismic Momentum", 0.075 * (ctx.stats["Earth Boost"] || 0) * a); });
  perk("spell-slinger", "+0.075%/amt crit chance per 1% Magic Boost", true, (E, a, S, ctx) => E.natCrit("Spell Slinger", 0.075 * (ctx.stats["Magic Boost"] || 0) * a));
  perk("sharp-crits", "+0.1%/amt crit chance per 1% Physical Boost; crits +20/amt pen", true, (E, a, S, ctx) => {
    E.natCrit("Sharp Crits", 0.1 * (ctx.stats["Physical Boost"] || 0) * a);
    E.critPen(20 * a);
  });
  perk("heightened-reflexes", "+1.5%/amt crit chance", true, (E, a) => E.natCrit("Heightened Reflexes", 1.5 * a));
  perk("perfection", "Perfection stacks: +2% damage, +1% crit chance & damage each", true, (E, a, S) => {
    const st = Math.min(S.perfection, 5 * a);
    if (!st) return;
    E.mult("Perfection", 1 + 0.02 * st, ALL);
    E.natCrit("Perfection", st);
  }, ["perfection"]);
  perk("critical-master", "+0.05×/amt crit damage", true, (E, a) => E.critDmg("Critical Master", 0.05 * a, ALL));
  perk("vital-strikes", "+0.25×/amt crit damage", true, (E, a) => E.critDmg("Vital Strikes", 0.25 * a, ALL));
  perk("spark", "+0.5×/amt crit damage vs Burning", true, (E, a, S) => { if (S.target.Burn) E.critDmg("Spark", 0.5 * a, ALL); });
  perk("splinter", "+0.1×/amt crit damage vs Bleeding", true, (E, a, S) => { if (S.target.Bleed) E.critDmg("Splinter", 0.1 * a, ALL); });
  perk("golden-crits", "40% of crits deal +50%/amt", true, (E, a) => E.critOnly("Golden Crits (expected)", 1 + 0.4 * 0.5 * a, ALL));
  perk("spell-piercer", "Art/rune crits +20%/amt and ignore positive defenses", true, (E, a) => { E.critOnly("Spell Piercer", 1 + 0.2 * a, AR); E.critIgnoreDef(AR); });
  perk("primal", "Crit chance quartered; +1%/amt damage per 1% crit chance", true, (E, a) => E.primal(a));
  perk("carrying-winds", "High-knockback attacks: +10%/amt, extra crit roll from Air Boost", false, (E, a, S, ctx) => {
    E.mult("Carrying Winds", 1 + 0.1 * a, ALL);
    E.critRoll("Carrying Winds", Math.min(1, (ctx.stats["Air Boost"] || 0) * a / 100), (atk) => !atk.isChain); // chain lightning isn't high knockback
  });
  perk("thief-training", "Base crit ×1.0+0.1/amt; behind the target always crit (+20%, or +30% if it'd crit anyway)", false, (E, a) => E.thief(a));
  perk("venom-eater", "Hit that consumes your Poison: guaranteed crit +10%/amt (base crit −0.3×+0.1/amt always applies)", false, (E, a, S) => {
    if (S.target.Poison) E.alwaysCrit("Venom Eater", 1 + 0.1 * a, NODOT);
  });
  perk("royal-parry", "Hit consuming Critical Boost: +50%/amt", true, (E, a, S) => { if (S.self["critical-boost"]) E.alwaysCrit("Royal Parry", 1 + 0.5 * a, NODOT); });
  perk("fractured-energy", "Natural crits become Fractured: (20+20×amt)% of damage repeated", true, (E, a) => E.fractured(0.2 + 0.2 * a));
  perk("caci-king-spirit", "King's Luck: extra 20% crit roll and +2 Lucky", false, (E) => { E.critRoll("King's Luck", 0.2, ALL); E.lucky(2); });
  perk("lucky", "Failed chance effects reroll at 2/3 of their chance, once per Lucky", true, (E, a) => E.lucky(a));

  // ---- armor
  perk("crushing-pressure", "+10/amt armor pen, +15%/amt of the target's matching defense", true, (E, a) => { E.pen("Crushing Pressure", 10 * a, ALL); E.penByDefense(0.15 * a); });

  // ---- attack speed
  perk("inhuman-swings", "M1/M2 attack speed +(Dex+Phys)/(350−50×amt)", true, (E, a, S, ctx) => {
    const pct = Math.min(300, ((ctx.stats["Dexterity Boost"] || 0) + (ctx.stats["Physical Boost"] || 0)) / Math.max(50, 350 - 50 * a) * 100);
    if (pct > 0) E.atkSpeed("Inhuman Swings", pct, W);
  });
  perk("engine", "+0.25%/amt attack speed per 1% Speed Boost, +3%/amt per 0.1 Tailwind", true, (E, a, S, ctx) => {
    const pct = 0.25 * Math.max(0, ctx.stats["Speed Boost"] || 0) * a + (S.self.tailwind ? 30 * S.tailwindPotency * a : 0);
    if (pct) E.atkSpeed("Engine", pct, ALL);
  });
  perk("blood-lust", "Bloodlust: +20% attack speed per 1 potency (max 2.5/amt)", false, (E, a, S) => E.atkSpeed("Bloodlust", 20 * Math.min(S.bloodlust, 2.5 * a), ALL), ["bloodlust"]);
  perk("flash-strike", "After a parry: +75%/amt attack speed", false, (E, a) => E.atkSpeed("Flash Strike", 75 * a, ALL));
  perk("star-barrage", "Star Mode after a weapon art: +(20+25×amt)% attack speed", false, (E, a) => E.atkSpeed("Star Mode", 20 + 25 * a, ALL));
  perk("poison-acceleration", "While you're Poisoned: +20%/amt attack speed and art/rune cooldown speed", true, (E, a, S) => {
    if (!S.self["self-poison"]) return;
    E.atkSpeed("Poison Acceleration", 20 * a, ALL);
    E.artCast(20 * a);
    E.cd("art", "speed", 0.2 * a); E.cd("rune", "speed", 0.2 * a);
  });
  perk("roaring-heads", "+5%/amt attack speed per debuff on you", true, (E, a, S) => { if (S.selfDebuffs) E.atkSpeed("Roaring Heads", 5 * a * S.selfDebuffs, ALL); }, ["extraSelfDebuffs"]);

  // ---- cooldowns
  perk("caster", "Rune cooldown speed +20%/amt, weapon art +10%/amt", true, (E, a) => { E.cd("rune", "speed", 0.2 * a); E.cd("art", "speed", 0.1 * a); });
  perk("runic-winds", "Tailwind: rune cooldown speed +10%/amt", true, (E, a, S) => { if (S.self.tailwind) E.cd("rune", "speed", 0.1 * a); });
  perk("whirlwind", "Tailwind→Whirlwind: art/rune cooldown speed +30%/amt; wind slash on art/rune", true, (E, a, S) => {
    if (S.self.tailwind) { E.cd("art", "speed", 0.3 * a); E.cd("rune", "speed", 0.3 * a); }
    E.proc({ name: "Whirlwind slash", on: "cast", hits: [[3 + 0.3 * a, 1]], types: { Air: 1 }, scalings: { Air: 1 } });
  });
  perk("magic-surge", "Chance to reset weapon art cooldown (average extra casts)", true, (E, a) => {
    const c = Math.min(0.95, 0.05 + 0.1 * a);
    E.cd("art", "speed", c / (1 - c));
  });
  perk("divinity", "Finishers cut current weapon art cooldown by 10%/amt", true, (E, a) => E.onFinisher("divinity", a));
  perk("shamanic-flow", "M1/M2 hits cut weapon art cooldown by 0.5s/amt", true, (E, a) => E.onWeaponHit("artFlat", 0.5 * a));
  perk("power-surge", "M1/M2 hits cut rune cooldown by (0.5+0.5×amt)s", true, (E, a) => E.onWeaponHit("runeFlat", 0.5 + 0.5 * a));

  // ---- on-hit procs
  perk("bombardier", "40% chance explosion (10+amt) Magic/Holy", true, (E, a) => E.proc({ name: "Bombardier", on: "hit", chance: 0.4, hits: [[10 + a, 1]], types: { Magic: 0.5, Holy: 0.5 }, scalings: { Magic: 1, Holy: 1 } }));
  perk("bastion-ballista", "Ranged hits fire arrows (1.25+0.75×amt) Earth", false, (E, a) => E.proc({ name: "Bastion Ballista", on: "hit", hits: [[1.25 + 0.75 * a, 1]], types: { Earth: 1 }, scalings: { Dexterity: 1, Earth: 1 }, cooldown: 0.1, noBonus: true }));
  perk("dragon-state", "Above (85−5×amt)% HP: M1/M2 magic wave (1.5+1.5×amt)", true, (E, a, S) => {
    if (S.selfHp >= 85 - 5 * a) E.proc({ name: "Dragon State", on: "attack", when: W, hits: [[1.5 + 1.5 * a, 1]], types: { Magic: 1 }, scalings: { Magic: 0.75, Dexterity: 0.75, Holy: 0.75 } });
  }, ["selfHp"]);
  perk("glacial-buildup", "Every hit +amt Water; crystals burst for 16×amt", true, (E, a) => {
    const r = Math.max(1, Math.round(a));
    E.proc({ name: "Glacial Buildup", on: "hit", hits: [[r + (16 * a) / Math.ceil(40 / r), 1]], types: { Water: 1 }, scalings: { Water: 1, Physical: 1 }, noBonus: true, noLevel: true });
  });
  perk("quake", "(30+5×amt)% chance Earth shockwave (2.5+2.5×amt)", true, (E, a) => E.proc({ name: "Quake", on: "hit", chance: (30 + 5 * a) / 100, hits: [[2.5 + 2.5 * a, 1]], types: { Earth: 1 }, scalings: { Earth: 1 } }));
  perk("rainstorm", "10%/amt chance raindrop (4+2×amt) Water", true, (E, a) => E.proc({ name: "Rainstorm", on: "hit", chance: Math.min(1, 0.1 * a), hits: [[4 + 2 * a, 1]], types: { Water: 1 }, scalings: { Water: 1 }, cooldown: 0.6 }));
  perk("star-struck", "M1/M2 fire 2×amt stars of random elements", true, (E, a) => E.proc({ name: "Star Struck", on: "attack", when: W, stars: Math.round(2 * a) }));
  perk("stormcaller", "2.5% chance lightning (20+4×amt) Air/Magic", true, (E, a) => E.proc({ name: "Stormcaller", on: "hit", chance: 0.025, hits: [[20 + 4 * a, 1]], types: { Air: 0.5, Magic: 0.5 }, scalings: { Air: 1, Magic: 1 } }));
  perk("tectonic-heat", "~10% chance magma ball (2.5+2.5×amt) Fire", true, (E, a) => E.proc({ name: "Tectonic Heat", on: "hit", chance: 0.1, hits: [[2.5 + 2.5 * a, 1]], types: { Fire: 1 }, scalings: { Fire: 1, Earth: 1 }, cooldown: 0.25 }));
  perk("dark-harvest", "Target ≤50% HP: Hex burst (20+20×amt), 2s cooldown", true, (E, a, S) => {
    if (S.targetHp <= 50) E.proc({ name: "Dark Harvest", on: "attack", when: NODOT, hits: [[20 + 20 * a, 1]], types: { Hex: 1 }, scalings: { Hex: 1 }, cooldown: 2 });
  }, ["targetHp"]);
  perk("quarry", "Every 4 hits: Holy/Physical burst (20×amt)", true, (E, a) => E.proc({ name: "Quarry", on: "hit", every: 4, hits: [[20 * a, 1]], types: { Holy: 0.5, Physical: 0.5 }, scalings: { Holy: 1, Physical: 1 } }));
  perk("runic-blades", "Target marked by an art/rune: magic blade per hit (2+1.5×amt)", true, (E, a) => E.proc({ name: "Runic Blades", on: "hit", needsMark: 6.5 * a, hits: [[2 + 1.5 * a, 1]], types: { Magic: 1 }, scalings: { Magic: 1 }, cooldown: 0.075 }));
  perk("protector-spirit", "Above 50% HP: M1/M2 beam (0.4+0.1×amt)", true, (E, a, S) => {
    if (S.selfHp > 50 || a >= 2) E.proc({ name: "Protector Spirit", on: "attack", when: W, hits: [[0.4 + 0.1 * a, 1]], types: { Earth: 0.5, Magic: 0.5 }, scalings: { Earth: 0.5, Magic: 0.5 } });
  }, ["selfHp"]);
  perk("ignition", "10%/amt chance: amt Fire damage, applies Burn", true, (E, a) => E.proc({ name: "Ignition", on: "hit", chance: Math.min(1, 0.1 * a), hits: [[a, 1]], types: { Fire: 1 }, scalings: { Fire: 1 }, noBonus: true }));
  perk("poisonous", "10%/amt chance: amt Hex damage, applies Poison", true, (E, a) => E.proc({ name: "Poisonous", on: "hit", chance: Math.min(1, 0.1 * a), hits: [[a, 1]], types: { Hex: 1 }, scalings: { Hex: 1 }, noBonus: true }));
  // finishers
  perk("gale-bursts", "Finisher air missiles (1.5+2.5×amt)", true, (E, a) => E.proc({ name: "Gale Bursts", on: "finisherHit", decay: true, hits: [[1.5 + 2.5 * a, 1]], types: { Air: 1 }, scalings: { Air: 1, Dexterity: 1 } }));
  perk("phalanx-stab", "Finisher stabs (1×amt) Physical/Earth", true, (E, a) => E.proc({ name: "Phalanx Stab", on: "finisherHit", decay: true, hits: [[a, 1]], types: { Physical: 0.5, Earth: 0.5 }, scalings: { Physical: 1, Earth: 1 } }));
  perk("tempest", "Finisher tornadoes (0.8+0.266×amt), −25% each", true, (E, a) => E.proc({ name: "Tempest", on: "finisherHit", tempest: true, hits: [[0.8 + 0.2664 * a, 1]], types: { Air: 1 }, scalings: { Air: 1 } }));
  perk("royal-finisher", "Once per finisher: Magic wave (3+amt)", true, (E, a) => E.proc({ name: "Royal Finisher", on: "finisher", hits: [[3 + a, 1]], types: { Magic: 1 }, scalings: { Magic: 1 } }));
  perk("golem-guillotine", "Slam finishers: Earth fissure (6×amt)", true, (E, a) => E.proc({ name: "Golem Guillotine", on: "finisher", when: slam, hits: [[6 * a, 1]], types: { Earth: 1 }, scalings: { Earth: 1 } }));
  perk("gnawing-poison", "Finishers bite Poisoned targets (8×amt), 1.5s cooldown", true, (E, a, S) => {
    if (S.target.Poison) E.proc({ name: "Gnawing Poison", on: "finisher", hits: [[8 * a, 1]], types: { Hex: 0.5, Physical: 0.5 }, scalings: { Hex: 1, Physical: 1 }, cooldown: 1.5 });
  });
  perk("blazing-finisher", "Finishers on Burning targets: 2×amt + 20% of the finisher as Fire", true, (E, a, S) => {
    if (S.target.Burn) E.proc({ name: "Blazing Finisher", on: "finisher", hits: [[2 * a, 1]], types: { Fire: 1 }, scalings: { Fire: 1 }, inherit: 0.2, cooldown: 0.2 });
  });
  perk("static-buildup", "RMB calls lightning from charges built by hits", true, (E, a) => E.staticBuildup(a));
  // art / rune cast procs
  perk("gravity-well", "Art/rune: inverse shockwave (15+10×amt)", true, (E, a) => E.proc({ name: "Gravity Well", on: "cast", hits: [[15 + 10 * a, 1]], types: { Earth: 0.5, Magic: 0.5 }, scalings: { Earth: 1, Magic: 1 } }));
  perk("ruler-of-the-sands", "Art/rune: chance sandnado 0.3×amt × 25 hits", true, (E, a) => E.proc({ name: "Ruler Of The Sands", on: "cast", chanceFromCd: 1 + 0.5 * a, hits: [[0.3 * a, 25]], types: { Earth: 0.5, Air: 0.5 }, scalings: { Earth: 1, Air: 1 } }));
  perk("fiery-pursuit", "Weapon art dashes: floor(amt) × (15+1.5×amt) Fire", true, (E, a) => E.proc({ name: "Fiery Pursuit", on: "cast", when: ART, kind: "art", hits: [[15 + 1.5 * a, Math.floor(a)]], types: { Fire: 1 }, scalings: { Fire: 1 } }));
  perk("power-inhale", "Fully held weapon art: teleport strike 20×amt Air", false, (E, a) => E.proc({ name: "Power Inhale", on: "cast", when: ART, kind: "art", hits: [[20 * a, 1]], types: { Air: 1 }, scalings: { Air: 1 } }));
  perk("quicksand", "Weapon art: quicksand (1+20×amt) ticks of 0.3", true, (E, a) => E.proc({ name: "Quicksand", on: "cast", when: ART, hits: [[0.3, 1 + 20 * a]], types: { Earth: 0.5, Air: 0.5 }, scalings: { Earth: 1, Air: 1 } }));
  perk("honey-arts", "Weapon art: honey glob 2×amt Magic", true, (E, a) => E.proc({ name: "Honey Arts", on: "cast", when: ART, hits: [[2 * a, 1]], types: { Magic: 1 }, scalings: { Magic: 1.5 } }));
  perk("pyre-bloom", "Weapon art: Pyre Bloom fireballs", true, (E, a) => E.pyreBloom(a));
  perk("lodestone-barrage", "Rune: rocks (2+0.75×amt) by base cooldown", true, (E, a) => E.proc({ name: "Lodestone Barrage", on: "cast", when: (atk) => atk.kind === "rune", rocks: 1 + 0.2 * a, hits: [[2 + 0.75 * a, 1]], types: { Magic: 0.5, Earth: 0.5 }, scalings: { Magic: 0.5, Earth: 0.5, Dexterity: 0.5 } }));
  perk("final-act", "Rune: minion explosion (5+7.5×amt)", true, (E, a) => E.proc({ name: "Final Act", on: "cast", when: (atk) => atk.kind === "rune", hits: [[5 + 7.5 * a, 1]], types: { Hex: 0.5, Magic: 0.5 }, scalings: { Hex: 1, Magic: 1, Summon: 1 } }));
  perk("apollo-boost", "Rune: (1+2×amt) shockwaves of 5/(1+0.1×amt)", true, (E, a) => E.proc({ name: "Apollo Boost", on: "cast", when: (atk) => atk.kind === "rune", kind: "rune", hits: [[5 / (1 + 0.1 * a), Math.floor(1 + 2 * a)]], types: PHYS_MAGIC_HALF, scalings: { Magic: 1, Physical: 1 } }));
  perk("air-pressure", "Rune releases Air Burst (6+0.65×potency, max 10×amt)", true, (E, a) => E.proc({ name: "Air Burst", on: "cast", when: (atk) => atk.kind === "rune", kind: "rune", hits: [[6 + 0.65 * 10 * a, 1]], types: { Air: 1 }, scalings: { Air: 1 } }));
  // echoes (repeat a portion of an attack)
  perk("phantom-pain", "Repeats 25%/amt×(1+0.1×amt) of damage as Hex", true, (E, a) => E.echo({ name: "Phantom Pain", frac: 0.25 * a * (1 + 0.1 * a), types: { Hex: 1 }, when: NODOT, crit: true }));
  perk("blub-blub", "50% chance: 2 × 15%/amt of damage as Water", true, (E, a) => E.echo({ name: "Blub Blub", frac: 0.15 * a * 2 * 0.5, types: { Water: 1 }, when: NODOT }));
  perk("storm-rend", "~20% chance chain lightning (1/3 of damage); Electrical Rend", true, (E) => E.echo({ name: "Storm Rend chain", frac: 0.2 / 3, types: { Air: 0.5, Magic: 0.5 }, when: NODOT }));
  perk("ichor-spark", "~12.5% chance red chain lightning (20%/amt of damage)", true, (E, a) => E.echo({ name: "Ichor Spark chain", frac: 0.125 * 0.2 * a, types: { Air: 0.5, Physical: 0.5 }, when: NODOT }));
  perk("luminescent-fervor", "Luminescent (after healing): 5%/amt of damage as Holy", false, (E, a) => E.echo({ name: "Luminescent", frac: 0.05 * a, types: { Holy: 1 }, when: NODOT }));
  perk("propelling-fun", "Cloudpush/Cinderpull: 7.5% of damage as Air (Fire while burning)", false, (E, a, S) => E.echo({ name: S.self["self-burn"] ? "Cinderpull" : "Cloudpush", frac: 0.075, types: S.self["self-burn"] ? { Fire: 1 } : { Air: 1 }, when: NODOT }));
  perk("explosive-charge", "Weapon art hits explode for 100% as Fire/Physical", true, (E) => E.echo({ name: "Explosive Charge", frac: 1, types: { Fire: 0.5, Physical: 0.5 }, when: ART }));
  perk("fungal-prototype", "Art/rune hits leave a poison cloud: 3.33%/amt per second for 10s", true, (E, a) => E.echo({ name: "Fungal Prototype", frac: 0.333 * a, types: { Hex: 1 }, when: AR, oncePerCast: true }));
  // per-second sources
  perk("vile-presence", "Constant Hex aura (1.2×amt per second)", true, (E, a) => E.tick({ name: "Vile Presence", perSecond: 1, hits: [[1.2 * a, 1]], types: { Hex: 1 }, scalings: { Hex: 1 } }));
  perk("proto-tech", "10%/amt chance per second: chain lightning (1+0.75×amt)", true, (E, a) => E.tick({ name: "Proto Tech", perSecond: Math.min(1, 0.1 * a), chance: true, hits: [[1 + 0.75 * a, 1]], types: { Magic: 0.5, Hex: 0.5 }, scalings: { Magic: 0.5, Hex: 0.5 } }));
  perk("sickness", "10%/amt chance per second: sneeze (2+0.5×amt)", true, (E, a) => E.tick({ name: "Sickness", perSecond: Math.min(1, 0.1 * a), chance: true, hits: [[2 + 0.5 * a, 1]], types: { Earth: 0.5, Hex: 0.5 }, scalings: { Earth: 1, Hex: 1 } }));
  perk("radiance", "Heals deal Holy damage: 1 + HP healed × 4/45 × amt (10 Holy scaling)", true, (E, a, S) => E.tick({ name: "Radiance", perSecond: S.healsPerSec, hits: [[1 + (S.healAmount * 4 / 45) * a, 1]], types: { Holy: 1 }, scalings: { Holy: 10 } }), ["healsPerSec", "healAmount"]);

  // ---- defensive triggers (rates come from the Situation inputs)
  const perSec = (per10) => per10 / 10;
  perk("thorns", "Hit/blocked: thorns (2+amt) Physical, (20+5×amt)% chance (always when blocking)", true, (E, a, S) => E.tick({
    name: "Thorns", perSecond: Math.min(2, perSec(S.blocksPer10) + perSec(S.hitsPer10) * Math.min(1, 0.2 + 0.05 * a)), hits: [[2 + a, 1]], types: { Physical: 1 }, scalings: { Dexterity: 1 },
  }), ["blocksPer10", "hitsPer10"]);
  perk("blastshield", "Taking damage: Earth shockwave (15+15×amt), 5s cooldown", true, (E, a, S) => E.tick({ name: "Blastshield", perSecond: Math.min(perSec(S.hitsPer10), 1 / 5), hits: [[15 + 15 * a, 1]], types: { Earth: 1 }, scalings: { Earth: 1 } }), ["hitsPer10"]);
  perk("heavy-slate", "Ignored knockback: Earth burst (5+2×amt), 0.5s cooldown", true, (E, a, S) => E.tick({ name: "Heavy Slate", perSecond: Math.min(perSec(S.hitsPer10), 2), hits: [[5 + 2 * a, 1]], types: { Earth: 1 }, scalings: { Earth: 1 } }), ["hitsPer10"]);
  perk("magic-guard", "Blocking: Magic shockwave (15×amt), 8s cooldown", true, (E, a, S) => E.tick({ name: "Magic Guard", perSecond: Math.min(perSec(S.blocksPer10), 1 / 8), hits: [[15 * a, 1]], types: { Magic: 1 }, scalings: { Magic: 1 } }), ["blocksPer10"]);
  perk("air-barrier", "Blocking: Air shockwave (3×amt)", true, (E, a, S) => E.tick({ name: "Air Barrier", perSecond: perSec(S.blocksPer10), hits: [[3 * a, 1]], types: { Air: 1 }, scalings: { Air: 1 } }), ["blocksPer10"]);
  perk("frozen-waste", "Blocking: freezing AoE (15+15×amt) Water, cooldown 10/(1+0.2×amt)s", true, (E, a, S) => E.tick({
    name: "Frozen Waste", perSecond: Math.min(perSec(S.blocksPer10), (1 + 0.2 * a) / 10), hits: [[15 + 15 * a, 1]], types: { Water: 1 }, scalings: { Water: 1, Physical: 1 },
  }), ["blocksPer10"]);
  perk("screeching-sound", "Blocking: ~20% chance Air shockwave (1)", true, (E, a, S) => E.tick({ name: "Screeching Sound", perSecond: perSec(S.blocksPer10) * 0.2, chance: true, hits: [[1, 1]], types: { Air: 1 }, scalings: { Air: 1 } }), ["blocksPer10"]);
  perk("grandmagic-guard", "While holding block: bubble 0.2×amt Magic per second", false, (E, a) => E.tick({ name: "Grandmagic Guard", perSecond: 1, hits: [[0.2 * a, 1]], types: { Magic: 1 }, scalings: { Magic: 1 } }));
  perk("volatile-shell", "Shield fully depleted: Hex explosion (25+20×amt), 0.1 Protection scaling", true, (E, a, S) => E.tick({
    name: "Volatile Shell", perSecond: S.shieldBreaksPerMin / 60, hits: [[25 + 20 * a, 1]], types: { Hex: 1 }, scalings: { Hex: 1, Protection: 0.1 },
  }), ["shieldBreaksPerMin"]);

  // ---- triggered by applying a status (see APPLY below)
  perk("barbed-flurry", "Reapplying Bleed: (1.6+0.32×amt) Physical", true, (E, a, S) => {
    if (S.target.Bleed) E.proc({ name: "Barbed Flurry", on: "apply", apply: "Bleed", hits: [[1.6 + 0.32 * a, 1]], types: { Physical: 1 }, scalings: { Physical: 1, Dexterity: 1 } });
  });
  perk("cauterize", "Burn becomes Singed: a Fire burst (2+0.2×amt)×x on application instead of ticks", true, (E, a, S) => {
    const bp = S.applied.Burn;
    const x = bp <= 1 ? Math.pow(1 + bp, 1 + bp) : Math.pow(1 + bp, 2);
    E.dot("Burn", { mult: 0 });
    E.proc({ name: "Cauterize", on: "apply", apply: "Burn", hits: [[(2 + 0.2 * a) * x, 1]], types: { Fire: 1 }, scalings: { Fire: 1.5 } });
  });
  perk("hex-ray", "Applying Weakness: Hex ray (3+0.6×amt)×(1+4×potency)", true, (E, a, S) => E.proc({
    name: "Hex Ray", on: "apply", apply: "Weakness", hits: [[(3 + 0.6 * a) * (1 + 4 * S.weakPotency), 1]], types: { Hex: 1 }, scalings: { Hex: 1 },
  }));
  perk("ice-burst", "Applying Shatter: icicle burst (8+4×amt) Water/Physical", true, (E, a) => E.proc({ name: "Ice Burst", on: "apply", apply: "Shatter", hits: [[8 + 4 * a, 1]], types: { Water: 0.5, Physical: 0.5 }, scalings: { Water: 1, Physical: 1 } }));

  // ---- more finisher / attack / cast effects
  perk("deathmist-slash", "Once per finisher: slash 1.6×amt Water/Hex", true, (E, a) => E.proc({ name: "Deathmist Slash", on: "finisher", hits: [[1.6 * a, 1]], types: { Water: 0.5, Hex: 0.5 }, scalings: { Water: 1, Hex: 1 } }));
  perk("spore-burst", "Once per finisher: spores (0.875+0.0875×amt) Hex × Poison Potency", true, (E, a, S) => E.proc({
    name: "Spore Burst", on: "finisher", hits: [[(0.875 + 0.0875 * a) * potencyMult(S.potency.Poison), 1]], types: { Hex: 1 }, scalings: { Dexterity: 1, Hex: 1, Earth: 1 },
  }));
  perk("gaseous-smash", "Slams: poison cloud amt × (2+4×amt) ticks of Hex", true, (E, a) => E.proc({ name: "Gaseous Smash", on: "attack", when: slamAny, hits: [[a, 2 + 4 * a]], types: { Hex: 1 }, scalings: { Hex: 1, Earth: 1 } }));
  perk("heavy-gravitate", "Earth/Magic art or rune marks Heavy Gravity; RMB consumes it for (4.17+2.08×amt)×3", true, (E, a, S, ctx) => {
    const t = ctx.wpn.art && ctx.wpn.art.types ? ctx.wpn.art.types : ctx.wpn.types;
    const runeT = (ctx.rune && ctx.rune.attack && ctx.rune.attack.types) || {};
    if (!(t.Earth || t.Magic || runeT.Earth || runeT.Magic)) return;
    E.proc({ name: "Heavy Gravitate", on: "attack", when: (atk) => atk.kind === "m2", needsMark: 15 + a, hits: [[4.166 + 2.0833 * a, 3]], types: { Magic: 0.5, Earth: 0.5 }, scalings: { Magic: 1, Earth: 1 }, cooldown: 0.3 });
  });
  perk("torpedo-barrage", "Art/rune hits fire stored torpedoes: floor(0.5+4.5×amt) × (1.5+0.4×amt)", true, (E, a) => E.proc({
    name: "Torpedo Barrage", on: "cast", hits: [[1.5 + 0.4 * a, Math.floor(0.5 + 4.5 * a)]], types: { Water: 0.5, Physical: 0.5 }, scalings: { Water: 1, Physical: 1 },
  }));
  perk("voltaic-body", "After a weapon art: hits zap (8+4×amt)×0.85^n for CD/2+3×amt s; rune cooldown +20%", true, (E, a) => {
    E.cd("rune", "mult", 1.2);
    E.proc({ name: "Voltaic Body", on: "attack", when: NODOT, voltaic: true, afterArt: (art) => (art.cooldownBase || 10) / 2 + 3 * a, hits: [[8 + 4 * a, 1]], types: { Air: 0.5, Magic: 0.5 }, scalings: { Air: 1, Magic: 1 } });
  });
  perk("springblast", "With Bounce: finisher hits explode", true, (E, a, S) => { if (S.self.bounce) E.proc({ name: "Springblast", on: "finisherHit", springblast: a, types: { Physical: 1 }, scalings: { Physical: 1 } }); });
  perk("bounce-momentum", "Tongue Shot (after jumping): finishers lash (5+2.5×amt)", false, (E, a) => E.proc({ name: "Tongue Shot", on: "finisher", hits: [[5 + 2.5 * a, 1]], types: { Water: 0.5, Physical: 0.5 }, scalings: { Water: 1 } }));
  perk("channeled-depths", "Fully charged attack gains +(0.5+0.5×amt) Water type, once per charge", true, (E, a) => E.proc({
    name: "Channeled Depths", on: "attack", when: NODOT, inheritTypes: { Water: 0.5 + 0.5 * a }, cooldown: (0.1 + 0.1 * a) / (0.01 * a),
  }));
  perk("forgotten-chivalry", "Art/rune consuming Reinforce: +0.4/amt Holy type", true, (E, a, S) => { if (S.self.reinforce) E.addType("Forgotten Chivalry", "Holy", 0.4 * a, AR); });
  perk("slayer-rage", "Held Rage / Weakening Roar Rune: ramping Hex damage", true, (E, a) => E.override((atk) => {
    if (atk.runeId === "rage-rune") return { ...atk, hits: [[0.25 + 0.125 * a, 20]], types: { Hex: 1 }, scalings: { Hex: 0.75, Physical: 0.75 } };
    if (atk.runeId === "weakening-roar-rune") return { ...atk, hits: [[0.5 + 0.1875 * a, 20]], types: { Hex: 1 }, scalings: { Hex: 0.75, Physical: 0.75, Magic: 0.3 } };
    return atk;
  }));
  perk("cannonball", "RMB launches stored minions: (10+amt)×(1+0.1×minions)", false, (E, a, S) => E.m2Override({
    name: "Cannonball", hits: [[(10 + a) * (1 + 0.1 * S.summonsFired), 1]], types: { Physical: 1 }, scalings: { Summon: 1 + 0.05 * a },
  }), ["summonsFired"]);
  perk("sharp-claws", "Wound (after a guardbreak): Bleed deals +10%/amt as True", false, (E, a) => E.dot("Bleed", { addType: { True: 0.1 * a } }));
  perk("dragigator-spirit", "Dragigator Spirit +10% per Burn Potency", true, (E, a, S) => E.mult("Dragigator Spirit", 1 + 0.1 * S.potency.Burn, (atk) => atk.spiritId === "dragigator-spirit"));
  perk("icestorm", "Orbiting ice storm while hitting: (3+amt) per second", true, (E, a) => E.tick({ name: "Icestorm", perSecond: 1, hits: [[3 + a, 1]], types: { Magic: 0.5, Water: 0.5 }, scalings: { Magic: 1, Water: 1 } }));
  perk("tesla-cannon", "Ranged hits: tesla orb zaps (2+4×amt) twice per second", false, (E, a) => E.tick({ name: "Tesla Cannon", perSecond: 2, hits: [[2 + 4 * a, 1]], types: { Magic: 0.5, Air: 0.5 }, scalings: { Magic: 1, Air: 1 } }));
  perk("caustic-slow", "Slowed targets take a True DoT", true, (E, a, S) => {
    if (S.target.slowed) E.tick({ name: "Caustic Slow", perSecond: 1, hits: [[(1.5 + 0.5 * a) * (1 + S.slowPotency / 2), 1]], types: { True: 1 }, scalings: { Earth: 1, Hex: 1 }, potency: "Poison", noBonus: true });
  });

  // ---- RMB replacements (toggle to test them as your M2)
  perk("steam-charge", "Steam beam RMB: 6 × 10 Fire/Air (at max Steam Buildup)", false, (E) => E.m2Override({ name: "Steam beam", hits: [[6, 10]], types: { Fire: 0.5, Air: 0.5 }, scalings: { Fire: 1, Air: 1 } }));
  perk("wave-rider", "Empowered RMB: 40 Water (at 100 Gathering Tide)", false, (E) => E.m2Override({ name: "Wave Rider", hits: [[40, 1]], types: { Water: 1 }, scalings: { Water: 1 } }));
  perk("divine-crash", "Airborne RMB crash, scales with fall distance", false, (E, a, S, ctx) => {
    const d = S.distance;
    if (ctx.perks["fell-rush"]) return; // combined variant handled by Fell Rush
    E.m2Override({ name: "Divine Crash", hits: [[(6 + 0.6 * a) * (1 + Math.min(5, d / 30)), 1]], types: { Air: 0.5, Holy: 0.5 }, scalings: { Air: 0.5, Holy: 0.5 + Math.min(0.5, d / 500) } });
  }, ["distance"]);
  perk("fell-rush", "RMB teleport to a linked target, scales with distance", false, (E, a, S, ctx) => {
    const d = S.distance;
    const combo = ctx.perks["divine-crash"];
    E.m2Override(combo
      ? { name: "Fell Rush + Divine Crash", hits: [[(8.5 + 0.85 * a) * (1 + Math.min(5, d / 50)), 1]], types: { Holy: 0.4, Hex: 0.3, Air: 0.3 }, scalings: { Air: 0.5, Holy: 0.5, Hex: 0.5 + Math.min(0.5, d / 500) } }
      : { name: "Fell Rush", hits: [[(8.5 + 0.85 * a) * (1 + Math.min(5, d / 50)), 1]], types: { Air: 0.5, Hex: 0.5 }, scalings: { Air: 0.5, Hex: 0.5 + Math.min(0.5, d / 500) } });
  }, ["distance"]);
  // Expected number of times one use of an attack applies a status, for perks that trigger on applying it.
  // `r` is the hit result (hits, crit chance), `p(id)` the perk amount.
  const DARK_ELF = (ctx, r) => (ctx.build.race === "dark-elf" ? (0.08 / 6) * r.hits : 0);
  const APPLY = {
    Bleed: (ctx, atk, r, p, S) => {
      let n = DARK_ELF(ctx, r);
      if (p("vicious-edge") && W(atk)) n += Math.min(1, 0.55 * p("vicious-edge"));
      if (p("serrated-edge") && atk.finisher) n += 1;
      if (p("penance") && S.selfHp <= 35) n += 0.5 * r.hits;
      if (p("splinter")) n += r.crit.p * r.hits;
      if (p("whirlwind") && AR(atk)) n += 1;
      if (p("gorecast") && ART(atk)) n += 1;
      if (p("winter-woof-spirit") && W(atk)) n += 1;
      if (["cacitrops-rune", "sanguine-bolt-rune"].includes(atk.runeId) || ["caci-spirit", "gremlin-spirit"].includes(atk.spiritId)) n += r.hits;
      return n;
    },
    Burn: (ctx, atk, r, p, S) => {
      let n = DARK_ELF(ctx, r);
      if (p("ignition")) n += Math.min(1, 0.1 * p("ignition")) * r.hits;
      if (p("echo-incineration")) n += ((10 + 2.5 * p("echo-incineration")) / 100) * r.hits;
      if (p("bellowing-ember") && S.selfHp <= 40 + 5 * p("bellowing-ember")) n += 0.35 * r.hits;
      if (p("dragon-breath") && atk.finisher) n += r.hits;
      if (p("sunburn") && (r.types.Holy || 0) > 0) n += (24 + 6 * p("sunburn")) / 100;
      if (p("fiery-pursuit") && ART(atk)) n += Math.floor(p("fiery-pursuit"));
      if (["fireball-rune", "brainblast-rune"].includes(atk.runeId) || atk.spiritId === "dragigator-spirit") n += 1;
      return n;
    },
    Shatter: (ctx, atk, r, p) => {
      let n = DARK_ELF(ctx, r);
      if (p("cleave") && atk.finisher) n += 1;
      if (p("gravitational-enforcer") && atk.kind === "m2") n += 1;
      if (p("mine") && atk.kind === "m2" && atk.form === "Mine") n += 1;
      if (p("erosion") && (r.types.Earth || 0) > 0) n += ((5 + 5 * p("erosion")) / 100) * r.hits;
      if (atk.spiritId === "winter-woof-spirit") n += 1;
      return n;
    },
    Weakness: (ctx, atk, r, p, S) => {
      let n = DARK_ELF(ctx, r);
      if (p("weakening")) n += Math.min(1, 0.05 * p("weakening")) * r.hits;
      if (atk.runeId === "weakening-roar-rune" || atk.spiritId === "woof-spirit") n += 1;
      if (p("cursed-flames")) n += APPLY.Burn(ctx, atk, r, p, S); // Cursed Flames burns count as Weakening
      return n;
    },
  };

  // Extra attacks some perks add (shown under SPECIAL in the Test tab).
  const EXTRA_ATTACKS = {
    "wind-drill": (a) => ({ name: "Wind Drill (roll)", hits: [[3 + 1.5 * a, 10]], types: { Air: 1 }, scalings: { Air: 1 } }),
    "pulverizing-rush": (a) => ({ name: "Pulverizing Rush (slam)", hits: [[4 + 2 * a, 1]], types: { Earth: 1 }, scalings: { Earth: 1, Air: 1 } }),
  };

  // Perks handled directly by the damage engine (Rage family, Frenzy, Ferocity, DoT potency).
  const ENGINE_PERKS = ["gladiatorial-rage", "mage-rage", "oceans-rage", "void-rage", "fury", "iron-slayer-spirit", "frenzy", "ferocity",
    "burn-potency", "bleed-potency", "poison-potency", "potion-chugger", "endless-despair", "cursed", "perk-effectiveness", "cursed-experiment",
    "contained", "bomber-satchel", "spirit-commune", "darkening-hex"];
  // Stance perks are reflected in the weapon form (M1/M2 base damage).
  const FORM_PERKS = ["duelist-stance", "lance", "saw-stance", "saw-heart", "dual-wielding", "kama-blades", "locked-and-loaded", "artillery-mage",
    "stratos-winds", "storm-caster", "virulent-core", "cosmic-ray", "mine"];

  window.VoxlEffects = {
    SITUATION, STATUSES, POTIONS, SPIRITS, PERKS: P, DOT_SOURCES, DOT_RUNES, POTENCY_PERKS, ENGINE_PERKS, FORM_PERKS, APPLY, EXTRA_ATTACKS,
    STAT_PERKS: ["brawny", "strong-tides", "weight-distribution", "quick-witted", "whirl-foot", "true-balance", "righted-wrongs", "lucky",
      "carapace", "extra-layers", "frozen-heart", "immovable", "rocky-body", "spellshield", "swift-guard"],
    SUMMON_ARTS, SUMMON_RUNES,
    // perks only referenced as a source of a status / DoT / potency
    sourcePerks: () => {
      const ids = new Set();
      STATUSES.forEach((st) => (st.sources.toString().match(/p\("([a-z0-9-]+)"\)/g) || []).forEach((m) => ids.add(m.slice(3, -2))));
      Object.values(DOT_SOURCES).concat(Object.values(POTENCY_PERKS)).forEach((l) => l.forEach((id) => ids.add(id)));
      return ids;
    },
    decay, potencyMult,
    filters: { W, FIN, AR, ART, NODOT, ALL, and, hasType },
  };
})();
