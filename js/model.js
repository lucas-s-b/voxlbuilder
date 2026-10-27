// Weapon, race and guild rules, following the Voxlpedia wiki
// (Weapons, Template:WeaponBoost, Races, Guilds, Attack Speed pages).
(function () {
  const D = window.VOXL_DATA;
  const C = window.VoxlCalc;

  const partById = Object.fromEntries(D.parts.map((p) => [p.id, p]));
  // Arts whose infobox gives damage as prose instead of a hit list.
  // Starstream: ~70 stars spread evenly over 6 elements (4.5 base, 1.0 own-element scaling) and True (9 base, 0.5 Magic) = 360 base.
  const ART_HITS = {
    starstream: {
      hits: [[4.5, 60], [9, 10]],
      types: { Magic: 0.125, Air: 0.125, Fire: 0.125, Hex: 0.125, Holy: 0.125, Water: 0.125, True: 0.25 },
      scalings: { Magic: 0.25, Air: 0.125, Fire: 0.125, Hex: 0.125, Holy: 0.125, Water: 0.125 },
    },
  };
  D.arts.forEach((a) => { if (!a.hits && ART_HITS[a.id]) Object.assign(a, ART_HITS[a.id]); });
  const artById = Object.fromEntries(D.arts.map((a) => [a.id, a]));
  const guildById = Object.fromEntries(D.guilds.map((g) => [g.id, g]));
  const raceById = Object.fromEntries(D.races.map((r) => [r.id, r]));

  // Shrine of Balance: scalings and stat boosts multiplied inversely to part tier.
  const TIER_MULT = { 1: 3, 2: 1.7, 3: 1.4, 4: 1.1, 5: 1 };
  const HYBRID_MULT = 1.5;

  // Race passives that change numbers the builder tracks.
  const RACE_EFFECTS = {
    human: { lowHpDamage: 0.2 },
    "half-ork": { armorPen: 10 },
    elf: { runeCdMult: 0.6 },
    "dark-elf": {},
    "dragon-blooded": { stats: { Warding: 50, Protection: 10, "Heat Resistance": 100, "Cold Resistance": 100 } },
    ork: { stats: { Tenacity: 0.2 }, artArmorPen: 10 },
    "high-elf": { artCdMult: 0.75 },
    arborian: { stats: { "Fire Defense": -50, Protection: 15 } },
    kitsune: { stats: { "Jump Boost": 2, "Speed Boost": 10 }, weaponSpeed: 0.1 },
    bunikin: { stats: { "Jump Boost": 5 } },
  };

  const WEAPON_TYPES = {
    "Medium Handle": { "Small Blade": "Dagger", "Medium Blade": "1-Handed Sword", "Heavy Blade": "Unbalanced Sword", "Hammer Head": "Mallet" },
    "Long Handle": { "Small Blade": "Dagger", "Medium Blade": "2-Handed Sword", "Heavy Blade": "Greatsword", "Hammer Head": "Mallet" },
    Pole: { "Small Blade": "Spear", "Medium Blade": "Spear", "Heavy Blade": "Great Spear", "Hammer Head": "War Hammer" },
  };

  // M1 combo / M2 base damage per weapon form (in-game values supplied by the user).
  // Each M1 entry is one swing as [damage, hits]; M2 is one finisher as a list of [damage, hits].
  const x3 = (d) => [[[d, 1]], [[d, 1]], [[d, 1]]];
  const MOVES = {
    "Fists": { m1: [[[5.5, 1]], [[5.5, 1]], [[2.7, 3]]], m2: [[15.5, 1]] },
    "1-Handed Sword": { m1: x3(6), m2: [[9, 1]] },
    "2-Handed Sword": { m1: x3(5.5), m2: [[12, 1]] },
    "Rapier": { m1: [[[4.5, 1]], [[4.5, 1]], [[1.5, 4]]], m2: [[7.5, 1]] },
    "Dual Swords": { m1: [[[3, 2]], [[3, 2]], [[6, 1]]], m2: [[8, 1]] },
    "Greatsword": { m1: [[[9, 1]], [[4, 1]], [[9, 1]]], m2: [[11, 1]] },
    "Unbalanced Sword": { m1: [[[7.5, 1]], [[12, 1]]], m2: [[16, 1]] },
    "Dual Unbalanced Swords": { m1: [[[12, 1]], [[12, 1]]], m2: [[8, 2], [12, 1]] },
    "Dagger": { m1: x3(4.5), m2: [[5.5, 1]] },
    "Dual Daggers": { m1: [[[4, 1]], [[1.4, 5]], [[1.4, 5]]], m2: [[11, 1]] },
    "Spear": { m1: x3(6), m2: [[10, 1]] },
    "Great Spear": { m1: [[[9, 1]], [[14, 1]]], m2: [[5, 3]] },
    "Mallet": { m1: x3(6), m2: [[18, 1]] },
    "Dual Mallets": { m1: [[[5, 1]], [[1, 5]], [[5.5, 1]]], m2: [[18.5, 1]] },
    "War Hammer": { m1: [[[6, 1]], [[6, 1]], [[14, 1]]], m2: [[8, 2]] },
    "Dual Kamas": { m1: [[[4, 1]], [[4, 1]], [[3, 3]]], m2: [[5.5, 1]] },
    "Scythe": { m1: x3(7.5), m2: [[5, 3]] },
    "Lance": { m1: x3(6), m2: [[6.8, 1]], note: "Lance M2: 6.8 tapped, up to 20 held (Charged M2)" },
    "Saw Sword": { m1: [[[4, 2]], [[4, 2]], [[4, 2]]], m2: [[1.7, 10]] },
    "Saw Fists": { m1: [[[2.5, 2]], [[2.5, 2]], [[2.5, 2]]], m2: [[3, 7]] },
    "Artillery Mage": { m1: [[[5.5, 1]], [[5.5, 1]]], m2: [[8.5, 1]] },
    "Stratos Winds": { m1: [[[6, 1]], [[6, 1]]], m2: [[15, 1]] },
    "Storm Caster": { m1: [[[5, 1]], [[5, 1]]], m2: [[2.75, 5]] },
    "Virulent Core": { m1: [[[4.5, 1]], [[4.5, 1]]], m2: [[12, 1]] },
    "Cosmic Ray": { m1: null, m2: [[18.5, 1]] },
    "Mine": { m1: null, m2: [[5, 1], [10, 1], [15, 1]] },
    "Shield": { m1: [[[5, 1]], [[5, 1]], [[10, 1]]], m2: [[5, 1]] },
    "Side Gun": { m1: null, m2: [[7, 1]] },
    "Shotgun": { m1: null, m2: [[4.5, 3]] },
    "Dual Guns": { m1: [[[4, 1]], [[4, 1]]], m2: [[1.6, 8]] },
    "Rifle": { m1: [[[5, 1]], [[5, 1]], [[18, 1]]], m2: [[17, 1]], note: "Rifle M2: 17 tapped, up to 45.3 held (Charged M2)" },
  };

  const DUAL_BY_BLADE = { "Small Blade": "Dual Daggers", "Medium Blade": "Dual Swords", "Heavy Blade": "Dual Unbalanced Swords", "Hammer Head": "Dual Mallets" };
  const ONE_HANDED = ["Dagger", "1-Handed Sword", "Unbalanced Sword", "Mallet"];
  const GUN_HOLDERS = ["Dagger", "1-Handed Sword", "Unbalanced Sword", "Shield"];
  // Perks that replace both LMB and RMB, or only RMB.
  const CORE_FORMS = [["artillery-mage", "Artillery Mage"], ["stratos-winds", "Stratos Winds"], ["storm-caster", "Storm Caster"], ["virulent-core", "Virulent Core"]];

  // Final weapon form after stance perks, cores and the Blaster Ring: which M1 and M2 the build uses.
  function weaponForm(build, perks) {
    const w = build.weapon || emptyWeapon();
    const parts = partsOf(w);
    const has = (id) => (perks[id] || 0) > 0;
    const notes = [];
    let base = weaponTypeName(w, parts.filter(Boolean));
    if (base === "None" || base === "Incomplete" || base === "Unknown") {
      notes.push("No complete weapon — using 1-Handed Sword moves.");
      base = "1-Handed Sword";
    }
    const blade = w.mode === "sword" && parts[1] ? parts[1].partType : null;
    let m1 = base, m2 = base;
    const set = (form, why) => { m1 = form; m2 = form; notes.push(`${form} (${why})`); };

    if (w.mode === "monk") {
      if (base === "Fists" && has("saw-heart")) set("Saw Fists", "Saw Heart");
    } else if (has("dual-wielding") && ONE_HANDED.includes(base) && DUAL_BY_BLADE[blade]) {
      set(DUAL_BY_BLADE[blade], "Dual Wielding");
    } else if (has("kama-blades") && (base === "Dagger" || base === "Spear")) {
      set(base === "Dagger" ? "Dual Kamas" : "Scythe", "Kama Blades");
    } else if (has("lance") && (base === "Greatsword" || base === "Unbalanced Sword")) {
      set("Lance", "Lance");
    } else if (has("saw-stance") && blade === "Medium Blade") {
      set("Saw Sword", "Saw Stance");
    } else if (has("duelist-stance") && base === "1-Handed Sword") {
      set("Rapier", "Duelist Stance");
    }
    const core = CORE_FORMS.find(([id]) => has(id));
    if (core) set(core[1], core[1] + " perk");

    // Blaster Ring (Locked And Loaded): a second Blaster Ring infused upgrades the guns.
    const guns = perks["locked-and-loaded"] || 0;
    if (guns && m1 === "Fists") {
      const form = guns >= 2 ? "Rifle" : "Dual Guns";
      m1 = form; m2 = form;
      notes.push(`${form} (Locked And Loaded${guns >= 2 ? " ×2" : ""})`);
    } else if (guns && GUN_HOLDERS.includes(base)) {
      m2 = guns >= 2 ? "Shotgun" : "Side Gun";
      notes.push(`M2 → ${m2} (Locked And Loaded${guns >= 2 ? " ×2" : ""})`);
    }
    if (has("cosmic-ray")) { m2 = "Cosmic Ray"; notes.push("M2 → Cosmic Ray"); }
    if (has("mine")) { m2 = "Mine"; notes.push("M2 → Mine (overrides other RMBs)"); }

    // Forms without their own M1 keep the base weapon's.
    const m1Moves = (MOVES[m1] && MOVES[m1].m1) || MOVES[base].m1;
    if (!(MOVES[m1] && MOVES[m1].m1)) m1 = base;
    [MOVES[m1], MOVES[m2]].forEach((mv) => { if (mv && mv.note && !notes.includes(mv.note)) notes.push(mv.note); });
    return { base, m1, m2, m1Moves, m2Moves: MOVES[m2].m2, notes };
  }

  const emptyWeapon = () => ({ mode: "sword", handle: null, blade: null, gloves: null, essence: null, shrine: false, art: null });

  function partsOf(w) {
    const ids = w.mode === "monk" ? [w.gloves, w.essence] : [w.handle, w.blade];
    return ids.map((id) => (id && partById[id]) || null);
  }

  const round = C.round;
  const addInto = (into, from, mult) => Object.entries(from || {}).forEach(([k, v]) => { into[k] = round((into[k] || 0) + v * mult); });

  // Everything the weapon contributes: stats, perks, damage types, scalings and speed.
  function weapon(build) {
    const w = build.weapon || emptyWeapon();
    const parts = partsOf(w).filter(Boolean);
    const guild = build.guild && guildById[build.guild.id];
    const monkRank = guild && guild.id === "monk" ? build.guild.rank : 0;
    const race = RACE_EFFECTS[build.race] || {};

    const stats = {}, scalings = {}, types = {}, perks = [];
    parts.forEach((p) => {
      const shrine = w.shrine ? TIER_MULT[p.tier] || 1 : 1;
      const isMonkPart = ["gloves", "essence"].includes(p.kind);
      // Template:WeaponBoost — Monk rank adds 25% per rank past the first on top of the shrine bonus
      const boostMult = isMonkPart && monkRank ? shrine + (monkRank - 1) * 0.25 : shrine;
      addInto(stats, p.stats, boostMult);
      addInto(scalings, p.scalings, shrine);
      addInto(types, p.types, 1);
      p.perks.forEach((pk, i) => {
        const bonus = p.kind === "gloves" && i === 0 && monkRank ? monkRank - 1 : 0;
        perks.push({ id: pk.id, amount: pk.amount + bonus });
      });
    });
    const baseScalings = { ...scalings }; // weapon art requirements ignore the hybrid bonus
    const scalingKeys = parts.map((p) => Object.keys(p.scalings).sort().join(","));
    const hybrid = parts.length === 2 && scalingKeys[0] !== scalingKeys[1];
    if (hybrid) Object.keys(scalings).forEach((k) => { scalings[k] = round(scalings[k] * HYBRID_MULT); });
    if (!Object.keys(types).length && parts.length) types.Physical = 1;

    const speeds = parts.map((p) => p.attackSpeed);
    const attackSpeed = speeds.length ? round(speeds.reduce((a, b) => a + b, 0) / speeds.length + (race.weaponSpeed || 0)) : 0;

    return { parts, stats, scalings, baseScalings, types, perks, hybrid, attackSpeed, mode: w.mode, typeName: weaponTypeName(w, parts), art: w.art && artById[w.art] };
  }

  // Weapon art requirements (Weapon Arts page / Template:WeaponArts): weapon types, minimum scalings
  // (before the hybrid bonus) and minimum weapon stats. `any` = at least one of those scalings.
  const ART_REQS = {
    lunge: { mode: "sword" },
    spin: { types: ["2-Handed Sword", "Greatsword", "Unbalanced Sword"] },
    "rapid-stabs": { types: ["Dagger", "Rapier", "Spear"], test: (w, sc) => w.typeName === "Dagger" || sc("Dexterity") >= 0.5, text: "0.5 Dexterity scaling (Spear, Rapier)" },
    javelin: { types: ["Spear", "Great Spear"] },
    rend: { types: ["Greatsword"] },
    slam: { types: ["Unbalanced Sword", "Greatsword", "Great Spear", "Mallet", "War Hammer"], scal: { Physical: 0.5 } },
    "dagger-throw": { types: ["Dagger"], scal: { Dexterity: 0.7 } },
    "cross-slash": { types: ["1-Handed Sword", "2-Handed Sword"], scal: { Dexterity: 0.4, Physical: 0.4 } },
    impale: { types: ["1-Handed Sword", "Spear"], any: { Physical: 0.6, Dexterity: 0.6 } },
    "warrior-stomp": { stats: { "Physical Defense": 5 } },
    barrage: { mode: "monk" },
    shatter: { mode: "monk", scal: { Physical: 0.6 } },
    focus: { mode: "monk", scal: { Dexterity: 0.6 } },
    retaliate: { stats: { Tenacity: 0.1 } },
    laser: { scal: { Magic: 0.3 } },
    mines: { scal: { Magic: 0.5 } },
    "mage-bomb": { stats: { "Magic Boost": 11 } },
    "magical-ray": { stats: { "Magic Boost": 21 } },
    "condensed-star": { test: (w, sc) => sc("Dexterity") > 0 && sc("Magic") > 0 && Math.max(sc("Dexterity"), sc("Magic")) > 0.5, text: "Dexterity and Magic scaling, one above 0.5" },
    "mage-bomber-summon": { scal: { Magic: 0.3 }, stats: { "Summon Boost": 10 } },
    "blessedlings-summon": { scal: { Holy: 0.3 }, stats: { "Summon Boost": 10 } },
    "toaladin-summon": { test: (w, sc) => sc("Holy") > 0, text: "Any Holy scaling", stats: { "Summon Boost": 20 } },
    "undead-buni-summon": { scal: { Hex: 0.3 }, stats: { "Summon Boost": 7 } },
    "skeletal-woof-summon": { scal: { Hex: 0.3 }, stats: { "Summon Boost": 20 } },
    "infernal-legion": { stats: { "Fire Boost": 5, "Summon Boost": 5 } },
    "lesser-heal": { scal: { Holy: 0.3 } },
    "holy-phalanx": { types: ["Spear", "Great Spear"], scal: { Holy: 0.4 } },
    "holy-shrine": { scal: { Holy: 0.8 }, stats: { "Holy Boost": 15 } },
    "polarity-cannon": { scal: { Holy: 0.5, Hex: 0.5 } },
    "cursed-ground": { scal: { Hex: 0.3 } },
    jinx: { scal: { Hex: 0.6 } },
    "dark-tentacle": { scal: { Hex: 0.8 } },
    "curse-flame-ray": { scal: { Hex: 0.4, Fire: 0.4 } },
    "gale-assault": { scal: { Air: 0.3 } },
    "storm-stomp": { scal: { Air: 0.5 } },
    "lightning-cloak": { scal: { Air: 0.5, Magic: 0.5 } },
    "flame-slash": { scal: { Fire: 0.3 } },
    flamethrower: { scal: { Fire: 0.6 } },
    erupt: { scal: { Fire: 0.3, Earth: 0.3 } },
    cleanse: { scal: { Water: 0.3 } },
    splash: { scal: { Water: 0.6 } },
    waterfall: { scal: { Water: 0.8 } },
    "icicle-wave": { scal: { Water: 0.5 }, stats: { "Heat Resistance": 50 } },
    earthquake: { scal: { Earth: 0.3 } },
    "grand-quake": { scal: { Earth: 0.8 } },
    "earth-slam": { scal: { Earth: 0.5, Physical: 0.5 } },
    "black-hole": { scal: { Magic: 0.4, Earth: 0.4 } },
    cragblade: { scal: { Earth: 0.75 } },
    starstream: { parts: ["starlight-handle", "starlight-greatblade"] },
  };

  // Which requirements of `artId` the weapon misses: [] means it can be equipped.
  function artMissing(wpn, artId) {
    const r = ART_REQS[artId];
    if (!r) return [];
    if (wpn.parts.length < 2) return ["A complete weapon"];
    const sc = (k) => wpn.baseScalings[k] || 0;
    const miss = [];
    if (r.mode && wpn.mode !== r.mode) miss.push(r.mode === "monk" ? "Monk gloves + essence" : "Handle + blade weapon");
    if (r.types && !r.types.includes(wpn.typeName)) miss.push(r.types.join(", "));
    Object.entries(r.scal || {}).forEach(([k, v]) => { if (sc(k) < v - 1e-9) miss.push(`${v} ${k} scaling`); });
    if (r.any && !Object.entries(r.any).some(([k, v]) => sc(k) >= v - 1e-9)) miss.push(Object.entries(r.any).map(([k, v]) => `${v} ${k}`).join(" or ") + " scaling");
    if (r.test && !r.test(wpn, sc)) miss.push(r.text);
    Object.entries(r.stats || {}).forEach(([k, v]) => { if ((wpn.stats[k] || 0) < v - 1e-9) miss.push(`${k} ${C.fmtStat(k, v)}`); });
    if (r.parts && !r.parts.every((id) => wpn.parts.some((p) => p.id === id))) miss.push("Starlight Handle + Starlight Greatblade");
    return miss;
  }

  function weaponTypeName(w, parts) {
    if (parts.length < 2) return parts.length ? "Incomplete" : "None";
    if (w.mode === "monk") return parts[0].partType === "Shield" ? "Shield" : "Fists";
    const row = WEAPON_TYPES[parts[0].partType];
    return (row && row[parts[1].partType]) || "Unknown";
  }

  function guildRank(build) {
    const g = build.guild && guildById[build.guild.id];
    if (!g) return null;
    const rank = g.ranks[Math.max(0, Math.min(g.ranks.length, build.guild.rank) - 1)];
    return rank ? { guild: g, rank: build.guild.rank, stats: rank.stats, perks: rank.perks } : null;
  }

  // Extra stat/perk sources beyond equipment, fed into VoxlCalc.buildTotals.
  // Draconic guild rune infusion (Draconic Blood / Draconic pages): a second rune key locked to a draconic ability.
  // Rank 1 has Dragon Claw; the promotion quests unlock Dragon Infusion (rank 2) and Dragon Bubble (rank 3).
  // Type and scaling follow your Dragon Blooded skin color; other races deal Physical.
  const DRACONIC = {
    colors: ["Fire", "Air", "Earth", "Water", "Holy", "Hex"],
    skins: { Fire: "Red", Air: "White", Earth: "Green", Water: "Blue", Holy: "Yellow", Hex: "Purple" },
    abilities: [
      { id: "claw", name: "Dragon Claw", rank: 1, cooldown: 5, text: "(25 + 2.5 × Draconic Blood) damage, guardbreaks, 60 poise" },
      { id: "infusion", name: "Dragon Infusion", rank: 2, cooldown: 35, text: "Draconic Infusion buff (0.1 × Draconic Blood) for 20s: all attacks +0.1 type of your color per 0.1 potency" },
      { id: "bubble", name: "Dragon Bubble", rank: 3, cooldown: 7, text: "(20 + 2 × Draconic Blood) damage, 45 poise, detonates on contact" },
    ],
    // Claw / Bubble attack stats by color
    attack: {
      Fire: { speed: 1.2, text: "×1.2 speed, applies Burn for 5s" },
      Air: { speed: 2, cd: 0.75, text: "×2 speed, ×2 knockback, ×0.75 cooldown" },
      Earth: { dmg: 1.5, speed: 0.7, text: "×1.5 damage, ×1.5 stun, ×0.7 speed" },
      Water: { dmg: 1.1, speed: 1.2, text: "×1.1 damage, ×1.2 speed, ×1.2 stun, heals and cleanses" },
      Holy: { text: "Heals" },
      Hex: { text: "×1.2 stun, Weakness (0.1 × Draconic Blood) for 10s plus 3 chances at a random debuff" },
    },
    // Dragon Infusion bonus by color
    infusion: {
      Air: "+10% attack speed and +20% knockback per 0.1 potency",
      Fire: "Attacks always apply Burn; applied Burn potency +15% per Draconic Blood",
      Hex: "Applied debuffs +5% potency and +15% duration per Draconic Blood",
      Holy: "Healing +10% per 0.1 potency; applied buffs +5% potency per Draconic Blood",
      Water: "Immune to debuffs; healing pulse every (8 − Draconic Blood)s",
      Earth: "Poise damage +15% and stun resistance +0.15 per 0.1 potency",
    },
  };

  // The build's draconic ability, color and damage type, or null without the Draconic guild.
  function draconic(build) {
    const g = build.guild;
    if (!g || g.id !== "draconic") return null;
    const rank = Math.max(1, Math.min(3, g.rank || 1));
    const open = DRACONIC.abilities.filter((x) => x.rank <= rank);
    const ability = open.find((x) => x.id === g.ability) || open[0];
    const color = DRACONIC.colors.includes(g.color) ? g.color : "Fire";
    const blooded = build.race === "dragon-blooded";
    return { rank, open, ability, color, blooded, type: blooded ? color : "Physical" };
  }

  function extraSources(build) {
    const out = [];
    const wpn = weapon(build);
    if (wpn.parts.length) out.push({ name: "Weapon", stats: wpn.stats, perks: wpn.perks });
    const gr = guildRank(build);
    if (gr) out.push({ name: `${gr.guild.name} (Rank ${gr.rank})`, stats: gr.stats, perks: gr.perks });
    const race = RACE_EFFECTS[build.race];
    if (race && race.stats) out.push({ name: raceById[build.race].name, stats: race.stats, perks: [] });
    return out;
  }

  window.VoxlModel = {
    partById, artById, guildById, raceById, TIER_MULT, HYBRID_MULT, RACE_EFFECTS, WEAPON_TYPES,
    MOVES, emptyWeapon, partsOf, weapon, weaponForm, guildRank, extraSources, ART_REQS, artMissing, DRACONIC, draconic,
  };
})();
