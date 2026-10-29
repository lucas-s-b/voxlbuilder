(function () {
  const DAMAGE_TYPES = ["Physical", "Magic", "Fire", "Water", "Earth", "Air", "Hex", "Holy", "True"];
  const DEFENSE_TYPES = ["Physical", "Magic", "Fire", "Water", "Earth", "Air", "Hex", "Holy"];
  const SEQUENCES = { dps: ["seq", "seqRepeat", "duration"], tank: ["tseq", "tseqRepeat", "tduration"], debuff: ["dseq", "dseqRepeat", "dduration"], heal: ["hseq", "hseqRepeat", "hduration"] };
  const STEP_ACTIONS = ["m1", "m2", "art", "rune", "drac", "special", "potion", "wait"];
  const SETTINGS_VERSION = 2;

  const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
  const isPlainKey = (key) => /^[a-z0-9:-]+$/i.test(key);

  function defaultSettings() {
    return {
      seq: [{ a: "m1", n: 3 }], seqRepeat: true, duration: 30,
      tseq: [], tseqRepeat: true, tduration: 30,
      dseq: [{ a: "m1", n: 1 }], dseqRepeat: true, dduration: 30,
      hseq: [{ a: "m1", n: 3 }], hseqRepeat: true, hduration: 30,
      crit: "avg", runs: 150, special: "", enemy: "",
      customs: [{ id: "c1", name: "Custom hit", dmg: 20, hits: 1, types: {} }],
      target: Object.fromEntries(DEFENSE_TYPES.map((type) => [type, 0])),
      inc: { seq: null, per10: 5, blockPct: 0, parryPct: 0, stun: 0.5 },
      conditions: {}, situational: {}, perkOff: {}, potions: {}, start: { self: {}, target: {} }, timing: {},
    };
  }

  function cleanTypes(types) {
    return Object.fromEntries(Object.entries(types && typeof types === "object" ? types : {})
      .filter(([type, value]) => DAMAGE_TYPES.includes(type) && typeof value === "number" && value > 0).map(([type, value]) => [type, Math.min(10, value)]));
  }

  function plainObject(object, accept) {
    return Object.fromEntries(Object.entries(object && typeof object === "object" ? object : {}).filter(([key, value]) => isPlainKey(key) && accept(value)));
  }

  function cleanSteps(list, customIds) {
    return list.slice(0, 30).filter(Boolean)
      .map((step) => (step.a === "m2c" ? { ...step, a: "m2", c: 1 } : step.a === "custom" && customIds.length ? { ...step, a: customIds[0] } : step))
      .filter((step) => STEP_ACTIONS.includes(step.a) || customIds.includes(step.a))
      .map((step) => ({
        a: step.a, n: clamp(Math.round(+step.n || 1), 1, 50),
        ...(step.a === "wait" ? { w: clamp(+step.w || 1, 0.1, 60) } : {}),
        ...(+step.c > 0 ? { c: clamp(Math.round(+step.c * 100) / 100, 0, 1) } : {}),
      }));
  }

  function sanitizeSettings(saved) {
    const result = { ...defaultSettings(), version: SETTINGS_VERSION };
    if (!saved || typeof saved !== "object") return result;
    if (["avg", "always", "never"].includes(saved.crit)) result.crit = saved.crit;
    if (typeof saved.runs === "number") result.runs = clamp(Math.round(saved.runs), 10, 1000);
    if (typeof saved.special === "string") result.special = saved.special;
    else if (typeof saved.spirit === "string") result.special = saved.spirit;
    const enemies = window.VOXL_DATA.enemies || [];
    if (typeof saved.enemy === "string" && enemies.some((enemy) => enemy.id === saved.enemy)) result.enemy = saved.enemy;
    DEFENSE_TYPES.forEach((type) => { if (saved.target && typeof saved.target[type] === "number") result.target[type] = clamp(saved.target[type], -1000, 1000); });
    const legacyCustom = [{ id: "c1", name: "Custom hit", dmg: typeof saved.customBase === "number" ? saved.customBase : 20, hits: typeof saved.customHits === "number" ? saved.customHits : 1, types: {} }];
    result.customs = (Array.isArray(saved.customs) ? saved.customs : legacyCustom).slice(0, 8).filter((custom) => custom && /^[a-z0-9]{1,8}$/i.test(custom.id))
      .map((custom) => ({ id: custom.id, name: String(custom.name || "Custom hit").slice(0, 30), dmg: clamp(+custom.dmg || 0, 0, 1e6), hits: clamp(Math.round(+custom.hits || 1), 1, 50), types: cleanTypes(custom.types) }));
    const customIds = result.customs.map((custom) => "custom:" + custom.id);
    Object.values(SEQUENCES).forEach(([listKey, repeatKey, durationKey]) => {
      if (Array.isArray(saved[listKey])) result[listKey] = cleanSteps(saved[listKey], customIds);
      if (typeof saved[repeatKey] === "boolean") result[repeatKey] = saved[repeatKey];
      if (typeof saved[durationKey] === "number") result[durationKey] = clamp(saved[durationKey], 5, 300);
    });
    const savedSteps = Object.values(SEQUENCES).flatMap(([listKey]) => (Array.isArray(saved[listKey]) ? result[listKey] : []));
    const oldComboSteps = saved.version !== SETTINGS_VERSION && savedSteps.some((step) => step.a === "m1");
    if (saved.comboSteps === true || oldComboSteps) result.comboSteps = true;
    const incoming = saved.inc && typeof saved.inc === "object" ? saved.inc : {};
    const enemy = result.enemy && enemies.find((entry) => entry.id === result.enemy);
    ["per10", "blockPct", "parryPct", "stun"].forEach((key) => { if (typeof incoming[key] === "number") result.inc[key] = clamp(incoming[key], 0, key === "stun" ? 10 : 100); });
    if (Array.isArray(incoming.seq)) {
      result.inc.seq = incoming.seq.filter((step) => step && (step.a === "c" || (enemy && Number.isInteger(step.a) && enemy.attacks[step.a]))).slice(0, 20).map((step) => ({
        a: step.a, n: clamp(Math.round(+step.n || 1), 1, 50),
        ...(step.a === "c" ? { dmg: clamp(+step.dmg || 0, 0, 1e6), types: cleanTypes(step.types), ...(step.guardbreak ? { guardbreak: true } : {}) } : {}),
      }));
    }
    result.conditions = plainObject(saved.conditions, (value) => typeof value === "number" || typeof value === "boolean");
    result.situational = plainObject(saved.situational, (value) => value === true);
    result.perkOff = plainObject(saved.perkOff, (value) => value === true);
    Object.entries(plainObject(saved.perkOn, (value) => typeof value === "boolean")).forEach(([id, on]) => {
      if (on) result.situational[id] = true;
      else result.perkOff[id] = true;
    });
    result.potions = plainObject(saved.potions, (value) => value === true);
    const start = saved.start && typeof saved.start === "object" ? saved.start : {};
    ["self", "target"].forEach((side) => { result.start[side] = plainObject(start[side], (value) => typeof value === "number" && Number.isFinite(value)); });
    result.timing = Object.fromEntries(Object.entries(plainObject(saved.timing, (value) => value && typeof value === "object")).map(([key, value]) => [key, {
      ...(+value.cast > 0 ? { cast: clamp(+value.cast, 0.05, 30) } : {}), ...(+value.active > 0 ? { active: clamp(+value.active, 0.05, 60) } : {}),
    }]));
    return result;
  }

  function tabOptions(settings, mode) {
    const [listKey, repeatKey, durationKey] = SEQUENCES[mode];
    const enemy = settings.enemy ? (window.VOXL_DATA.enemies || []).find((entry) => entry.id === settings.enemy) : null;
    const options = {
      mode, steps: settings[listKey] || [], repeat: !!settings[repeatKey], duration: settings[durationKey] || 30, runs: settings.runs,
      targetDefenses: { ...settings.target },
    };
    if (mode === "tank") {
      options.incoming = window.VoxlEngine.incomingFrom(settings, enemy);
      options.simulateHp = true;
      options.minimumDuration = settings.tduration || 30;
      if (!options.steps.length) { options.repeat = true; }
    }
    return options;
  }

  Object.assign(window.VoxlEngine, { defaultSettings, sanitizeSettings, tabOptions, SEQUENCES, DAMAGE_TYPES, DEFENSE_TYPES, cleanTypes });
})();
