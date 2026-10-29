(function () {
  const Expression = window.VoxlExpression;

  const camel = (name) => name.replace(/[^A-Za-z0-9]+(.)?/g, (match, next) => (next ? next.toUpperCase() : "")).replace(/^./, (first) => first.toLowerCase());
  const OFFENSIVE_BOOSTS = ["Physical Boost", "Magic Boost", "Fire Boost", "Water Boost", "Earth Boost", "Air Boost", "Hex Boost", "Holy Boost", "Dexterity Boost", "Summon Boost"];
  const STAT_NAMES = OFFENSIVE_BOOSTS.concat(["Speed Boost", "Attack Speed", "Jump Boost", "Armor Penetration", "Physical Defense", "Magic Defense", "Fire Defense",
    "Water Defense", "Earth Defense", "Air Defense", "Hex Defense", "Holy Defense", "Protection", "Warding", "Tenacity", "Cold Resistance", "Heat Resistance"]);

  const MATH_FUNCTIONS = {
    min: Math.min, max: Math.max, floor: Math.floor, ceil: Math.ceil, abs: Math.abs, sqrt: Math.sqrt, pow: Math.pow,
    round: (value) => Math.round(value), clamp: (value, low, high) => Math.min(high, Math.max(low, value)),
    oneOf: (value, ...options) => options.includes(value),
  };

  function statVariables(stats) {
    const variables = {};
    STAT_NAMES.forEach((name) => { variables[camel(name)] = stats[name] || 0; });
    variables.highestBoost = Math.max(0, ...OFFENSIVE_BOOSTS.map((name) => stats[name] || 0));
    variables.positiveBoosts = OFFENSIVE_BOOSTS.concat(["Speed Boost"]).reduce((sum, name) => sum + Math.max(0, stats[name] || 0), 0);
    variables.positiveDefenses = STAT_NAMES.filter((name) => /Defense|Warding/.test(name)).reduce((sum, name) => sum + Math.max(0, stats[name] || 0), 0);
    variables.negativeOtherStats = Object.entries(stats)
      .filter(([name]) => !["Warding", "Physical Defense", "Magic Defense", "Tenacity"].includes(name))
      .reduce((sum, [, value]) => sum + Math.max(0, -value), 0);
    return variables;
  }

  function applyStatEffects(stats, perkAmounts) {
    const rules = window.VoxlRules.current();
    const entries = Object.entries(perkAmounts)
      .filter(([id, amount]) => amount && rules.perks[id] && rules.perks[id].effects.some((effect) => effect.type === "stat"))
      .sort((a, b) => (rules.perks[a[0]].order || 0) - (rules.perks[b[0]].order || 0));
    entries.forEach(([id, amount]) => {
      rules.perks[id].effects.filter((effect) => effect.type === "stat").forEach((effect) => {
        const scope = { variables: { ...statVariables(stats), amount }, functions: MATH_FUNCTIONS };
        const current = stats[effect.stat] || 0;
        if (effect.set !== undefined) stats[effect.stat] = +Expression.compile(effect.set)(scope);
        else if (effect.multiplier !== undefined) stats[effect.stat] = current * +Expression.compile(effect.multiplier)(scope);
        else stats[effect.stat] = current + +Expression.compile(effect.add)(scope);
      });
    });
    return stats;
  }

  const UNSCALED_DEFAULT = ["cursed", "perk-effectiveness", "luminescent-fervor", "valor", "spirit-commune", "channeled-weapon", "quickcast", "thief-training", "vampire"];
  const isUnscaled = (id) => {
    const rule = window.VoxlRules.current().perks[id];
    return rule ? !!rule.unscaled || ["cursed", "perk-effectiveness", "channeled-weapon"].includes(id) : UNSCALED_DEFAULT.includes(id);
  };

  function conditionValues(settings) {
    const rules = window.VoxlRules.current();
    const values = {};
    rules.core.conditions.forEach((condition) => {
      const saved = settings.conditions ? settings.conditions[condition.id] : undefined;
      if (condition.type === "boolean") values[condition.id] = saved === undefined ? !!condition.default : !!saved;
      else values[condition.id] = typeof saved === "number" && Number.isFinite(saved) ? saved : condition.default;
    });
    return values;
  }

  function activePerks(build, totals, settings) {
    const rules = window.VoxlRules.current();
    const amounts = {};
    Object.values(totals.perks).forEach((perk) => { amounts[perk.id] = perk.amount; });
    if (build.race && rules.perks["race:" + build.race]) amounts["race:" + build.race] = 1;
    Object.entries({ ...amounts }).forEach(([id, amount]) => {
      const rule = rules.perks[id];
      (rule ? rule.effects : []).filter((effect) => effect.type === "grantPerk").forEach((effect) => {
        const value = +Expression.compile(effect.value)({ variables: { amount }, functions: MATH_FUNCTIONS });
        amounts[effect.perk] = (amounts[effect.perk] || 0) + value;
      });
    });
    const enabled = {};
    Object.entries(amounts).forEach(([id, amount]) => {
      const rule = rules.perks[id];
      if (!amount || (settings.perkOff && settings.perkOff[id])) return;
      if (rule && rule.situational && !(settings.situational && settings.situational[id])) return;
      enabled[id] = amount;
    });
    return { all: amounts, enabled };
  }

  function indexEffects(perkAmounts) {
    const rules = window.VoxlRules.current();
    const byType = {};
    Object.entries(perkAmounts).forEach(([id, amount]) => {
      const rule = rules.perks[id];
      if (!rule) return;
      rule.effects.forEach((effect, index) => {
        if (effect.type === "stat" || effect.type === "grantPerk") return;
        (byType[effect.type] = byType[effect.type] || []).push({ sourceKind: "perk", sourceId: id, amount, effect, key: `${id}#${index}` });
      });
    });
    Object.values(byType).forEach((list) => list.sort((a, b) => (a.effect.order || 0) - (b.effect.order || 0)));
    return byType;
  }

  function indexStatusEffects() {
    const statuses = window.VoxlRules.current().core.statuses;
    const index = {};
    Object.entries(statuses).forEach(([id, status]) => {
      index[id] = { onSelf: {}, onTarget: {} };
      ["onSelf", "onTarget"].forEach((side) => (status[side] || []).forEach((effect, position) => {
        (index[id][side][effect.type] = index[id][side][effect.type] || []).push({ sourceKind: "status", sourceId: id, effect, key: `${id}.${side}#${position}` });
      }));
    });
    return index;
  }

  function formInfo(build, perkAmounts) {
    const rules = window.VoxlRules.current();
    const form = window.VoxlModel.weaponForm(build, perkAmounts);
    const forms = rules.attacks.forms;
    const m1Form = forms[form.m1] && forms[form.m1].m1 ? form.m1 : form.base;
    return {
      base: form.base, m1: m1Form, m2: form.m2, notes: form.notes,
      m1Rule: forms[m1Form] || forms["1-Handed Sword"], m2Rule: forms[form.m2] || forms[form.base] || forms["1-Handed Sword"],
    };
  }

  function weaponTypes(weapon) {
    return Object.keys(weapon.types || {}).length ? { ...weapon.types } : { Physical: 1 };
  }

  const highestType = (types) => Object.entries(types).sort((a, b) => b[1] - a[1])[0][0];

  function buildProfile(build, totals, weapon, settings) {
    const rules = window.VoxlRules.current();
    const constants = rules.core.constants;
    const perks = activePerks(build, totals, settings);
    const stats = { ...totals.stats };
    const conditions = conditionValues(settings);
    const level = build.level || 80;
    const form = formInfo(build, perks.all);
    const types = weaponTypes(weapon);
    const draconic = window.VoxlModel.draconic(build);
    const statVars = statVariables(stats);
    const variables = {
      ...statVars, ...conditions, ...constants, level,
      maxHp: constants.baseMaxHp * (1 + constants.levelBonusPerLevel * level),
      summonScale: 1 + (stats["Summon Boost"] || 0) / 100 * (1 + level / 80),
      weaponHighestType: highestType(types),
      draconicColor: draconic ? draconic.color : "", dragonBlooded: !!(draconic && draconic.blooded),
      draconicType: draconic ? draconic.type : "Physical",
      gatheringTideStart: typeof settings.gatheringTideStart === "number" ? settings.gatheringTideStart : 100,
      enemyBaseHp: 100,
    };
    const runeItem = build.slots.rune && window.VOXL_DATA.items.find((item) => item.id === build.slots.rune.id);
    return {
      build, settings, rules, constants, level, stats, statVariables: statVars, perks: perks.enabled, allPerks: perks.all, conditions,
      variables, functions: MATH_FUNCTIONS, effects: indexEffects(perks.enabled), statusEffects: indexStatusEffects(),
      form, weapon, weaponTypes: types, weaponScalings: { ...(weapon.scalings || {}) }, draconic, runeItem,
    };
  }

  window.VoxlEngine = window.VoxlEngine || {};
  Object.assign(window.VoxlEngine, {
    camel, STAT_NAMES, OFFENSIVE_BOOSTS, MATH_FUNCTIONS, statVariables, applyStatEffects, isUnscaled, conditionValues,
    activePerks, indexEffects, buildProfile, weaponTypes, highestType,
  });
})();
