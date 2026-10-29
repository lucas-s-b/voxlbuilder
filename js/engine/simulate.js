(function () {
  const Engine = window.VoxlEngine;
  const combat = Engine.internals;

  const DEFAULT_RUNS = 150;
  const COUNT_LIMIT = 600;

  function newReport(steps) {
    return {
      damage: 0, bySource: {}, byName: {}, byProc: {}, byType: {}, bins: [], applications: {}, uptime: {}, allyBuffs: {},
      steps: (steps || []).map((step, index) => ({ index, action: step.a, damage: 0, uses: 0, waited: 0, skipped: 0, start: null, end: null, note: "", applied: {}, healed: 0 })),
      healing: { self: 0, effectiveSelf: 0, allies: 0, bySource: {}, allySources: {} },
      taken: { total: 0, raw: 0, hp: 0, shield: 0, dot: 0, selfDamage: 0, byType: {}, byAttack: {}, incomingHits: 0, dodged: 0, blocked: 0, parried: 0, stun: 0 },
      selfDamage: 0, hits: 0, crits: 0, spirits: 0, killTime: null, deathTime: null, deaths: 0, duration: 0, lowestHp: null,
    };
  }

  function newContext(profile, options, seed) {
    const constants = profile.constants;
    const maxHp = profile.variables.maxHp;
    const context = {
      profile, options, rng: combat.seededRandom(seed), time: 0, nextTick: 1, queue: [], queueCounter: 0,
      nextEnemyAttack: options.incoming && options.incoming.steps.length ? options.incoming.interval : Infinity, enemyIndex: 0,
      uptimeClock: 0, depth: 0, errors: new Set(), counters: {}, procReady: {}, hitTimes: [], flatCarry: {}, surgeFails: 0,
      cooldownReady: { art: 0, rune: 0, drac: 0, special: 0, potion: 0 },
      self: { statuses: {}, hp: maxHp, maxHp, shield: Math.max(0, Math.min(maxHp, profile.stats.Protection || 0)), bonusShield: 0, shieldBroken: false, lastHit: -1e9 },
      target: { statuses: {}, defenses: options.targetDefenses || {}, pool: false, hp: 0, maxHp: 0, dead: false },
      minions: [], minionMode: false, lastSummon: null, energy: 0, energyMax: constants.spiritEnergyMax || 100, energyBlockedUntil: -1,
      lastCleanse: -1e9, vitalMist: 0, stepIndex: -1, currentAttack: null, releasingSpirit: false, lastHitDue: 0,
      report: newReport(options.steps),
    };
    combat.active.context = context;
    context.variables = combat.contextVariables(context);
    const spirits = profile.rules.attacks.spirits;
    const owned = Object.keys(spirits).filter((id) => profile.perks[id]);
    const chosen = owned.includes(profile.settings.special) ? profile.settings.special : owned[0];
    context.spirit = chosen && profile.perks["spirit-commune"] ? { id: chosen, rule: spirits[chosen] } : null;
    return context;
  }

  function overrideFor(context, kind, id) {
    const variables = Object.assign(Object.create(context.variables), kind === "art" ? { artId: id } : { runeId: id });
    return (context.profile.effects.override || []).filter((entry) => combat.condition(entry.effect.when, combat.effectScope(entry, variables, context)))
      .reduce((merged, entry) => {
        const next = { ...merged, ...entry.effect.attack, amount: entry.amount };
        Object.keys(entry.effect.attack).forEach((key) => { if (entry.effect.attack[key] === null) delete next[key]; });
        return next;
      }, null);
  }

  function weaponForm(profile, highestTypes) {
    return {
      m1Types: profile.form.m1Rule && profile.form.m1Rule.typesFromHighest ? highestTypes : "weapon",
      m2Types: profile.form.m2Rule && profile.form.m2Rule.typesFromHighest ? highestTypes : "weapon",
    };
  }

  function buildActions(context) {
    const profile = context.profile;
    const rules = profile.rules.attacks;
    const settings = profile.settings;
    const constants = profile.constants;
    const total = Object.values(profile.weaponTypes).reduce((sum, value) => sum + value, 0) || 1;
    const formTypes = weaponForm(profile, { [profile.variables.weaponHighestType]: total });
    const actions = {};
    const passingStatic = (type, variables) => combat.passing(context, type, Object.assign(Object.create(context.variables), variables || {}));

    const m1Rule = profile.form.m1Rule || {};
    const swings = m1Rule.m1 || [];
    if (swings.length) {
      const formHasFinisher = !m1Rule.noM1Finisher && swings.length > 1;
      const removeFinisher = passingStatic("noM1Finisher", { formHasFinisher, isM1: true }).length > 0;
      const replaceFinisher = passingStatic("replaceM1Finisher", {}).length > 0;
      const deltaDrill = passingStatic("deltaDrill", {}).reduce((sum, entry) => sum + Math.round(combat.number(entry.effect.value, entry.scope)), 0);
      const list = swings.map((hits, index) => {
        const last = index === swings.length - 1;
        let swingHits = hits;
        if (last && deltaDrill > 0) {
          const extra = [];
          for (let drill = 1; drill <= deltaDrill; drill++) hits.forEach(([base, count]) => extra.push([base * Math.max(0.3, 1 - (0.3 + 0.1 * drill)), count]));
          swingHits = hits.concat(extra);
        }
        return {
          kind: "m1", isM1: true, form: profile.form.m1, name: `Swing ${index + 1}`, source: "m1", hits: swingHits, types: formTypes.m1Types, scalings: "weapon",
          finisher: last && formHasFinisher && !removeFinisher, chain: index + 1, procCoef: m1Rule.procCoef === undefined ? 1 : m1Rule.procCoef, replacedByM2: last && replaceFinisher,
        };
      });
      actions.m1 = { key: "m1", name: "M1 combo", swings: list };
    }
    const m2Rule = profile.form.m2Rule || {};
    const chargeEffect = passingStatic("chargeM2", {})[0];
    actions.m2 = {
      key: "m2", name: "M2",
      attack: {
        kind: "m2", isM2: true, form: profile.form.m2, name: "M2", source: "m2", hits: m2Rule.m2 || [], types: formTypes.m2Types, scalings: "weapon", finisher: true,
        eachHitFinisher: !!m2Rule.m2EachHitFinisher, chain: swings.length + 1, procCoef: m2Rule.m2ProcCoef !== undefined ? m2Rule.m2ProcCoef : m2Rule.procCoef === undefined ? 1 : m2Rule.procCoef,
      },
      charge: chargeEffect ? { kind: "effect", entry: chargeEffect } : m2Rule.charge ? { kind: "form", rule: m2Rule.charge } : null,
    };

    const art = profile.weapon.art;
    if (art) {
      const base = rules.arts[art.id] || { hits: art.hits || [], types: art.types || undefined, scalings: art.scalings || undefined };
      const override = overrideFor(context, "art", art.id);
      const rule = override ? { ...base, ...override } : base;
      actions.art = {
        key: "art", name: art.name, image: art.image, ability: "art", baseCooldown: rule.cooldown !== undefined ? rule.cooldown : art.cooldown || 0, rule,
        attack: attackFromRule(rule, { kind: "art", artId: art.id, name: art.name, source: "art" }, override),
      };
    }
    const rune = profile.runeItem;
    if (rune) {
      const base = rules.runes[rune.id] || { hits: [] };
      const override = overrideFor(context, "rune", rune.id);
      const rule = override ? { ...base, ...override } : base;
      actions.rune = {
        key: "rune", name: rune.name, image: rune.image, ability: "rune", baseCooldown: rule.cooldown !== undefined ? rule.cooldown : rule.cooldownOnHit !== undefined ? rule.cooldownOnHit : rune.cooldown || 0, rule,
        attack: attackFromRule(rule, { kind: "rune", runeId: rune.id, name: rune.name, source: "rune" }, override),
      };
    }
    const draconic = profile.draconic;
    const blood = profile.allPerks["draconic-blood"] || 0;
    if (draconic && blood) {
      const abilityRule = rules.draconic[draconic.ability.id];
      const color = draconic.blooded ? rules.draconic.colors[draconic.color] || {} : {};
      const scope = Object.assign(Object.create(context.variables), { amount: blood });
      const rule = { hits: [], ...abilityRule };
      if (abilityRule.base !== undefined) {
        rule.hits = [{ base: combat.number(abilityRule.base, scope) * (color.damage || 1), count: 1, guardbreak: !!abilityRule.guardbreak }];
        rule.types = { [draconic.type]: 1 };
        rule.scalings = { [draconic.type]: 1 };
        rule.applies = (color.applies || []).map((spec) => ({ ...spec, potency: spec.potency === undefined ? undefined : combat.number(spec.potency, scope) }));
        const healFormula = abilityRule.heal && abilityRule.heal[draconic.color];
        if (draconic.blooded && healFormula) rule.heal = { base: combat.number(healFormula, scope), scalings: { [draconic.type]: 1 }, target: "both", cleanse: !!color.cleanse };
      }
      if (abilityRule.buff) rule.selfApplies = [{ status: abilityRule.buff.status, potency: combat.number(abilityRule.buff.potency, scope), duration: abilityRule.buff.duration }];
      actions.drac = {
        key: "drac", name: abilityRule.name, ability: "rune", baseCooldown: abilityRule.cooldown * (abilityRule.buff ? 1 : color.cooldown || 1), rule,
        attack: attackFromRule(rule, { kind: "rune", runeId: "draconic-" + draconic.ability.id, name: abilityRule.name, source: "drac" }),
      };
    }

    const specials = [];
    if (context.spirit) {
      const rule = context.spirit.rule;
      specials.push({ id: context.spirit.id, name: (window.VOXL_DATA.perks[context.spirit.id] || {}).name || context.spirit.id, spirit: true, cast: constants.spiritCastTime, rule });
    }
    (profile.effects.extraAction || []).forEach((entry) => {
      const attack = entry.effect.attack;
      specials.push({ id: entry.sourceId, name: (window.VOXL_DATA.perks[entry.sourceId] || {}).name || entry.sourceId, entry, cast: attack.cast, cooldown: attack.cooldown || 0 });
    });
    if (specials.length) {
      const chosen = specials.find((special) => special.id === settings.special) || specials[0];
      actions.special = { key: "special", name: chosen.name, special: chosen, choices: specials.map((special) => [special.id, special.name]) };
    }
    const throwable = Object.entries(settings.potions || {}).filter(([id, on]) => on && rules.potions[id] && rules.potions[id].hits).map(([id]) => id)[0];
    if (throwable) {
      const rule = rules.potions[throwable];
      actions.potion = { key: "potion", name: (window.VOXL_DATA.items.find((item) => item.id === throwable) || { name: throwable }).name, rule,
        attack: attackFromRule(rule, { kind: "potion", name: throwable, source: "proc" }) };
    }
    (settings.customs || []).forEach((custom) => {
      const types = Object.fromEntries(Object.entries(custom.types || {}).filter(([, value]) => value > 0));
      const ownTypes = Object.keys(types).length > 0;
      actions["custom:" + custom.id] = {
        key: "custom:" + custom.id, name: custom.name || "Custom attack",
        attack: { kind: "custom", name: custom.name || "Custom attack", source: "custom", hits: [[Math.max(0, +custom.dmg || 0), Math.max(1, Math.round(+custom.hits || 1))]],
          types: ownTypes ? types : "weapon", scalings: "weapon", procCoef: 1 },
      };
    });
    return actions;
  }

  function attackFromRule(rule, identity, override) {
    return {
      ...identity, hits: rule.hits || [], types: rule.types, scalings: rule.scalings, procCoef: rule.procCoef === undefined ? 1 : rule.procCoef,
      finisher: !!rule.finisher, eachHitFinisher: !!rule.eachHitFinisher, guardbreak: !!rule.guardbreak, applies: rule.applies, slam: !!rule.slam,
      baseMultiplier: rule.baseMultiplier, spiritPerHit: rule.spiritPerHit, amount: override ? override.amount : undefined,
      scope: override && override.amount !== undefined ? { amount: override.amount } : undefined,
    };
  }

  function swingTime(context, attack, settings) {
    const custom = settings.timing && settings.timing.m1 && +settings.timing.m1.cast;
    const base = custom > 0 ? custom : context.profile.constants.defaultSwingTime;
    return base / combat.attackSpeed(context, attack, "weapon").multiplier;
  }

  function timingOverride(settings, key) {
    const timing = (settings.timing || {})[key] || {};
    return { cast: +timing.cast > 0 ? +timing.cast : null, active: +timing.active > 0 ? +timing.active : null };
  }

  function prepareAttack(context, template, extra) {
    const attack = { ...template, ...extra };
    attack.procCoef = combat.number(attack.procCoef === undefined ? 1 : attack.procCoef, context.variables, 1);
    if (attack.isM1 || attack.isM2) {
      const variables = combat.hitVariables(context, attack, {}, { procCoef: attack.procCoef });
      if (combat.passing(context, "countsAs", variables).some((entry) => entry.effect.kind === "art")) attack.countsAsArt = true;
    }
    return attack;
  }

  function castVariables(context, attack, castTime, cooldown) {
    const variables = combat.hitVariables(context, attack, {}, { procCoef: attack.procCoef });
    return Object.assign(variables, { castTime, cooldown, baseCooldown: attack.baseCooldown || 0, isCastStart: true });
  }

  function runAttack(context, attack, rule, castTime, activeTime, cooldown) {
    context.currentAttack = attack;
    const variables = castVariables(context, attack, castTime, cooldown);
    (rule && rule.selfApplies || []).forEach((spec) => combat.applySpec(context, spec, "self", variables, { sourceName: attack.name }));
    combat.fireTrigger(context, "cast", variables);
    if (attack.kind === "rune" || attack.kind === "art") combat.autoSpirit(context, "cast");
    if (attack.kind === "rune") combat.autoSpirit(context, "rune");
    const spread = activeTime > 0 ? activeTime : 0;
    attack.spread = spread;
    const result = (attack.hits || []).length ? combat.executeAttack(context, attack) : null;
    if (!(attack.hits || []).length && attack.applies) attack.applies.forEach((spec) => combat.applySpec(context, spec, "target", variables, { sourceName: attack.name }));
    if (spread > 0) context.lastHitDue = Math.max(context.lastHitDue, context.time + spread);
    if (rule && rule.heal) healFromRule(context, rule.heal, attack.name, spread);
    if (rule && rule.summon) combat.summonMinions(context, { ...rule.summon });
    if (rule && rule.selfDamage) {
      const selfDamage = rule.selfDamage;
      const amount = selfDamage.ofMaxHp ? combat.number(selfDamage.fraction, variables) * context.self.maxHp : combat.number(selfDamage.base, variables) * combat.number(selfDamage.count === undefined ? 1 : selfDamage.count, variables, 1);
      combat.takeSelfDamage(context, amount, selfDamage.types, attack.name);
    }
    const endVariables = castVariables(context, attack, castTime, cooldown);
    combat.schedule(context, context.time + castTime, () => combat.fireTrigger(context, "castEnd", endVariables));
    context.currentAttack = null;
    return result;
  }

  function healFromRule(context, heal, name, spread) {
    const scalings = heal.noScaling ? {} : combat.scalingsFromSpec(context, heal.scalings || {}, context.variables);
    const level = heal.noLevel ? 1 : 1 + context.profile.constants.levelBonusPerLevel * context.profile.level;
    const amount = combat.number(heal.base, context.variables) * combat.boostMultiplier(context, scalings) * level;
    const count = Math.max(1, Math.round(heal.count || 1));
    const options = { lifesteal: !!heal.lifesteal, cleanse: !!heal.cleanse, canProcHeal: !heal.lifesteal };
    for (let index = 0; index < count; index++) {
      const run = () => combat.heal(context, amount, heal.target || "self", name, options);
      if (spread > 0 && count > 1) combat.schedule(context, context.time + spread * (index + 0.5) / count, run);
      else run();
    }
  }

  function chargedM2(context, action, charge) {
    const base = action.attack;
    if (!action.charge || !(charge > 0)) return { attack: base, chargeTime: 0 };
    if (action.charge.kind === "form") {
      const rule = action.charge.rule;
      const hits = [[rule.from + (rule.to - rule.from) * charge, 1]];
      const procCoef = rule.procCoefTo ? base.procCoef + (rule.procCoefTo - base.procCoef) * charge : base.procCoef;
      return { attack: { ...base, hits, procCoef, name: "M2" }, chargeTime: rule.time * charge };
    }
    const entry = action.charge.entry;
    const scope = combat.effectScope(entry, Object.assign(Object.create(context.variables), { form: context.profile.form.m2 }), context);
    const effect = entry.effect;
    const multiplier = 1 + combat.number(effect.maxBonus, scope, 0.8) * charge;
    const perSwing = Math.max(1, Math.round(combat.number(effect.hitsPerSwing, scope, 1)));
    const hits = [[combat.number(effect.from, scope) * multiplier, perSwing]];
    const slashes = combat.number(effect.maxBonus, scope, 0.8) * charge >= combat.number(effect.slashAt, scope, 0.3) - 1e-9;
    if (slashes) hits.push([combat.number(effect.slash, scope) * multiplier, perSwing]);
    return {
      attack: { ...base, hits, scalings: effect.scalings || base.scalings, guardbreak: true, applies: slashes ? effect.slashApplies : base.applies, name: "M2" },
      chargeTime: combat.number(effect.time, scope, 0) * charge,
    };
  }

  function currentM2(context, action) {
    const replacement = combat.passing(context, "replaceM2", context.variables)[0];
    if (!replacement) return { attack: action.attack, entry: null };
    const definition = replacement.effect.attack;
    return {
      entry: replacement,
      attack: {
        ...action.attack, ...definition, isM2: true, kind: "m2", source: "m2", name: combat.attackName(definition.name, replacement.scope, "M2"),
        procCoef: definition.canProc === false ? 0 : definition.procCoef === undefined ? 1 : definition.procCoef, amount: replacement.amount,
        scope: { amount: replacement.amount }, spiritCoefficient: definition.spiritCoefficient,
      },
    };
  }

  function performSwing(context, template) {
    const attack = prepareAttack(context, template, { amount: template.amount });
    const lock = swingTime(context, attack, context.profile.settings);
    combat.fireTrigger(context, "cast", castVariables(context, attack, lock, 0));
    combat.executeAttack(context, attack);
    combat.gainEnergy(context, attack);
    return lock;
  }

  function performM2(context, action, charge) {
    const { attack: chosen, entry } = currentM2(context, action);
    const { attack: template, chargeTime } = entry ? { attack: chosen, chargeTime: 0 } : chargedM2(context, { ...action, attack: chosen }, charge);
    const attack = prepareAttack(context, template, {});
    const speed = combat.attackSpeed(context, attack, "weapon").multiplier;
    const lock = swingTime(context, attack, context.profile.settings) + chargeTime / speed;
    combat.fireTrigger(context, "cast", castVariables(context, attack, lock, 0));
    combat.executeAttack(context, attack);
    combat.gainEnergy(context, attack);
    if (entry && entry.effect.resetCounter) combat.resetCounter(context, entry.effect.resetCounter);
    const spirit = context.spirit;
    if (spirit && (spirit.rule.trigger || "rmb") === "rmb" && context.energy >= context.energyMax - 1e-9) combat.releaseSpirit(context, spirit);
    return lock;
  }

  function cooldownOf(context, action) {
    let base = action.baseCooldown;
    if (action.rule && action.rule.cooldownFromAttackSpeed) {
      const speed = combat.attackSpeed(context, action.attack, "art");
      base /= Math.min(1, speed.weapon * speed.stat);
    }
    return combat.abilityCooldown(context, action.ability, base, action.attack).final;
  }

  function abilityPlan(context, action, charge) {
    const rule = action.rule;
    const constants = context.profile.constants;
    const timingKey = action.key === "art" ? "art:" + action.attack.artId : action.key === "rune" ? "rune:" + action.attack.runeId : "drac:" + action.attack.runeId;
    const override = timingOverride(context.profile.settings, timingKey);
    const template = { ...action.attack, baseCooldown: action.baseCooldown };
    if (rule.charge && charge > 0) template.hits = [[rule.charge.from + (rule.charge.to - rule.charge.from) * charge, 1]];
    const attack = prepareAttack(context, template, {});
    const speed = action.key === "art" && !rule.fixedCast ? combat.attackSpeed(context, attack, "art").multiplier : 1;
    const baseCast = override.cast || (action.key === "art" ? rule.cast || constants.defaultCastTime : constants.runeCastTime);
    const chargeTime = rule.charge && charge > 0 ? rule.charge.time * charge : 0;
    const castTime = (baseCast + chargeTime) / speed;
    const longActive = override.active || rule.active;
    const activeTime = longActive ? Math.max(castTime, longActive / speed) : (attack.hits || []).length > 1 || expandsToMany(attack) ? castTime : 0;
    return { attack, rule, castTime, activeTime, cooldown: cooldownOf(context, action), timingKey };
  }

  const expandsToMany = (attack) => (attack.hits || []).some((group) => Array.isArray(group) ? +group[1] > 1 : +group.count > 1);

  function performAbility(context, action, charge) {
    const { attack, rule, castTime, activeTime, cooldown } = abilityPlan(context, action, charge);
    runAttack(context, attack, rule, castTime, activeTime, cooldown);
    context.cooldownReady[action.key] = context.time + cooldown;
    if (action.key === "art") {
      const surge = combat.passing(context, "cooldownReset", context.variables).find((entry) => entry.effect.ability === "art");
      if (surge) {
        const chance = Math.min(1, combat.number(surge.effect.chance, surge.scope) + context.surgeFails * combat.number(surge.effect.rampPerFail, surge.scope, 0));
        if (context.rng() < chance) { context.cooldownReady.art = context.time + castTime; context.surgeFails = 0; } else context.surgeFails++;
      }
    }
    return castTime;
  }

  function performSpecial(context, action) {
    const special = action.special;
    if (special.spirit) {
      if (context.energy < context.energyMax - 1e-9) return { lock: 0, note: "energy" };
      combat.releaseSpirit(context, context.spirit);
      return { lock: special.cast || context.profile.constants.spiritCastTime };
    }
    const definition = special.entry.effect.attack;
    const template = { kind: definition.kind || "custom", name: special.name, source: "special", hits: definition.hits, types: definition.types, scalings: definition.scalings,
      procCoef: definition.canProc ? definition.procCoef === undefined ? 1 : definition.procCoef : 0, slam: !!definition.slam, guardbreak: !!definition.guardbreak,
      scope: { amount: special.entry.amount }, amount: special.entry.amount };
    const attack = prepareAttack(context, template, {});
    const castTime = (definition.cast || context.profile.constants.defaultCastTime) / combat.attackSpeed(context, attack, "weapon").multiplier;
    runAttack(context, attack, definition, castTime, (attack.hits || []).length > 1 ? castTime : 0, special.cooldown || 0);
    context.cooldownReady.special = context.time + (special.cooldown || 0);
    return { lock: castTime };
  }

  function expandSteps(actions, steps) {
    const items = [];
    steps.forEach((step, stepIndex) => {
      const uses = Math.max(1, Math.min(50, Math.round(+step.n || 1)));
      for (let use = 0; use < uses; use++) {
        if (step.a === "wait") items.push({ stepIndex, wait: Math.max(0, Math.min(60, +step.w || 1)), first: use === 0 });
        else if (step.a === "m1" && actions.m1) actions.m1.swings.forEach((swing, swingIndex) => items.push({ stepIndex, key: "m1", swing, first: use === 0 && swingIndex === 0, last: swingIndex === actions.m1.swings.length - 1 }));
        else if (step.a.startsWith("swing:") && actions.m1) items.push({ stepIndex, key: "m1", swing: actions.m1.swings[+step.a.slice(6)], first: true, last: true });
        else items.push({ stepIndex, key: step.a, charge: +step.c || 0, first: use === 0, last: true });
      }
    });
    return items;
  }

  const ABILITY_KEYS = ["art", "rune", "drac", "special"];

  function readyAt(context, actions, item) {
    if (!ABILITY_KEYS.includes(item.key) || !actions[item.key]) return context.time;
    return context.cooldownReady[item.key];
  }

  function performItem(context, actions, item) {
    const action = actions[item.key];
    if (item.key === "m1") {
      if (item.swing.replacedByM2) return performM2(context, actions.m2, 0);
      return performSwing(context, item.swing);
    }
    if (item.key === "m2") return performM2(context, action, item.charge);
    if (item.key === "art" || item.key === "rune" || item.key === "drac") return performAbility(context, action, item.charge);
    if (item.key === "special") return performSpecial(context, action).lock;
    const attack = prepareAttack(context, action.attack, {});
    const lock = swingTime(context, attack, context.profile.settings);
    combat.executeAttack(context, attack);
    return lock;
  }

  function runSequence(context, actions) {
    const options = context.options;
    const items = expandSteps(actions, options.steps || []);
    const steps = context.report.steps;
    const repeat = !!options.repeat;
    const end = repeat ? options.duration : COUNT_LIMIT;
    const hasAction = items.some((item) => !item.wait && actions[item.key]);
    let position = 0;
    let actedThisLoop = false;
    while (items.length) {
      if (position >= items.length) {
        if (!repeat || !hasAction) break;
        if (!actedThisLoop) {
          const waits = items.filter((item) => actions[item.key] && ABILITY_KEYS.includes(item.key)).map((item) => readyAt(context, actions, item));
          const next = Math.min(...waits);
          if (!Number.isFinite(next) || next <= context.time + 1e-9) break;
          combat.advanceTo(context, Math.min(end, next));
        }
        position = 0;
        actedThisLoop = false;
      }
      if (context.time >= end - 1e-9) break;
      const item = items[position++];
      const step = steps[item.stepIndex];
      context.stepIndex = item.stepIndex;
      if (item.wait) {
        if (step.start === null) step.start = context.time;
        combat.advanceTo(context, Math.min(end, context.time + item.wait));
        step.end = context.time;
        step.uses++;
        continue;
      }
      if (!actions[item.key]) { step.note = "missing"; continue; }
      const ready = readyAt(context, actions, item);
      if (ready > context.time + 1e-9) {
        if (repeat) { step.skipped++; continue; }
        step.waited += ready - context.time;
        combat.advanceTo(context, ready);
      }
      if (step.start === null) step.start = context.time;
      const lock = performItem(context, actions, item);
      if (lock === 0 && item.key === "special") { step.note = "energy"; step.skipped++; continue; }
      actedThisLoop = true;
      if (item.last) step.uses++;
      combat.advanceTo(context, Math.min(repeat ? end : Infinity, context.time + lock));
      step.end = context.time;
    }
    context.stepIndex = -1;
    if (repeat) return end;
    return Math.max(context.time, context.lastHitDue);
  }

  function startFight(context) {
    const settings = context.profile.settings;
    const rules = context.profile.rules;
    const start = settings.start || {};
    ["self", "target"].forEach((side) => Object.entries(start[side] || {}).forEach(([id, potency]) => {
      if (rules.core.statuses[id] && potency !== false && potency !== null) {
        combat.applyStatus(context, side, id, +potency || 0, 1e6, { sourceName: "start", noPotencyBonus: true, noDurationBonus: true });
      }
    }));
    Object.entries(settings.potions || {}).forEach(([id, on]) => {
      const potion = on && rules.attacks.potions[id];
      if (!potion) return;
      (potion.selfApplies || []).forEach((spec) => combat.applySpec(context, spec, "self", context.variables, { sourceName: id, source: "potion" }));
      (potion.applies || []).forEach((spec) => combat.applySpec(context, spec, "target", context.variables, { sourceName: id, source: "potion" }));
    });
    combat.fireTrigger(context, "start", context.variables);
  }

  function runFight(profile, options, seed) {
    const context = newContext(profile, options, seed);
    const actions = buildActions(context);
    startFight(context);
    const fightEnd = runSequence(context, actions);
    const end = Math.max(fightEnd, options.minimumDuration || 0);
    combat.advanceTo(context, end);
    context.report.duration = end;
    context.report.errors = [...context.errors];
    context.report.endStatuses = snapshotStatuses(context);
    combat.active.context = null;
    return context.report;
  }

  function snapshotStatuses(context) {
    const snapshot = { self: {}, target: {} };
    ["self", "target"].forEach((side) => Object.entries(context[side].statuses).forEach(([id, status]) => {
      if (combat.statusAlive(status, context.time)) snapshot[side][id] = status.potency;
    }));
    return snapshot;
  }

  function addInto(total, value) {
    if (typeof value === "number") return (total || 0) + value;
    if (Array.isArray(value)) {
      const list = Array.isArray(total) ? total : [];
      value.forEach((item, index) => { list[index] = addInto(list[index], item); });
      return list;
    }
    if (value && typeof value === "object") {
      const object = total && typeof total === "object" ? total : {};
      Object.entries(value).forEach(([key, item]) => { object[key] = addInto(object[key], item); });
      return object;
    }
    return total === undefined ? value : total;
  }

  function divideBy(value, count) {
    if (typeof value === "number") return value / count;
    if (Array.isArray(value)) return value.map((item) => divideBy(item, count));
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, divideBy(item, count)]));
    return value;
  }

  function percentile(sorted, share) {
    if (!sorted.length) return 0;
    const position = Math.min(sorted.length - 1, Math.max(0, Math.round(share * (sorted.length - 1))));
    return sorted[position];
  }

  function average(reports) {
    const count = reports.length;
    const summed = reports.reduce((total, report) => {
      const { killTime, deathTime, errors, endStatuses, lowestHp, steps, ...rest } = report;
      return addInto(total, { ...rest, stepStats: steps.map(({ action, note, start, end, ...numbers }) => numbers) });
    }, null) || {};
    const result = divideBy(summed, count);
    result.steps = reports[0] ? reports[0].steps.map((step, index) => ({ ...step, ...result.stepStats[index] })) : [];
    delete result.stepStats;
    const deaths = reports.filter((report) => report.deathTime !== null).map((report) => report.deathTime);
    result.deathShare = deaths.length / Math.max(1, count);
    result.deathTime = deaths.length ? deaths.reduce((sum, time) => sum + time, 0) / deaths.length : null;
    result.lowestHp = reports.length ? Math.min(...reports.map((report) => report.lowestHp === null ? Infinity : report.lowestHp)) : null;
    const totals = reports.map((report) => report.damage).sort((a, b) => a - b);
    result.spread = { low: percentile(totals, 0.1), high: percentile(totals, 0.9) };
    result.errors = [...new Set(reports.flatMap((report) => report.errors || []))];
    result.endStatuses = reports[0] ? reports[0].endStatuses : { self: {}, target: {} };
    result.runs = count;
    return result;
  }

  const MINIMUM_RUNS = 24;
  const TARGET_ERROR = 0.004;

  function settled(reports, metric) {
    const values = reports.map(metric);
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    if (Math.abs(mean) < 1e-9) return true;
    const variance = values.reduce((sum, value) => sum + (value - mean) * (value - mean), 0) / Math.max(1, values.length - 1);
    return Math.sqrt(variance / values.length) / Math.abs(mean) < TARGET_ERROR;
  }

  function simulate(profile, options) {
    const runs = Math.max(1, Math.round(options.runs || DEFAULT_RUNS));
    const reports = [];
    for (let run = 0; run < runs; run++) {
      reports.push(runFight(profile, options, 7919 * (run + 1)));
      if (reports.length >= MINIMUM_RUNS && reports.length % 8 === 0
        && settled(reports, (report) => report.damage) && settled(reports, (report) => report.healing.self + report.healing.allies) && settled(reports, (report) => report.taken.total)) break;
    }
    return average(reports);
  }

  function detailSteps(profile, key) {
    if (key !== "m1") return [{ a: key, n: 1 }];
    const swings = (profile.form.m1Rule && profile.form.m1Rule.m1) || [];
    return swings.map((swing, index) => ({ a: "swing:" + index, n: 1 }));
  }

  function tracedRun(profile, options, crit) {
    const context = newContext({ ...profile, settings: { ...profile.settings, crit } }, { ...options, trace: true }, 1);
    const actions = buildActions(context);
    startFight(context);
    runSequence(context, actions);
    combat.advanceTo(context, Math.max(context.time, context.lastHitDue));
    combat.active.context = null;
    return { report: context.report, trace: context.traced };
  }

  function hitDetails(profile, options, key) {
    const detailOptions = { ...options, mode: "dps", steps: detailSteps(profile, key), repeat: false, incoming: null, simulateHp: false, minimumDuration: 0 };
    const averaged = simulate(profile, detailOptions);
    const normal = tracedRun(profile, detailOptions, "never");
    const critical = tracedRun(profile, detailOptions, "always");
    return { average: averaged, normal: normal.report, critical: critical.report, trace: normal.trace, criticalTrace: critical.trace };
  }

  function abilityPreview(profile, key, runs) {
    const context = newContext(profile, { steps: [] }, 1);
    const actions = buildActions(context);
    const action = actions[key];
    if (!action) { combat.active.context = null; return null; }
    const plan = abilityPlan(context, action, 0);
    const hitCount = (plan.attack.hits || []).reduce((sum, group) => sum + Math.round(combat.number(Array.isArray(group) ? group[1] : group.count === undefined ? 1 : group.count, context.variables, 1)), 0);
    combat.active.context = null;
    const details = simulate(profile, { mode: "dps", steps: [{ a: key, n: 1 }], repeat: false, runs: runs || 40, targetDefenses: profile.settings.target || {} });
    const firstStep = details.steps[0] || { damage: 0 };
    return { cooldown: plan.cooldown, baseCooldown: action.baseCooldown, cast: plan.castTime, active: Math.max(plan.castTime, plan.activeTime), damage: firstStep.damage, hitCount, byType: details.byType };
  }

  function listActions(profile) {
    const context = newContext(profile, { steps: [] }, 1);
    const actions = buildActions(context);
    const plans = {};
    ["art", "rune", "drac"].forEach((key) => { if (actions[key]) plans[key] = abilityPlan(context, actions[key], 0); });
    const probe = actions.m1 ? actions.m1.swings[0] : actions.m2.attack;
    const speed = combat.attackSpeed(context, probe, "weapon");
    const result = { actions, plans, speed, swingTime: swingTime(context, probe, profile.settings), energyMax: context.energyMax };
    combat.active.context = null;
    return result;
  }

  function incomingFrom(settings, enemy) {
    const incoming = settings.inc || {};
    const steps = [];
    (Array.isArray(incoming.seq) ? incoming.seq : defaultIncoming(enemy)).forEach((step) => {
      const attack = incomingStep(step, enemy);
      if (attack) for (let use = 0; use < attack.uses; use++) steps.push(attack);
    });
    const perTen = Math.max(0, +incoming.per10 || 0);
    return {
      steps, interval: perTen > 0 ? 10 / perTen : Infinity, blockShare: Math.max(0, Math.min(1, (+incoming.blockPct || 0) / 100)),
      parryShare: Math.max(0, Math.min(1, (+incoming.parryPct || 0) / 100)), stun: Math.max(0, +incoming.stun || 0),
    };
  }

  const defaultIncoming = (enemy) => (enemy && enemy.attacks.length ? enemy.attacks.map((attack, index) => ({ a: index, n: 1 })) : [{ a: "c", n: 1, dmg: 20, types: { Physical: 1 } }]);

  function incomingStep(step, enemy) {
    const uses = Math.max(1, Math.round(+step.n || 1));
    if (step.a === "c") {
      const types = Object.entries(step.types || {}).filter(([, value]) => value > 0);
      const sum = types.reduce((total, [, value]) => total + value, 0) || 1;
      const damage = Math.max(0, +step.dmg || 0);
      const parts = Object.fromEntries((types.length ? types : [["Physical", 1]]).map(([type, value]) => [type, damage * value / (types.length ? sum : 1)]));
      return { name: step.name || "Custom hit", parts, hits: 1, guardbreak: !!step.guardbreak, uses };
    }
    const attack = enemy && enemy.attacks[step.a];
    return attack ? { name: attack.name, parts: { ...attack.parts }, hits: attack.hits || 1, guardbreak: !!attack.guardbreak, uses } : null;
  }

  Object.assign(window.VoxlEngine, { simulate, hitDetails, abilityPreview, listActions, buildActions, incomingFrom, defaultIncoming, incomingStep, newContext, runFight, average });
})();
