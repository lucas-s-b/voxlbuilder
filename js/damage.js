// Damage model for the Test tab, following the Voxlpedia wiki:
//  DMG = Base × (1 + Σ scaling × boost) × Level × Damage Bonus × Type Specific × Crit × Armor
//  (Damage Calculation, Damage Type and Scalings, Critical Hit, Armor Penetration, Attack Speed,
//   Cooldowns, Status Effects and the perk pages; perk effects live in js/effects.js).
(function () {
  const C = window.VoxlCalc;
  const M = window.VoxlModel;
  const FX = window.VoxlEffects;

  const DMG_TYPES = ["Physical", "Magic", "Fire", "Water", "Earth", "Air", "Hex", "Holy", "True"];
  const PHYSICAL_GROUP = ["Physical", "Air", "Earth"];
  const STAR_TYPES = ["Magic", "Air", "Fire", "Hex", "Holy", "Water"];

  // Burn / Bleed / Poison: base 1.75 × (1 + potency/1.1) per second for player-inflicted DoTs.
  const DOTS = {
    Burn: { type: "Fire", scalings: { Fire: 1.5 } },
    Bleed: { type: "Physical", scalings: { Physical: 1, Dexterity: 1 } },
    Poison: { type: "Hex", scalings: { Hex: 1, Earth: 1 } },
  };

  const defaults = () => ({
    attack: "m1", spirit: null, swingTime: 0.5, perkAtkSpeed: 0,
    customBase: 20, customHits: 1, crit: "avg", dmgBonus: 0,
    target: { Physical: 0, Magic: 0, Fire: 0, Water: 0, Earth: 0, Air: 0, Hex: 0, Holy: 0 },
    dots: { Burn: { on: false, potency: 0 }, Bleed: { on: false, potency: 0 }, Poison: { on: false, potency: 0 } },
    // rotation: "time" = everything enabled on cooldown for `duration` seconds; "count" = each enabled action `count` times
    rotMode: "time", duration: 30, spiritMax: 100,
    rotOrder: ["rune", "drac", "art", "special", "custom", "m1"], // priority, top first; "m1" = the M1 combo (+ its M2)
    timing: {}, // per action {cast, active} overrides, e.g. "art:starstream"
    rot: {
      m1: { on: true, count: 5 }, m2: { on: false, count: 2 }, art: { on: true, count: 3 }, rune: { on: true, count: 1 }, drac: { on: true, count: 1 },
      special: { on: false, count: 3, cooldown: 0 }, custom: { on: false, count: 3, cooldown: 0 },
    },
    potions: {}, status: {}, perkOn: {}, sit: {},
  });

  const round = C.round;
  const sumHits = (hits) => (hits || []).reduce((a, [v, n]) => a + v * n, 0);
  const countHits = (hits) => (hits || []).reduce((a, [, n]) => a + n, 0);
  const cdFloor = (v) => Math.max(1, Math.floor(v + 1e-9));

  // ------------------------------------------------------------ context: build + toggles → situation
  function context(build, totals, wpn, s) {
    s = s || build.test || defaults();
    const perks = {};
    Object.values(totals.perks).forEach((p) => { perks[p.id] = p.amount; });
    const race = M.RACE_EFFECTS[build.race] || {};
    const runeSlot = build.slots.rune;
    const rune = runeSlot && window.VOXL_DATA.items.find((i) => i.id === runeSlot.id);
    const form = M.weaponForm(build, perks);
    const potions = new Set(Object.keys(s.potions || {}).filter((k) => s.potions[k]));
    const ctx = { build, stats: totals.stats, perks, race, wpn, rune, form, potions, level: build.level || 80, draconic: M.draconic(build) };
    ctx.potionMult = 1 + 0.2 * (perks["potion-chugger"] || 0);
    ctx.statuses = resolveStatuses(ctx, s);
    ctx.dotSources = dotSources(ctx);
    ctx.S = situation(ctx, s);
    return ctx;
  }

  const perkOf = (ctx) => (id) => ctx.perks[id] || 0;

  // Which statuses the build can provide, their best source, and whether the user switched them on.
  function resolveStatuses(ctx, s) {
    const p = perkOf(ctx);
    const out = {};
    const buffMult = 1 + 0.1 * p("bastion-bless");
    const debuffAdj = (v) => (p("endless-despair") ? v * (1 + 0.35 * p("endless-despair")) + 0.1 : v);
    FX.STATUSES.forEach((st) => {
      const sources = st.sources(ctx, p).filter(Boolean);
      if (!sources.length) return;
      const set = (s.status || {})[st.id] || {};
      const idx = Math.min(sources.length - 1, Math.max(0, set.src | 0));
      let potency = null;
      if (st.potency) {
        const raw = typeof set.pot === "number" ? set.pot : sources[idx][1];
        potency = st.side === "target" ? debuffAdj(raw) : raw * (sources[idx][0].includes("Potion") ? 1 : buffMult);
      }
      out[st.id] = { def: st, sources, src: idx, on: !!set.on, potency, variant: st.variants ? sources[idx][1] : null, customPot: typeof set.pot === "number" };
    });
    return out;
  }

  function dotSources(ctx) {
    const out = {};
    Object.keys(DOTS).forEach((k) => {
      const list = FX.DOT_SOURCES[k].filter((id) => ctx.perks[id]).map((id) => (window.VOXL_DATA.perks[id] || { name: id }).name);
      if (ctx.rune && FX.DOT_RUNES[k].includes(ctx.rune.id)) list.push(ctx.rune.name);
      if (ctx.build.race === "dark-elf") list.push("Dark Elf");
      if (k === "Poison" && ctx.potions.has("throwable-poison-potion")) list.push("Throwable Poison Potion");
      if (k === "Poison" && ctx.form.m1 === "Virulent Core") list.push("Virulent Core");
      const d = ctx.draconic;
      if (k === "Burn" && d && d.blooded && d.color === "Fire" && ctx.perks["draconic-blood"]) list.push(d.ability.name + " (Fire)");
      out[k] = list;
    });
    return out;
  }

  function situation(ctx, s) {
    const sit = {};
    Object.entries(FX.SITUATION).forEach(([k, d]) => {
      const v = (s.sit || {})[k];
      sit[k] = v === undefined || v === null || v === "" ? d.def : d.options ? (d.options.includes(v) ? v : d.def) : +v;
    });
    // hits taken / blocked come from the INCOMING DAMAGE setup (attacks per 10s and how many you block)
    if (s.inc && typeof s.inc.per10 === "number") {
      const share = Math.min(1, Math.max(0, +s.inc.blockPct || 0) / 100);
      sit.hitsPer10 = s.inc.per10 * (1 - share);
      sit.blocksPer10 = s.inc.per10 * share;
    }
    const st = ctx.statuses;
    const on = (id) => st[id] && st[id].on;
    const self = {};
    ["tailwind", "bounce", "inspired", "reinforce", "critical-boost", "regen", "self-poison", "self-burn", "self-bleed", "self-slow", "draconic-infusion", "lightning-cloak"].forEach((id) => { self[id] = !!on(id); });
    if (ctx.draconic) sit.element = ctx.draconic.color; // Draconic color is picked with the guild in the Character tab
    const pots = potencyPerks(ctx);
    // Darkening Hex: Hex hits reach its 10-activation cap quickly; each adds then multiplies your debuffs' potency.
    const dh = ctx.perks["darkening-hex"] || 0;
    const hexHits = dh && [ctx.wpn.types, ctx.wpn.art && ctx.wpn.art.types, ctx.rune && ctx.rune.attack && ctx.rune.attack.types].some((t) => t && t.Hex > 0);
    const darken = (v, mult) => { if (!hexHits) return v; for (let i = 0; i < 10; i++) v = (v + 0.005 * dh) * (mult ? 1 + 0.05 * dh : 1); return v; };
    const applied = Object.fromEntries(Object.keys(DOTS).map((k) => [k, darken((+s.dots[k].potency || 0) + 0.1 * pots[k], true)]));
    // Dragon Infusion (Fire): applied Burn potency +15% per Draconic Blood; (Hex): applied debuffs +5% potency per Draconic Blood
    const dInf = ctx.draconic && ctx.draconic.blooded && ctx.draconic.ability.id === "infusion" && on("draconic-infusion") ? ctx.perks["draconic-blood"] || 0 : 0;
    if (dInf && ctx.draconic.color === "Fire") applied.Burn *= 1 + 0.15 * dInf;
    if (dInf && ctx.draconic.color === "Hex") Object.keys(applied).forEach((k) => { applied[k] *= 1 + 0.05 * dInf; });
    const target = {
      Bleed: ctx.dotSources.Bleed.length > 0 && s.dots.Bleed.on,
      Burn: ctx.dotSources.Burn.length > 0 && s.dots.Burn.on,
      Poison: ctx.dotSources.Poison.length > 0 && s.dots.Poison.on,
      sticky: on("sticky") ? st.sticky.variant : null,
      frostbite: !!on("frostbite"), slowed: !!on("slowed"), taunted: !!on("taunted"), weakened: !!on("weakened"),
    };
    const targetDebuffs = ["Bleed", "Burn", "Poison"].filter((k) => target[k]).length +
      ["shatter", "electrical-rend", "hypnotized", "sticky", "frostbite", "slowed", "taunted", "weakened"].filter(on).length + sit.extraTargetDebuffs;
    const selfDebuffs = ["self-poison", "self-burn", "self-bleed", "self-slow"].filter(on).length + sit.extraSelfDebuffs;
    return {
      ...sit, self, target, targetDebuffs, selfDebuffs,
      shatter: on("shatter") ? darken(st.shatter.potency, false) : 0,
      rend: on("electrical-rend") ? darken(st["electrical-rend"].potency, false) : 0,
      hypno: on("hypnotized") ? st.hypnotized.potency : 0,
      slowPotency: on("slowed") ? darken(st.slowed.potency, true) : 0, darkHex: !!hexHits,
      tailwindPotency: on("tailwind") ? st.tailwind.potency : 0, // already includes the Tailwind perk's +0.1/amt
      bouncePotency: on("bounce") ? st.bounce.potency : 0,
      inspiredPotency: on("inspired") ? st.inspired.potency : 0,
      weakPotency: st.weakened ? st.weakened.potency : 0.5,
      sun: !!(s.sit || {}).sun, shadows: !!(s.sit || {}).shadows,
      potency: pots, applied,
    };
  }

  function potencyPerks(ctx) {
    const out = {};
    Object.entries(FX.POTENCY_PERKS).forEach(([k, ids]) => { out[k] = ids.reduce((a, id) => a + (ctx.perks[id] || 0), 0); });
    return out;
  }

  // ------------------------------------------------------------ collect active perk effects
  function collect(ctx, s) {
    const m = {
      mult: [], typeMult: [], addType: [], convert: [], swap: [], pen: [], penByDef: 0, natCrit: [], noDexCrit: false,
      critRoll: [], critDmg: [], critBase: 0, chains: [], critOnly: [], critIgnoreDef: [], critPen: 0, primal: 0, alwaysCrit: [], thief: 0,
      fractured: 0, atkSpeed: [], atkTime: 1, cd: { art: { mult: 1, speed: 0 }, rune: { mult: 1, speed: 0 } }, procs: [], echoes: [],
      dot: { Burn: {}, Bleed: {}, Poison: {} }, dotAll: { addType: {} }, ticks: [], overrides: [], hitsMult: [], rageTypes: [],
      deltaDrill: 0, divinity: 0, artFlat: 0, runeFlat: 0, artCast: 0, staticBuildup: 0, pyreBloom: 0, m2Override: null, active: [], lucky: 0,
    };
    const E = {
      mult: (name, v, when) => m.mult.push({ name, v, when }),
      typeMult: (name, types, v) => m.typeMult.push({ name, types, v }),
      addType: (name, type, amt, when) => m.addType.push({ name, type, amt, when }),
      convert: (name, from, to, frac, when, early) => m.convert.push({ name, from, to, frac, when, early }),
      swap: (name, x, y) => m.swap.push([x, y]),
      pen: (name, flat, when) => m.pen.push({ name, flat, when }),
      penByDefense: (f) => { m.penByDef += f; },
      natCrit: (name, pct) => m.natCrit.push({ name, pct }),
      noDexCrit: () => { m.noDexCrit = true; },
      critRoll: (name, chance, when) => m.critRoll.push({ name, chance, when }),
      critDmg: (name, add, when) => m.critDmg.push({ name, add, when }),
      critBase: (v) => { m.critBase += v; },
      critOnly: (name, v, when) => m.critOnly.push({ name, v, when }),
      critIgnoreDef: (when) => m.critIgnoreDef.push(when),
      critPen: (v) => { m.critPen += v; },
      primal: (a) => { m.primal += a; },
      alwaysCrit: (name, bonus, when) => m.alwaysCrit.push({ name, bonus, when }),
      thief: (a) => { m.thief = a; },
      fractured: (f) => { m.fractured = f; },
      atkSpeed: (name, pct, when) => m.atkSpeed.push({ name, pct, when }),
      atkTime: (x) => { m.atkTime *= x; },
      artCast: (pct) => { m.artCast += pct; },
      cd: (kind, type, v) => { if (type === "mult") m.cd[kind].mult *= v; else m.cd[kind].speed += v; },
      proc: (spec) => m.procs.push(spec),
      echo: (spec) => m.echoes.push(spec),
      chain: (spec) => m.chains.push(spec),
      dot: (kind, o) => {
        const d = m.dot[kind];
        if (o.mult) d.mult = (d.mult || 1) * o.mult;
        if (o.setTypes) d.setTypes = o.setTypes;
        if (o.setScal) d.setScal = o.setScal;
        ["addType", "addScal"].forEach((k) => { if (o[k]) { d[k] = d[k] || {}; Object.entries(o[k]).forEach(([t, v]) => { d[k][t] = (d[k][t] || 0) + v; }); } });
      },
      dotAll: (o) => Object.entries(o.addType || {}).forEach(([t, v]) => { m.dotAll.addType[t] = (m.dotAll.addType[t] || 0) + v; }),
      tick: (spec) => m.ticks.push(spec),
      stat: () => {},
      override: (f) => m.overrides.push(f),
      hitsMult: (n, dmg, when) => m.hitsMult.push({ n, dmg, when }),
      rageTypes: (types) => m.rageTypes.push(...types),
      deltaDrill: (n) => { m.deltaDrill = n; },
      onFinisher: (k, a) => { m.divinity += a; },
      onWeaponHit: (k, v) => { m[k] += v; },
      staticBuildup: (a) => { m.staticBuildup = a; },
      pyreBloom: (a) => { m.pyreBloom = a; },
      m2Override: (spec) => { m.m2Override = spec; },
      lucky: (a) => { m.lucky += a; },
    };
    const on = s.perkOn || {};
    Object.values(FX.PERKS).forEach((pk) => {
      const a = ctx.perks[pk.id];
      if (!a) return;
      const enabled = on[pk.id] === undefined ? pk.def : !!on[pk.id];
      if (!enabled) return;
      pk.fx(E, a, ctx.S, ctx);
      m.active.push(pk.id);
    });
    // Lightning Cloak (weapon art status): chain lightning on hits, 1/3 of the hit, 130% chance × proc coefficient, up to 4 extra
    // targets. As a status toggle for single hits; in the timeline only during the 40s after casting the art.
    if (ctx.wpn.art && ctx.wpn.art.id === "lightning-cloak") {
      m.chains.push({ name: "Lightning Cloak chain", frac: 1 / 3, extra: 4, chance: 1.3, types: { Air: 0.5, Magic: 0.5 },
        when: (atk) => atk.kind !== "dot" && (atk.cloak !== undefined ? atk.cloak : !!ctx.S.self["lightning-cloak"]) });
    }
    // armor removed by target debuffs
    m.armorAll = (ctx.S.shatter + ctx.S.rend) * 100;
    m.armorMagic = ctx.S.hypno * 50;
    return m;
  }

  // ------------------------------------------------------------ helpers
  const boost = (ctx, scaling) => ctx.stats[scaling + " Boost"] || 0;
  const perk = (ctx, id) => ctx.perks[id] || 0;

  function highestBoost(ctx) {
    return Math.max(0, ...["Physical", "Magic", "Fire", "Water", "Earth", "Air", "Hex", "Holy", "Dexterity", "Summon"].map((b) => boost(ctx, b)));
  }

  // Armor Penetration page: defense and pen as decimals.
  function armorMult(defPct, penFlat) {
    const def = defPct / 100, pen = penFlat / 100;
    if (def <= pen + 0.2) {
      const a = def - pen;
      return a > 0 ? 1 / (1 + a) : 1 - a;
    }
    return 1 / (1 + def / (1 + 5 * pen));
  }

  function targetDefense(ctx, mods, s, type) {
    if (type === "True") return null;
    const group = PHYSICAL_GROUP.includes(type) ? "Physical" : "Magic";
    const raw = (s.target[group] || 0) + (type === group ? 0 : s.target[type] || 0);
    return raw - mods.armorAll - (group === "Magic" ? mods.armorMagic : 0);
  }

  // Sticky / Frostbite: target takes more damage of some types.
  function takenMult(ctx, type) {
    const t = ctx.S.target;
    let m = 1;
    if (t.sticky) {
      const extra = { base: [], purple: ["Hex"], red: ["Fire", "Earth"], green: ["Hex", "Earth"], melting: ["Fire", "Earth"] }[t.sticky] || [];
      if (type === "Magic" || extra.includes(type)) m *= 1.2;
    }
    if (t.frostbite && (type === "Water" || type === "Air")) m *= 1.1;
    return m;
  }

  function rageBonus(ctx) {
    return 0.1 * (perk(ctx, "gladiatorial-rage") + perk(ctx, "mage-rage") + perk(ctx, "oceans-rage") + perk(ctx, "fury"));
  }

  function runeRage(ctx) {
    const a = ctx.rune && ctx.rune.attack;
    const r = a && (a.applies || []).find((x) => x.status === "Rage");
    if (!r) return null;
    const dur = r.duration * (1 + 0.2 * (perk(ctx, "gladiatorial-rage") + perk(ctx, "void-rage") + perk(ctx, "fury"))) * (1 + 0.33 * perk(ctx, "contained"));
    return { potency: (r.potency || 0) * (1 + 0.1 * perk(ctx, "bastion-bless")), duration: dur };
  }

  // Rage potency right now: the Rage toggle, or a Rage Rune window during the timeline
  // (in the timeline a toggle sourced from the rune only counts inside its windows).
  function ragePotency(ctx, runeWindow, timeline) {
    const st = ctx.statuses.rage;
    let src = 0;
    const fromRune = st && ctx.rune && st.sources[st.src][0] === ctx.rune.name;
    if (st && st.on && !(timeline && fromRune)) src = st.potency || 0;
    const rr = runeRage(ctx);
    if (rr && runeWindow) src = Math.max(src, rr.potency);
    return src > 0 ? src + rageBonus(ctx) : 0;
  }

  function rageApplies(ctx, mods, type) {
    if (type === "Physical") return true;
    if (type === "Magic" && perk(ctx, "mage-rage")) return true;
    if (type === "Water" && perk(ctx, "oceans-rage")) return true;
    if (type === "Hex" && perk(ctx, "cursed-experiment")) return true; // Hexigen
    return mods.rageTypes.includes(type);
  }

  function weaponTypes(ctx) {
    return Object.keys(ctx.wpn.types).length ? ctx.wpn.types : { Physical: 1 };
  }

  function baseTypes(ctx, types) {
    if (!types) return { ...weaponTypes(ctx) };
    if (types.__highest__) {
      const wt = weaponTypes(ctx);
      const top = Object.entries(wt).sort((a, b) => b[1] - a[1])[0][0];
      const out = { ...types };
      delete out.__highest__;
      out[top] = (out[top] || 0) + types.__highest__;
      return out;
    }
    return { ...types };
  }

  function finalTypes(ctx, mods, atk, rage) {
    let types = baseTypes(ctx, atk.types);
    const conv = (c) => {
      if (!c.when(atk, types)) return;
      if (c.from === "*") {
        const total = Object.entries(types).filter(([k]) => k !== c.to).reduce((a, [, v]) => a + v, 0);
        Object.keys(types).forEach((k) => { if (k !== c.to) delete types[k]; });
        types[c.to] = (types[c.to] || 0) + total;
        return;
      }
      const amt = (types[c.from] || 0) * c.frac;
      if (!amt) return;
      types[c.from] -= amt;
      types[c.to] = (types[c.to] || 0) + amt;
    };
    mods.convert.filter((c) => c.early).forEach(conv);
    mods.addType.forEach((x) => { if (x.when(atk, types)) types[x.type] = (types[x.type] || 0) + x.amt; });
    if (rage && perk(ctx, "void-rage")) types.Hex = (types.Hex || 0) + 0.1 * perk(ctx, "void-rage");
    mods.convert.filter((c) => !c.early).forEach(conv);
    mods.swap.forEach(([x, y]) => {
      const X = types[x] || 0, Y = types[y] || 0;
      if (X || Y) { types[x] = X / 2 + Y / 2; types[y] = Y / 2 + X / 2; }
    });
    Object.keys(types).forEach((k) => { if (!(types[k] > 1e-9)) delete types[k]; });
    return types;
  }

  function applyOverrides(mods, atk) {
    if (atk.overridden) return atk;
    let a = atk;
    mods.overrides.forEach((f) => { a = f(a); });
    return a;
  }

  function attackSpeed(ctx, mods, s) {
    const stat = ctx.stats["Attack Speed"] || 0;
    const statMult = stat >= 0 ? 1 + stat / 100 : 1 / (1 + Math.abs(stat) / 100);
    const probe = { kind: "m1", form: ctx.form.m1 };
    const perkPct = (+s.perkAtkSpeed || 0) + mods.atkSpeed.filter((x) => x.when(probe, {})).reduce((a, x) => a + x.pct, 0);
    const perkMult = 1 + perkPct / 100;
    const weaponSpeed = ctx.wpn.attackSpeed || 1;
    const mult = (weaponSpeed * statMult * perkMult) / mods.atkTime;
    return { weaponSpeed, statMult, perkMult, perkPct, timeMult: mods.atkTime, mult, swingTime: (+s.swingTime || 0.5) / mult };
  }

  // ------------------------------------------------------------ one attack
  function crits(ctx, mods, s, atk, types) {
    let nat = (mods.noDexCrit ? 0 : boost(ctx, "Dexterity") / 10) + mods.natCrit.reduce((a, x) => a + x.pct, 0);
    nat = Math.max(0, nat);
    const natEff = mods.primal ? nat / 4 : nat;
    const fracturedChance = mods.fractured ? Math.min(1, natEff / 100) : 0;
    const natRoll = mods.fractured ? 0 : Math.min(1, natEff / 100);
    const rolls = mods.critRoll.filter((r) => r.when(atk, types)).map((r) => r.chance);
    const kingsLuck = 0;
    let p = 1 - (1 - natRoll) * rolls.reduce((a, r) => a * (1 - r), 1) * (1 - kingsLuck);
    let mult = 1.5 + mods.critBase + (mods.fractured ? 0 : natEff / 100) + mods.critDmg.filter((x) => x.when(atk, types)).reduce((a, x) => a + x.add, 0);
    // Thief Training always changes the base multiplier; its toggle means "standing behind the target".
    if (perk(ctx, "thief-training")) mult += -0.5 + 0.1 * perk(ctx, "thief-training");
    if (perk(ctx, "venom-eater")) mult += -0.3 + 0.1 * perk(ctx, "venom-eater");
    let only = mods.critOnly.filter((x) => x.when(atk, types)).reduce((a, x) => a * x.v, 1);
    const forced = mods.alwaysCrit.filter((x) => x.when(atk, types));
    if (atk.alwaysCrit || forced.length) { p = 1; only *= forced.reduce((a, x) => a * x.bonus, 1); }
    if (mods.thief) {
      only *= p * 1.3 + (1 - p) * 1.2;
      p = 1;
    }
    if (ctx.S.self["critical-boost"] && atk.kind !== "dot") p = 1;
    if (s.crit === "always") p = 1;
    if (s.crit === "never") p = 0;
    return { nat, natEff, p: Math.min(1, p), mult: Math.max(1, mult), only, fracturedChance, primalBonus: mods.primal ? 1 + (nat / 100) * mods.primal : 1 };
  }

  function bonusList(ctx, mods, s, atk, types, rage) {
    const list = [];
    if (atk.noBonus) return list;
    if (ctx.race.lowHpDamage && ctx.S.selfHp < 50) list.push(["Human (<50% HP)", 1 + ctx.race.lowHpDamage]);
    const fer = perk(ctx, "ferocity");
    if (fer && ctx.stats.Tenacity > 0) list.push(["Ferocity", 1 + 0.011 * (ctx.stats.Tenacity * 10) * fer]);
    const fr = perk(ctx, "frenzy");
    if (fr && rage) list.push(["Frenzy", 1 + (0.05 + rage / 6) * fr]);
    if (ctx.S.self.inspired) list.push(["Inspired", 1 + 0.75 * ctx.S.inspiredPotency]);
    if (+s.dmgBonus) list.push(["Other bonus", 1 + s.dmgBonus / 100]);
    mods.mult.forEach((x) => {
      if (!x.when(atk, types)) return;
      const v = typeof x.v === "function" ? x.v(atk, types, ctx.stats) : x.v;
      if (v !== 1) list.push([x.name, v]);
    });
    return list;
  }

  // Damage of one use of `atk` (all its hits), plus its procs and echoes.
  function hit(ctx, mods, s, atkIn, st) {
    st = st || {};
    const rage = st.rage || 0;
    let atk = applyOverrides(mods, atkIn);
    let hits = (atk.hits || []).map((h) => h.slice());
    mods.hitsMult.forEach((h) => { if (h.when(atk)) hits = hits.map(([d, n]) => [d * h.dmg, n * h.n]); });
    if (mods.deltaDrill && atk.kind === "m1" && atk.finisher) {
      const extra = [];
      for (let k = 1; k <= mods.deltaDrill; k++) extra.push(...hits.map(([d, n]) => [d * Math.max(0.3, 1 - (0.3 + 0.1 * k)), n]));
      hits = hits.concat(extra);
    }
    atk = { ...atk, hits };
    const types = finalTypes(ctx, mods, atk, rage);
    const scalings = atk.scalings || ctx.wpn.scalings;
    const effBoost = scalingBoost(ctx, scalings);
    const lvl = atk.noLevel ? 1 : 1 + ctx.level * 0.0125;
    const cr = crits(ctx, mods, s, atk, types);
    const bonuses = bonusList(ctx, mods, s, atk, types, rage);
    if (cr.primalBonus !== 1 && !atk.noBonus) bonuses.push(["Primal", cr.primalBonus]);
    const bonus = bonuses.reduce((a, [, v]) => a * v, 1);
    const base = sumHits(hits);
    const pre = base * (1 + effBoost) * lvl * bonus;

    let pen = (ctx.stats["Armor Penetration"] || 0) + (ctx.race.armorPen || 0);
    if (atk.kind === "art") pen += ctx.race.artArmorPen || 0;
    if (perk(ctx, "gladiatorial-rage")) pen += highestBoost(ctx) / 15;
    mods.pen.forEach((x) => { if (x.when(atk, types)) pen += x.flat; });
    const ignoreOnCrit = mods.critIgnoreDef.some((w) => w(atk, types));

    const byType = {}, critByType = {}, armorByType = {}, typeMults = {};
    const typePart = (t, frac, critHit) => {
      let def = targetDefense(ctx, mods, s, t);
      let p = pen + (critHit ? mods.critPen : 0);
      if (def != null && def > 0 && mods.penByDef) p += mods.penByDef * def;
      if (critHit && ignoreOnCrit && def != null) def = Math.min(def, 0);
      const armor = def == null ? 1 : armorMult(def, p);
      let tm = rage && rageApplies(ctx, mods, t) ? 1 + rage : 1;
      mods.typeMult.forEach((x) => { if (x.types.includes(t)) tm *= x.v; });
      tm *= takenMult(ctx, t);
      return { dmg: frac * tm * armor, armor, tm };
    };
    Object.entries(types).forEach(([t, frac]) => {
      const n = typePart(t, frac, false);
      byType[t] = pre * n.dmg;
      armorByType[t] = n.armor;
      typeMults[t] = n.tm;
      critByType[t] = pre * typePart(t, frac, true).dmg;
    });
    const normal = Object.values(byType).reduce((a, b) => a + b, 0);
    const critHit = Object.values(critByType).reduce((a, b) => a + b, 0) * cr.mult * cr.only;
    const expected = (1 - cr.p) * normal + cr.p * critHit;
    const critFactor = (1 - cr.p) + cr.p * cr.mult;
    const expByType = {};
    Object.keys(byType).forEach((t) => { expByType[t] = (1 - cr.p) * byType[t] + cr.p * critByType[t] * cr.mult * cr.only; });

    // echoes: a share of the hit repeated as another type
    const echoes = [];
    const echoTypes = (spec, scale) => {
      const out = {};
      Object.entries(spec.types).forEach(([t, f]) => { out[t] = typePart(t, f, false).dmg * scale; });
      return out;
    };
    const pushEcho = (name, spec, scale) => {
      const bt = echoTypes(spec, scale);
      echoes.push({ name, byType: bt, dmg: Object.values(bt).reduce((a, b) => a + b, 0) });
    };
    if (!atk.isProc) {
      mods.echoes.forEach((e) => {
        if (!e.when(atk, types)) return;
        const share = e.oncePerCast ? 1 / Math.max(1, countHits(hits)) : 1;
        pushEcho(e.name, e, e.frac * pre * share * (e.crit ? critFactor : 1));
      });
      if (mods.fractured && cr.fracturedChance) pushEcho("Fractured", { types: { Magic: 0.5, Earth: 0.5 } }, cr.fracturedChance * mods.fractured * pre);
      // Chain lightning (Lightning Cloak, Storm Caster): a share of the hit before its damage type and crit, then its own
      // damage type (with type bonuses and conversions like Spirit Winds) and its own crit. It hits the initial target and
      // chains to up to `extra` more, each once; with one enemy it chains back to the original target.
      mods.chains.forEach((c) => {
        if (!c.when(atk, types)) return;
        const cAtk = { ...atk, types: c.types, isChain: true, weaponTypes: false };
        const cTypes = finalTypes(ctx, mods, cAtk, rage);
        const cCrit = crits(ctx, mods, s, cAtk, cTypes);
        const targets = 1 + Math.min(c.extra || 0, Math.max(1, ctx.S.enemies || 1));
        const chance = Math.min(1, (c.chance || 1) * (atk.procCoef === undefined ? 1 : atk.procCoef));
        const scale = c.frac * pre * targets * chance * ((1 - cCrit.p) + cCrit.p * cCrit.mult);
        pushEcho(`${c.name} ×${targets}`, { types: cTypes }, scale);
      });
    }
    return {
      atk, base, hits: countHits(hits), effBoost, lvl, bonus, bonuses, crit: cr, pen, byType, expByType, armorByType, typeMults, types, scalings,
      pre, normal, critHit, expected, echoes, echoTotal: echoes.reduce((a, e) => a + e.dmg, 0), rage,
    };
  }

  // Effective boost from scalings; Protection scaling uses the raw Protection stat (it isn't a %).
  function scalingBoost(ctx, scalings) {
    return Object.entries(scalings).reduce((a, [k, v]) => a + (k === "Protection" ? v * (ctx.stats.Protection || 0) : (v * boost(ctx, k)) / 100), 0);
  }

  // Chance after Lucky rerolls: each whole Lucky rerolls at 2/3 of the chance, the decimal part partially.
  function luckyChance(p, lucky) {
    if (!lucky || p >= 1 || p <= 0) return p;
    const r = (2 / 3) * p;
    const whole = Math.floor(lucky), frac = lucky - whole;
    return 1 - (1 - p) * Math.pow(1 - r, whole) * (1 - r * frac);
  }

  const sumTypes = (into, from, mult) => { Object.entries(from || {}).forEach(([t, v]) => { into[t] = (into[t] || 0) + v * (mult === undefined ? 1 : mult); }); return into; };
  const total = (bt) => Object.values(bt).reduce((a, b) => a + b, 0);

  // Procs triggered by one use of `atk`: [{name, dmg, byType}] in expected damage.
  // Cooldowns are respected on the timeline (`track`), or capped per swing interval otherwise.
  function procsFor(ctx, mods, s, atk, res, st, track) {
    const out = [];
    if (atk.isProc || atk.kind === "dot") return out;
    const fin = res.atk.finisher;
    const finHits = fin ? res.hits : 0;
    const t = st.time || 0;
    const p = (id) => ctx.perks[id] || 0;
    const ready = (spec) => {
      if (!track || !spec.cooldown) return true;
      const last = track[spec.name];
      if (last !== undefined && t - last < spec.cooldown) return false;
      track[spec.name] = t;
      return true;
    };
    const procHit = (spec, count) => {
      const pa = spec.inheritTypes
        ? { ...res.atk, isProc: true, types: spec.inheritTypes, overridden: true }
        : { kind: spec.kind || "proc", isProc: true, hits: spec.hits, types: spec.types, scalings: spec.scalings, noBonus: spec.noBonus, noLevel: spec.noLevel };
      const r = hit(ctx, mods, s, pa, st);
      return sumTypes({}, r.expByType, count);
    };
    const push = (name, byType) => { const d = total(byType); if (d > 0) out.push({ name, dmg: d, byType }); };
    mods.procs.forEach((pr) => {
      if (pr.when && !pr.when(res.atk, res.types)) return;
      const chance = pr.chance === undefined ? 1 : luckyChance(pr.chance, mods.lucky);
      let count = 0;
      if (pr.on === "hit") count = res.hits * chance / (pr.every || 1);
      else if (pr.on === "attack") count = chance;
      else if (pr.on === "finisher") count = fin ? chance : 0;
      else if (pr.on === "finisherHit") {
        if (!fin) return;
        if (pr.springblast) {
          const a = pr.springblast, perHit = res.base / Math.max(1, res.hits);
          const base = (7 + 0.7 * a + (0.25 + 0.15 * a) * perHit) / (0.5 + Math.min(finHits, 5) / 2);
          if (ready(pr)) push(pr.name, procHit({ ...pr, hits: [[base, 1]] }, finHits));
          return;
        }
        for (let k = 1; k <= finHits; k++) count += pr.tempest ? Math.pow(0.75, k - 1) : pr.decay ? FX.decay(k) : 1;
        count *= chance;
      } else if (pr.on === "cast") {
        if (atk.kind !== "art" && atk.kind !== "rune") return;
        count = chance;
        const baseCd = atk.cooldownBase || 0;
        if (pr.chanceFromCd) count *= Math.min(1, (baseCd * pr.chanceFromCd) / 100);
        if (pr.rocks) count *= Math.round(1 + (baseCd / 3) * pr.rocks);
      } else if (pr.on === "apply") {
        count = FX.APPLY[pr.apply](ctx, res.atk, res, p, ctx.S);
      }
      if (pr.needsMark && !st.marked) return;
      if (pr.afterArt && st.windows && !(st.windows[pr.name] > t)) return;
      if (pr.voltaic) {
        const k = Math.max(1, Math.round(3 / Math.max(0.05, st.interval || 0.5)));
        let avg = 0;
        for (let i = 1; i <= k; i++) avg += Math.pow(0.85, i);
        count *= avg / k;
      }
      if (!track && pr.cooldown && st.interval) count = Math.min(count, st.interval / pr.cooldown);
      if (!count || !ready(pr)) return;
      if (pr.stars) {
        const bt = {};
        STAR_TYPES.forEach((ty) => sumTypes(bt, procHit({ hits: [[3, 1]], types: { [ty]: 1 }, scalings: { [ty]: 1 } }, 1), (pr.stars * count) / 7));
        sumTypes(bt, procHit({ hits: [[6, 1]], types: { True: 1 }, scalings: { Magic: 0.5 } }, 1), (pr.stars * count) / 7);
        push(pr.name, bt);
        return;
      }
      const bt = procHit(pr, count);
      if (pr.inherit) sumTypes(bt, res.expByType, pr.inherit * count);
      push(pr.name, bt);
    });
    if (mods.pyreBloom && atk.kind === "art") {
      const a = mods.pyreBloom, cd = atk.cooldownBase || 10;
      const ammo = (1.5 + 0.5 * Math.floor(a)) * Math.min(10, Math.max(1, cd / 2.5 - 2));
      push("Pyre Bloom", procHit({ kind: "art", hits: [[(1.5 + 0.325 * a) * (1 + cd / 120), 1]], types: { Fire: 1 }, scalings: { Fire: 1, Summon: 1 } }, ammo));
    }
    if (mods.staticBuildup && atk.kind === "m2") {
      const a = mods.staticBuildup;
      const charge = Math.min(20, st.charges !== undefined ? st.charges : 20);
      if (charge >= 3) {
        const strikes = Math.floor(1 + (charge / 20) * a * (charge === 20 ? 2 : 1));
        const rmb = res.base * (1 + res.effBoost) * res.lvl;
        push(`Static Buildup ×${strikes}`, procHit({ hits: [[(3 + rmb * 0.1538) * (1 + 0.1 * a), 1]], types: { Air: 0.5, Magic: 0.5 }, scalings: { Air: 1, Magic: 1 } }, strikes));
      }
    }
    return out;
  }

  // ------------------------------------------------------------ DoTs and per-second sources
  function potencyMult(p) {
    if (!p) return 1;
    return p < 10 ? Math.pow(1 + p / 10, 1 + p / 10) : Math.pow(1 + p / 10, 2);
  }

  function dot(ctx, mods, s, kind, rage) {
    const d = DOTS[kind], md = mods.dot[kind];
    const pPerk = ctx.S.potency[kind];
    const potency = ctx.S.applied[kind];
    const types = { ...(md.setTypes || { [d.type]: 1 }) };
    Object.entries(md.addType || {}).forEach(([t, v]) => { types[t] = (types[t] || 0) + v; });
    Object.entries(mods.dotAll.addType).forEach(([t, v]) => { types[t] = (types[t] || 0) + v; });
    const scalings = { ...(md.setScal || d.scalings) };
    Object.entries(md.addScal || {}).forEach(([t, v]) => { scalings[t] = (scalings[t] || 0) + v; });
    const atk = { kind: "dot", dot: kind, hits: [[1.75 * (1 + potency / 1.1), 1]], types, scalings };
    const r = hit(ctx, mods, { ...s, crit: "never" }, atk, { rage });
    const mult = potencyMult(pPerk) * (md.mult === undefined ? 1 : md.mult);
    const byType = sumTypes({}, r.byType, mult);
    return { kind, types: r.types, potency, potencyPerk: pPerk, potencyMult: potencyMult(pPerk), perSecond: total(byType), byType };
  }

  function ticks(ctx, mods, s, rage) {
    return mods.ticks.map((tk) => {
      const atk = { kind: "proc", isProc: true, hits: tk.hits, types: tk.types, scalings: tk.scalings, noBonus: tk.noBonus };
      let rate = tk.chance ? luckyChance(tk.perSecond, mods.lucky) : tk.perSecond;
      if (tk.potency) rate *= potencyMult(ctx.S.potency[tk.potency]);
      const byType = sumTypes({}, hit(ctx, mods, s, atk, { rage }).expByType, rate);
      return { name: tk.name, perSecond: total(byType), byType };
    }).filter((x) => x.perSecond > 0);
  }

  // ------------------------------------------------------------ attacks the build can test
  function artCooldown(ctx, mods, art) {
    const base = art.cooldownBase;
    if (!base) return null;
    return cdFloor((base * (ctx.race.artCdMult || 1) * mods.cd.art.mult) / (1 + mods.cd.art.speed));
  }

  function runeCooldown(ctx, mods) {
    if (!ctx.rune || !ctx.rune.cooldown) return null;
    let base = ctx.rune.cooldown;
    if (ctx.rune.id === "rage-rune" && perk(ctx, "gladiatorial-rage")) base = 30;
    return cdFloor((base * (ctx.race.runeCdMult || 1) * mods.cd.rune.mult) / (1 + 0.1 * perk(ctx, "mage-rage") + mods.cd.rune.speed));
  }

  const NO_M1_FINISHER = ["Storm Caster", "Artillery Mage", "Stratos Winds", "Virulent Core", "Dual Guns"];

  // Weapon art as a test attack, with the perk overrides (Heat Drill, ...) and its cooldown for this build.
  function artAttack(ctx, mods, art) {
    const a = applyOverrides(mods, { key: "art", kind: "art", artId: art.id, name: art.name, hits: art.hits, types: art.types, scalings: art.scalings, cooldownBase: art.cooldown, weaponTypes: !art.types });
    return { ...a, overridden: true, cooldown: artCooldown(ctx, mods, a), note: art.baseText };
  }

  function attacks(ctx, mods, s) {
    const f = ctx.form;
    const list = [];
    const swings = f.m1Moves.map((hits, i) => ({
      key: "m1", kind: "m1", form: f.m1, name: `Swing ${i + 1}`, hits, types: null, scalings: null, chain: i + 1, weaponTypes: true,
      finisher: i === f.m1Moves.length - 1 && f.m1Moves.length > 1 && !NO_M1_FINISHER.includes(f.m1),
    }));
    list.push({ key: "m1", kind: "m1", form: f.m1, name: `M1 combo · ${f.m1}`, swings, hits: f.m1Moves.flat(), types: null, scalings: null, weaponTypes: true });
    const m2o = mods.m2Override;
    list.push(m2o
      ? { key: "m2", kind: "m2", form: f.m2, name: `M2 · ${m2o.name}`, hits: m2o.hits, types: m2o.types, scalings: m2o.scalings, finisher: true, chain: f.m1Moves.length + 1 }
      : { key: "m2", kind: "m2", form: f.m2, name: `M2 · ${f.m2}`, hits: f.m2Moves, types: null, scalings: null, finisher: true, chain: f.m1Moves.length + 1, weaponTypes: true });
    if (ctx.wpn.art) list.push(artAttack(ctx, mods, ctx.wpn.art));
    if (ctx.rune) {
      const ra = ctx.rune.attack;
      const r = applyOverrides(mods, { key: "rune", kind: "rune", runeId: ctx.rune.id, name: ctx.rune.name, hits: ra && ra.hits, types: ra && ra.types, scalings: (ra && ra.scalings) || {}, cooldownBase: ctx.rune.cooldown, applies: ra && ra.applies });
      list.push({ ...r, overridden: true, cooldown: runeCooldown(ctx, mods) });
    }
    const drac = draconicAttack(ctx, mods);
    if (drac) list.push(drac);
    // SPECIAL: monk spirits and attacks added by perks (Wind Drill, Pulverizing Rush)
    const specials = [];
    Object.keys(FX.SPIRITS).filter((id) => ctx.perks[id]).forEach((id) => {
      const sp = FX.SPIRITS[id];
      specials.push({ id, kind: sp.kind || "m2", spiritId: id, name: (window.VOXL_DATA.perks[id] || {}).name || id, hits: sp.hits, types: sp.types || null, scalings: sp.scalings || null, finisher: !!sp.finisher, alwaysCrit: sp.alwaysCrit, weaponTypes: !sp.types });
    });
    Object.entries(FX.EXTRA_ATTACKS).filter(([id]) => ctx.perks[id]).forEach(([id, f]) => specials.push({ id, kind: "custom", ...f(ctx.perks[id]) }));
    if (specials.length) {
      const sp = specials.find((x) => x.id === s.spirit) || specials[0];
      list.push({ ...sp, key: "special", specials: specials.map((x) => [x.id, x.name]), specialId: sp.id });
    }
    if (ctx.potions.has("throwable-damage-potion")) list.push({ key: "potion", kind: "potion", name: "Throwable Damage Potion", hits: [[12, 1]], types: { Physical: 1 }, scalings: {} });
    list.push({ key: "custom", kind: "custom", name: "Custom attack", hits: [[+s.customBase || 0, +s.customHits || 1]], types: null, scalings: null, weaponTypes: true });
    return list;
  }

  // Draconic guild rune infusion: Dragon Claw / Dragon Bubble hit; Dragon Infusion is a 20s buff (Draconic Blood page).
  // It sits in the rune infusion slot, so rune cooldown effects and rune damage perks apply to it.
  function draconicAttack(ctx, mods) {
    const d = ctx.draconic, a = perk(ctx, "draconic-blood");
    if (!d || !a) return null;
    const cs = d.blooded ? M.DRACONIC.attack[d.color] || {} : {};
    const id = d.ability.id;
    const baseCd = d.ability.cooldown * (id === "infusion" ? 1 : cs.cd || 1);
    const cooldown = cdFloor((baseCd * (ctx.race.runeCdMult || 1) * mods.cd.rune.mult) / (1 + mods.cd.rune.speed));
    const common = { key: "drac", kind: "rune", runeId: "draconic-" + id, draconic: id, name: d.ability.name, cooldownBase: baseCd, cooldown };
    if (id === "infusion") {
      const potency = 0.1 * a;
      return { ...common, hits: null, applies: [{ status: "Draconic Infusion", potency }], buff: { potency, duration: 20 * (1 + 0.33 * perk(ctx, "contained")) } };
    }
    const base = (id === "bubble" ? 20 + 2 * a : 25 + 2.5 * a) * (cs.dmg || 1);
    const atk = applyOverrides(mods, { ...common, hits: [[base, 1]], types: { [d.type]: 1 }, scalings: { [d.type]: 1 }, poise: id === "bubble" ? 45 : 60, guardbreak: id === "claw" });
    return { ...atk, overridden: true, cooldown };
  }

  // ------------------------------------------------------------ action timing
  // How long an action locks you (cast) and how long its hits keep landing (active), in seconds at 1.0 speed.
  // The wiki lists no cast times, so arts default to 1s and the ones below follow its notes. When active is
  // longer than cast the action is move-stackable: you can use other attacks while it keeps hitting.
  const ART_TIMING = {
    starstream: { cast: 0.6, active: 6, note: "You can move around while casting" },
    focus: { cast: 0.5, active: 10, note: "Lasts 10s; you can attack while it is active" },
    "magical-ray": { cast: 3, active: 3, note: "Held for its full duration" },
    "holy-phalanx": { cast: 3, active: 3, note: "Held for its full duration" },
    flamethrower: { cast: 3, active: 3, note: "Held for its full duration" },
    "black-hole": { cast: 3, active: 3, note: "Held for its full duration" },
    "polarity-cannon": { cast: 2.5, active: 2.5, note: "Charged for up to 5s" },
    barrage: { cast: 1.5, active: 1.5 },
    "rapid-stabs": { cast: 1.2, active: 1.2 },
    "dark-tentacle": { cast: 0.6, active: 1.2 },
    mines: { cast: 0.8, active: 0.8 },
  };
  const FIXED_CAST_ARTS = ["dagger-throw", "retaliate"]; // "Cast time is unaffected by Attack Speed"

  function timingKey(atk) {
    if (atk.kind === "art") return "art:" + atk.artId;
    if (atk.key === "rune") return "rune:" + atk.runeId;
    if (atk.key === "drac") return "drac:" + atk.draconic;
    if (atk.key === "special") return "special:" + atk.specialId;
    return atk.key;
  }

  // Weapon arts only speed up from weapon speed, stat attack speed, Quickcast, Power Inhale and Stone Weapon (Weapon Arts page).
  function artSpeed(ctx, mods, s, atk) {
    if (FIXED_CAST_ARTS.includes(atk.artId)) return 1;
    const as = attackSpeed(ctx, mods, s);
    return (as.weaponSpeed * as.statMult * (1 + mods.artCast / 100)) / mods.atkTime;
  }

  function timing(ctx, mods, s, atk) {
    const as = attackSpeed(ctx, mods, s);
    if (atk.key === "m1") return { key: "m1", cast: as.swingTime, active: as.swingTime, baseCast: +s.swingTime || 0.5, baseActive: +s.swingTime || 0.5, speed: as.mult, fixed: true };
    const key = timingKey(atk);
    const over = (s.timing || {})[key] || {};
    let def, speed;
    if (atk.kind === "art") { def = ART_TIMING[atk.artId] || { cast: 1, active: 1 }; speed = artSpeed(ctx, mods, s, atk); }
    else if (atk.key === "rune" || atk.key === "drac") { def = { cast: 0.5, active: 0.5 }; speed = 1; }
    else { def = { cast: +s.swingTime || 0.5, active: +s.swingTime || 0.5 }; speed = as.mult; }
    const baseCast = over.cast > 0 ? +over.cast : def.cast;
    const baseActive = Math.max(baseCast, over.active > 0 ? +over.active : Math.max(def.active, baseCast));
    return { key, cast: baseCast / speed, active: baseActive / speed, baseCast, baseActive, speed, note: def.note, custom: over.cast > 0 || over.active > 0 };
  }

  // Spirit Commune: energy per attack = spiritCoeff × attackCoeff × (1 + (amt−1)/6) ÷ attack speed; a spirit is released at full energy.
  const SPIRIT_COEFF = {
    "basic-spirit": 2, "woof-spirit": 1, "mageling-spirit": 1, "buni-spirit": 1, "bulfrogg-spirit": 1, "bumblz-spirit": 1, "winter-woof-spirit": 0.75,
    "toadzerker-spirit": 1, "caci-spirit": 1, "dire-buni-spirit": 2, "bomber-spirit": 1, "queen-bumblz-spirit": 0.5, "roguent-spirit": 4,
    "deep-spider-spirit": 0.5, "gremlin-spirit": 0.5, "croakernaut-spirit": 1, "dragigator-spirit": 2, "iron-slayer-spirit": 0.5, "bowldur-spirit": 0.75,
    "void-root-spirit": 0.5, "snoeman-spirit": 0.75, "caci-king-spirit": 0.5,
  };
  const ATTACK_COEFF = {
    Fists: { m1: 4, fin: 13.845, m2: 15 }, Shield: { m1: 4, fin: 3.75, m2: 15 }, "Dual Guns": { m1: 5, fin: 5, m2: 40 }, Rifle: { m1: 4.6, fin: 6, m2: 16.67 },
    "Side Gun": { m1: 0, fin: 0, m2: 10 }, Shotgun: { m1: 0, fin: 0, m2: 21 }, "Saw Fists": { m1: 9.2, fin: 9.2, m2: 42 }, "Artillery Mage": { m1: 4, fin: 4, m2: 18.75 },
    "Stratos Winds": { m1: 5, fin: 5, m2: 15 }, "Storm Caster": { m1: 4.6, fin: 4.6, m2: 41 }, "Virulent Core": { m1: 4, fin: 4, m2: 11.55 }, "Cosmic Ray": { m1: 0, fin: 0, m2: 20 },
  };

  function spiritGain(ctx, mods, s, atk, spiritId) {
    const a = perk(ctx, "spirit-commune");
    if (!a) return 0;
    const spiritCoeff = SPIRIT_COEFF[spiritId] || 1;
    const amt = 1 + (a - 1) / 6;
    if (atk.artId === "barrage") return spiritCoeff * 4.8 * 12 * amt; // unaffected by attack speed
    const c = ATTACK_COEFF[atk.form] || ATTACK_COEFF.Fists;
    const coeff = atk.kind === "m2" ? c.m2 : atk.kind === "m1" ? (atk.finisher ? c.fin : c.m1) : 0;
    return (spiritCoeff * coeff * amt) / attackSpeed(ctx, mods, s).mult;
  }

  const ROT_KEYS = ["m1", "m2", "art", "rune", "drac", "special", "custom"];
  const COOLDOWN_KEYS = ["rune", "drac", "art", "special", "custom"];
  const ORDER_KEYS = ["rune", "drac", "art", "special", "custom", "m1"];

  // Priority list: valid keys from the settings; a missing key (e.g. one added in a later version) goes right after
  // the key it follows in the default order.
  function rotOrder(s) {
    const got = (Array.isArray(s.rotOrder) ? s.rotOrder : []).filter((k, i, l) => ORDER_KEYS.includes(k) && l.indexOf(k) === i);
    ORDER_KEYS.forEach((k, i) => {
      if (got.includes(k)) return;
      const prev = ORDER_KEYS.slice(0, i).reverse().find((x) => got.includes(x));
      got.splice(prev ? got.indexOf(prev) + 1 : 0, 0, k);
    });
    return got;
  }
  const COUNT_LIMIT = 600; // seconds; a count-mode run never goes past this

  function rotation(s) {
    const d = defaults().rot, r = s.rot || {};
    return Object.fromEntries(ROT_KEYS.map((k) => [k, { ...d[k], ...(r[k] || {}) }]));
  }

  function swingPattern(m1, m2, s) {
    const rot = rotation(s);
    const steps = rot.m1.on ? m1.swings.slice() : [];
    if (rot.m2.on) steps.push(m2);
    return steps;
  }

  // ------------------------------------------------------------ timeline
  // Only one action at a time: each locks you for its cast time. Hits of a move-stackable action (active > cast)
  // keep landing while you do other things. Cooldown actions go first when ready; M1 combos (each followed by an M2
  // when both are on) fill the gaps. With nothing to fill, the timeline waits for the next cooldown.
  function simulate(ctx, mods, s) {
    const countMode = s.rotMode === "count";
    const rot = rotation(s);
    const atks = attacks(ctx, mods, s);
    const find = (k) => atks.find((a) => a.key === k);
    const A = { m1: find("m1"), m2: find("m2"), art: find("art"), rune: find("rune"), drac: find("drac"), special: find("special"), custom: find("custom") };
    // a monk spirit is released by energy, not a cooldown
    const spiritGated = !!(A.special && A.special.spiritId && perk(ctx, "spirit-commune"));
    const energyMax = Math.max(1, +s.spiritMax || 100);
    const cd = {
      art: A.art && A.art.cooldown, rune: A.rune && A.rune.cooldown, drac: A.drac && A.drac.cooldown,
      special: spiritGated ? 0 : Math.max(0, +rot.special.cooldown || 0), custom: Math.max(0, +rot.custom.cooldown || 0),
    };
    const usable = (k) => rot[k].on && A[k] && (k === "m1" ? A.m1.swings.length > 0 : k === "art" || k === "rune" || k === "drac" ? cd[k] > 0 : true);
    const left = Object.fromEntries(ROT_KEYS.map((k) => [k, !usable(k) ? 0 : countMode ? Math.max(0, Math.round(+rot[k].count || 0)) : Infinity]));
    const done = Object.fromEntries(ROT_KEYS.map((k) => [k, 0]));
    const ready = { art: 0, rune: 0, drac: 0, special: 0, custom: 0 };
    const order = rotOrder(s);
    const m1Rank = order.indexOf("m1");
    const as = attackSpeed(ctx, mods, s);
    const tim = Object.fromEntries(["m2", "art", "rune", "drac", "special", "custom"].filter((k) => A[k]).map((k) => [k, timing(ctx, mods, s, A[k])]));
    tim.m1 = timing(ctx, mods, s, A.m1);
    const rr = runeRage(ctx);
    const markLen = Math.max(0, ...mods.procs.filter((p) => p.needsMark).map((p) => p.needsMark));
    const afterArt = mods.procs.filter((p) => p.afterArt);
    const windows = {};
    const typeTotals = {};
    const events = [];
    const end = countMode ? COUNT_LIMIT : Math.max(5, Math.min(300, +s.duration || 30));
    // spread an action's damage over its active time; returns the share that landed inside the fight
    const emit = (x, key, v, byType, span) => {
      const n = span > 1e-6 ? Math.min(40, Math.max(2, Math.ceil(span / 0.25))) : 1;
      let kept = 0;
      for (let j = 0; j < n; j++) {
        const at = n === 1 ? x : x + (span * (j + 0.5)) / n;
        if (!countMode && at >= end) continue;
        if (v) events.push([at, key, v / n]);
        kept++;
      }
      sumTypes(typeTotals, byType, kept / n);
      return { kept: kept / n, last: x + (n === 1 ? 0 : span) };
    };
    const track = {};
    const rageWindows = [];
    const infWindows = []; // Dragon Infusion buff windows
    const cloakWindows = []; // Lightning Cloak (weapon art) windows
    const cloakArt = A.art && A.art.artId === "lightning-cloak";
    const cloakDur = 40 * (1 + 0.33 * perk(ctx, "contained"));
    const dracInfusion = A.drac && A.drac.draconic === "infusion";
    const infUp = (x) => infWindows.some(([a, b]) => x >= a && x < b);
    const hitsBy = Object.fromEntries(ROT_KEYS.concat("proc").map((k) => [k, 0]));
    const casts = [];
    let markEnd = -1, charges = 0, swing = 0, m2Due = false, t = 0, energy = 0, beenades = 0, lastHit = 0;
    const log = [];
    const runeUp = (x) => rageWindows.some(([a, b]) => x >= a && x < b);
    const st = (x) => ({ rage: ragePotency(ctx, runeUp(x), true), marked: x < markEnd, time: x, charges, windows, interval: as.swingTime });
    const use = (x, atk, key, span) => {
      const state = st(x);
      if (dracInfusion) atk = { ...atk, dracInf: infUp(x) }; // in the timeline the buff only counts inside its windows
      if (cloakArt) atk = { ...atk, cloak: cloakWindows.some(([a, b]) => x >= a && x < b) };
      if (atk.hits && atk.hits.length) {
        const r = hit(ctx, mods, s, atk, state);
        const e = emit(x, key, r.expected, r.expByType, span);
        hitsBy[key] += r.hits * e.kept;
        lastHit = Math.max(lastHit, e.last);
        r.echoes.forEach((ec) => emit(x, "proc", ec.dmg, ec.byType, span));
        procsFor(ctx, mods, s, atk, r, state, track).forEach((p) => { const pe = emit(x, "proc", p.dmg, p.byType, span); hitsBy.proc += pe.kept; });
        return r;
      }
      procsFor(ctx, mods, s, { ...atk, hits: [] }, { atk, hits: 0, types: {}, normal: 0, base: 0, effBoost: 0, lvl: 1, crit: { p: 0 }, expByType: {} }, state, track)
        .forEach((p) => emit(x, "proc", p.dmg, p.byType, span));
      return null;
    };
    while (t < end) {
      const isReady = (k) => (k === "special" && spiritGated ? energy >= energyMax - 1e-9 : cd[k] > 0 && t >= ready[k] - 1e-9);
      // Highest priority first. By count the order is strict (M1 combo on top = all combos first); on cooldown,
      // actions ranked below the M1 combo wait until the current combo (and its M2) ends instead of cutting in.
      const comboBusy = swing > 0 || m2Due;
      let pick = null;
      for (let i = 0; i < order.length && !pick; i++) {
        const k = order[i];
        if (k === "m1") { if (countMode && (comboBusy || left.m1 > 0)) pick = swing > 0 || !m2Due ? "m1" : "m2"; continue; }
        if (left[k] > 0 && isReady(k) && (countMode || i < m1Rank || !comboBusy)) pick = k;
      }
      if (!pick) {
        if (swing > 0 || (!m2Due && left.m1 > 0)) pick = "m1";
        else if (left.m2 > 0) pick = "m2";
        else pick = ["special", "custom"].find((k) => left[k] > 0 && !cd[k] && !(k === "special" && spiritGated));
      }
      if (!pick) {
        const next = COOLDOWN_KEYS.filter((k) => left[k] > 0 && cd[k] > 0).map((k) => ready[k]);
        if (!next.length) break; // nothing left that can ever fire (e.g. a spirit with no attacks to charge it)
        t = Math.max(t, Math.min(...next)); // idle until the next cooldown is up
        continue;
      }
      let atk = pick === "m1" ? A.m1.swings[swing] : A[pick];
      const tm = tim[pick];
      if (pick === "rune" && beenades && atk.hits && atk.hits.length) {
        atk = { ...atk, hits: atk.hits.concat([[atk.hits[0][0], beenades]]) }; // Bomber Satchel: extra Beenades
        beenades = 0;
      }
      if (pick === "rune" && rr) rageWindows.push([t, t + rr.duration]);
      if (pick === "drac" && atk.buff) infWindows.push([t, t + atk.buff.duration]);
      if (pick === "art" && cloakArt) cloakWindows.push([t, t + cloakDur]);
      const r = use(t, atk, pick, tm.active > tm.cast + 1e-9 ? tm.active : 0);
      if ((pick === "art" || pick === "rune") && markLen && atk.hits && atk.hits.length) markEnd = t + markLen;
      if (pick === "art") {
        afterArt.forEach((p) => { windows[p.name] = t + p.afterArt(atk); });
        if (perk(ctx, "bomber-satchel") && r && r.hits) beenades = 5;
      }
      if (pick in ready) ready[pick] = t + cd[pick];
      if (pick !== "m1" && pick !== "m2") casts.push({ key: pick, t, cast: tm.cast, active: tm.active });
      if (spiritGated) energy = pick === "special" ? 0 : Math.min(energyMax, energy + spiritGain(ctx, mods, s, atk, A.special.spiritId));
      if (pick === "m1") {
        charges = Math.min(20, charges + (r ? r.hits : 0));
        if (++swing >= A.m1.swings.length) { swing = 0; left.m1--; done.m1++; m2Due = left.m2 > 0; }
      } else {
        left[pick]--; done[pick]++;
        if (pick === "m2") { m2Due = false; charges = 0; }
        log.push({ t, what: atk.name });
      }
      if (pick === "m1" || pick === "m2") {
        ready.art -= mods.artFlat;
        ready.rune -= mods.runeFlat;
        if (mods.divinity && atk.finisher && ready.art > t) ready.art = t + (ready.art - t) * Math.max(0, 1 - 0.1 * mods.divinity);
      }
      t += tm.cast;
    }
    const capped = countMode && t >= COUNT_LIMIT;
    const T = countMode ? Math.min(COUNT_LIMIT, Math.max(t, lastHit)) : end;
    const keys = ["m1", "m2", "proc", "art", "rune", "drac", "special", "custom", "dot"];
    const bins = Array.from({ length: Math.max(1, Math.ceil(T - 1e-9)) }, () => Object.fromEntries(keys.map((k) => [k, 0])));
    events.forEach(([x, k, v]) => { bins[Math.min(bins.length - 1, Math.floor(x))][k] += v; });
    // DoTs and auras tick for the whole run; the last second only counts the part that was fought
    let dotTotal = 0;
    bins.forEach((b, i) => {
      const span = Math.min(1, T - i);
      if (span <= 0) return;
      const rage = ragePotency(ctx, runeUp(i), true);
      Object.keys(DOTS).forEach((k) => {
        if (!ctx.S.target[k]) return;
        const d = dot(ctx, mods, s, k, rage);
        b.dot += d.perSecond * span;
        dotTotal += d.perSecond * span;
        sumTypes(typeTotals, d.byType, span);
      });
      ticks(ctx, mods, s, rage).forEach((x) => { b.dot += x.perSecond * span; sumTypes(typeTotals, x.byType, span); });
    });
    const perSec = bins.map((b) => keys.reduce((a, k) => a + b[k], 0));
    const fightTotal = perSec.reduce((a, b) => a + b, 0);
    const bySource = Object.fromEntries(keys.map((k) => [k, bins.reduce((a, b) => a + b[k], 0)]));
    return {
      T: round(T), mode: countMode ? "count" : "time", bins, perSec, total: fightTotal, avg: T > 0 ? fightTotal / T : 0, peak: Math.max(...perSec),
      bySource, typeTotals, log, attackSpeed: as, done, capped, cooldowns: cd, timing: tim, casts, hitsBy, dotTotal,
      direct: fightTotal - bySource.dot, spiritGated, energyMax, infUptime: Math.min(1, infWindows.reduce((q, [a, b]) => q + Math.max(0, Math.min(b, T) - a), 0) / Math.max(1e-6, T)),
    };
  }

  // Sustained DPS with the current toggles: M1 combo (+ M2) + procs + echoes + DoTs, no cooldown abilities.
  function sustained(ctx, mods, s) {
    const rage = ragePotency(ctx, false);
    const atks = attacks(ctx, mods, s);
    const pattern = swingPattern(atks[0], atks[1], s);
    const as = attackSpeed(ctx, mods, s);
    let perCycle = 0;
    if (!pattern.length) pattern.push(...atks[0].swings); // M1 and M2 both off: sustained still means the M1 combo
    pattern.forEach((step) => {
      const r = hit(ctx, mods, s, step, { rage });
      perCycle += r.expected + r.echoTotal + procsFor(ctx, mods, s, step, r, { rage, charges: 20, interval: as.swingTime, marked: true }).reduce((a, p) => a + p.dmg, 0);
    });
    const melee = perCycle / (pattern.length * as.swingTime);
    const dots = Object.keys(DOTS).filter((k) => ctx.S.target[k]).reduce((a, k) => a + dot(ctx, mods, s, k, rage).perSecond, 0) +
      ticks(ctx, mods, s, rage).reduce((a, x) => a + x.perSecond, 0);
    return { dps: melee + dots, m1: melee, dots };
  }

  window.VoxlDamage = {
    DMG_TYPES, DOTS, defaults, context, collect, attacks, hit, procsFor, dot, ticks, attackSpeed,
    simulate, sustained, ragePotency, runeRage, swingPattern, rotation, rotOrder, ROT_KEYS, potencyMult, artCooldown, runeCooldown,
    artAttack, timing, ART_TIMING, spiritGain, SPIRIT_COEFF, armorMult, draconicAttack,
  };
})();
