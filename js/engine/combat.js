(function () {
  const Expression = window.VoxlExpression;
  const Engine = window.VoxlEngine;

  const active = { context: null, hit: null };

  const statusAlive = (status, time) => status && status.until > time + 1e-9;
  const EMPTY = [];
  const SIDES = ["self", "target"];

  function sideStatus(side, idOrTag) {
    const context = active.context;
    if (!context) return null;
    const statuses = context[side].statuses;
    const direct = statuses[idOrTag];
    if (statusAlive(direct, context.time)) return direct;
    const definitions = context.profile.rules.core.statuses;
    let best = null;
    Object.entries(statuses).forEach(([id, status]) => {
      const definition = definitions[id];
      if (!definition || !statusAlive(status, context.time)) return;
      const tagged = (definition.tags || []).includes(idOrTag) || (idOrTag === "debuff" && definition.kind === "debuff") || (idOrTag === "buff" && definition.kind === "buff");
      if (tagged && (!best || status.potency > best.potency)) best = status;
    });
    return best;
  }

  function countKind(side, kind) {
    const context = active.context;
    const definitions = context.profile.rules.core.statuses;
    return Object.entries(context[side].statuses).filter(([id, status]) => definitions[id] && definitions[id].kind === kind && statusAlive(status, context.time)).length;
  }

  const RUNTIME_FUNCTIONS = {
    perk: (id) => (active.context ? active.context.profile.perks[id] || 0 : 0),
    hasSelf: (id) => !!sideStatus("self", id),
    hasTarget: (id) => !!sideStatus("target", id),
    selfPotency: (id) => { const status = sideStatus("self", id); return status ? status.potency : 0; },
    targetPotency: (id) => { const status = sideStatus("target", id); return status ? status.potency : 0; },
    selfDuration: (id) => { const status = sideStatus("self", id); return status ? status.until - active.context.time : 0; },
    targetDuration: (id) => { const status = sideStatus("target", id); return status ? status.until - active.context.time : 0; },
    counter: (id) => counterValue(active.context, id),
    counterFull: (id) => counterIsFull(active.context, id),
    counterStarted: (id) => !!(active.context.counters[id] && active.context.counters[id].started),
    potencyAmount: (dot) => potencyAmount(active.context, dot),
    potencyMultiplier: (dot) => potencyMultiplier(active.context, potencyAmount(active.context, dot)),
    hasType: (type, tag) => {
      const hit = active.hit;
      if (!hit || !hit.parts) return false;
      return hit.parts.some((part) => part.type === type && part.fraction > 0 && !part.noTriggers && !(Array.isArray(part.noTypeBonus) && tag && part.noTypeBonus.includes(tag)));
    },
    typeShare: (type) => {
      const hit = active.hit;
      if (!hit || !hit.parts) return 0;
      const total = hit.parts.reduce((sum, part) => sum + part.fraction, 0) || 1;
      return hit.parts.filter((part) => part.type === type).reduce((sum, part) => sum + part.fraction, 0) / total;
    },
    attackHasType: (type) => !!(active.hit && active.hit.attackTypes && active.hit.attackTypes[type] > 0),
    hitsInLast: (seconds) => {
      const context = active.context;
      return context.hitTimes.filter((time) => time > context.time - seconds - 1e-9).length;
    },
  };
  const FUNCTIONS = { ...Engine.MATH_FUNCTIONS, ...RUNTIME_FUNCTIONS };

  function evaluate(formula, variables, fallback) {
    if (formula === undefined || formula === null || formula === "") return fallback;
    if (typeof formula === "number" || typeof formula === "boolean") return formula;
    try {
      return Expression.compile(formula)({ variables, functions: FUNCTIONS });
    } catch (error) {
      if (active.context) active.context.errors.add(`${formula}: ${error.message}`);
      return fallback;
    }
  }
  const number = (formula, variables, fallback) => {
    const value = +evaluate(formula, variables, fallback === undefined ? 0 : fallback);
    return Number.isFinite(value) ? value : fallback === undefined ? 0 : fallback;
  };
  const condition = (formula, variables) => (formula === undefined ? true : Expression.truthy(evaluate(formula, variables, false)));

  function effectScope(entry, parentVariables, context) {
    const variables = Object.create(parentVariables);
    if (entry.sourceKind === "perk") variables.amount = entry.amount;
    else if (entry.sourceKind === "status") {
      const status = context[entry.side].statuses[entry.sourceId];
      variables.potency = status ? status.potency : 0;
    }
    return variables;
  }

  function seededRandom(seed) {
    let value = seed >>> 0;
    return () => {
      value = (value + 0x6d2b79f5) >>> 0;
      let mixed = Math.imul(value ^ (value >>> 15), 1 | value);
      mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
      return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
    };
  }

  function luckyChance(context, chance, noLucky) {
    const lucky = noLucky ? 0 : currentLucky(context);
    if (!lucky || chance >= 1 || chance <= 0) return Math.max(0, Math.min(1, chance));
    const reroll = context.profile.constants.luckyRerollShare * chance;
    const whole = Math.floor(lucky);
    return 1 - (1 - chance) * Math.pow(1 - reroll, whole) * (1 - reroll * (lucky - whole));
  }

  function roll(context, chance, noLucky) {
    if (chance >= 1) return true;
    if (chance <= 0) return false;
    return context.rng() < luckyChance(context, chance, noLucky);
  }

  function liveEffects(context, type) {
    const own = context.profile.effects[type] || EMPTY;
    const index = context.profile.statusEffects;
    let added = null;
    for (const side of SIDES) {
      const statuses = context[side].statuses;
      const sideKey = side === "self" ? "onSelf" : "onTarget";
      for (const id in statuses) {
        const definition = index[id];
        if (!definition) continue;
        const entries = definition[sideKey][type];
        if (!entries || !statusAlive(statuses[id], context.time)) continue;
        if (!added) added = [];
        for (const entry of entries) added.push({ effect: entry.effect, sourceKind: entry.sourceKind, sourceId: entry.sourceId, key: entry.key, amount: entry.amount, side });
      }
    }
    if (!added) return own;
    return own.concat(added).sort((a, b) => (a.effect.order || 0) - (b.effect.order || 0));
  }

  function passing(context, type, variables) {
    const result = [];
    for (const entry of liveEffects(context, type)) {
      const scope = effectScope(entry, variables, context);
      if (condition(entry.effect.when, scope)) result.push({ effect: entry.effect, sourceKind: entry.sourceKind, sourceId: entry.sourceId, key: entry.key, amount: entry.amount, side: entry.side, scope });
    }
    return result;
  }

  const effectLabel = (context, entry) => entry.effect.label ||
    (entry.sourceKind === "perk" ? ((window.VOXL_DATA.perks[entry.sourceId] || {}).name || entry.sourceId) : (context.profile.rules.core.statuses[entry.sourceId] || {}).name || entry.sourceId);

  function contextVariables(context) {
    const variables = Object.create(context.profile.variables);
    const stepCondition = (id) => (context.stepConditions && context.stepConditions[id] !== undefined ? context.stepConditions[id] : context.profile.conditions[id]);
    const getters = {
      time: () => context.time,
      selfHp: () => (context.options.simulateHp ? 100 * context.self.hp / context.self.maxHp : context.profile.conditions.selfHp),
      currentHp: () => context.self.hp,
      targetHp: () => (context.target.pool ? 100 * Math.max(0, context.target.hp) / context.target.maxHp : stepCondition("targetHp")),
      selfDebuffs: () => countKind("self", "debuff"),
      selfBuffs: () => countKind("self", "buff"),
      targetDebuffs: () => countKind("target", "debuff"),
      shieldHp: () => context.self.shield,
      summons: () => (context.minionMode ? context.minions.filter((minion) => minion.until > context.time).length : context.profile.conditions.summons),
      inSun: () => context.profile.conditions.sunSources >= 1 || !!sideStatus("self", "sunBlessed"),
      cleanseMultiplier: () => {
        const since = Math.floor(context.time - context.lastCleanse);
        return since >= 0 && since < 5 ? [4, 3, 3, 3, 2][since] : 1;
      },
      tenacity: () => context.profile.statVariables.tenacity + dynamicStat(context, "Tenacity"),
      naturalCritRaw: () => naturalCrit(context, active.hit ? active.hit.variables : variables).raw,
      naturalCrit: () => naturalCrit(context, active.hit ? active.hit.variables : variables).value,
      lastCroak: () => context.profile.conditions.lastCroak,
      gatheringTideStart: () => context.profile.variables.gatheringTideStart,
    };
    context.profile.rules.core.conditions.filter((condition) => condition.scope === "step" && !getters[condition.id])
      .forEach((condition) => { getters[condition.id] = () => stepCondition(condition.id); });
    Object.entries(getters).forEach(([name, getter]) => Object.defineProperty(variables, name, { get: getter, enumerable: true }));
    return variables;
  }

  function dynamicStat(context, stat) {
    return (context.profile.effects.dynamicStat || []).filter((entry) => entry.effect.stat === stat)
      .reduce((sum, entry) => sum + number(entry.effect.value, effectScope(entry, context.variables, context)), 0);
  }

  function currentLucky(context) {
    const variables = active.hit ? active.hit.variables : context.variables;
    return liveEffects(context, "lucky").reduce((sum, entry) => {
      const scope = effectScope(entry, variables, context);
      return condition(entry.effect.when, scope) ? sum + number(entry.effect.value, scope) : sum;
    }, 0);
  }

  function counterDefinition(context, id) {
    return (context.profile.effects.counter || []).find((entry) => entry.effect.id === id);
  }

  function counterState(context, id) {
    if (!context.counters[id]) {
      const definition = counterDefinition(context, id);
      const initial = definition && definition.effect.initial !== undefined ? number(definition.effect.initial, effectScope(definition, context.variables, context)) : 0;
      context.counters[id] = { value: initial, stacks: [], lockUntil: -1, started: false, startedAt: 0 };
    }
    const counter = context.counters[id];
    const definition = counterDefinition(context, id);
    if (counter.started && definition && definition.effect.duration && context.time >= counter.startedAt + definition.effect.duration) {
      Object.assign(counter, { value: 0, stacks: [], started: false });
    }
    return counter;
  }

  function counterValue(context, id) {
    const counter = counterState(context, id);
    const definition = counterDefinition(context, id);
    if (definition && definition.effect.stackDuration) {
      counter.stacks = counter.stacks.filter((until) => until > context.time);
      return counter.stacks.length;
    }
    return counter.value;
  }

  function counterMax(context, id) {
    const definition = counterDefinition(context, id);
    return definition ? number(definition.effect.max, effectScope(definition, context.variables, context), Infinity) : Infinity;
  }

  const counterIsFull = (context, id) => counterValue(context, id) >= counterMax(context, id) - 1e-9;

  function gainCounter(context, id, amount) {
    const counter = counterState(context, id);
    const definition = counterDefinition(context, id);
    if (!definition || context.time < counter.lockUntil) return;
    if (!counter.started) counter.startedAt = context.time;
    counter.started = true;
    if (definition.effect.stackDuration) {
      for (let index = 0; index < Math.round(amount); index++) counter.stacks.push(context.time + definition.effect.stackDuration);
      return;
    }
    const wasFull = counterIsFull(context, id);
    counter.value = Math.min(counterMax(context, id), counter.value + amount);
    if (!wasFull && counterIsFull(context, id) && !definition.effect.noFullTrigger) fireTrigger(context, "counterFull:" + id, context.variables);
  }

  function resetCounter(context, id) {
    const counter = counterState(context, id);
    const definition = counterDefinition(context, id);
    counter.value = 0;
    counter.stacks = [];
    counter.started = false;
    if (definition && definition.effect.lockout) counter.lockUntil = context.time + definition.effect.lockout;
  }

  function potencyAmount(context, dot) {
    return (context.profile.effects.dotPotency || []).filter((entry) => entry.effect.dot === dot)
      .reduce((sum, entry) => sum + number(entry.effect.value, effectScope(entry, context.variables, context)), 0);
  }

  function potencyMultiplier(context, amount) {
    return number(context.profile.rules.core.formulas.potencyMultiplier, { amount });
  }

  function matchesStatus(context, effect, statusId, side) {
    const definition = context.profile.rules.core.statuses[statusId] || {};
    if (effect.to && effect.to !== side) return false;
    if (effect.except && effect.except.includes(statusId)) return false;
    if (effect.status) return effect.status === statusId || (statusId === "whirlwind" && effect.status === "tailwind");
    if (effect.tag) return (definition.tags || []).includes(effect.tag);
    if (effect.kind) return definition.kind === effect.kind;
    return true;
  }

  function convertedStatus(context, statusId) {
    let id = statusId;
    for (let pass = 0; pass < 3; pass++) {
      const conversion = (context.profile.effects.statusConvert || []).find((entry) => entry.effect.from === id);
      if (!conversion) break;
      id = conversion.effect.to;
    }
    return id;
  }

  function applyStatus(context, side, requestedId, potencyIn, durationIn, info) {
    const definitions = context.profile.rules.core.statuses;
    const statusId = convertedStatus(context, requestedId);
    const definition = definitions[statusId];
    if (!definition) { context.errors.add(`Unknown status "${requestedId}"`); return; }
    const isDebuff = definition.kind === "debuff";
    const variables = context.variables;
    if (side === "self" && isDebuff) {
      if (passing(context, "debuffImmune", variables).length) return;
      const shield = passing(context, "debuffShield", variables).find((entry) => counterValue(context, entry.effect.counter) >= 1);
      if (shield) {
        const counter = counterState(context, shield.effect.counter);
        counter.value -= 1;
        (shield.effect.applies || []).forEach((apply) => applyStatus(context, "self", apply.status, number(apply.potency, shield.scope), number(apply.duration, shield.scope), {}));
        if (shield.effect.heal) healDirect(context, number(shield.effect.heal, shield.scope), "self", effectLabel(context, shield), { noBonus: false });
        return;
      }
    }
    let potency = potencyIn === undefined || potencyIn === null ? 0 : potencyIn;
    let duration = durationIn;
    if (!info.noPotencyBonus) {
      const basePotency = potency;
      const potencyEffects = passing(context, "statusPotency", Object.assign(Object.create(variables), { basePotency }))
        .filter((entry) => matchesStatus(context, entry.effect, statusId, side) && (!entry.effect.source || entry.effect.source === info.source)
          && (!entry.effect.selfInflictedOnly || info.selfInflicted));
      if (definition.dot && side === "target") potency += 0.1 * potencyAmount(context, definition.dot.potencyPerk || statusId);
      potencyEffects.forEach((entry) => {
        if (entry.effect.chance !== undefined && !roll(context, number(entry.effect.chance, entry.scope))) return;
        if (entry.effect.add !== undefined) potency += number(entry.effect.add, entry.scope);
      });
      potencyEffects.forEach((entry) => { if (entry.effect.multiplier !== undefined) potency *= number(entry.effect.multiplier, entry.scope, 1); });
      potencyEffects.forEach((entry) => { if (entry.effect.finalAdd !== undefined) potency += number(entry.effect.finalAdd, entry.scope); });
      if (side === "self" && isDebuff) {
        const warding = context.profile.statVariables.warding;
        potency = warding >= 0 ? potency / (1 + warding / 100) : potency * (1 + Math.abs(warding) / 100);
      }
    }
    if (definition.maxPotency !== undefined) potency = Math.min(potency, definition.maxPotency);
    if (!info.noDurationBonus) {
      const durationEffects = passing(context, "statusDuration", variables).filter((entry) => matchesStatus(context, entry.effect, statusId, side));
      durationEffects.forEach((entry) => { if (entry.effect.multiplier !== undefined) duration *= number(entry.effect.multiplier, entry.scope, 1); });
      durationEffects.forEach((entry) => { if (entry.effect.add !== undefined) duration += number(entry.effect.add, entry.scope); });
    }
    if (!(duration > 0)) return;
    const statuses = context[side].statuses;
    const existing = statuses[statusId];
    const had = statusAlive(existing, context.time);
    if (had) {
      existing.potency = Math.max(existing.potency, potency);
      existing.until = Math.max(existing.until, context.time + duration);
      if (info.setPotency) existing.potency = potency;
    } else {
      statuses[statusId] = { potency, until: context.time + duration, since: context.time, source: info.sourceName || "", amplified: 0 };
    }
    const tally = context.report.applications;
    const key = `${side}:${statusId}`;
    tally[key] = tally[key] || { count: 0, sources: {} };
    tally[key].count++;
    if (info.sourceName) tally[key].sources[info.sourceName] = (tally[key].sources[info.sourceName] || 0) + 1;
    const step = context.stepIndex >= 0 ? context.report.steps[context.stepIndex] : null;
    if (step && side === "target") step.applied[statusId] = (step.applied[statusId] || 0) + 1;
    const triggerVariables = Object.assign(Object.create(context.variables), { appliedPotency: potency, targetHadStatus: had, gainedDuration: duration });
    if (side === "target") {
      fireTrigger(context, "apply:" + statusId, triggerVariables);
      (context.profile.effects.countsAsApply || []).filter((entry) => entry.effect.from === statusId).forEach((entry) => {
        fireTrigger(context, "apply:" + entry.effect.as, Object.assign(Object.create(context.variables), { appliedPotency: entry.effect.potency || 0, targetHadStatus: false }));
      });
      if (statusId === "bleed") autoSpirit(context, "applyBleed");
    } else {
      fireTrigger(context, "gain:" + statusId, triggerVariables);
      if (isDebuff) fireTrigger(context, "gainDebuff", triggerVariables);
    }
  }

  function removeStatus(context, side, statusId, stackAmount) {
    const status = context[side].statuses[statusId];
    if (!statusAlive(status, context.time)) return false;
    if (stackAmount) {
      status.potency -= stackAmount;
      if (status.potency > 1e-9) return true;
    }
    delete context[side].statuses[statusId];
    return true;
  }

  function applySpec(context, spec, side, scope, info) {
    if (spec.when !== undefined && !condition(spec.when, scope)) return;
    if (spec.chance !== undefined && !roll(context, number(spec.chance, scope))) return;
    if (spec.all) { spec.all.forEach((child) => applySpec(context, child, side, scope, info)); return; }
    if (spec.oneOf) { applySpec(context, spec.oneOf[Math.floor(context.rng() * spec.oneOf.length)], side, scope, info); return; }
    if (spec.randomDebuffs) {
      const pool = context.profile.rules.attacks.randomDebuffs;
      for (let index = 0; index < spec.randomDebuffs; index++) {
        const pick = pool[Math.floor(context.rng() * pool.length)];
        applySpec(context, { ...pick, duration: spec.duration || pick.duration }, side, scope, info);
      }
      return;
    }
    const apply = () => applyStatus(context, side, spec.status, number(spec.potency, scope, 0), number(spec.duration, scope, 5), { ...info, noPotencyBonus: spec.noPotencyBonus || info.noPotencyBonus });
    const delay = number(spec.delay, scope, 0);
    if (delay > 0) schedule(context, context.time + delay, apply);
    else apply();
  }

  function typesFromSpec(context, spec, scope, usesWeapon, attackVariables) {
    if (spec === undefined || spec === null || spec === "weapon") return weaponTypesFor(context, attackVariables || scope);
    if (spec === "highest") return { [context.profile.variables.weaponHighestType]: 1 };
    if (typeof spec === "string") {
      const text = String(evaluate(spec, scope, ""));
      if (context.profile.rules.core.damageTypes.includes(text)) return { [text]: 1 };
      const types = {};
      text.split(",").forEach((pair) => { const [type, value] = pair.split(":"); if (type) types[type.trim()] = +value || 1; });
      return types;
    }
    const types = {};
    Object.entries(spec).forEach(([type, value]) => { types[type] = number(value, scope); });
    return types;
  }

  function weaponTypesFor(context, variables) {
    const types = { ...context.profile.weaponTypes };
    passing(context, "weaponType", variables).forEach((entry) => {
      types[entry.effect.damageType] = (types[entry.effect.damageType] || 0) + number(entry.effect.value, entry.scope);
    });
    passing(context, "weaponConvert", variables).forEach((entry) => {
      const moved = (types[entry.effect.from] || 0) * Math.min(1, number(entry.effect.fraction, entry.scope));
      if (!moved) return;
      types[entry.effect.from] -= moved;
      types[entry.effect.to] = (types[entry.effect.to] || 0) + moved;
    });
    return types;
  }

  function scalingsFromSpec(context, spec, scope) {
    if (spec === undefined || spec === null || spec === "weapon") return { ...context.profile.weaponScalings };
    const highest = context.profile.variables.weaponHighestType === "True" ? "Magic" : context.profile.variables.weaponHighestType;
    if (spec === "highest") return { [highest]: 1 };
    const scalings = {};
    Object.entries(spec).forEach(([name, value]) => {
      const key = name === "highest" ? highest : name;
      scalings[key] = (scalings[key] || 0) + number(value, scope);
    });
    return scalings;
  }

  function boostMultiplier(context, scalings) {
    const stats = context.profile.stats;
    return 1 + Object.entries(scalings).reduce((sum, [name, value]) => sum + (name === "Protection" ? value * (stats.Protection || 0) : value * (stats[name + " Boost"] || 0) / 100), 0);
  }

  function armorMultiplier(defensePercent, penetrationPercent, constants) {
    const defense = defensePercent / 100;
    const penetration = penetrationPercent / 100;
    if (defense <= penetration + constants.armorPenThreshold / 100) {
      const armor = defense - penetration;
      return armor > 0 ? 1 / (1 + armor) : 1 - armor;
    }
    return 1 / (1 + defense / (1 + constants.armorPenDivisorFactor * penetration));
  }

  function naturalCrit(context, variables) {
    const dexterity = passing(context, "noDexterityCrit", variables).length ? 0 : context.profile.statVariables.dexterityBoost / context.profile.constants.dexterityPerCritPercent;
    const raw = Math.max(0, dexterity + passing(context, "critChance", variables).reduce((sum, entry) => sum + number(entry.effect.value, entry.scope), 0));
    const multiplier = passing(context, "critChanceMultiplier", variables).reduce((product, entry) => product * number(entry.effect.value, entry.scope, 1), 1);
    return { raw, value: raw * multiplier };
  }

  function hitVariables(context, attack, group, hit) {
    const variables = Object.create(context.variables);
    const formRule = attack.isM1 ? context.profile.form.m1Rule : context.profile.form.m2Rule;
    const formName = attack.form || "";
    Object.assign(variables, {
      kind: attack.kind, isM1: !!attack.isM1, isM2: !!attack.isM2, isWeapon: !!(attack.isM1 || attack.isM2), isFinisher: !!attack.finisher,
      isArt: attack.kind === "art" || !!attack.countsAsArt || (attack.artShare && hit.index % 2 === 0), isRune: attack.kind === "rune", isSpirit: !!attack.spiritId, isDot: attack.kind === "dot",
      isProc: !!attack.isProc, isEcho: !!attack.isEcho, canProc: hit.procCoef > 0, procCoef: hit.procCoef, form: formName,
      formHasFinisher: !(formRule && formRule.noM1Finisher), unbalancedForm: !!(formRule && formRule.unbalanced), piercerFullForm: !!(formRule && formRule.piercerFull),
      oneHandedForm: !!(formRule && formRule.oneHanded),
      isSlamWeapon: !!((attack.isM1 && attack.finisher && formRule && formRule.slamFinisher) || (attack.isM2 && formRule && formRule.slamM2)),
      isSlam: !!(attack.slam || (attack.isM1 && attack.finisher && formRule && formRule.slamFinisher) || (attack.isM2 && formRule && formRule.slamM2)),
      artId: attack.artId || "", runeId: attack.runeId || "", spiritId: attack.spiritId || "", dotId: attack.dotId || "",
      chain: attack.chain || 1, finisherHit: hit.finisherHit || 0, finisherHits: hit.finisherHits || 0,
      finisherProcRate: attack.isM2 && context.profile.form.m2Rule && context.profile.form.m2Rule.halfFinisherProcs ? 0.5 : 1,
      guardbreak: !!(group.guardbreak || attack.guardbreak || hit.guardbreak), crit: false, wouldCrit: false,
      baseCooldown: attack.baseCooldown || 0, hitsLanded: attack.hitsLanded || 0, noSavageCombo: !!attack.noSavageCombo, noThief: !!attack.noThief,
      castEnergized: !!attack.marks && !!attack.marks.castEnergized, isCastStart: false, castingArt: false,
      noAddedTypes: !!attack.noAddedTypes, hitBase: hit.base || 0, hitPreBonus: 0, attackPreBonus: attack.parentPreBonus || 0,
      dotNoAoe: !!attack.noAoe, poisonDuration: 5,
    });
    if (attack.consumed) Object.keys(attack.consumed).forEach((id) => { variables["consumed" + id.charAt(0).toUpperCase() + id.slice(1)] = true; });
    if (attack.amount !== undefined) variables.amount = attack.amount;
    return variables;
  }

  function resolveHit(context, attack, group, hitInfo) {
    const constants = context.profile.constants;
    const previousHit = active.hit;
    const hit = { index: hitInfo.index, finisherHit: hitInfo.finisherHit, finisherHits: hitInfo.finisherHits, procCoef: attack.procCoef, guardbreak: false, consumed: {} };
    active.hit = hit;
    const variables = hitVariables(context, attack, group, hit);
    hit.variables = variables;
    const attackScope = attack.scope ? Object.assign(Object.create(variables), attack.scope) : variables;

    let base = number(group.base, attackScope) * (attack.baseMultiplier || 1);
    hit.base = base;
    variables.hitBase = base;

    const usesWeapon = group.types === undefined && (attack.types === undefined || attack.types === null || attack.types === "weapon");
    let typeSpec = group.types !== undefined ? group.types : attack.types;
    if (group.randomType) typeSpec = { [group.randomType[Math.floor(context.rng() * group.randomType.length)]]: 1 };
    const baseTypes = typesFromSpec(context, typeSpec, attackScope, usesWeapon, variables);
    hit.attackTypes = attack.attackTypes || baseTypes;
    hit.parts = Object.entries(baseTypes).filter(([, fraction]) => fraction > 0).map(([type, fraction]) => ({ type, fraction }));
    if (!attack.noAddedTypes) {
      passing(context, "addType", variables).forEach((entry) => {
        const typeName = context.profile.rules.core.damageTypes.includes(entry.effect.damageType) ? entry.effect.damageType : String(evaluate(entry.effect.damageType, entry.scope, ""));
        const fraction = number(entry.effect.value, entry.scope);
        if (fraction > 0 && typeName) hit.parts.push({ type: typeName, fraction, noTriggers: !!entry.effect.noTriggers, noTypeBonus: entry.effect.noTypeBonus, source: entry.sourceId });
      });
    }

    const scalings = scalingsFromSpec(context, group.scalings !== undefined ? group.scalings : attack.scalings, attackScope);
    const boost = boostMultiplier(context, scalings);
    const levelMultiplier = attack.noLevel ? 1 : 1 + constants.levelBonusPerLevel * context.profile.level;
    const preBonus = base * boost * levelMultiplier + number(attack.addPreBonus, attackScope, 0);
    variables.hitPreBonus = preBonus;

    const bonuses = [];
    let bonus = 1;
    if (!attack.noBonus) {
      liveEffects(context, "damage").forEach((entry) => {
        const scope = effectScope(entry, variables, context);
        if (!condition(entry.effect.when, scope)) return;
        if (entry.effect.chance !== undefined && !roll(context, number(entry.effect.chance, scope))) return;
        const value = number(entry.effect.value, scope, 1);
        if (entry.effect.grantsGuardbreak) { hit.guardbreak = true; variables.guardbreak = true; }
        if (entry.effect.consumeTarget) {
          removeStatus(context, "target", entry.effect.consumeTarget, entry.effect.consumeStack);
          hit.consumed[entry.effect.consumeTarget] = true;
          variables["consumed" + entry.effect.consumeTarget.charAt(0).toUpperCase() + entry.effect.consumeTarget.slice(1)] = true;
        }
        if (value !== 1) { bonus *= value; bonuses.push([effectLabel(context, entry), value]); }
      });
    }
    let reduced = 1;
    passing(context, "damageReduced", variables).forEach((entry) => {
      const value = number(entry.effect.value, entry.scope, 1);
      if (value !== 1) { reduced *= value; bonuses.push([effectLabel(context, entry), value]); }
    });
    const pre = preBonus * bonus * reduced;

    const typeEffects = passing(context, "typeMultiplier", variables);
    const amounts = {};
    const typeMultipliers = {};
    hit.parts.forEach((part) => {
      const multiplier = typeEffects.reduce((product, entry) => {
        if (!entry.effect.types.includes(part.type)) return product;
        if (part.noTypeBonus === true) return product;
        if (Array.isArray(part.noTypeBonus) && (part.noTypeBonus.includes(entry.sourceId) || part.noTypeBonus.includes(entry.effect.tag))) return product;
        return product * number(entry.effect.value, entry.scope, 1);
      }, 1);
      amounts[part.type] = (amounts[part.type] || 0) + pre * part.fraction * multiplier;
      typeMultipliers[part.type] = multiplier;
    });
    passing(context, "convertType", variables).forEach((entry) => {
      const fraction = Math.min(1, number(entry.effect.fraction, entry.scope));
      const sources = entry.effect.from === "*" ? Object.keys(amounts).filter((type) => type !== entry.effect.to) : [entry.effect.from];
      sources.forEach((type) => {
        const moved = (amounts[type] || 0) * fraction;
        if (!moved) return;
        amounts[type] -= moved;
        amounts[entry.effect.to] = (amounts[entry.effect.to] || 0) + moved;
      });
    });
    passing(context, "swapType", variables).forEach((entry) => {
      const fraction = number(entry.effect.fraction, entry.scope);
      const first = amounts[entry.effect.a] || 0;
      const second = amounts[entry.effect.b] || 0;
      if (!first && !second) return;
      amounts[entry.effect.a] = first * (1 - fraction) + second * fraction;
      amounts[entry.effect.b] = second * (1 - fraction) + first * fraction;
    });
    const preCrit = Object.values(amounts).reduce((sum, value) => sum + value, 0);

    const crit = attack.canCrit === false ? { isCrit: false, multiplier: 1, bonus: 1, chance: 0 } : rollCrit(context, attack, group, variables, hit);
    variables.crit = crit.isCrit;
    const critFactor = crit.isCrit ? crit.multiplier * crit.bonus : 1;

    const armor = armorForHit(context, variables, amounts);
    const byType = {};
    let total = 0;
    Object.entries(amounts).forEach(([type, value]) => {
      if (!(value > 0)) return;
      byType[type] = value * critFactor * armor[type];
      total += byType[type];
    });
    if (context.options.trace && !context.traced && !attack.isProc && !attack.isEcho) {
      context.traced = { base, scalings, boost, levelMultiplier, bonuses, bonus: bonus * reduced, parts: hit.parts, amounts, typeMultipliers, crit, armor, total, pre, preCrit };
    }
    active.hit = previousHit;
    return { total, byType, crit: crit.isCrit, pre, preBonus, preCrit, amounts, hit, variables, guardbreak: variables.guardbreak };
  }

  function rollCrit(context, attack, group, variables, hit) {
    const constants = context.profile.constants;
    const settingsCrit = context.profile.settings.crit;
    const natural = naturalCrit(context, variables);
    const procBoost = Math.max(1, hit.procCoef || 0);
    let wouldCrit = false;
    if (!passing(context, "disableNaturalCrit", variables).length) {
      const chance = Math.min(1, natural.value / 100 * procBoost);
      wouldCrit = constants.luckyAffectsCrit ? roll(context, chance) : context.rng() < chance;
    }
    passing(context, "critRoll", variables).forEach((entry) => {
      if (!wouldCrit && context.rng() < Math.min(1, number(entry.effect.value, entry.scope) * procBoost)) wouldCrit = true;
    });
    variables.wouldCrit = wouldCrit;
    let isCrit = wouldCrit || !!group.forceCrit;
    let bonus = 1;
    passing(context, "forceCrit", variables).forEach((entry) => {
      isCrit = true;
      if (entry.effect.bonus !== undefined) bonus *= number(entry.effect.bonus, entry.scope, 1);
      if (entry.effect.consume) removeStatus(context, entry.side || "self", entry.effect.consume);
      if (entry.effect.consumeTarget) {
        removeStatus(context, "target", entry.effect.consumeTarget);
        hit.consumed[entry.effect.consumeTarget] = true;
        variables["consumed" + entry.effect.consumeTarget.charAt(0).toUpperCase() + entry.effect.consumeTarget.slice(1)] = true;
      }
    });
    if (settingsCrit === "always") isCrit = true;
    if (settingsCrit === "never") isCrit = false;
    variables.crit = isCrit;
    const multiplier = Math.max(1, constants.baseCritMultiplier + natural.value / 100 +
      passing(context, "critDamage", variables).reduce((sum, entry) => sum + number(entry.effect.value, entry.scope), 0));
    if (isCrit) {
      passing(context, "critBonus", variables).forEach((entry) => {
        if (entry.effect.chance !== undefined && context.rng() >= number(entry.effect.chance, entry.scope)) return;
        bonus *= number(entry.effect.value, entry.scope, 1);
      });
    }
    return { isCrit, multiplier, bonus, chance: natural.value };
  }

  function armorForHit(context, variables, amounts) {
    const rules = context.profile.rules;
    const target = context.target.defenses;
    const penetrationStat = context.profile.statVariables.armorPenetration;
    const penEffects = passing(context, "armorPen", variables).reduce((sum, entry) => sum + number(entry.effect.value, entry.scope), 0);
    const ofDefense = passing(context, "armorPenOfDefense", variables).reduce((sum, entry) => sum + number(entry.effect.value, entry.scope), 0);
    const reductions = passing(context, "armorReduction", variables);
    const ignore = passing(context, "ignoreDefense", variables).length > 0;
    const result = {};
    Object.keys(amounts).forEach((type) => {
      if (type === "True") { result[type] = 1; return; }
      const group = rules.core.typeGroups[type] || "Magic";
      let defense = (target[group] || 0) + (type !== group ? target[type] || 0 : 0);
      const debuffPen = reductions.filter((entry) => !entry.effect.group || entry.effect.group === group).reduce((sum, entry) => sum + number(entry.effect.value, entry.scope), 0);
      let penetration = penetrationStat + penEffects + debuffPen + (defense > 0 ? ofDefense * defense : 0);
      if (ignore) defense = Math.min(defense, 0);
      result[type] = armorMultiplier(defense, penetration, context.profile.constants);
    });
    return result;
  }

  function record(context, source, name, result) {
    const report = context.report;
    report.damage += result.total;
    report.bySource[source] = (report.bySource[source] || 0) + result.total;
    report.byName[name] = (report.byName[name] || 0) + result.total;
    if (["proc", "echo", "dot", "aura", "minion"].includes(source)) report.byProc[name] = (report.byProc[name] || 0) + result.total;
    Object.entries(result.byType).forEach(([type, value]) => { report.byType[type] = (report.byType[type] || 0) + value; });
    const bin = Math.max(0, Math.floor(context.time + 1e-9));
    const bins = report.bins;
    while (bins.length <= bin) bins.push({});
    const sourceBin = bins[bin][source] || (bins[bin][source] = {});
    sourceBin[name || source] = (sourceBin[name || source] || 0) + result.total;
    const step = context.stepIndex >= 0 ? report.steps[context.stepIndex] : null;
    if (step && !["dot", "aura", "minion"].includes(source)) step.damage += result.total;
    if (step && ["proc", "echo"].includes(source)) step.extra[name || source] = (step.extra[name || source] || 0) + result.total;
    if (context.target.pool) {
      context.target.hp -= result.total;
      if (context.target.hp <= 0 && !context.target.dead) {
        context.target.dead = true;
        report.killTime = report.killTime === null ? context.time : report.killTime;
        fireTrigger(context, "kill", context.variables);
      }
    }
  }

  function expandGroups(context, attack, scope) {
    return (attack.hits || []).map((group) => {
      if (Array.isArray(group)) return { base: group[0], count: Math.max(0, Math.round(number(group[1], scope, 1))) };
      return { ...group, count: Math.max(0, Math.round(number(group.count === undefined ? 1 : group.count, scope, 1))) };
    }).filter((group) => group.count > 0);
  }

  function executeAttack(context, attack, options) {
    const scope = attack.scope ? Object.assign(Object.create(context.variables), attack.scope) : context.variables;
    const groups = expandGroups(context, attack, scope);
    let countMultiplier = 1;
    let damageMultiplier = 1;
    if (attack.isM1 || attack.isM2) {
      const probe = hitVariables(context, attack, {}, { procCoef: attack.procCoef });
      passing(context, "hitMultiplier", probe).forEach((entry) => {
        countMultiplier *= number(entry.effect.count, entry.scope, 1);
        damageMultiplier *= number(entry.effect.damage, entry.scope, 1);
      });
      passing(context, "procCoefficient", probe).forEach((entry) => { attack.procCoef *= number(entry.effect.value, entry.scope, 1); });
    }
    const jobs = [];
    groups.forEach((group) => {
      const scaledGroup = damageMultiplier !== 1 ? { ...group, base: number(group.base, scope) * damageMultiplier } : group;
      for (let repeat = 0; repeat < Math.round(group.count * countMultiplier); repeat++) jobs.push(scaledGroup);
    });
    const totalHits = jobs.length;
    const spread = number(attack.spread, scope, 0);
    const startTime = context.time;
    const isFinisher = attack.finisher || attack.eachHitFinisher;
    attack.hitsLanded = 0;
    attack.stepIndex = context.stepIndex;
    let damage = 0;
    const runHit = (group, index) => {
      const result = resolveHit(context, attack, group, { index, finisherHit: isFinisher ? index : 0, finisherHits: isFinisher ? totalHits : 0 });
      record(context, attack.source, attack.name, result);
      damage += result.total;
      attack.hitsLanded++;
      if (index === 1) {
        attack.parentPreBonus = result.preBonus;
        (attack.applies || []).filter((spec) => !spec.perHit).forEach((spec) => applySpec(context, spec, "target", scope, { sourceName: attack.name }));
      }
      afterHit(context, attack, result, index, totalHits);
    };
    const finish = () => {
      if (options && options.noAttackTrigger) return;
      const attackVariables = hitVariables(context, attack, {}, { procCoef: attack.procCoef });
      attackVariables.hitsLanded = attack.hitsLanded;
      attackVariables.attackPreBonus = attack.parentPreBonus || 0;
      if (!attack.isProc && !attack.isEcho && attack.kind !== "dot") fireTrigger(context, "attack", attackVariables);
      if (attack.finisher && !attack.eachHitFinisher && attack.hitsLanded) fireTrigger(context, "finisher", attackVariables);
      if (options && options.onFinish) options.onFinish(attack);
    };
    if (spread > 0 && totalHits > 1) {
      jobs.forEach((group, position) => {
        schedule(context, startTime + spread * (position + 0.5) / totalHits, () => {
          const savedStep = context.stepIndex;
          context.stepIndex = attack.stepIndex;
          runHit(group, position + 1);
          if (position === totalHits - 1) finish();
          context.stepIndex = savedStep;
        });
      });
      return { damage, hits: totalHits, delayed: true };
    }
    jobs.forEach((group, position) => runHit(group, position + 1));
    finish();
    return { damage, hits: attack.hitsLanded };
  }

  function afterHit(context, attack, result, index, totalHits) {
    const variables = result.variables;
    active.hit = result.hit;
    (attack.applies || []).filter((spec) => spec.perHit).forEach((spec) => applySpec(context, spec, "target", variables, { sourceName: attack.name }));
    passing(context, "lifesteal", variables).forEach((entry) => {
      const stage = entry.effect.stage || "final";
      const damage = stage === "preCrit" ? result.preCrit : stage === "preType" ? result.pre : stage === "preBonus" ? result.preBonus : result.total;
      const amount = number(entry.effect.fraction, entry.scope) * damage + number(entry.effect.flat, entry.scope, 0);
      if (amount > 0) heal(context, amount, "self", effectLabel(context, entry), { lifesteal: true, noScaling: true, noLevel: true, canProcHeal: false });
    });
    if (result.hit.procCoef > 0 || attack.kind === "dot") runEchoes(context, attack, result, index);
    if (result.hit.procCoef > 0 && attack.kind !== "dot") {
      context.hitTimes.push(context.time);
      if (context.hitTimes.length > 200) context.hitTimes.splice(0, 100);
      context.report.hits++;
      if (result.crit) context.report.crits++;
      fireTrigger(context, "hit", variables);
      if (result.crit) fireTrigger(context, "crit", variables);
      if (attack.finisher || attack.eachHitFinisher) fireTrigger(context, "finisherHit", variables);
      if (attack.eachHitFinisher) fireTrigger(context, "finisher", variables);
    }
    active.hit = null;
  }

  function runEchoes(context, attack, result, index) {
    if (attack.isEcho || context.depth > context.profile.constants.procChainDepth) return;
    passing(context, "echo", result.variables).forEach((entry) => {
      const effect = entry.effect;
      if (attack.kind === "dot") return;
      if (effect.oncePerAttack && index > 1) return;
      if (effect.cooldown && !procReady(context, entry.key, number(effect.cooldown, entry.scope))) return;
      if (effect.chance !== undefined) {
        if (!roll(context, Math.min(1, number(effect.chance, entry.scope)))) return;
      }
      const count = Math.max(0, Math.round(number(effect.count, entry.scope, 1)));
      const stageDamage = effect.stage === "preCrit" ? result.preCrit : result.pre;
      const echoAttack = {
        kind: "proc", isEcho: true, isProc: true, name: effectLabel(context, entry), source: "echo", procCoef: 0, types: effect.types, scalings: {},
        hits: [{ base: number(effect.fraction, entry.scope) * stageDamage, count, preTyped: effect.stage === "preCrit" }], noAddedTypes: true,
        noBonus: true, noLevel: true, guardbreak: !!effect.guardbreak, spread: effect.spread, preTyped: effect.stage === "preCrit",
      };
      context.depth++;
      const fire = () => echoHits(context, echoAttack);
      const delay = number(effect.delay, entry.scope, 0);
      if (delay > 0) schedule(context, context.time + delay, fire);
      else fire();
      context.depth--;
      fireTrigger(context, "echo:" + effectLabel(context, entry), result.variables);
    });
  }

  function echoHits(context, echoAttack) {
    const group = echoAttack.hits[0];
    const spread = number(echoAttack.spread, context.variables, 0);
    const stepIndex = context.stepIndex;
    const fireOne = (index) => {
      const previousHit = active.hit;
      const hit = { index: index + 1, procCoef: 0, consumed: {} };
      active.hit = hit;
      const variables = hitVariables(context, echoAttack, group, hit);
      hit.variables = variables;
      hit.parts = Object.entries(echoAttack.types).map(([type, fraction]) => ({ type, fraction }));
      const amounts = {};
      const typeEffects = echoAttack.preTyped ? [] : passing(context, "typeMultiplier", variables);
      hit.parts.forEach((part) => {
        const multiplier = typeEffects.reduce((product, typeEntry) => (typeEntry.effect.types.includes(part.type) ? product * number(typeEntry.effect.value, typeEntry.scope, 1) : product), 1);
        amounts[part.type] = (amounts[part.type] || 0) + group.base * part.fraction * multiplier;
      });
      const crit = rollCrit(context, echoAttack, group, variables, hit);
      const armor = armorForHit(context, variables, amounts);
      const byType = {};
      let total = 0;
      Object.entries(amounts).forEach(([type, value]) => {
        if (!(value > 0)) return;
        byType[type] = value * (crit.isCrit ? crit.multiplier * crit.bonus : 1) * armor[type];
        total += byType[type];
      });
      active.hit = previousHit;
      const savedStep = context.stepIndex;
      context.stepIndex = stepIndex;
      record(context, "echo", echoAttack.name, { total, byType });
      context.stepIndex = savedStep;
    };
    for (let index = 0; index < group.count; index++) {
      if (spread > 0) schedule(context, context.time + spread * (index + 0.5) / group.count, () => fireOne(index));
      else fireOne(index);
    }
  }

  function procReady(context, key, cooldown) {
    if (!cooldown) return true;
    const ready = context.procReady[key];
    if (ready !== undefined && context.time < ready - 1e-9) return false;
    context.procReady[key] = context.time + cooldown;
    return true;
  }

  const HIT_TRIGGERS = ["hit", "crit", "finisherHit"];

  function fireTrigger(context, trigger, variables) {
    if (context.depth > context.profile.constants.procChainDepth + 2) return;
    context.depth++;
    const triggered = [];
    Object.entries(context.profile.effects).forEach(([type, list]) => list.forEach((entry) => { if (entry.effect.trigger === trigger) triggered.push(entry); }));
    const index = context.profile.statusEffects;
    ["self", "target"].forEach((side) => {
      const sideKey = side === "self" ? "onSelf" : "onTarget";
      Object.entries(context[side].statuses).forEach(([id, status]) => {
        if (!statusAlive(status, context.time) || !index[id]) return;
        Object.values(index[id][sideKey]).forEach((list) => list.forEach((entry) => { if (entry.effect.trigger === trigger) triggered.push({ ...entry, side }); }));
      });
    });
    (context.profile.effects.counter || []).forEach((entry) => {
      const gain = entry.effect.gain;
      if (gain && gain.trigger === trigger) triggered.push({ ...entry, counterGain: true });
    });
    (context.profile.effects.counterGain || []).forEach((entry) => { if (entry.effect.trigger === trigger) triggered.push({ ...entry, counterGain: true, extraGain: true }); });
    triggered.forEach((entry) => runTriggered(context, entry, trigger, variables));
    context.depth--;
  }

  function runTriggered(context, entry, trigger, variables) {
    const effect = entry.effect;
    const scope = effectScope(entry, variables, context);
    if (entry.counterGain) {
      const gain = entry.extraGain ? effect : effect.gain;
      if (!condition(gain.when, scope)) return;
      gainCounter(context, entry.extraGain ? effect.id : effect.id, number(gain.amount, scope, 1));
      return;
    }
    if (!condition(effect.when, scope)) return;
    if (effect.every && trigger === "second") {
      const every = number(effect.every, scope, 1);
      if (Math.round(context.time) % Math.max(1, Math.round(every)) !== 0) return;
    }
    if (effect.chance !== undefined) {
      let chance = number(effect.chance, scope);
      if (HIT_TRIGGERS.includes(trigger) && !effect.ignoreProcCoef) chance *= Math.max(0, scope.procCoef === undefined ? 1 : scope.procCoef);
      if (!roll(context, Math.min(1, chance), effect.noLucky)) return;
    }
    if (effect.cooldown !== undefined && effect.type !== "proc" && !procReady(context, entry.key, number(effect.cooldown, scope))) return;
    switch (effect.type) {
      case "applyStatus": {
        const side = effect.to === "self" ? "self" : "target";
        applySpec(context, effect, side, scope, { sourceName: effectLabel(context, entry), selfInflicted: effect.selfInflicted, noPotencyBonus: effect.noPotencyBonus, noDurationBonus: effect.noDurationBonus, setPotency: false });
        if (effect.resetCounter) resetCounter(context, effect.resetCounter);
        if (effect.alsoAllies) context.report.allyBuffs[effect.status || "?"] = (context.report.allyBuffs[effect.status || "?"] || 0) + 1;
        break;
      }
      case "statusGain": {
        const amount = number(effect.amount, scope);
        const status = context.self.statuses[effect.status];
        const current = statusAlive(status, context.time) ? status.potency : 0;
        const max = number(effect.max, scope, Infinity);
        const potency = Math.min(max, current + amount);
        const duration = number(effect.duration, scope, 5);
        if (statusAlive(status, context.time)) { status.potency = potency; status.until = Math.max(status.until, context.time + duration); }
        else applyStatus(context, "self", effect.status, potency, duration, { sourceName: effectLabel(context, entry), noPotencyBonus: true });
        break;
      }
      case "proc": runProc(context, entry, scope); break;
      case "heal": healFromEffect(context, entry, scope); break;
      case "consume": removeStatus(context, effect.from === "self" ? "self" : "target", effect.status); break;
      case "counterReset": resetCounter(context, effect.id); break;
      case "cooldownFlat": reduceCooldown(context, effect.ability, number(effect.value, scope), "flat"); break;
      case "cooldownPercent": reduceCooldown(context, effect.ability, number(effect.value, scope), "percent"); break;
      case "selfDamage": takeSelfDamage(context, number(effect.value, scope), effect.types || { True: 1 }, effectLabel(context, entry)); break;
      case "debuffAmplify": amplifyDebuffs(context, effect, scope); break;
      case "markCast": {
        if (context.currentAttack) context.currentAttack.marks = { ...(context.currentAttack.marks || {}), [effect.mark]: true };
        if (effect.resetCounter) resetCounter(context, effect.resetCounter);
        break;
      }
      default: break;
    }
  }

  function runProc(context, entry, scope) {
    const effect = entry.effect;
    if (context.depth > context.profile.constants.procChainDepth) return;
    if (effect.cooldown !== undefined && !procReady(context, entry.key, number(effect.cooldown, scope))) return;
    const count = Math.max(0, Math.round(number(effect.count, scope, 1)));
    const label = effectLabel(context, entry);
    for (let repeat = 0; repeat < count; repeat++) {
      const definition = effect.oneOf ? effect.oneOf[Math.floor(context.rng() * effect.oneOf.length)] : effect.attack;
      if (!definition) continue;
      const attack = procAttack(context, definition, entry, scope, label);
      executeAttack(context, attack, { noAttackTrigger: true });
      if (effect.applies && attack.hitsLanded) effect.applies.forEach((spec) => applySpec(context, spec, "target", attack.scope ? Object.assign(Object.create(scope), attack.scope) : scope, { sourceName: label }));
      fireTrigger(context, "proc:" + entry.sourceId, scope);
    }
    if (effect.consumeSelf) removeStatus(context, "self", effect.consumeSelf);
    if (effect.consumeTarget) removeStatus(context, "target", effect.consumeTarget);
    if (effect.resetCounter) resetCounter(context, effect.resetCounter);
    if (effect.gainCounter) gainCounter(context, effect.gainCounter, 1);
    if (effect.cleanse) cleanse(context);
  }

  function procAttack(context, definition, entry, scope, label) {
    const procCoef = definition.canProc ? number(definition.procCoef === undefined ? 1 : definition.procCoef, scope, 1) : 0;
    return {
      kind: definition.kind || "proc", isProc: true, name: attackName(definition.name, scope, label),
      source: definition.kind === "art" ? "art" : definition.kind === "rune" ? "rune" : "proc",
      hits: definition.hits, types: definition.types, scalings: definition.scalings, procCoef, canCrit: definition.canCrit,
      noBonus: definition.noBonus, noLevel: definition.noLevel, noAddedTypes: definition.noAddedTypes, guardbreak: definition.guardbreak,
      finisher: definition.finisher, addPreBonus: definition.addPreBonus, spread: definition.spread, artShare: definition.artShare, noThief: definition.noThief,
      scope: { amount: entry.amount, attackPreBonus: scope.attackPreBonus, hitBase: scope.hitBase, finisherHit: scope.finisherHit, finisherHits: scope.finisherHits, appliedPotency: scope.appliedPotency, healAmount: scope.healAmount },
      amount: entry.amount, parentPreBonus: scope.hitPreBonus || scope.attackPreBonus,
    };
  }

  function attackName(name, scope, fallback) {
    if (!name) return fallback;
    return name.includes("'") ? String(evaluate(name, scope, fallback)) || fallback : name;
  }

  function amplifyDebuffs(context, effect, scope) {
    const definitions = context.profile.rules.core.statuses;
    Object.entries(context.target.statuses).forEach(([id, status]) => {
      if (!statusAlive(status, context.time) || !definitions[id] || definitions[id].kind !== "debuff") return;
      if ((status.amplified || 0) >= number(effect.limit, scope, 10)) return;
      status.amplified = (status.amplified || 0) + 1;
      if (!(effect.noAdd || []).includes(id)) status.potency += number(effect.add, scope);
      if (!(effect.noMultiply || []).includes(id)) status.potency *= number(effect.multiplier, scope, 1);
      status.until += number(effect.duration, scope);
    });
  }

  function healMultiplier(context, target) {
    const variables = context.variables;
    const bonus = 1 + passing(context, "healBonus", variables).reduce((sum, entry) => sum + number(entry.effect.value, entry.scope), 0) / 100;
    const received = target === "self" ? Math.max(0, 1 + passing(context, "healReceived", variables).reduce((sum, entry) => sum + number(entry.effect.value, entry.scope), 0) / 100) : 1;
    return bonus * received;
  }

  function heal(context, amount, target, name, options) {
    const opts = options || {};
    let value = amount * (opts.noBonus ? 1 : healMultiplier(context, target));
    if (!opts.noCrit) {
      const crit = passing(context, "healCrit", context.variables)[0];
      if (crit && opts.canProcHeal !== false && context.rng() < number(crit.effect.chance, crit.scope)) value *= 1 + number(crit.effect.bonus, crit.scope);
    }
    if (opts.lifesteal && (context.profile.effects.vitalMist || []).length) {
      context.vitalMist = Math.min(number(context.profile.effects.vitalMist[0].effect.max, effectScope(context.profile.effects.vitalMist[0], context.variables, context), 100), context.vitalMist + value * 10);
      return;
    }
    healDirect(context, value, target, name, opts);
  }

  function healDirect(context, value, target, name, options) {
    const opts = options || {};
    const report = context.report.healing;
    if (target === "self" || target === "both") {
      const share = opts.selfShare === undefined ? 1 : opts.selfShare;
      const selfValue = value * share;
      const missing = Math.max(0, context.self.maxHp - context.self.hp);
      const effective = context.options.simulateHp ? Math.min(missing, selfValue) : selfValue;
      context.self.hp = Math.min(context.self.maxHp, context.self.hp + selfValue);
      report.self += selfValue;
      report.effectiveSelf += effective;
      report.bySource[name] = (report.bySource[name] || 0) + selfValue;
    }
    if (target === "allies" || target === "both") {
      report.allies += value;
      report.allySources[name] = (report.allySources[name] || 0) + value;
    }
    const step = context.stepIndex >= 0 ? context.report.steps[context.stepIndex] : null;
    if (step) step.healed += value;
    if (opts.canProcHeal !== false) {
      const variables = Object.assign(Object.create(context.variables), { healAmount: value, healCleanses: !!opts.cleanse, healCanProc: opts.canProcHeal !== false, healingBurning: false });
      fireTrigger(context, "heal", variables);
      if (target === "self" || target === "both") fireTrigger(context, "selfHeal", variables);
    }
    if (opts.cleanse) cleanse(context);
  }

  function healFromEffect(context, entry, scope) {
    const effect = entry.effect;
    const scalings = effect.noScaling ? {} : scalingsFromSpec(context, effect.scalings || {}, scope);
    const levelMultiplier = effect.noLevel || effect.noScaling && effect.lifesteal ? 1 : 1 + context.profile.constants.levelBonusPerLevel * context.profile.level;
    const amount = number(effect.base, scope) * boostMultiplier(context, scalings) * levelMultiplier;
    if (amount <= 0) return;
    heal(context, amount, effect.target || "self", effectLabel(context, entry), {
      lifesteal: effect.lifesteal, canProcHeal: effect.canProcHeal !== false && !effect.lifesteal, cleanse: effect.cleanse, selfShare: effect.selfShare,
    });
  }

  function cleanse(context) {
    context.lastCleanse = context.time;
    const definitions = context.profile.rules.core.statuses;
    Object.keys(context.self.statuses).forEach((id) => {
      if (definitions[id] && definitions[id].kind === "debuff" && !definitions[id].uncleansable) delete context.self.statuses[id];
    });
    fireTrigger(context, "cleanse", context.variables);
  }

  function takeSelfDamage(context, amount, types, name) {
    if (!(amount > 0)) return;
    context.report.selfDamage += amount;
    context.report.taken.selfDamage += amount;
    if (context.options.simulateHp) loseHp(context, amount);
    fireTrigger(context, "selfDamaged", Object.assign(Object.create(context.variables), { selfDamageTaken: amount }));
  }

  function loseHp(context, amount) {
    context.self.hp -= amount;
    const report = context.report;
    report.lowestHp = report.lowestHp === null ? context.self.hp : Math.min(report.lowestHp, context.self.hp);
    if (context.self.hp <= 0) {
      if (context.report.deathTime === null) context.report.deathTime = context.time;
      context.report.deaths++;
      context.self.hp = context.self.maxHp;
    }
  }

  function abilityCooldown(context, ability, baseCooldown, attack) {
    const variables = attack ? hitVariables(context, attack, {}, { procCoef: attack.procCoef }) : context.variables;
    let base = baseCooldown;
    const effects = passing(context, "cooldown", variables).filter((entry) => entry.effect.ability === ability || entry.effect.ability === "any");
    effects.filter((entry) => entry.effect.kind === "base").forEach((entry) => { base = number(entry.effect.value, entry.scope, base); });
    let cooldown = base;
    effects.forEach((entry) => {
      const value = number(entry.effect.value, entry.scope);
      if (entry.effect.kind === "reduction") cooldown *= Math.max(0, 1 - value);
      else if (entry.effect.kind === "increase") cooldown *= 1 + value;
      else if (entry.effect.kind === "speed") cooldown /= 1 + value;
    });
    if (attack && attack.cooldownMultiplier) cooldown *= attack.cooldownMultiplier;
    return { base, final: Math.max(context.profile.constants.cooldownMinimum, Math.floor(cooldown + 1e-9)), exact: cooldown };
  }

  function reduceCooldown(context, ability, value, kind) {
    const keys = ability === "art" ? ["art"] : ability === "rune" ? ["rune", "drac"] : ["art", "rune", "drac"];
    keys.forEach((key) => {
      const remaining = context.cooldownReady[key] - context.time;
      if (!(remaining > 0)) return;
      if (kind === "percent") { context.cooldownReady[key] -= remaining * value; return; }
      context.flatCarry[key] = (context.flatCarry[key] || 0) + value;
      const whole = Math.floor(context.flatCarry[key] + 1e-9);
      if (whole >= 1) { context.cooldownReady[key] -= whole; context.flatCarry[key] -= whole; }
    });
  }

  function attackSpeed(context, attack, kind) {
    const stats = context.profile.stats;
    const statValue = stats["Attack Speed"] || 0;
    const statMultiplier = statValue >= 0 ? 1 + statValue / 100 : 1 / (1 + Math.abs(statValue) / 100);
    const variables = attack ? hitVariables(context, attack, {}, { procCoef: attack.procCoef }) : context.variables;
    const fixed = passing(context, "fixedAttackSpeed", variables)[0];
    if (fixed) return { multiplier: number(fixed.effect.value, fixed.scope, 0.75), weapon: 1, stat: 1, perk: 1, time: 1 };
    const sum = (category) => passing(context, "attackSpeed", variables).filter((entry) => (entry.effect.category || "perk") === category)
      .reduce((total, entry) => total + number(entry.effect.value, entry.scope), 0);
    const timeMultiplier = passing(context, "attackSpeed", variables).filter((entry) => entry.effect.category === "time")
      .reduce((product, entry) => product * number(entry.effect.value, entry.scope, 1), 1);
    const weapon = (context.profile.weapon.attackSpeed || 1) + sum("weapon") / 100;
    const perk = kind === "art" ? 1 + sum("art") / 100 : 1 + sum("perk") / 100;
    const multiplier = (weapon * statMultiplier * perk) / timeMultiplier;
    return { multiplier, weapon, stat: statMultiplier, perk, time: timeMultiplier };
  }

  function schedule(context, time, run) {
    context.queue.push({ time, run, order: context.queueCounter++ });
    context.queue.sort((a, b) => a.time - b.time || a.order - b.order);
  }

  function advanceTo(context, time) {
    while (true) {
      const nextTick = context.nextTick;
      const nextQueued = context.queue.length ? context.queue[0].time : Infinity;
      const nextEnemy = context.nextEnemyAttack;
      const next = Math.min(nextTick, nextQueued, nextEnemy);
      if (next > time + 1e-9) break;
      trackUptime(context, next);
      context.time = next;
      if (next === nextQueued) context.queue.shift().run();
      else if (next === nextEnemy) enemyAttack(context);
      else { context.nextTick += 1; secondTick(context); }
    }
    trackUptime(context, time);
    context.time = Math.max(context.time, time);
  }

  function trackUptime(context, time) {
    const from = context.uptimeClock;
    if (time <= from) return;
    ["self", "target"].forEach((side) => Object.entries(context[side].statuses).forEach(([id, status]) => {
      const start = Math.max(from, status.since || 0);
      const end = Math.min(time, status.until);
      if (end <= start) return;
      const key = `${side}:${id}`;
      const uptime = context.report.uptime[key] || (context.report.uptime[key] = { time: 0, potencyTime: 0 });
      uptime.time += end - start;
      uptime.potencyTime += (end - start) * status.potency;
    }));
    context.uptimeClock = time;
  }

  function secondTick(context) {
    const definitions = context.profile.rules.core.statuses;
    context.stepIndexBackup = context.stepIndex;
    context.stepIndex = -1;
    Object.entries(context.target.statuses).forEach(([id, status]) => {
      const definition = definitions[id];
      if (!definition || !definition.dot || !statusAlive(status, context.time - 1e-6)) return;
      dotTick(context, id, definition, status);
    });
    Object.entries(context.self.statuses).forEach(([id, status]) => {
      const definition = definitions[id];
      if (!definition || !definition.dot || !statusAlive(status, context.time - 1e-6)) return;
      selfDotTick(context, id, definition, status);
    });
    (context.profile.effects.aura || []).forEach((entry) => {
      const scope = effectScope(entry, context.variables, context);
      const interval = Math.max(1, Math.round(number(entry.effect.interval, scope, 1)));
      if (Math.round(context.time) % interval !== 0 || !condition(entry.effect.when, scope)) return;
      if (entry.effect.chance !== undefined && !roll(context, number(entry.effect.chance, scope))) return;
      const attack = procAttack(context, entry.effect.attack, entry, scope, effectLabel(context, entry));
      attack.source = "aura";
      attack.kind = entry.effect.attack.kind || "aura";
      executeAttack(context, attack, { noAttackTrigger: true });
      if (entry.effect.applies && attack.hitsLanded) entry.effect.applies.forEach((spec) => applySpec(context, spec, "target", scope, { sourceName: attack.name }));
    });
    fireTrigger(context, "second", context.variables);
    vitalMistTick(context);
    shieldTick(context);
    minionTick(context);
    context.stepIndex = context.stepIndexBackup;
  }

  function dotTick(context, id, definition, status) {
    const dot = definition.dot;
    const variables = Object.assign(Object.create(context.variables), { potency: status.potency, dotId: id });
    const modifiers = (context.profile.effects.dotModify || []).filter((entry) => entry.effect.dot === id || entry.effect.dot === "all");
    let types = typesFromSpec(context, dot.types, variables, false, variables);
    let scalings = scalingsFromSpec(context, dot.scalings, variables);
    let multiplier = potencyMultiplier(context, potencyAmount(context, dot.potencyPerk || id));
    const dotVariables = Object.assign(Object.create(variables), { isDot: true, dotNoAoe: !!dot.noAoe });
    modifiers.forEach((entry) => {
      const scope = effectScope(entry, dotVariables, context);
      if (!condition(entry.effect.when, scope)) return;
      if (entry.effect.setTypes) types = typesFromSpec(context, entry.effect.setTypes, scope);
      if (entry.effect.setScalings) scalings = scalingsFromSpec(context, entry.effect.setScalings, scope);
      Object.entries(entry.effect.addTypes || {}).forEach(([type, value]) => { types[type] = (types[type] || 0) + number(value, scope); });
      Object.entries(entry.effect.addScalings || {}).forEach(([name, value]) => { scalings[name] = (scalings[name] || 0) + number(value, scope); });
      if (entry.effect.multiplier !== undefined) multiplier *= number(entry.effect.multiplier, scope, 1);
    });
    if (!(multiplier > 0)) return;
    const attack = {
      kind: "dot", dotId: id, name: definition.name, source: "dot", procCoef: dot.canProc ? 1 : 0, canCrit: false, noAoe: dot.noAoe,
      hits: [[number(dot.base, variables) * multiplier, 1]], types, scalings,
    };
    if (dot.kind === "rune") { attack.kind = "rune"; attack.source = "dot"; }
    executeAttack(context, attack, { noAttackTrigger: true });
    fireTrigger(context, "dotTick:" + id, variables);
  }

  function selfDotTick(context, id, definition, status) {
    const dot = definition.dot;
    const variables = Object.assign(Object.create(context.variables), { potency: status.potency });
    const scalings = scalingsFromSpec(context, dot.scalings, variables);
    let damage = number(dot.base, variables) * boostMultiplier(context, scalings) * (1 + context.profile.constants.levelBonusPerLevel * context.profile.level);
    const warding = context.profile.statVariables.warding;
    damage = warding >= 0 ? damage / (1 + warding * context.profile.constants.wardingDotFactor / 100) : damage * (1 + Math.abs(warding) / 100);
    (context.profile.effects.dotTaken || []).filter((entry) => entry.effect.dot === id).forEach((entry) => { damage *= number(entry.effect.value, effectScope(entry, variables, context), 1); });
    if (damage > 0) {
      context.report.taken.dot += damage;
      context.report.taken.total += damage;
      context.report.taken.byType[Object.keys(dot.types || { True: 1 })[0]] = (context.report.taken.byType[Object.keys(dot.types || { True: 1 })[0]] || 0) + damage;
      if (context.options.simulateHp) loseHp(context, damage);
    }
    fireTrigger(context, "selfDotTick:" + id, variables);
  }

  function vitalMistTick(context) {
    const entry = (context.profile.effects.vitalMist || [])[0];
    if (!entry || context.vitalMist <= 0) return;
    const scope = effectScope(entry, context.variables, context);
    const rate = number(entry.effect.rate, scope, 2) * (context.vitalMist > 50 ? 2 : 1) * (context.profile.conditions.blocking ? 2 : 1);
    const used = Math.min(context.vitalMist, rate);
    context.vitalMist -= used;
    const scalings = scalingsFromSpec(context, entry.effect.scalings, scope);
    healDirect(context, used / 5 * boostMultiplier(context, scalings) * healMultiplier(context, "both"), "both", "Vital Mist", { canProcHeal: false });
    if (context.vitalMist > 50) applyStatus(context, "self", "tailwind", number(entry.effect.tailwind, scope, 0.2), 4, { sourceName: "Vital Mist" });
  }

  function syncShield(context) {
    const maxShield = currentShieldMax(context);
    const bonus = maxShield - Math.max(0, Math.min(context.self.maxHp, context.profile.stats.Protection || 0));
    if (bonus > context.self.bonusShield + 1e-9) {
      context.self.shield += bonus - context.self.bonusShield;
      context.self.shieldBroken = false;
    }
    context.self.bonusShield = bonus;
    context.self.shield = Math.min(context.self.shield, maxShield);
    return maxShield;
  }

  function shieldTick(context) {
    if (!context.options.simulateHp) return;
    const maxShield = syncShield(context);
    if (context.time - context.self.lastHit < 2 || context.self.shield >= maxShield) return;
    const rate = maxShield * (context.self.shieldBroken ? 0.1 : 0.05);
    context.self.shield = Math.min(maxShield, context.self.shield + rate);
    if (context.self.shield >= maxShield) context.self.shieldBroken = false;
  }

  function currentShieldMax(context) {
    const protection = context.profile.stats.Protection || 0;
    const bonus = passing(context, "shield", context.variables).reduce((sum, entry) => sum + number(entry.effect.value, entry.scope), 0);
    return Math.max(0, Math.min(context.self.maxHp, protection)) + bonus;
  }

  function minionModifiers(context) {
    const result = { damage: 1, hp: 1, count: 1, cap: context.profile.constants.maxSummons, decay: 1, trusty: false };
    (context.profile.effects.minion || []).filter((entry) => entry.effect.when === undefined).forEach((entry) => {
      const effect = entry.effect;
      const scope = effectScope(entry, context.variables, context);
      if (effect.damage !== undefined) result.damage *= number(effect.damage, scope, 1);
      if (effect.hp !== undefined) result.hp *= number(effect.hp, scope, 1);
      if (effect.count !== undefined) result.count *= number(effect.count, scope, 1);
      if (effect.decay !== undefined) result.decay *= number(effect.decay, scope, 1);
      if (effect.trusty) result.trusty = true;
      if (effect.cap !== undefined) result.cap += number(effect.cap, scope, 0);
    });
    if (result.trusty) result.cap = 1;
    return result;
  }

  function summonMinions(context, summon) {
    const modifiers = minionModifiers(context);
    const summonScale = context.profile.variables.summonScale;
    const count = Math.max(1, Math.round(summon.count * modifiers.count));
    const decayRate = (summon.decay || 0.02) * modifiers.decay;
    const lifetime = modifiers.trusty || decayRate <= 0 ? 1e6 : 1 / decayRate;
    const maxHp = 50 * summonScale * modifiers.hp;
    context.minionMode = true;
    context.lastSummon = summon;
    const variables = Object.assign(Object.create(context.variables), { summonsSpawned: count, summonMaxHp: maxHp, minionBaseHp: maxHp });
    const absorbs = (context.profile.effects.applyStatus || []).some((entry) => entry.effect.consumesMinion) && !sideStatus("self", "minionAbsorbed");
    const spawned = absorbs ? count - 1 : count;
    for (let index = 0; index < spawned; index++) {
      context.minions.push({ name: summon.name, attacks: summon.attacks, until: context.time + lifetime, next: summon.attacks.map((attack) => context.time + attack.every), damage: modifiers.damage * summonScale, maxHp });
    }
    const alive = context.minions.filter((minion) => minion.until > context.time);
    while (alive.length > modifiers.cap) {
      alive.shift().until = context.time;
      fireTrigger(context, "minionDeath", variables);
    }
    fireTrigger(context, "summon", variables);
    autoSpirit(context, "summon");
  }

  function minionTick(context) {
    const dynamic = (context.profile.effects.minion || []).filter((entry) => entry.effect.when !== undefined && entry.effect.damage !== undefined);
    context.minions.forEach((minion) => {
      if (minion.until <= context.time - 1e-9) {
        if (!minion.dead) {
          minion.dead = true;
          fireTrigger(context, "minionDeath", Object.assign(Object.create(context.variables), { minionBaseHp: minion.maxHp }));
        }
        return;
      }
      const boost = dynamic.reduce((product, entry) => {
        const scope = effectScope(entry, context.variables, context);
        return condition(entry.effect.when, scope) ? product * number(entry.effect.damage, scope, 1) : product;
      }, 1);
      minion.attacks.forEach((attack, index) => {
        while (minion.next[index] <= context.time + 1e-9) {
          minion.next[index] += attack.every;
          const value = attack.base * minion.damage * boost;
          const amounts = {};
          Object.entries(attack.types).forEach(([type, fraction]) => { amounts[type] = value * fraction; });
          const armor = armorForHit(context, context.variables, amounts);
          const byType = {};
          let total = 0;
          Object.entries(amounts).forEach(([type, amount]) => { byType[type] = amount * armor[type]; total += byType[type]; });
          record(context, "minion", minion.name, { total, byType });
        }
      });
    });
  }

  function enemyAttack(context) {
    const incoming = context.options.incoming;
    const step = incoming.steps[context.enemyIndex % incoming.steps.length];
    context.enemyIndex++;
    context.nextEnemyAttack = context.time + incoming.interval;
    if (!step) return;
    for (let hitIndex = 0; hitIndex < (step.hits || 1); hitIndex++) incomingHit(context, step, hitIndex);
  }

  function incomingHit(context, attack, hitIndex) {
    const report = context.report.taken;
    const variables = Object.assign(Object.create(context.variables), {
      incomingStun: context.options.incoming.stun, blockedHit: false,
      repeatedIncomingType: context.lastIncomingTypes === Object.keys(attack.parts).sort().join(","), incomingMatchesRepeated: true,
    });
    context.lastIncomingTypes = Object.keys(attack.parts).sort().join(",");
    const hits = attack.hits || 1;
    const enemyMultiplier = passing(context, "enemyDamage", variables).reduce((product, entry) => product * number(entry.effect.value, entry.scope, 1), 1);
    const raw = {};
    Object.entries(attack.parts).forEach(([type, value]) => { raw[type] = value / hits * enemyMultiplier; });
    const rawTotal = Object.values(raw).reduce((sum, value) => sum + value, 0);
    report.raw += rawTotal;
    report.incomingHits++;
    const dodgeChance = 1 - passing(context, "dodge", variables).reduce((product, entry) => product * (1 - Math.min(1, number(entry.effect.value, entry.scope))), 1);
    const futureSight = passing(context, "futureSight", variables)[0];
    let dodged = context.rng() < luckyChance(context, dodgeChance);
    if (!dodged && futureSight && context.time - context.self.lastHit >= number(futureSight.effect.wait, futureSight.scope, 20)) dodged = true;
    if (!dodged && sideStatus("self", "focus")) dodged = true;
    if (dodged) {
      report.dodged++;
      fireTrigger(context, "dodge", variables);
      return;
    }
    context.self.lastHit = context.time;
    const guardbreak = attack.guardbreak && !passing(context, "noGuardbreak", variables).length;
    const autoBlock = passing(context, "block", variables).reduce((product, entry) => product * (1 - Math.min(1, number(entry.effect.value, entry.scope))), 1);
    const blocked = !guardbreak && (context.rng() < 1 - (1 - context.options.incoming.blockShare) * autoBlock || !!sideStatus("self", "autoblock"));
    const parryEffects = passing(context, "parry", variables);
    const parried = parryEffects.length > 0 && (blocked || guardbreak) && (context.rng() < context.options.incoming.parryShare || !!sideStatus("self", "autoparry"));
    variables.blockedHit = blocked;
    let multiplier = 1;
    if (parried) {
      multiplier *= 1 - Math.max(...parryEffects.map((entry) => number(entry.effect.value, entry.scope, 0.9)));
      report.parried++;
      if (sideStatus("self", "autoparry")) removeStatus(context, "self", "autoparry", 1);
      fireTrigger(context, "parry", variables);
    } else if (blocked) {
      const blockReduction = passing(context, "blockReduction", variables).reduce((sum, entry) => sum + number(entry.effect.value, entry.scope), 0);
      multiplier *= 1 / (1 + blockReduction / 100);
      report.blocked++;
      fireTrigger(context, "block", variables);
    }
    const stunImmune = passing(context, "stunImmune", variables).length > 0;
    const stunResistance = context.profile.statVariables.tenacity + passing(context, "stunResistance", variables).reduce((sum, entry) => sum + number(entry.effect.value, entry.scope), 0);
    if (!parried) report.stun += stunImmune ? 0 : Math.max(0, context.options.incoming.stun - stunResistance);
    const stats = context.profile.stats;
    const selfArmorLoss = passing(context, "selfArmorReduction", variables).reduce((sum, entry) => sum + number(entry.effect.value, entry.scope), 0);
    const defenseEffects = passing(context, "defense", variables);
    const reductionEffects = passing(context, "damageReduction", variables).filter((entry) => !entry.effect.cooldown || procReady(context, entry.key, entry.effect.cooldown));
    const takenEffects = passing(context, "damageTaken", variables);
    const typeTaken = passing(context, "typeTaken", variables);
    const flat = passing(context, "flatReduction", variables);
    const byType = {};
    let total = 0;
    Object.entries(raw).forEach(([type, value]) => {
      let amount = value * multiplier;
      if (type !== "True") {
        const group = context.profile.rules.core.typeGroups[type] || "Magic";
        const defense = (stats[group + " Defense"] || 0) + (type !== group ? stats[type + " Defense"] || 0 : 0) - selfArmorLoss;
        amount *= defense >= 0 ? 1 / (1 + defense / 100) : 1 + Math.abs(defense) / 100;
        defenseEffects.forEach((entry) => {
          if (entry.effect.types && !entry.effect.types.includes(type)) return;
          amount /= 1 + number(entry.effect.value, entry.scope) / 100;
        });
        flat.filter((entry) => entry.effect.group === group).forEach((entry) => { amount = Math.max(0, amount - number(entry.effect.value, entry.scope) * value / rawTotal); });
      }
      reductionEffects.forEach((entry) => { amount /= 1 + number(entry.effect.value, entry.scope) / 100; });
      takenEffects.forEach((entry) => { amount *= number(entry.effect.value, entry.scope, 1); });
      typeTaken.forEach((entry) => { if (entry.effect.types.includes(type)) amount *= number(entry.effect.value, entry.scope, 1); });
      byType[type] = amount;
      total += amount;
    });
    passing(context, "chanceReduction", variables).forEach((entry) => { if (context.rng() < number(entry.effect.chance, entry.scope)) total *= number(entry.effect.value, entry.scope, 1); });
    const absorbShare = passing(context, "shieldAbsorb", variables).reduce((value, entry) => Math.max(value, number(entry.effect.value, entry.scope)), context.profile.constants.shieldAbsorb);
    let toHp = total;
    if (context.options.simulateHp) syncShield(context);
    if (context.options.simulateHp && context.self.shield > 0 && !context.self.shieldBroken) {
      const absorbed = Math.min(context.self.shield, total * absorbShare);
      context.self.shield -= absorbed;
      toHp -= absorbed;
      report.shield += absorbed;
      if (context.self.shield <= 1e-9) { context.self.shieldBroken = true; fireTrigger(context, "shieldBreak", variables); }
    }
    report.total += total;
    report.hp += toHp;
    Object.entries(byType).forEach(([type, value]) => { report.byType[type] = (report.byType[type] || 0) + value; });
    report.byAttack[attack.name] = (report.byAttack[attack.name] || 0) + total;
    if (context.options.simulateHp) loseHp(context, toHp);
    fireTrigger(context, "damaged", variables);
  }

  function spiritRule(context) {
    const spirits = context.profile.rules.attacks.spirits;
    const id = Object.keys(spirits).find((spiritId) => context.profile.perks[spiritId]);
    return id ? { id, rule: spirits[id] } : null;
  }

  function gainEnergy(context, attack) {
    const commune = context.profile.perks["spirit-commune"] || 0;
    const spirit = context.spirit;
    if (!commune || !spirit || context.energyBlockedUntil > context.time) return;
    const formRule = attack.isM1 ? context.profile.form.m1Rule : context.profile.form.m2Rule;
    const coefficients = (formRule && formRule.spirit) || context.profile.rules.attacks.defaultSpiritCoefficients;
    const perAttack = attack.spiritPerHit ? attack.spiritPerHit * attack.hitsLanded : attack.isM2 ? coefficients.m2 : attack.isM1 ? (attack.finisher ? coefficients.finisher : coefficients.m1) : attack.spiritCoefficient || 0;
    if (!perAttack) return;
    const speed = attack.spiritPerHit || attack.spiritCoefficient ? 1 : attackSpeed(context, attack, "weapon").multiplier;
    context.energy = Math.min(context.energyMax, context.energy + spirit.rule.coefficient * perAttack * (1 + (commune - 1) / 6) / speed);
  }

  function spiritAttack(context, spirit) {
    const rule = spirit.rule;
    return {
      key: "spirit", kind: rule.kind || "spirit", spiritId: spirit.id, name: (window.VOXL_DATA.perks[spirit.id] || {}).name || spirit.id, source: "spirit",
      hits: rule.hits, types: rule.types, scalings: rule.scalings, procCoef: rule.procCoef === undefined ? 1 : rule.procCoef, finisher: !!rule.finisher,
      eachHitFinisher: !!rule.eachHitFinisher, guardbreak: rule.guardbreak, applies: rule.applies, selfApplies: rule.selfApplies, spread: rule.active,
      noSavageCombo: true, isM2: false, form: context.profile.form.m2,
    };
  }

  function autoSpirit(context, trigger) {
    const spirit = context.spirit;
    if (!spirit || (spirit.rule.trigger || "rmb") !== trigger || context.energy < context.energyMax - 1e-9 || context.releasingSpirit) return;
    releaseSpirit(context, spirit);
  }

  function releaseSpirit(context, spirit) {
    context.releasingSpirit = true;
    const cost = spirit.rule.energyCost ? context.energyMax * spirit.rule.energyCost : context.energyMax;
    context.energy = Math.max(0, context.energy - cost);
    const attack = spiritAttack(context, spirit);
    (attack.selfApplies || []).forEach((spec) => applySpec(context, spec, "self", context.variables, { sourceName: attack.name }));
    if (spirit.rule.hits && spirit.rule.hits.length) executeAttack(context, attack);
    else if (attack.applies) attack.applies.forEach((spec) => applySpec(context, spec, "target", context.variables, { sourceName: attack.name }));
    if (spirit.rule.defense) applyStatus(context, "self", "reinforce", 0.3, spirit.rule.defense.duration, { sourceName: attack.name, noPotencyBonus: true });
    if (spirit.rule.resetsCooldown) { context.cooldownReady.art = context.time; context.cooldownReady.rune = context.time; }
    if (spirit.rule.rageBoost) {
      const rage = context.self.statuses.rage;
      if (statusAlive(rage, context.time)) { rage.potency += 0.2; rage.until = context.time + (rage.until - context.time) * 2; }
    }
    if (spirit.rule.energyLock) context.energyBlockedUntil = context.time + spirit.rule.energyLock;
    if (spirit.rule.extraSummons && context.lastSummon) summonMinions(context, { ...context.lastSummon, count: spirit.rule.extraSummons });
    context.report.spirits++;
    context.releasingSpirit = false;
    return attack;
  }

  window.VoxlEngine = window.VoxlEngine || {};
  Object.assign(window.VoxlEngine, {
    internals: {
      active, evaluate, number, condition, effectScope, seededRandom, luckyChance, roll, liveEffects, passing, effectLabel, contextVariables,
      counterValue, gainCounter, resetCounter, counterIsFull, potencyAmount, potencyMultiplier, applyStatus, applySpec, removeStatus, statusAlive,
      typesFromSpec, scalingsFromSpec, boostMultiplier, armorMultiplier, naturalCrit, resolveHit, rollCrit, executeAttack, record, fireTrigger,
      heal, healDirect, cleanse, takeSelfDamage, loseHp, abilityCooldown, reduceCooldown, attackSpeed, schedule, advanceTo, trackUptime,
      summonMinions, minionModifiers, attackName, enemyAttack, incomingHit, spiritRule, gainEnergy, spiritAttack, releaseSpirit, autoSpirit, procAttack,
      currentShieldMax, sideStatus, hitVariables, weaponTypesFor,
    },
  });
})();
