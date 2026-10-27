// Survival, healing, minion, poise and utility perks for the Test tab, transcribed from the Voxlpedia
// perk / Stats / Summons / Status Effects pages. Damage perks live in effects.js; this covers the rest.
(function () {
  const PHYSICAL_GROUP = ["Physical", "Air", "Earth"];
  const INC_TYPES = ["Physical", "Air", "Earth", "Magic", "Fire", "Water", "Hex", "Holy", "True"];

  // Who hits you: the picked wiki enemy (mode "enemy") or the training dummy (mode "custom"), with a sequence of
  // attacks ({a: attack index or "c" for a custom hit, n: times, dmg, types}) that repeats at `per10` hits per 10s.
  // `blockPct` is how often you block. The rest has no setting in the Test tab and keeps these values.
  const defaults = () => ({
    mode: "enemy", enemy: "dire-buni", seq: null, per10: 5, blockPct: 0,
    stun: 0.5, hp: 0, // hp 0 = 100 × level multiplier
    parryPer10: 0, mounted: false, shieldUp: true, healingAllies: false,
    summonDps: 5, summonHp: 50, speed: 16,
  });

  const enemyById = () => Object.fromEntries((window.VOXL_DATA.enemies || []).map((e) => [e.id, e]));
  const customHit = () => ({ a: "c", n: 1, dmg: 20, types: { Physical: 1 } });
  // without a sequence of its own, an enemy uses each of its attacks once and the dummy one custom hit
  const defaultSeq = (e) => (e && e.attacks.length ? e.attacks.map((_, i) => ({ a: i, n: 1 })) : [customHit()]);

  // One step of the sequence as an attack: {name, parts: {type: damage}, hits, guardbreak, n}
  function stepAttack(st, e) {
    const n = Math.max(1, Math.round(+st.n || 1));
    if (st.a === "c") {
      const types = Object.entries(st.types || {}).filter(([t, v]) => INC_TYPES.includes(t) && v > 0);
      const sum = types.reduce((x, [, v]) => x + v, 0) || 1;
      const dmg = Math.max(0, +st.dmg || 0);
      const parts = Object.fromEntries((types.length ? types : [["Physical", 1]]).map(([t, v]) => [t, (dmg * v) / (types.length ? sum : 1)]));
      return { name: "Custom hit", parts, hits: 1, guardbreak: 0, n };
    }
    const a = e && e.attacks[st.a];
    return a ? { name: a.name, parts: { ...a.parts }, hits: a.hits, guardbreak: a.guardbreak ? 1 : 0, n, attack: a } : null;
  }

  // The sequence averaged into one incoming attack (by how many times each step is used).
  function incoming(inc) {
    const e = inc.mode === "enemy" ? enemyById()[inc.enemy] : null;
    const steps = (Array.isArray(inc.seq) ? inc.seq : defaultSeq(e)).map((st) => stepAttack(st, e)).filter(Boolean);
    const total = steps.reduce((x, st) => x + st.n, 0);
    const parts = {};
    steps.forEach((st) => Object.entries(st.parts).forEach(([t, v]) => { parts[t] = (parts[t] || 0) + (v * st.n) / total; }));
    const avg = (f) => (total ? steps.reduce((x, st) => x + f(st) * st.n, 0) / total : 0);
    const who = e ? e.name : "Training dummy";
    const name = !steps.length ? `${who} · no attacks` : steps.length === 1 ? `${who} · ${steps[0].name}` : `${who} · ${total} attacks averaged`;
    return { name, parts, hits: avg((st) => st.hits) || 1, guardbreak: avg((st) => st.guardbreak), enemy: e, steps };
  }

  // Every perk this module models, by section.
  const GROUPS = {
    defense: ["adaptive-plate", "bulwark", "buckler", "parry", "turtle", "rabbits-foot", "hardened-will", "future-sight", "undying-rot", "carapace",
      "vapor-aegis", "lithic-veil", "reinforced-block", "stoneskin", "mounted-defense", "pain-distribution", "defensive-stance", "wall", "quickcast", "colossus"],
    healing: ["heal-boost", "lifesteal", "life-drinker", "honey-gather", "vital-mist", "light-bearer", "ocean-song", "essence-totem", "crimson-tithe",
      "inoculation", "critical-healing", "holy-tides", "deepcrystal-calling", "star-friendship", "revel-in-death"],
    summons: ["swarm", "trusty-servant", "directive", "blood-rush", "sweet-tooth", "drone", "warden-of-many", "divine-intervention", "possession",
      "spore-trooper", "bumblz-spirit"],
    poise: ["concussion", "dominating"],
    utility: ["equipment-farmer", "trophy-hunter", "investigator", "untethered", "contained", "wildfire", "darkening-hex", "bomber-satchel", "spirit-commune"],
  };
  const PERK_IDS = Object.values(GROUPS).flat();

  const fmt1 = (v) => String(Math.round(v * 10) / 10);
  const red = (d) => (d >= 0 ? 1 / (1 + d / 100) : 1 + Math.abs(d) / 100); // Stats page: x / (1 + def%), negative adds |def|%

  function evaluate(ctx, mods, s, sim, Dmg) {
    const inc = { ...defaults(), ...(s.inc || {}) };
    const p = (id) => ctx.perks[id] || 0;
    const st = ctx.stats;
    const S = ctx.S;
    const lvl = ctx.level;
    const lvlMult = 1 + lvl * 0.0125; // Mechanics: +1.25% HP, healing and damage per level
    const maxHp = inc.hp > 0 ? inc.hp : 100 * lvlMult;
    const T = Math.max(1e-6, sim.T);
    const rows = { defense: [], healing: [], summons: [], poise: [], utility: [] };
    const row = (group, id, text, value) => { if (p(id)) rows[group].push({ id, name: (window.VOXL_DATA.perks[id] || { name: id }).name, amt: p(id), text, value }); };
    const reinforce = ctx.statuses.reinforce && ctx.statuses.reinforce.on ? ctx.statuses.reinforce.potency || 0 : 0;
    // Draconic rune infusion (Draconic Blood page): Dragon Infusion buff share of the fight and its potency
    const drc = ctx.draconic && p("draconic-blood") ? ctx.draconic : null;
    const blood = p("draconic-blood");
    const infSt = ctx.statuses["draconic-infusion"];
    const infPot = drc && drc.ability.id === "infusion" ? (infSt && infSt.potency !== null ? infSt.potency : 0.1 * blood) : 0;
    const infUp = infPot ? Math.max(sim.infUptime || 0, S.self["draconic-infusion"] ? 1 : 0) : 0;
    const infColor = drc && drc.blooded && infUp ? drc.color : null;
    const artTime = (sim.casts || []).filter((c) => c.key === "art");

    // ---------------------------------------------------------------- DEFENSE (one incoming attack)
    const atk = incoming(inc);
    const raw = Object.values(atk.parts).reduce((x, v) => x + v, 0);
    const attacks10 = Math.max(0, +inc.per10 || 0);
    const hitsPerSec = attacks10 / 10;
    const tenacity = st.Tenacity || 0;
    const stunRes = tenacity + 0.2 * p("colossus") + (p("lithic-veil") ? 0.4 * p("lithic-veil") : 0) + (infColor === "Earth" ? 1.5 * infPot * infUp : 0);
    const stunAfter = Math.max(0, inc.stun - stunRes);
    const bulwarkOn = p("bulwark") && inc.stun > 0 && inc.stun - tenacity <= 0.2 * p("bulwark") + 1e-9;
    let defBonus = 0;
    const factors = [];
    if (p("adaptive-plate")) defBonus += 10 * p("adaptive-plate"); // bubble is up after the same type hits twice
    if (bulwarkOn) defBonus += 33.34;
    if (p("carapace") && inc.shieldUp && (st.Protection || 0) > 0) defBonus += 15 * p("carapace");
    if (p("defensive-stance") && S.target.taunted) defBonus += 50 * p("defensive-stance");
    // each damage type of the attack against its group defense (Physical/Magic) and its own type defense
    let afterDef = 0, physAfter = 0;
    Object.entries(atk.parts).forEach(([type, v]) => {
      const group = type === "True" ? null : PHYSICAL_GROUP.includes(type) ? "Physical" : "Magic";
      const groupDef = group ? (st[group + " Defense"] || 0) + defBonus : 0;
      const typeDef = group && type !== group ? st[type + " Defense"] || 0 : 0;
      let m = group ? red(groupDef) * red(typeDef) : 1;
      if (p("vapor-aegis") && reinforce && (type === "Fire" || type === "Water")) m *= 0.1;
      afterDef += v * m;
      if (group === "Physical") physAfter += v * m;
      factors.push([`${fmt1(v)} ${type}: ${group ? `${group} defense ${Math.round(groupDef)}%${typeDef ? `, ${type} ${Math.round(typeDef)}%` : ""}` : "ignores defense"}${p("vapor-aegis") && reinforce && (type === "Fire" || type === "Water") ? ", Vapor Aegis" : ""}`, m]);
    });
    let mult = raw ? afterDef / raw : 1;
    // damage reduction: damageTaken / (1 + dr%)
    let dr = 0;
    if (reinforce) dr += reinforce * 100;
    if (p("undying-rot") && S.self["self-poison"]) dr += 15 * p("undying-rot");
    if (p("mounted-defense") && inc.mounted) dr += 30 * p("mounted-defense");
    if (dr) { mult /= 1 + dr / 100; factors.push([`Damage reduction +${Math.round(dr)}%`, 1 / (1 + dr / 100)]); }
    // chance-based and partial-uptime effects, as expected values; guardbreaks go through blocks
    const canGuard = 1 - (p("defensive-stance") ? 0 : atk.guardbreak);
    const blockShare = Math.min(1, Math.max(0, +inc.blockPct || 0) / 100) * canGuard;
    const turtle = Math.min(1, 0.2 * p("turtle")) * canGuard;
    const blocked = blockShare + (1 - blockShare) * turtle;
    if (blocked > 0) {
      // a block is +100% damage reduction on that hit; Reinforced Block adds 50% per amount
      const blockDr = 100 + 50 * p("reinforced-block");
      const f = 1 - blocked + blocked / (1 + blockDr / 100);
      mult *= f; factors.push([`Blocking ${Math.round(blocked * 100)}% of attacks (−${Math.round(100 - 100 / (1 + blockDr / 100))}% each)`, f]);
    }
    const parryShare = (p("parry") || p("buckler")) ? Math.min(1, inc.parryPer10 / Math.max(1e-6, attacks10)) : 0;
    if (parryShare) { const f = 1 - 0.9 * parryShare; mult *= f; factors.push([`Parry on ${Math.round(parryShare * 100)}% of attacks (−90%)`, f]); }
    const dodge = Math.min(1, 0.01 * p("rabbits-foot"));
    if (dodge) { mult *= 1 - dodge; factors.push([`Rabbits Foot dodge ${Math.round(dodge * 100)}%`, 1 - dodge]); }
    if (p("future-sight")) {
      // Future Glimpse returns after (22.5 − 7.5×amt)s (min 5) without being hit: share of hits dodged = e^(−rate×wait)
      const wait = Math.max(5, 22.5 - 7.5 * p("future-sight"));
      const share = hitsPerSec > 0 ? Math.exp(-hitsPerSec * wait) : 1;
      mult *= 1 - share; factors.push([`Future Sight dodges ${(share * 100).toFixed(1)}% of attacks (${wait}s quiet)`, 1 - share]);
    }
    if (p("hardened-will")) { const f = 1 - 0.05 * 0.8; mult *= f; factors.push(["Hardened Will 5% chance −80%", f]); }
    if (p("stoneskin") && artTime.length) {
      // lasts the art animation plus 50% of its cooldown
      const art = sim.timing.art;
      const up = Math.min(1, (artTime.length * (art.cast + 0.5 * (sim.cooldowns.art || 0))) / T);
      const f = 1 - up * Math.min(0.8, 0.3 * p("stoneskin"));
      mult *= f; factors.push([`Stoneskin up ${Math.round(up * 100)}% of the fight`, f]);
    }
    let perHit = raw * mult;
    if (p("lithic-veil") && physAfter > 0 && inc.healingAllies) {
      const cut = Math.min(physAfter * (mult / (raw ? afterDef / raw : 1)), 0.25 * p("lithic-veil") * atk.hits);
      perHit = Math.max(0, perHit - cut); factors.push([`Lithic Veil −${0.25 * p("lithic-veil")} physical per hit`, null]);
    }
    let toMinions = 0;
    if (p("pain-distribution") && S.summons > 0) { toMinions = Math.min(0.9, 0.1 * p("pain-distribution")); perHit *= 1 - toMinions; factors.push([`Pain Distribution: ${Math.round(toMinions * 100)}% to minions`, 1 - toMinions]); }
    // Protection: shield absorbs 75% of hit damage (not DoTs) until it breaks
    const shield = Math.min(maxHp, Math.max(0, st.Protection || 0));
    const hitsToBreak = shield > 0 && perHit > 0 ? shield / (perHit * 0.75) : 0;
    const warding = st.Warding || 0;
    const defense = {
      attack: atk, raw, perHit, takenPct: raw ? (perHit / raw) * 100 : 0, perSec: perHit * hitsPerSec, hitsPerSec, maxHp, shield, hitsToBreak,
      ehp: perHit > 0 ? (maxHp / (perHit / raw)) + (shield > 0 ? shield / 3 : 0) : Infinity, factors, blocked,
      hitsToDie: perHit > 0 ? Math.ceil((maxHp + shield * 0.75) / perHit) : Infinity,
      stun: { raw: inc.stun, after: bulwarkOn ? 0 : stunAfter, res: stunRes, bulwark: bulwarkOn, artCast: p("quickcast") ? Math.max(0, stunAfter - 0.2) : null },
      dotTaken: red(warding * 2), debuffPotency: red(warding),
    };
    row("defense", "adaptive-plate", `+${10 * p("adaptive-plate")}% defense while the bubble is up (after taking the same type twice)`);
    row("defense", "bulwark", bulwarkOn ? `Stun ${inc.stun}s − tenacity ${tenacity} ≤ ${0.2 * p("bulwark")}s: no stun, +33.34% defense` : `Inactive: stun after tenacity ${(inc.stun - tenacity).toFixed(2)}s > ${(0.2 * p("bulwark")).toFixed(2)}s`);
    row("defense", "buckler", `Grants Parry +${p("buckler")}`);
    row("defense", "parry", `Parries take −90%; set parries per 10s · deals ${40 * (p("parry") + p("buckler"))} poise`);
    row("defense", "turtle", `${Math.round(turtle * 100)}% chance to auto-block (blocking itself reduces nothing without Reinforced Block)`);
    row("defense", "rabbits-foot", `${Math.round(dodge * 100)}% dodge · roll i-frames ×${(1 + 0.5 * p("rabbits-foot")).toFixed(2)}`);
    row("defense", "hardened-will", "5% chance to take −80% and ignore stun");
    row("defense", "future-sight", `Autododge after ${Math.max(5, 22.5 - 7.5 * p("future-sight"))}s unhit`);
    row("defense", "undying-rot", S.self["self-poison"] ? `+${15 * p("undying-rot")}% damage reduction while poisoned` : "Needs Poisoned (you) on");
    row("defense", "carapace", `+${15 * p("carapace")}% defense while shield is up · stun immune with shield`);
    row("defense", "vapor-aegis", reinforce ? "−90% Fire & Water with Reinforce · Reinforce lasts +" + 10 * p("vapor-aegis") + "%" : "Needs Reinforce on");
    row("defense", "lithic-veil", `After healing anyone: −${0.25 * p("lithic-veil")} physical per hit, −${0.4 * p("lithic-veil")}s stun`);
    row("defense", "reinforced-block", `+${100 + 50 * p("reinforced-block")}% damage reduction on blocked hits`);
    row("defense", "stoneskin", `−${Math.round(Math.min(0.8, 0.3 * p("stoneskin")) * 100)}% damage during arts and 50% of the cooldown after`);
    row("defense", "mounted-defense", `+${30 * p("mounted-defense")}% damage reduction while on the Glacial Snapper mount`);
    row("defense", "pain-distribution", `${Math.round(Math.min(0.9, 0.1 * p("pain-distribution")) * 100)}% of damage taken split to minions · minion HP +${20 * p("pain-distribution")}%`);
    row("defense", "defensive-stance", `+${50 * p("defensive-stance")}% defense vs Taunted · can't be guardbroken`);
    row("defense", "wall", `Allies hit near your block send ${10 * p("wall")}% of their damage to you (4s)`);
    row("defense", "quickcast", `Stun −0.2s while casting arts · arts cast ${20 + 10 * p("quickcast")}% faster`);
    row("defense", "colossus", `+${(0.2 * p("colossus")).toFixed(2)}s stun resistance · size +${20 * p("colossus")}%`);

    // ---------------------------------------------------------------- HEALING
    const b = (k) => (st[k + " Boost"] || 0) / 100;
    const scal = (sc) => 1 + Object.entries(sc).reduce((a, [k, v]) => a + v * b(k), 0);
    const critP = p("critical-healing") ? Math.min(1, (20 + (st["Holy Boost"] || 0) / 5) / 100) : 0;
    const critBonus = 0.35 + 0.1665 * p("critical-healing");
    const healMult = (1 + 0.1 * p("heal-boost") + (p("holy-tides") ? 0.001 * ((st["Water Boost"] || 0) + (st["Holy Boost"] || 0)) * p("holy-tides") : 0)) * (1 + critP * critBonus) *
      (infColor === "Holy" ? 1 + infPot * infUp : 1); // Dragon Infusion (Holy): +10% healing per 0.1 potency
    const heal = (base, sc, noLevel) => base * scal(sc || {}) * (noLevel ? 1 : lvlMult) * healMult;
    const hs = []; // [name, HP per second, note]
    const directHits = sim.hitsBy ? Object.entries(sim.hitsBy).filter(([k]) => k !== "proc").reduce((a, [, v]) => a + v, 0) : 0;
    const weaponHits = sim.hitsBy ? sim.hitsBy.m1 + sim.hitsBy.m2 : 0;
    const dotTicks = Object.keys(Dmg.DOTS).filter((k) => S.target[k]).length * T;
    let lifesteal = 0;
    if (p("lifesteal")) lifesteal += (0.0025 * p("lifesteal") * sim.direct + 0.1 * directHits) / T;
    if (p("honey-gather") && S.target.sticky) lifesteal += (0.005 * p("honey-gather") * sim.direct + 0.1 * directHits) / T;
    if (p("life-drinker")) lifesteal += (0.0025 * p("life-drinker") * sim.dotTotal + 0.1 * dotTicks) / T;
    if (p("vital-mist") && lifesteal > 0) {
      // lifesteal becomes Vital Mist (1 HP → 10 potency), consumed at (2 + 0.5×amt) per tick, healing 1 HP per 5 potency
      const potencyIn = lifesteal * 10;
      const used = Math.min(potencyIn, (2 + 0.5 * p("vital-mist")) * (potencyIn > 50 ? 2 : 1));
      hs.push(["Vital Mist (from lifesteal)", (used / 5) * scal({ Air: 1, Physical: 1 }) * healMult, `max potency ${50 + 50 * p("vital-mist")}`]);
    } else if (lifesteal > 0) hs.push(["Lifesteal", lifesteal * healMult, "0.25%/amt of damage + 0.1 per hit"]);
    if (p("light-bearer") && weaponHits) hs.push(["Light Bearer pulses", (Math.min(1, 0.5 * p("light-bearer")) * weaponHits * heal(0.25 + 0.025 * p("light-bearer"), { Holy: 1 })) / T, "on M1/M2 hits"]);
    const art = ctx.wpn.art;
    const artCasts = sim.done ? sim.done.art : 0;
    if (art && artCasts) {
      const baseCd = art.cooldown || 0;
      if (p("ocean-song")) hs.push(["Ocean Song", (artCasts * heal((0.7 + 0.1 * p("ocean-song")) * (1 + baseCd / 30), { Water: 1, Dexterity: 1 })) / T, "per weapon art"]);
      if (p("essence-totem")) hs.push(["Essence Totem", (artCasts * (1 + baseCd / 5) * heal(1.2 + 0.1 * p("essence-totem"), { Holy: 0.5, Earth: 0.5 })) / T, `${Math.floor(1 + baseCd / 5)} pulses per art`]);
      if (p("crimson-tithe")) {
        const uses = Math.min(artCasts, Math.floor(T / 15) + 1);
        const self = 0.2 * heal(3.2 + 1.6 * p("crimson-tithe"), { Physical: 0.7, Air: 0.7 });
        hs.push(["Crimson Tithe (20% to you)", (uses * self) / T, "costs 33% of current HP as True damage"]);
        if (p("inoculation")) hs.push(["Inoculation (Tithe self-damage)", (uses * (0.3 * 0.33 * maxHp + 0.1) * p("inoculation")) / T, "30% of self-damage + 0.1"]);
      }
    }
    if (p("undying-rot") && S.self["self-poison"]) hs.push(["Undying Rot", (0.2 + 0 / 7.5) * p("undying-rot") * healMult, "per tick while poisoned (unaffected by level)"]);
    const regen = ctx.statuses.regen && ctx.statuses.regen.on;
    if (regen) { const pot = p("holy-tides") ? 0.5 * p("holy-tides") : 1; hs.push(["Regen", heal(pot, { Water: 1, Holy: 1 }), `potency ${pot}`]); }
    if (drc && drc.blooded && drc.ability.id !== "infusion" && (drc.color === "Holy" || drc.color === "Water") && sim.done && sim.done.drac) {
      const claw = drc.ability.id === "claw";
      const base = drc.color === "Holy" ? (claw ? 5 + 0.5 * blood : 4 + 0.4 * blood) : (claw ? 1.923 + 0.1923 * blood : 1.538 + 0.1538 * blood);
      hs.push([`${drc.ability.name} (${drc.color})`, (sim.done.drac * heal(base, { [drc.color]: 1 })) / T, `${heal(base, { [drc.color]: 1 }).toFixed(2)} per use`]);
    }
    if (infColor === "Water") hs.push(["Dragon Infusion pulses (Water)", (heal(0.1, { Water: 1 }) / Math.max(1, 8 - blood)) * infUp, `every ${Math.max(1, 8 - blood)}s while infused`]);
    const healing = { list: hs, total: hs.reduce((a, [, v]) => a + v, 0), mult: healMult, critP, critBonus, lvlMult, maxHp };
    row("healing", "heal-boost", `Healing +${10 * p("heal-boost")}%`);
    row("healing", "lifesteal", `Heal ${(0.25 * p("lifesteal")).toFixed(2)}% of hit damage + 0.1 per hit (not DoTs)`);
    row("healing", "life-drinker", `Heal ${(0.25 * p("life-drinker")).toFixed(2)}% of DoT damage + 0.1 · DoTs last +${20 * p("life-drinker")}%`);
    row("healing", "honey-gather", S.target.sticky ? `Heal ${(0.5 * p("honey-gather")).toFixed(2)}% of damage vs Sticky + 0.1` : "Needs Sticky on the target");
    row("healing", "vital-mist", `Lifesteal → Vital Mist; above 50 it pulses Tailwind ${(0.1 + 0.1 * p("vital-mist")).toFixed(1)}`);
    row("healing", "light-bearer", `${Math.round(Math.min(1, 0.5 * p("light-bearer")) * 100)}% per M1/M2 hit: ${(0.25 + 0.025 * p("light-bearer")).toFixed(3)} base Holy heal`);
    row("healing", "ocean-song", art ? `Each art heals ${heal((0.7 + 0.1 * p("ocean-song")) * (1 + (art.cooldown || 0) / 30), { Water: 1, Dexterity: 1 }).toFixed(2)} and cleanses` : "Needs a weapon art");
    row("healing", "essence-totem", art ? `Each art: ${Math.floor(1 + (art.cooldown || 0) / 5)} pulses of ${heal(1.2 + 0.1 * p("essence-totem"), { Holy: 0.5, Earth: 0.5 }).toFixed(2)}` : "Needs a weapon art");
    row("healing", "crimson-tithe", `Art: burst ${heal(3.2 + 1.6 * p("crimson-tithe"), { Physical: 0.7, Air: 0.7 }).toFixed(2)} (20% to you), tether ${heal(0.266 + 0.133 * p("crimson-tithe"), { Physical: 0.7, Air: 0.7 }).toFixed(2)}/s to allies; costs ${Math.round(0.33 * maxHp)} HP`);
    row("healing", "inoculation", `Self-damage heals (30% of it + 0.1) × ${p("inoculation")}`);
    row("healing", "critical-healing", `${Math.round(critP * 100)}% chance for +${Math.round(critBonus * 100)}% healing`);
    row("healing", "holy-tides", `Healing +${(0.1 * ((st["Water Boost"] || 0) + (st["Holy Boost"] || 0)) * p("holy-tides")).toFixed(1)}% · cleansing grants Regen ${0.5 * p("holy-tides")}`);
    row("healing", "deepcrystal-calling", `Ally cleanses spawn a crystal: ${heal(0.4 + 0.1 * p("deepcrystal-calling"), { Water: 1 }).toFixed(2)} × ${p("deepcrystal-calling") <= 3 ? 4 * p("deepcrystal-calling") : 6 + 2 * p("deepcrystal-calling")} ticks (10s cd)`);
    row("healing", "revel-in-death", `A minion dying heals ${(heal(0.1 * p("revel-in-death") * inc.summonHp, {}, true)).toFixed(1)} (${p("revel-in-death") * 10}% of its base HP; 1/10 if it despawned)`);
    row("healing", "star-friendship", `Healed allies' next art: +${50 * p("star-friendship")}% cooldown speed, heals ${(3 + 1.5 * p("star-friendship")).toFixed(1)} base`);

    // ---------------------------------------------------------------- MINIONS
    const sb = (st["Summon Boost"] || 0) / 100;
    const scale = 1 + sb * (1 + lvl / 80); // Summons page
    const swarm = p("swarm") ? Math.min(1, 0.75 + 0.05 * p("swarm")) : 1;
    const trustyD = p("trusty-servant") ? 1 + (300 + 100 * p("trusty-servant")) / 100 : 1;
    const trustyH = p("trusty-servant") ? 1 + (100 + 50 * p("trusty-servant")) / 100 : 1;
    const m2Share = sim.done && sim.done.m2 ? Math.min(1, (sim.done.m2 * 5) / T) : 0;
    const directive = p("directive") ? 1 + p("directive") * m2Share : 1;
    const sweet = p("sweet-tooth") && S.target.sticky ? 1 + 0.25 * p("sweet-tooth") : 1;
    const dmgMult = scale * swarm * trustyD * directive * sweet;
    const hpMult = scale * swarm * trustyH * (1 + 0.2 * p("pain-distribution"));
    const cap = p("trusty-servant") ? 1 : 15 + Math.round(p("swarm"));
    const count = Math.min(cap, S.summons);
    const summons = {
      scale, dmgMult, hpMult, cap, count, dps: count * inc.summonDps * dmgMult, hp: inc.summonHp * hpMult,
      shield: p("drone") ? Math.min(0.9 * inc.summonHp * hpMult, 10 * p("drone") * scale) : 0,
      decay: p("trusty-servant") ? 0 : null, possession: p("possession") ? (3 * lvl + (st["Summon Boost"] || 0) + 50) * p("possession") + 25 : 0,
    };
    row("summons", "swarm", `Twice the minions at ${Math.round(swarm * 100)}% HP & damage · cap ${cap}`);
    row("summons", "trusty-servant", `One minion: ×${trustyD.toFixed(1)} damage, ×${trustyH.toFixed(1)} HP, no decay`);
    row("summons", "directive", `After your M2: minions +${100 * p("directive")}% damage for 5s (up ${Math.round(m2Share * 100)}% of the fight)`);
    row("summons", "blood-rush", `Low-HP minions (< ${Math.min(90, 15 * p("blood-rush"))}% HP) gain Rage ${(0.15 * p("blood-rush")).toFixed(2)}`);
    row("summons", "sweet-tooth", `${Math.min(100, 10 * p("sweet-tooth"))}% chance to Sticky; vs Sticky +${25 * p("sweet-tooth")}% and heals ${((0.005 * inc.summonHp * hpMult + 3) * p("sweet-tooth")).toFixed(1)}`);
    row("summons", "drone", `Minion shield ${summons.shield.toFixed(1)} HP · stun/knockback immune while shielded`);
    row("summons", "warden-of-many", "Gaining Reinforce gives minions Autoblock for 1.6× its duration");
    row("summons", "divine-intervention", `Minions get ${100 * p("divine-intervention")}% of your heals and your buffs`);
    row("summons", "possession", `Can possess mobs with base HP ≤ ${Math.round(summons.possession)}`);
    row("summons", "spore-trooper", `Stores up to ${2 + Math.ceil(p("spore-trooper"))} sporelings (1 per 5s), thrown on M2`);
    row("summons", "bumblz-spirit", "Summoning at full energy summons 4 more");

    // ---------------------------------------------------------------- POISE / UTILITY
    const poiseMult = (1 + 0.166 * tenacity * p("concussion")) * (1 + 0.2 * p("colossus")) * (p("dominating") && S.target.taunted ? 1 + 0.33 * p("dominating") : 1) *
      (infColor === "Earth" ? 1 + 1.5 * infPot * infUp : 1); // Dragon Infusion (Earth): +15% poise damage per 0.1 potency
    const poise = { mult: poiseMult, stunMult: 1 + 0.1 * tenacity * p("concussion"), stunFlat: 0.2 * tenacity * p("concussion"), parry: 40 * (p("parry") + p("buckler")) };
    row("poise", "concussion", `Poise damage +${(16.6 * tenacity * p("concussion")).toFixed(1)}%, stun +${(10 * tenacity * p("concussion")).toFixed(1)}% +${poise.stunFlat.toFixed(2)}s (tenacity ${tenacity})`);
    row("poise", "dominating", `+${33 * p("dominating")}% poise damage vs Taunted${S.target.taunted ? "" : " (target not Taunted)"}`);
    const moveSpeed = (spd, a) => (spd < 25 + 5 * a ? (spd + (25 + a * 5) * a) / (1 + a) : spd);
    row("utility", "equipment-farmer", "Mob drops skip crafting materials (more equipment)");
    row("utility", "trophy-hunter", `"None" drop weight −${20 * p("trophy-hunter")}% (diminishing)`);
    row("utility", "investigator", "Does nothing (wiki)");
    row("utility", "untethered", `Movement while slowed by actions: speed ${inc.speed} → ${moveSpeed(inc.speed, p("untethered")).toFixed(1)}`);
    row("utility", "contained", `Buffs and self-debuffs last +${33 * p("contained")}% (Rage Rune windows included)`);
    row("utility", "wildfire", `DoTs hit every enemy in range (${S.enemies} set in Situation)`);
    row("utility", "darkening-hex", S.darkHex ? "Hex hits raise your debuff potency (10 activations, applied to DoTs, Shatter, Rend, Slow)" : "Needs Hex damage on your weapon, art or rune");
    row("utility", "bomber-satchel", "Art hits store 5 Beenades for the next Beenade Rune");
    if (drc) {
      const DR = window.VoxlModel.DRACONIC;
      const colorText = !drc.blooded ? "not Dragon Blooded: Physical, no color bonus" : drc.ability.id === "infusion" ? DR.infusion[drc.color] : DR.attack[drc.color].text;
      row("utility", "draconic-blood", `${drc.ability.name} (${drc.type}) on its own rune key${drc.ability.id === "infusion" ? `, Draconic Infusion ${infPot.toFixed(2)} up ${Math.round(infUp * 100)}% of the fight` : `, ${drc.ability.id === "bubble" ? 45 : 60} poise per hit`} · ${colorText}`);
    }
    row("utility", "spirit-commune", sim.spiritGated ? `Spirit released at ${sim.energyMax} energy (timeline)` : "Builds energy for monk spirits");

    return { defense, healing, summons, poise, rows, inc };
  }

  window.VoxlSupport = { defaults, evaluate, incoming, stepAttack, defaultSeq, customHit, enemyById, GROUPS, PERK_IDS, INC_TYPES };
})();
