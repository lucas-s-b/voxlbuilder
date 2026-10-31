(function () {
  const Engine = window.VoxlEngine;
  const Rules = window.VoxlRules;
  const TEXT = window.VoxlTestText;
  const CHART_COLORS = ["#ffd84a", "#4af6ff", "#ff5a5a", "#7dff8a", "#c49aff", "#ff9a3c", "#ff8ad8", "#fff6b0", "#6aa8ff", "#b0ff7a", "#ffc27a", "#ff7ab0"];
  const MODES = ["dps", "tank", "debuff", "heal", "rules"];
  const MAIN_SOURCES = ["m1", "m2", "art", "rune", "drac", "special", "spirit", "custom"];
  const views = () => window.VoxlViews;
  const format = (value, digits) => views().fmt(value, digits);

  const UI_KEY = "voxlbuilder:testui3";
  const interfaceState = (() => {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(UI_KEY)); } catch (error) { saved = null; }
    return {
      closed: new Set(saved && Array.isArray(saved.closed) ? saved.closed : ["advanced"]),
      openFolds: new Set(saved && Array.isArray(saved.openFolds) ? saved.openFolds : []),
      tab: (saved && saved.tab) || "sequence", detail: (saved && saved.detail) || "", mode: MODES.includes(saved && saved.mode) ? saved.mode : "dps",
      ruleSection: (saved && saved.ruleSection) || "perks", ruleKey: (saved && saved.ruleKey) || "", ruleSearch: "", ruleMessage: "", ruleDraft: null, resetArmed: false,
    };
  })();
  const saveInterface = () => {
    try {
      localStorage.setItem(UI_KEY, JSON.stringify({ closed: [...interfaceState.closed], openFolds: [...interfaceState.openFolds], tab: interfaceState.tab, detail: interfaceState.detail, mode: interfaceState.mode,
        ruleSection: interfaceState.ruleSection, ruleKey: interfaceState.ruleKey }));
    } catch (error) { /* storage unavailable */ }
  };

  const fold = (id, title, body) => `<details class="steps sub-fold" data-fold="${id}"${interfaceState.openFolds.has(id) ? " open" : ""}><summary class="outline">${title}</summary>${body}</details>`;

  const resultCache = new Map();
  function cached(key, compute) {
    if (resultCache.has(key)) return resultCache.get(key);
    const value = compute();
    resultCache.set(key, value);
    if (resultCache.size > 40) resultCache.delete(resultCache.keys().next().value);
    return value;
  }
  Rules.onChange(() => resultCache.clear());

  function currentState(A) {
    const build = A.build();
    const settings = build.test;
    const totals = A.totalsOf(build);
    const weapon = A.M.weapon(build);
    const profile = Engine.buildProfile(build, totals, weapon, settings);
    if (settings.comboSteps) {
      const comboLength = ((profile.form.m1Rule || {}).m1 || []).length || 1;
      Object.values(Engine.SEQUENCES).forEach(([listKey]) => settings[listKey].forEach((step) => { if (step.a === "m1") step.n = Math.min(50, step.n * comboLength); }));
      delete settings.comboSteps;
      A.save();
    }
    const signature = JSON.stringify(build);
    const catalog = cached(signature + "|catalog", () => Engine.listActions(profile));
    return { build, settings, totals, weapon, profile, catalog, signature };
  }

  const runTab = (state, mode, runs) => cached(`${state.signature}|${mode}|${runs || ""}`, () => {
    const options = Engine.tabOptions(state.settings, mode);
    return Engine.simulate(state.profile, runs ? { ...options, runs } : options);
  });

  const perkName = (id) => (window.VOXL_DATA.perks[id] || { name: id }).name;
  const statusName = (id) => (Rules.current().core.statuses[id] || { name: id }).name;
  const sequenceKeys = (mode) => Engine.SEQUENCES[mode];

  function typesText(types, none) {
    return Object.entries(types || {}).filter(([, value]) => value > 0).map(([type, value]) => `${type} ${format(value, 2)}`).join(" + ") || none;
  }

  function typeBars(escape, byType) {
    const colors = views().TYPE_COLORS;
    const rows = Object.entries(byType || {}).filter(([, value]) => value > 0.0005).sort((a, b) => b[1] - a[1]);
    const total = rows.reduce((sum, [, value]) => sum + value, 0);
    const largest = Math.max(...rows.map(([, value]) => value), 1e-9);
    return rows.map(([type, value]) => `<div class="bar-row"><span class="outline" style="color:${colors[type]}">${escape(type)}</span>
      <span class="bar"><span style="width:${(value / largest) * 100}%;background:${colors[type]}"></span></span><b>${format((value / total) * 100, 0)}% · ${format(value)}</b></div>`).join("");
  }

  function actionList(A, state) {
    const { catalog, profile, settings } = state;
    const actions = catalog.actions;
    const badge = (label) => `<span class="seq-badge outline">${label}</span>`;
    const list = [];
    if (actions.m1) list.push(["m1", TEXT.actions.m1, TEXT.actions.m1Sub(profile.form.m1, actions.m1.swings.length), badge("M1")]);
    list.push(["m2", TEXT.actions.m2, TEXT.actions.m2Sub(profile.form.m2, !!actions.m2.charge), badge("M2")]);
    if (actions.art) list.push(["art", actions.art.name, TEXT.actions.artSub(catalog.plans.art.cooldown), actions.art.image ? A.img(actions.art.image, actions.art.name) : badge("A")]);
    if (actions.rune) list.push(["rune", actions.rune.name, TEXT.actions.runeSub(catalog.plans.rune.cooldown), actions.rune.image ? A.img(actions.rune.image, actions.rune.name) : badge("R")]);
    if (actions.drac) list.push(["drac", actions.drac.name, TEXT.actions.dracSub(catalog.plans.drac.cooldown), A.img("guild-draconic.png", actions.drac.name)]);
    if (actions.special) list.push(["special", actions.special.name, actions.special.special.spirit ? TEXT.actions.spiritSub : TEXT.actions.extraSub, badge("SP")]);
    if (actions.potion) list.push(["potion", actions.potion.name, TEXT.actions.potionSub, badge("P")]);
    (settings.customs || []).forEach((custom) => list.push([`custom:${custom.id}`, custom.name, `${format(+custom.dmg || 0, 1)} × ${custom.hits || 1} · ${typesText(custom.types, TEXT.sameAsWeapon)}`, badge("C")]));
    list.push(["wait", TEXT.actions.wait, TEXT.actions.waitSub, badge("⏱")]);
    return list;
  }

  const ATTACK_SPECIFIC_EFFECTS = { replaceM2: ["m2"], chargeM2: ["m2"], override: ["art", "rune"], extraAction: ["special"] };

  function stepConditions(state, key) {
    const rules = Rules.current();
    const action = state.catalog.actions[key];
    const sourceName = (id) => (id.startsWith("race:") ? ((window.VOXL_DATA.races || []).find((race) => "race:" + race.id === id) || { name: id }).name : perkName(id));
    const perkSources = Object.keys(state.profile.perks).map((id) => [sourceName(id), ((rules.perks[id] || {}).effects || [])
      .filter((effect) => !ATTACK_SPECIFIC_EFFECTS[effect.type] || ATTACK_SPECIFIC_EFFECTS[effect.type].includes(key))]);
    const statusSources = state.catalog.statuses.map((status) => [status.name, rules.core.statuses[status.id]]);
    const ownSources = action && (action.rule || action.special) ? [[action.name, action.rule || action.special]] : [];
    const sources = perkSources.concat(statusSources, ownSources).map(([name, entry]) => [name, formulaNames([entry])]);
    return rules.core.conditions.filter((condition) => condition.scope === "step")
      .map((condition) => ({ ...condition, sources: [...new Set(sources.filter(([, names]) => names.has(condition.id)).map(([name]) => name))] }))
      .filter((condition) => condition.sources.length);
  }

  const statusList = (state) => state.catalog.statuses.map((status) => [`status:${status.id}`, status.name, status.kind === "debuff" ? TEXT.picker.debuffOnEnemy : TEXT.picker.buffOnYou, "", status.kind]);
  const stepLookup = (A, state) => Object.fromEntries(actionList(A, state).concat(statusList(state)).map((entry) => [entry[0], entry]));

  function chargeSeconds(state, key) {
    const catalog = state.catalog;
    if (key === "m2" && catalog.actions.m2.charge) {
      const charge = catalog.actions.m2.charge;
      if (charge.kind === "form") return charge.rule.time;
      return +Engine.internals.number(charge.entry.effect.time, Object.assign(Object.create(state.profile.variables), { amount: charge.entry.amount }), 0);
    }
    const plan = catalog.plans[key];
    return plan && plan.rule.charge ? plan.rule.charge.time : 0;
  }

  function renderTest(A) {
    if (interfaceState.mode === "rules") return renderRules(A);
    const escape = A.esc;
    const state = currentState(A);
    const { settings, profile, catalog } = state;
    const mode = interfaceState.mode;
    const colors = views().TYPE_COLORS;
    const numberInput = (path, value, attributes) => `<input class="num" type="number" data-path="${path}" value="${value === undefined || value === null ? "" : value}" ${attributes || ""}>`;
    const checkbox = (path, on, label) => `<label class="toggle"><input type="checkbox" data-path="${path}" ${on ? "checked" : ""}> <span>${label}</span></label>`;
    const select = (path, options, value) => `<select class="sort mini" data-path="${path}">${options.map(([optionValue, label]) => `<option value="${escape(optionValue)}"${String(optionValue) === String(value) ? " selected" : ""}>${escape(label)}</option>`).join("")}</select>`;
    const setButton = (path, value, label, on, extra) => `<button class="mode-tab outline${on ? " active" : ""}" data-set="${path}" data-val="${escape(String(value))}" ${extra || ""}>${label}</button>`;
    const typeSplit = (target, types, none) => {
      const rows = Object.entries(types || {}).map(([type, value]) => `<span class="tsplit-row"><span class="chip outline" style="color:${colors[type] || "#fff"}">${type}</span>
        <input class="num" type="number" data-tsplit="${target}" data-type="${type}" value="${value}" step="0.05" min="0" max="10" aria-label="${type}">
        <button class="mv del" data-tsplit-del="${target}" data-type="${type}" aria-label="✕">✕</button></span>`).join("");
      const left = Engine.DAMAGE_TYPES.filter((type) => !(types || {})[type]);
      return `<div class="tsplit">${rows || `<span class="muted">${none}</span>`}
        ${left.length ? `<select class="sort mini" data-tsplit-add="${target}" aria-label="${TEXT.addType}"><option value="">${TEXT.addType}</option>${left.map((type) => `<option>${type}</option>`).join("")}</select>` : ""}</div>`;
    };

    const actions = actionList(A, state);
    const statuses = statusList(state);
    const actionByKey = stepLookup(A, state);
    const [listKey, repeatKey, durationKey] = sequenceKeys(mode);
    const steps = Array.isArray(settings[listKey]) ? settings[listKey] : [];
    const summaryOf = (list) => list.map((step) => (actionByKey[step.a] ? actionByKey[step.a][1] : step.a) + (step.a === "wait" ? ` ${step.w || 1}s` : step.a.startsWith("status:") ? ` ${step.p || 0}` : step.n > 1 ? ` ×${step.n}` : "")).join(" → ");
    const chargeRow = (step, index, listAttribute) => {
      const seconds = chargeSeconds(state, step.a);
      if (!seconds) return "";
      const charge = +step.c || 0;
      return `<div class="seq-charge"><span class="lab">${TEXT.charge}</span>
        <input type="range" min="0" max="100" step="5" value="${Math.round(charge * 100)}" data-seq-c="${index}" ${listAttribute} data-time="${seconds}" aria-label="${TEXT.charge}">
        <span class="seq-charge-val">${TEXT.chargeLabel(Math.round(charge * 100), format(charge * seconds, 1))}</span></div>`;
    };
    const listAttribute = `data-list="${listKey}"`;
    const conditionsByKey = {};
    const paramsFrame = (step, index) => {
      const conditions = actionByKey[step.a] && !step.a.startsWith("status:") && step.a !== "wait"
        ? conditionsByKey[step.a] || (conditionsByKey[step.a] = stepConditions(state, step.a)) : [];
      const valueOf = (condition) => (step.k && step.k[condition.id] !== undefined ? step.k[condition.id] : condition.default);
      const inputs = conditions.map((condition) => {
        const field = `data-step-cond="${index}" data-cond="${condition.id}" ${listAttribute} id="step-${index}-${condition.id}"`;
        const input = condition.type === "boolean"
          ? `<input type="checkbox" ${field} ${valueOf(condition) ? "checked" : ""}>`
          : `<input class="num" type="number" ${field} value="${valueOf(condition)}" step="${condition.step}" min="${condition.min}" max="${condition.max}">`;
        return `<label class="seq-param-label" for="step-${index}-${condition.id}"><span>${escape(condition.label)}</span><i>${escape(condition.sources.join(", "))}</i></label><span class="seq-param-value">${input}</span>`;
      }).join("");
      const charge = chargeRow(step, index, listAttribute);
      return charge || inputs ? `<div class="seq-params">${charge}${inputs}</div>` : "";
    };
    const stepRows = steps.map((step, index) => {
      const action = actionByKey[step.a];
      return `<div class="seq-step${action ? "" : " missing"}">
        <span class="seq-num outline">${index + 1}</span>
        <span class="seq-ico${action && action[3] ? " portrait sm" : " blank"}">${action ? action[3] : ""}</span>
        <span class="seq-name" title="${escape(action ? action[2] : TEXT.notInBuild)}"><b>${escape(action ? action[1] : step.a)}</b>${action ? "" : `<i>${TEXT.notInBuild}</i>`}</span>
        <span class="seq-n">${step.a === "wait"
          ? `<input class="num" type="number" data-seq-w="${index}" ${listAttribute} value="${step.w || 1}" step="0.5" min="0.1" max="60" aria-label="${TEXT.seconds}"><span class="muted">s</span>`
          : step.a.startsWith("status:")
            ? `<input class="num" type="number" data-seq-p="${index}" ${listAttribute} value="${step.p || 0}" step="0.05" min="0" max="100" title="${TEXT.buffs.potency}" aria-label="${TEXT.buffs.potency}">
              <input class="num" type="number" data-seq-d="${index}" ${listAttribute} value="${step.d || ""}" step="1" min="0.1" max="600" placeholder="${TEXT.picker.durationPlaceholder}" title="${TEXT.picker.durationHelp}" aria-label="${TEXT.picker.duration}"><span class="muted">s</span>`
            : `<span class="muted">×</span><input class="num" type="number" data-seq-n="${index}" ${listAttribute} value="${step.n || 1}" step="1" min="1" max="50" aria-label="×">`}</span>
        <span class="seq-btns">
          <button class="mv" data-seq-move="${index}" ${listAttribute} data-dir="-1" ${index === 0 ? "disabled" : ""} aria-label="▲">▲</button>
          <button class="mv" data-seq-move="${index}" ${listAttribute} data-dir="1" ${index === steps.length - 1 ? "disabled" : ""} aria-label="▼">▼</button>
          <button class="mv del" data-seq-del="${index}" ${listAttribute} aria-label="✕">✕</button>
        </span>${paramsFrame(step, index)}</div>`;
    }).join("");
    const addButton = ([key, name, subtitle, icon], extra) => `<button class="seq-add" data-seq-add="${key}" ${listAttribute} ${extra || ""} title="${escape(subtitle)}">${icon ? `<span class="seq-ico portrait sm">${icon}</span>` : ""}<span>${escape(name)}</span></button>`;
    const attackButtons = actions.map((action) => addButton(action)
      + (action[0] === "m2" && catalog.actions.m2.charge ? addButton(["m2", TEXT.picker.chargedM2, action[2], action[3]], 'data-charge="1"') : "")).join("");
    const sequenceEditor = `
      <div class="seq-list">${stepRows || `<div class="seq-empty">${TEXT.emptySequence[mode]}</div>`}</div>
      <details class="step-picker"><summary class="mode-tab outline">${TEXT.picker.open}</summary>
        <div class="step-picker-panel">
          <div class="sub-h outline">${TEXT.picker.attacks}</div><div class="seq-adds">${attackButtons}</div>
          <div class="sub-h outline">${TEXT.picker.statuses}</div>
          ${statuses.length ? `<div class="seq-adds">${statuses.map((status) => addButton(status)).join("")}</div>` : `<div class="muted">${TEXT.picker.noStatuses}</div>`}
        </div></details>
      ${mode === "dps" ? "" : `<div class="seq-mode">
        ${setButton(repeatKey, "", TEXT.runOnce, !settings[repeatKey], `data-bool="0" title="${TEXT.onceHelp}"`)}
        ${setButton(repeatKey, "1", TEXT.repeatFor, !!settings[repeatKey], `data-bool="1" title="${TEXT.repeatHelp}"`)}
        ${settings[repeatKey] ? `${numberInput(durationKey, settings[durationKey], 'step="5" min="5" max="300"')}<span class="muted">${TEXT.seconds}</span>` : ""}
      </div>`}
      ${catalog.actions.special && catalog.actions.special.choices.length > 1 ? `<div class="opt-row"><span class="lab">${TEXT.specialAttack}</span>${select("special", catalog.actions.special.choices, catalog.actions.special.special.id)}</div>` : ""}
      ${fold("customs", TEXT.customAttacks((settings.customs || []).length), `${(settings.customs || []).map((custom) => `<div class="custom-card">
        <div class="custom-top"><input class="search" data-custom="${custom.id}" data-field="name" value="${escape(custom.name)}" maxlength="30" aria-label="${escape(custom.name)}">
          <button class="mv del" data-custom-del="${custom.id}" aria-label="✕">✕</button></div>
        <div class="opt-row"><span class="lab">${TEXT.damage}</span><input class="num" type="number" data-custom="${custom.id}" data-field="dmg" value="${custom.dmg}" step="0.5" min="0" aria-label="${TEXT.damage}">
          <span class="lab">${TEXT.timesHits}</span><input class="num" type="number" data-custom="${custom.id}" data-field="hits" value="${custom.hits}" step="1" min="1" max="50" aria-label="${TEXT.timesHits}"></div>
        <div class="opt-row"><span class="lab">${TEXT.damageType}</span>${typeSplit("c:" + custom.id, custom.types, TEXT.sameAsWeapon)}</div></div>`).join("")}
      ${(settings.customs || []).length < 8 ? `<button class="mode-tab outline" data-custom-new>${TEXT.newCustom}</button>` : ""}`)}`;

    const buffsSection = renderBuffs(A, state, { numberInput, checkbox, select });
    const enemySection = renderEnemy(A, state, mode, { numberInput, typeSplit });
    const advancedSection = `<div class="opt-row"><span class="lab">${TEXT.crits}</span><span class="mode-tabs">${["avg", "always", "never"].map((crit) => setButton("crit", crit, TEXT.critModes[crit], settings.crit === crit)).join("")}</span></div>
      <div class="opt-row"><span class="lab" title="${TEXT.advanced.runsHelp}">${TEXT.advanced.runs}</span>${numberInput("runs", settings.runs, 'step="10" min="10" max="1000"')}</div>`;

    const section = (id, number, title, summary, body) => {
      const open = !interfaceState.closed.has(id);
      return `<section class="cv-sec tsec${open ? " open" : ""}">
        <div class="cv-head"><button class="sec-toggle" data-toggle-sec="${id}" aria-expanded="${open}"><span class="caret">${open ? "▾" : "▸"}</span>${number ? `<span class="sec-n outline">${number}</span>` : ""}<h3 class="outline">${title}</h3></button>
          ${open ? "" : `<span class="sec-sum">${escape(summary || "")}</span>`}</div>
        ${open ? body : ""}</section>`;
    };
    const sequenceTitle = { dps: TEXT.sections.sequence, tank: TEXT.sections.tankSequence, debuff: TEXT.sections.debuffSequence, heal: TEXT.sections.healSequence }[mode];
    const enemyName = settings.enemy ? ((window.VOXL_DATA.enemies || []).find((enemy) => enemy.id === settings.enemy) || {}).name : TEXT.enemy.dummy;
    const setup = (mode === "tank" ? section("enemy", 1, TEXT.sections.enemy, enemyName, enemySection) + section("tseq", 2, sequenceTitle, summaryOf(steps), sequenceEditor)
      : section(listKey, 1, sequenceTitle, summaryOf(steps), sequenceEditor) + section("enemy", 2, TEXT.sections.enemy, enemyName, enemySection))
      + section("buffs", 3, TEXT.sections.buffs, buffsSection.summary, buffsSection.html)
      + section("advanced", 4, TEXT.sections.advanced, `${settings.runs}`, advancedSection);

    const previousSetup = A.$("viewTest").querySelector(".tv-setup");
    const keepScroll = previousSetup ? previousSetup.scrollTop : 0;
    A.$("viewTest").innerHTML = `${modeTabs()}
      <div class="tv-grid">
        <div class="tv-setup">${setup}</div>
        <div class="tv-results" id="testResults"></div>
      </div>`;
    A.$("viewTest").querySelector(".tv-setup").scrollTop = keepScroll;
    renderResults(A);
  }

  const modeTabs = () => `<div class="mode-tabs test-modes" role="tablist">${MODES.map((mode) =>
    `<button class="mode-tab outline${interfaceState.mode === mode ? " active" : ""}" data-test-mode="${mode}" role="tab" aria-selected="${interfaceState.mode === mode}">${TEXT.modes[mode]}</button>`).join("")}</div>`;

  function formulaNames(entries) {
    const names = new Set();
    const visit = (value) => {
      if (typeof value === "string") { try { window.VoxlExpression.names(value).variables.forEach((name) => names.add(name)); } catch (error) { /* not a formula */ } }
      else if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === "object") Object.values(value).forEach(visit);
    };
    entries.forEach(visit);
    return names;
  }

  function renderBuffs(A, state, inputs) {
    const escape = A.esc;
    const { settings, profile } = state;
    const rules = Rules.current();
    const statuses = Object.entries(rules.core.statuses).filter(([, status]) => !status.hidden).sort((a, b) => a[1].name.localeCompare(b[1].name));
    const startRows = (side) => Object.entries((settings.start || {})[side] || {}).map(([id, potency]) => `<div class="buff-row">
        <b>${escape(statusName(id))}</b><span class="lab">${TEXT.buffs.potency}</span>${inputs.numberInput(`start.${side}.${id}`, potency, 'step="0.05" min="0"')}
        <button class="mv del" data-start-del="${side}:${id}" aria-label="✕">✕</button></div>`).join("");
    const startPicker = (side) => `<select class="sort mini" data-start-add="${side}" aria-label="${TEXT.buffs.addStatus}"><option value="">${TEXT.buffs.addStatus}</option>
      ${statuses.filter(([id]) => !((settings.start || {})[side] || {})[id] && (side === "self" || rules.core.statuses[id].kind === "debuff")).map(([id, status]) => `<option value="${escape(id)}">${escape(status.name)}</option>`).join("")}</select>`;
    const potionRows = Object.keys(rules.attacks.potions).map((id) => {
      const [name, description] = TEXT.potions[id] || [id, ""];
      return `<div class="buff-row">${inputs.checkbox(`potions.${id}`, !!(settings.potions || {})[id], `<b>${escape(name)}</b>`)}<span class="muted">${escape(description)}</span></div>`;
    }).join("");
    const owned = Object.entries(profile.allPerks).filter(([id, amount]) => amount && rules.perks[id]);
    const situational = owned.filter(([id]) => rules.perks[id].situational);
    const alwaysOn = owned.filter(([id]) => !rules.perks[id].situational && !id.startsWith("race:"));
    const perkRow = ([id, amount], path, on) => `<div class="buff-row">${inputs.checkbox(path, on, `<b>${escape(perkName(id))}</b> <span class="muted">+${format(amount, 2)}</span>`)}</div>`;
    const usedNames = formulaNames(Object.keys(profile.perks).map((id) => rules.perks[id]).filter(Boolean));
    const conditionRows = rules.core.conditions.filter((condition) => condition.scope !== "step" && usedNames.has(condition.id)).map((condition) => {
      const value = profile.conditions[condition.id];
      if (condition.type === "boolean") return inputs.checkbox(`conditions.${condition.id}`, value, escape(condition.label));
      return `<label class="sit"><span>${escape(condition.label)}</span>${inputs.numberInput(`conditions.${condition.id}`, value, `step="${condition.step}" min="${condition.min}" max="${condition.max}"`)}</label>`;
    });
    const numberConditions = conditionRows.filter((row) => row.startsWith("<label class=\"sit\""));
    const booleanConditions = conditionRows.filter((row) => !row.startsWith("<label class=\"sit\""));
    const group = (title, body) => (body ? `<div class="buff-group"><div class="sub-h outline">${title}</div>${body}</div>` : "");
    const startCount = Object.keys(settings.start.self || {}).length + Object.keys(settings.start.target || {}).length;
    const onCount = startCount + Object.values(settings.potions || {}).filter(Boolean).length + situational.filter(([id]) => settings.situational[id]).length;
    const html = `
      <div class="buff-group"><div class="sub-h outline" title="${TEXT.buffs.startHelp}">${TEXT.buffs.startWith}</div>
        <div class="opt-row"><span class="lab">${TEXT.buffs.onYou}</span>${startPicker("self")}</div>${startRows("self")}
        <div class="opt-row"><span class="lab">${TEXT.buffs.onEnemy}</span>${startPicker("target")}</div>${startRows("target")}</div>
      ${group(TEXT.buffs.potions, potionRows)}
      ${group(TEXT.buffs.situational, situational.map((entry) => perkRow(entry, `situational.${entry[0]}`, !!settings.situational[entry[0]])).join(""))}
      ${conditionRows.length ? group(TEXT.buffs.conditions, `<div class="sit-grid">${numberConditions.join("")}</div>${booleanConditions.join("")}`) : ""}
      ${alwaysOn.length ? fold("alwaysOn", `${TEXT.buffs.alwaysOn(alwaysOn.length)} <span class="muted">${TEXT.buffs.untick}</span>`, alwaysOn.map((entry) => perkRow(entry, `perkOn.${entry[0]}`, !settings.perkOff[entry[0]])).join("")) : ""}`;
    return { html, summary: onCount ? TEXT.buffs.summaryOn(onCount) : TEXT.buffs.summaryNone };
  }

  function renderEnemy(A, state, mode, inputs) {
    const escape = A.esc;
    const { settings, profile } = state;
    const colors = views().TYPE_COLORS;
    const enemies = window.VOXL_DATA.enemies || [];
    const enemy = settings.enemy ? enemies.find((entry) => entry.id === settings.enemy) : null;
    const defenseChips = Object.entries(settings.target).filter(([, value]) => value).map(([type, value]) => `<span class="chip outline" style="color:${colors[type]}">${type} ${value > 0 ? "+" : ""}${value}%</span>`).join("") || `<span class="muted">${TEXT.enemy.noDefenses}</span>`;
    const icon = enemy && enemy.image ? A.img(enemy.image, enemy.name) : `<span class="seq-badge outline">🎯</span>`;
    let attacksBlock = "";
    if (mode === "tank") {
      const incomingSteps = Array.isArray(settings.inc.seq) ? settings.inc.seq : Engine.defaultIncoming(enemy);
      const rows = incomingSteps.map((step, index) => {
        const attack = Engine.incomingStep(step, enemy);
        return `<div class="seq-step${attack ? "" : " missing"}">
          <span class="seq-num outline">${index + 1}</span>
          <span class="seq-ico portrait sm">${step.a === "c" ? `<span class="seq-badge outline">C</span>` : icon}</span>
          <span class="seq-name"><b>${escape(attack ? attack.name : TEXT.enemy.unknownAttack)}</b><i>${attack ? escape(typesText(attack.parts, TEXT.enemy.noDamage)) + (attack.guardbreak ? " · " + TEXT.enemy.guardbreak : "") : ""}</i></span>
          <span class="seq-n"><span class="muted">×</span><input class="num" type="number" data-inc-n="${index}" value="${step.n || 1}" step="1" min="1" max="50" aria-label="×"></span>
          <span class="seq-btns">
            <button class="mv" data-inc-move="${index}" data-dir="-1" ${index === 0 ? "disabled" : ""} aria-label="▲">▲</button>
            <button class="mv" data-inc-move="${index}" data-dir="1" ${index === incomingSteps.length - 1 ? "disabled" : ""} aria-label="▼">▼</button>
            <button class="mv del" data-inc-del="${index}" aria-label="✕">✕</button>
          </span></div>
          ${step.a === "c" ? `<div class="custom-card inc-custom">
            <div class="opt-row"><span class="lab">${TEXT.damage}</span><input class="num" type="number" data-inc-dmg="${index}" value="${step.dmg}" step="1" min="0" aria-label="${TEXT.damage}">
              <label class="toggle"><input type="checkbox" data-inc-guard="${index}" ${step.guardbreak ? "checked" : ""}> <span>${TEXT.enemy.breaksGuard}</span></label></div>
            <div class="opt-row"><span class="lab">${TEXT.damageType}</span>${inputs.typeSplit("i:" + index, step.types, "Physical")}</div></div>` : ""}`;
      }).join("");
      const adds = (enemy ? enemy.attacks.map((attack, index) => `<button class="seq-add" data-inc-add="${index}" title="${escape(attack.name)}"><span class="seq-ico portrait sm">${icon}</span>
          <span>${escape(attack.name)} ${format(Object.values(attack.parts).reduce((sum, value) => sum + value, 0), 1)}${attack.guardbreak ? " ⛨" : ""}</span></button>`) : [])
        .concat(`<button class="seq-add" data-inc-add="c" title="${TEXT.enemy.customHit}"><span class="seq-ico portrait sm"><span class="seq-badge outline">C</span></span><span>${TEXT.enemy.customHit}</span></button>`).join("");
      const canParry = (profile.effects.parry || []).length > 0;
      attacksBlock = `
        <div class="sub-h outline">${TEXT.enemy.attacks}</div>
        <div class="seq-list">${rows || `<div class="seq-empty">${TEXT.enemy.noAttacks}</div>`}</div>
        <div class="seq-adds">${adds}</div>
        <div class="opt-row"><span class="lab">${TEXT.enemy.hitsPer10}</span>${inputs.numberInput("inc.per10", settings.inc.per10, 'step="1" min="0" max="100"')}
          <span class="lab">${TEXT.enemy.stun}</span>${inputs.numberInput("inc.stun", settings.inc.stun, 'step="0.1" min="0" max="10"')}<span class="muted">s</span></div>
        <div class="opt-row"><span class="lab">${TEXT.enemy.youBlock}</span>${inputs.numberInput("inc.blockPct", settings.inc.blockPct, 'step="5" min="0" max="100"')}<span class="muted">${TEXT.enemy.ofHits}</span>
          ${canParry ? `<span class="lab">${TEXT.enemy.youParry}</span>${inputs.numberInput("inc.parryPct", settings.inc.parryPct, 'step="5" min="0" max="100"')}<span class="muted">${TEXT.enemy.ofHits}</span>` : ""}</div>`;
    }
    return `
      <div class="enemy-row">${enemy && enemy.image ? A.portrait(A.img(enemy.image, enemy.name), true) : `<span class="seq-badge outline">🎯</span>`}
        <select class="sort mini" data-enemy aria-label="${TEXT.sections.enemy}">
          <option value="">${TEXT.enemy.dummy}</option>
          ${enemies.map((entry) => `<option value="${escape(entry.id)}"${enemy && entry.id === enemy.id ? " selected" : ""}>${escape(entry.name)} · ${TEXT.enemy.hp(format(entry.hp, 0))}</option>`).join("")}
        </select></div>
      <div class="sub-h outline">${TEXT.enemy.defenses}</div>
      <div class="chips">${defenseChips}</div>
      ${fold("defenses", TEXT.enemy.editDefenses, `<div class="def-grid">${Object.keys(settings.target).map((type) => `<label class="def"><span class="outline" style="color:${colors[type]}">${type}</span>${inputs.numberInput(`target.${type}`, settings.target[type], 'step="5"')}</label>`).join("")}</div>`)}
      ${attacksBlock}`;
  }

  function renderResults(A) {
    const box = A.$("testResults");
    if (!box) return;
    const state = currentState(A);
    const mode = interfaceState.mode;
    const kpiRuns = Math.max(20, Math.round(state.settings.runs / 4));
    const dps = runTab(state, "dps", mode === "dps" ? 0 : kpiRuns);
    const tank = runTab(state, "tank", mode === "tank" ? 0 : kpiRuns);
    const heal = runTab(state, "heal", mode === "heal" ? 0 : kpiRuns);
    const body = mode === "dps" ? dpsBody(A, state, dps) : mode === "tank" ? tankBody(A, state, tank) : mode === "debuff" ? debuffBody(A, state, runTab(state, "debuff", 0)) : healBody(A, state, heal);
    const kpi = (id, label, value, sub, color, tooltip) => `<button class="kpi${mode === id ? " on" : ""}" data-test-mode="${id}" aria-pressed="${mode === id}"${tooltip ? ` title="${tooltip}"` : ""}>
      <span class="lab">${label}</span><b class="outline" style="color:${color}">${value}</b><span class="kpi-sub">${sub}</span></button>`;
    const perSecond = (value, report) => value / Math.max(1e-9, report.duration);
    box.innerHTML = `
      <div class="kpis">
        ${kpi("dps", TEXT.results.total, format(dps.damage, 0), TEXT.results.inSeconds(format(dps.duration, 2)), "#fff3dc", TEXT.results.spread(format(dps.spread.low, 0), format(dps.spread.high, 0), dps.runs))}
        ${kpi("dps", TEXT.results.dps, format(perSecond(dps.damage, dps)), TEXT.results.estimated, "#6dff9a", TEXT.results.estimatedHelp)}
        ${kpi("tank", TEXT.results.taken, format(perSecond(tank.taken.total, tank), 1), TEXT.results.inSeconds(format(tank.duration, 0)), "#ff9a9a")}
        ${kpi("heal", TEXT.results.healed, format(perSecond(heal.healing.self + heal.healing.allies, heal), 1), TEXT.results.inSeconds(format(heal.duration, 1)), "#6dff9a")}
      </div>
      ${body}
      ${errorsCard(A, [dps, tank, heal])}`;
  }

  function errorsCard(A, reports) {
    const errors = [...new Set(reports.flatMap((report) => report.errors || []))];
    return errors.length ? `<div class="res-card"><div class="res-title outline">${TEXT.results.errors}</div>${errors.slice(0, 12).map((error) => `<div class="step"><span>${A.esc(error)}</span></div>`).join("")}</div>` : "";
  }

  function stepRows(A, state, report, value, clickable) {
    const escape = A.esc;
    const actionByKey = stepLookup(A, state);
    return (report.steps || []).map((step) => {
      const action = actionByKey[step.action];
      const name = action ? action[1] : step.action;
      const passive = step.action === "wait" || step.action.startsWith("status:");
      const when = step.start === null ? TEXT.results.notUsed : `${format(step.start, 2)}s → ${format(step.end === null ? step.start : step.end, 2)}s`;
      const notes = [
        step.uses > 1.001 ? `×${format(step.uses, 1)}` : "", step.waited > 0.005 ? TEXT.results.waited(format(step.waited, 2)) : "",
        step.skipped > 0.05 ? (step.note === "energy" ? TEXT.results.energySkip : TEXT.results.skipped(format(step.skipped, 1))) : "", step.note === "missing" ? TEXT.results.missing : "",
      ].filter(Boolean).join(" · ");
      const [big, small] = passive ? ["", ""] : value(step);
      const attributes = clickable && !passive ? `data-detail="${escape(step.action)}"` : "";
      const extras = clickable ? Object.entries(step.extra || {}).filter(([, damage]) => damage > 0.05).sort((first, second) => second[1] - first[1]) : [];
      return `<button class="seq-res${clickable ? "" : " static"}" ${attributes} ${passive ? "disabled" : ""}>
        <span class="seq-num outline">${step.index + 1}</span><span class="seq-ico${action && action[3] ? " portrait sm" : " blank"}">${action ? action[3] : ""}</span>
        <span class="seq-name"><b>${escape(name)}</b><i>${escape(when)}${notes ? " · " + escape(notes) : ""}</i></span>
        <span class="seq-dmg"><b class="outline">${big}</b>${small ? `<i>${small}</i>` : ""}</span>
        ${extras.length ? `<span class="seq-extra">${extras.map(([source, damage]) => `<span>${escape(source)}</span><b>+${format(damage, 1)}</b>`).join("")}</span>` : ""}</button>`;
    }).join("");
  }

  function dpsBody(A, state, report) {
    const escape = A.esc;
    const tab = ["sequence", "detail", "uptime", "perks"].includes(interfaceState.tab) ? interfaceState.tab : "sequence";
    const total = Math.max(1e-9, report.damage);
    const stepDamage = report.steps.reduce((sum, step) => sum + step.damage, 0);
    const background = Math.max(0, report.damage - stepDamage);
    const backgroundRow = background > 0.5 ? `<div class="seq-res static"><span class="seq-num outline">+</span><span class="seq-ico portrait sm"><span class="seq-badge outline">☠</span></span>
        <span class="seq-name"><b>${TEXT.results.background}</b><i>${TEXT.results.backgroundSub(format(report.duration, 2))}</i></span>
        <span class="seq-dmg"><b class="outline">${format(background, 0)}</b><i>${format((background / total) * 100, 0)}%</i></span></div>` : "";
    const chartData = chartSeries(report);
    const sequenceTab = `<div class="res-card">
        <div class="res-title outline" title="${TEXT.results.clickStep}">${TEXT.results.yourSequence}</div>
        <div class="seq-results">${stepRows(A, state, report, (step) => [format(step.damage, 0), `${format((step.damage / total) * 100, 0)}%`], true) || `<div class="muted">${TEXT.results.noSteps}</div>`}${backgroundRow}</div>
        ${report.duration > 0 ? chart(escape, report, chartData) : ""}
        <div class="legend">${chartData.series.map(({ label, total: value, color }) => `<span><i style="background:${color}"></i>${escape(label)} ${format((value / total) * 100, 0)}%</span>`).join("")}</div>
        ${Object.keys(report.byType).length ? `<div class="sub-h outline">${TEXT.results.byType}</div><div class="bars">${typeBars(escape, report.byType)}</div>` : ""}
      </div>`;
    const body = tab === "sequence" ? sequenceTab : tab === "detail" ? detailTab(A, state) : tab === "uptime" ? uptimeCard(A, report, null) : perksCard(A, state);
    return `<div class="res-tabs mode-tabs">
        ${Object.entries(TEXT.results.tabs).map(([key, label]) => `<button class="mode-tab outline${tab === key ? " active" : ""}" data-test-tab="${key}">${label}</button>`).join("")}
      </div>
      <div class="tab-body">${body}</div>`;
  }

  function detailTab(A, state) {
    const escape = A.esc;
    const usable = actionList(A, state).filter(([key]) => key !== "wait");
    const fromSequence = (state.settings.seq || []).map((step) => step.a).find((key) => usable.some(([usableKey]) => usableKey === key));
    const key = usable.some(([usableKey]) => usableKey === interfaceState.detail) ? interfaceState.detail : fromSequence || (usable[0] || [""])[0];
    const picker = `<div class="mode-tabs wrap detail-pick">${usable.map(([actionKey, name]) => `<button class="mode-tab outline${actionKey === key ? " active" : ""}" data-detail="${escape(actionKey)}">${escape(name.toUpperCase())}</button>`).join("")}</div>`;
    if (!key) return picker;
    const details = cached(`${state.signature}|detail|${key}`, () => Engine.hitDetails(state.profile, Engine.tabOptions(state.settings, "dps"), key));
    const average = details.average;
    const name = (usable.find(([actionKey]) => actionKey === key) || [key, key])[1];
    if (!(average.damage > 0)) return `${picker}<div class="res-card"><div class="res-title outline">${escape(name)}</div><div class="muted">${TEXT.results.noDamage}</div></div>`;
    const main = MAIN_SOURCES.reduce((sum, source) => sum + (average.bySource[source] || 0), 0);
    const extra = Math.max(0, average.damage - main);
    const extras = Object.entries(average.byProc).filter(([, value]) => value > 0.0005).sort((a, b) => b[1] - a[1]);
    const swings = key === "m1" ? `<div class="sub-h outline">${TEXT.results.swings}</div><div class="swing-list">${average.steps.map((step, index) =>
      `<div class="step"><span>${TEXT.results.swing(index + 1)}${(state.catalog.actions.m1.swings[index] || {}).finisher ? ` (${TEXT.results.finisher})` : ""}</span><b>${format(step.damage)}</b></div>`).join("")}</div>` : "";
    const trace = details.trace;
    const formula = trace ? [
      [TEXT.results.formulaRows.base, format(trace.base, 2)],
      [TEXT.results.formulaRows.scaling, `+${format((trace.boost - 1) * 100, 1)}% (${Object.entries(trace.scalings).map(([scaling, value]) => `${scaling} ${format(value, 2)}`).join(", ")})`],
      [TEXT.results.formulaRows.level, format(trace.levelMultiplier, 3)],
      ...trace.bonuses.map(([label, value]) => [`${label} ×`, format(value, 3)]),
      ...trace.parts.map((part) => [TEXT.results.formulaRows.type(part.type), format(part.fraction, 3)]),
      ...Object.entries(trace.typeMultipliers).filter(([, value]) => value !== 1).map(([type, value]) => [TEXT.results.formulaRows.typeMultiplier(type), format(value, 3)]),
      [TEXT.results.formulaRows.crit, `${format(trace.crit.chance, 1)}% / ×${format(trace.crit.multiplier, 3)}`],
      ...Object.entries(trace.armor).map(([type, value]) => [TEXT.results.formulaRows.armor(type), format(value, 3)]),
      [TEXT.results.formulaRows.total, format(trace.total, 2)],
    ] : [];
    return `${picker}<div class="res-card">
      <div class="res-title outline">${escape(name)}</div>
      <div class="big-row">
        <div><span class="lab">${key === "m1" ? TEXT.results.fullCombo : TEXT.results.oneUse}</span><b class="big outline">${format(average.damage)}</b><span class="muted">${extra > 0.05 ? TEXT.results.oneUseSub(format(main), format(extra)) : TEXT.results.averaged}</span></div>
        <div><span class="lab">${TEXT.results.normalCrit}</span><b class="mid outline">${format(details.normal.damage)}</b><b class="mid outline" style="color:#ffd84a">${format(details.critical.damage)}</b></div>
      </div>
      <div class="bars">${typeBars(escape, average.byType)}</div>
      ${swings}
      ${extras.length ? `<div class="sub-h outline">${TEXT.results.procs}</div>${extras.map(([entryName, value]) => `<div class="step"><span>${escape(entryName)}</span><b>+${format(value, 1)}</b></div>`).join("")}` : ""}
      ${formula.length ? `<details class="steps"><summary class="outline">${TEXT.results.formula}</summary>${formula.map(([label, value]) => `<div class="step"><span>${escape(label)}</span><b>${escape(value)}</b></div>`).join("")}</details>` : ""}
    </div>`;
  }

  function uptimeCard(A, report, onlySide) {
    const escape = A.esc;
    const duration = Math.max(1e-9, report.duration);
    const rows = (side) => Object.entries(report.uptime).filter(([key, uptime]) => key.startsWith(side + ":") && uptime.time > 0.01).sort((a, b) => b[1].time - a[1].time).map(([key, uptime]) => {
      const id = key.split(":")[1];
      const applications = report.applications[key] || { count: 0, sources: {} };
      const sources = Object.entries(applications.sources || {}).filter(([source]) => source !== "start").map(([source]) => source).join(", ");
      return `<div class="step col"><span><b class="ename">${escape(statusName(id))}</b> <span class="muted">${escape(sources)}</span></span>
        <span>${TEXT.results.uptimeRow(format(Math.min(100, uptime.time / duration * 100), 0), format(uptime.potencyTime / Math.max(1e-9, uptime.time), 2), format(applications.count, 1))}</span></div>`;
    }).join("");
    const self = onlySide === "target" ? "" : rows("self");
    const target = onlySide === "self" ? "" : rows("target");
    return `<div class="res-card"><div class="res-title outline">${onlySide === "self" ? TEXT.tank.yourStatuses : TEXT.results.uptimeTitle}</div>
      ${onlySide ? "" : `<div class="muted">${TEXT.results.uptimeHelp}</div>`}
      ${self ? `${onlySide ? "" : `<div class="sub-h outline">${TEXT.buffs.onYou}</div>`}${self}` : ""}
      ${target ? `<div class="sub-h outline">${TEXT.buffs.onEnemy}</div>${target}` : ""}
      ${!self && !target ? `<div class="muted">${TEXT.results.noUptime}</div>` : ""}</div>`;
  }

  function perksCard(A, state) {
    const escape = A.esc;
    const rules = Rules.current();
    const groups = { simulated: [], situationalOff: [], notSimulated: [], noRule: [] };
    Object.entries(state.profile.allPerks).forEach(([id, amount]) => {
      if (!amount || id.startsWith("race:")) return;
      const rule = rules.perks[id];
      const label = `${perkName(id)} +${format(amount, 2)}`;
      if (!rule) groups.noRule.push(label);
      else if (rule.simulated === false) groups.notSimulated.push(label);
      else if (!state.profile.perks[id]) groups.situationalOff.push(label);
      else groups.simulated.push(label);
    });
    const chips = (list) => `<div class="chips">${list.map((label) => `<span class="chip">${escape(label)}</span>`).join("")}</div>`;
    return `<div class="res-card"><div class="res-title outline">${TEXT.results.perksTitle}</div>
      ${Object.entries(groups).filter(([, list]) => list.length).map(([key, list]) => `<div class="sub-h outline">${TEXT.results[key]}</div>${chips(list)}`).join("")}</div>`;
  }

  function tankBody(A, state, report) {
    const escape = A.esc;
    const taken = report.taken;
    const duration = Math.max(1e-9, report.duration);
    const healed = report.healing.self;
    const perHit = taken.incomingHits > 0 ? taken.total / taken.incomingHits : 0;
    const rows = [
      [TEXT.tank.maxHp, format(state.profile.variables.maxHp, 0)],
      [TEXT.tank.shield, format(taken.shield, 1)],
      [TEXT.tank.dodged, TEXT.tank.perFight(format(taken.dodged, 1))],
      [TEXT.tank.blocked, TEXT.tank.perFight(format(taken.blocked, 1))],
      ...(taken.parried > 0.005 ? [[TEXT.tank.parried, TEXT.tank.perFight(format(taken.parried, 1))]] : []),
      [TEXT.tank.stunned, `${format(taken.stun, 2)}s`],
      [TEXT.tank.death, report.deathShare > 0 ? TEXT.tank.deathText(format(report.deathShare * 100, 0), format(report.deathTime, 1)) : TEXT.tank.survived],
      ...(report.lowestHp !== null && Number.isFinite(report.lowestHp) ? [[TEXT.tank.lowestHp, format(Math.max(0, report.lowestHp), 0)]] : []),
    ];
    const byAttack = Object.entries(taken.byAttack).sort((a, b) => b[1] - a[1]).map(([name, value]) => `<div class="step"><span>${escape(name)}</span><b>${format(value, 1)}</b></div>`).join("");
    return `<div class="tab-body"><div class="res-card">
        <div class="res-title outline">${TEXT.tank.title}</div>
        <div class="big-row">
          <div><span class="lab">${TEXT.tank.takenPerSecond}</span><b class="big outline" style="color:#ff8a8a">${format(taken.total / duration, 2)}</b><span class="muted">${TEXT.tank.perHit(format(perHit, 2), format(taken.raw > 0 ? taken.total / taken.raw * 100 : 0, 1))}</span></div>
          <div><span class="lab">${TEXT.tank.healedPerSecond}</span><b class="mid outline" style="color:#6dff9a">${format(healed / duration, 2)}</b></div>
        </div>
        <div class="kv">${rows.map(([label, value]) => `<span>${escape(label)}</span><b>${escape(value)}</b>`).join("")}</div>
        ${byAttack ? `<div class="sub-h outline">${TEXT.tank.byAttack}</div>${byAttack}` : ""}
        ${Object.keys(taken.byType).length ? `<div class="sub-h outline">${TEXT.tank.byType}</div><div class="bars">${typeBars(escape, taken.byType)}</div>` : ""}
      </div>${uptimeCard(A, report, "self")}</div>`;
  }

  function debuffBody(A, state, report) {
    const escape = A.esc;
    const rules = Rules.current();
    const duration = Math.max(1e-9, report.duration);
    const debuffs = Object.entries(report.applications).filter(([key]) => key.startsWith("target:")).map(([key, entry]) => [key.split(":")[1], entry, report.uptime[key] || { time: 0, potencyTime: 0 }])
      .filter(([id]) => (rules.core.statuses[id] || {}).kind === "debuff" || (rules.core.statuses[id] || {}).dot).sort((a, b) => b[1].count - a[1].count);
    const rows = debuffs.map(([id, entry, uptime]) => `<div class="step"><span><b>${escape(statusName(id))}</b> <span class="muted">${TEXT.debuff.row(format(entry.count / duration, 2), format(Math.min(100, uptime.time / duration * 100), 0), format(uptime.potencyTime / Math.max(1e-9, uptime.time), 2))}</span></span><b>${TEXT.debuff.times(format(entry.count, 1))}</b></div>`).join("");
    const stepList = stepRows(A, state, report, (step) => {
      const applied = Object.entries(step.applied || {}).filter(([, count]) => count > 0.005);
      const text = applied.map(([id, count]) => `${statusName(id)} ${format(count, 2)}`).join(" · ");
      return [format(applied.reduce((sum, [, count]) => sum + count, 0), 1), text || TEXT.debuff.noDebuffs];
    }, false);
    return `<div class="tab-body"><div class="res-card">
      <div class="res-title outline">${TEXT.debuff.title} <span class="muted">· ${TEXT.debuff.over(format(report.duration, 2))}</span></div>
      ${rows || `<div class="muted">${TEXT.debuff.none}</div>`}
      <div class="sub-h outline">${TEXT.debuff.steps}</div>
      <div class="seq-results">${stepList}</div></div></div>`;
  }

  function healBody(A, state, report) {
    const escape = A.esc;
    const duration = Math.max(1e-9, report.duration);
    const healing = report.healing;
    const total = healing.self + healing.allies;
    const sources = {};
    Object.entries(healing.bySource).forEach(([name, value]) => { sources[name] = (sources[name] || 0) + value; });
    Object.entries(healing.allySources).forEach(([name, value]) => { sources[name] = (sources[name] || 0) + value; });
    const sourceRows = Object.entries(sources).sort((a, b) => b[1] - a[1]).map(([name, value]) => `<div class="step"><span>${escape(name)}</span><b>${format(value / duration, 2)}/s · ${format(value, 1)}</b></div>`).join("");
    return `<div class="tab-body"><div class="res-card">
      <div class="res-title outline">${TEXT.heal.title} <span class="muted">· ${TEXT.heal.over(format(report.duration, 2))}</span></div>
      <div class="big-row">
        <div><span class="lab">${TEXT.heal.healedPerSecond}</span><b class="big outline" style="color:#6dff9a">${format(total / duration, 2)}</b></div>
        <div><span class="lab">${TEXT.heal.total}</span><b class="mid outline" style="color:#6dff9a">${format(total, 1)}</b></div>
      </div>
      <div class="kv"><span>${TEXT.heal.self}</span><b>${format(healing.self, 1)}</b><span>${TEXT.heal.allies}</span><b>${format(healing.allies, 1)}</b></div>
      ${sourceRows ? `<div class="sub-h outline">${TEXT.heal.bySource}</div>${sourceRows}` : `<div class="muted">${TEXT.heal.none}</div>`}
      <div class="sub-h outline">${TEXT.heal.steps}</div>
      <div class="seq-results">${stepRows(A, state, report, (step) => [format(step.healed, 1), TEXT.heal.healed], false)}</div>
    </div></div>`;
  }

  function chartSeries(report) {
    const totals = {};
    const perBin = report.bins.map((bin) => {
      const values = {};
      Object.entries(bin).forEach(([source, names]) => Object.entries(names).forEach(([name, value]) => {
        const label = source === "m1" ? TEXT.results.sources.m1 : name;
        values[label] = (values[label] || 0) + value;
        totals[label] = (totals[label] || 0) + value;
      }));
      return values;
    });
    const series = Object.entries(totals).filter(([, total]) => total > 0.0005).sort((first, second) => second[1] - first[1])
      .map(([label, total], index) => ({ label, total, color: CHART_COLORS[index % CHART_COLORS.length] }));
    return { series, perBin };
  }

  function chart(escape, report, { series, perBin }) {
    const width = 600, height = 140, pad = 20;
    const hasTail = perBin.length > Math.ceil(report.duration);
    const count = Math.max(1, perBin.length);
    const barWidth = (width - pad) / count;
    const average = report.damage / Math.max(1e-9, report.duration);
    const peak = Math.max(1, average, ...perBin.map((bin) => Object.values(bin).reduce((sum, value) => sum + value, 0)));
    let bars = "";
    perBin.forEach((bin, index) => {
      let top = height - pad;
      series.forEach(({ label, color }) => {
        if (!bin[label]) return;
        const barHeight = (bin[label] / peak) * (height - pad - 8);
        top -= barHeight;
        bars += `<rect x="${pad + index * barWidth + 0.5}" y="${top}" width="${Math.max(1, barWidth - 1)}" height="${barHeight}" fill="${color}"><title>${index}s: ${escape(label)} ${format(bin[label])}</title></rect>`;
      });
    });
    const averageY = height - pad - (average / peak) * (height - pad - 8);
    return `<svg class="chart" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img">
      <line x1="${pad}" y1="${height - pad}" x2="${width}" y2="${height - pad}" stroke="#0006"/>
      ${bars}
      <line x1="${pad}" y1="${averageY}" x2="${width}" y2="${averageY}" stroke="#6dff9a" stroke-dasharray="4 3"/>
      <text x="${pad}" y="${height - 5}" fill="#fff3dc" font-size="13" font-weight="600">0s</text>
      <text x="${width}" y="${height - 5}" fill="#fff3dc" font-size="13" font-weight="600" text-anchor="end">${format(hasTail ? perBin.length : report.duration, 2)}s</text>
    </svg>`;
  }

  function ruleEntries(section) {
    return Object.entries(Rules.section(section)).sort((a, b) => a[0].localeCompare(b[0]));
  }

  function entryLabel(section, key) {
    if (section === "perks") return key.startsWith("race:") ? key : perkName(key);
    if (section === "statuses") return statusName(key);
    if (section === "arts") return (window.VoxlModel.artById[key] || { name: key }).name;
    if (section === "runes" || section === "potions") return ((window.VOXL_DATA.items.find((item) => item.id === key)) || { name: (TEXT.potions[key] || [key])[0] }).name;
    if (section === "spirits") return perkName(key);
    return key;
  }

  function renderRules(A) {
    const escape = A.esc;
    const section = Rules.SECTIONS.includes(interfaceState.ruleSection) ? interfaceState.ruleSection : "perks";
    const search = interfaceState.ruleSearch.toLowerCase();
    const entries = ruleEntries(section).filter(([key]) => !search || key.toLowerCase().includes(search) || entryLabel(section, key).toLowerCase().includes(search));
    const key = interfaceState.ruleKey && Rules.section(section)[interfaceState.ruleKey] !== undefined ? interfaceState.ruleKey : "";
    const list = entries.map(([entryKey]) => `<button class="seq-res${entryKey === key ? " on" : ""}" data-rule-key="${escape(entryKey)}">
        <span class="seq-name"><b>${escape(entryLabel(section, entryKey))}</b><i>${escape(entryKey)}${Rules.isEdited(section, entryKey) ? " · " + TEXT.rules.edited : ""}</i></span></button>`).join("");
    const editedCount = Rules.editedCount();
    const left = `<section class="cv-sec tsec open">
        <div class="cv-head"><h3 class="outline">${TEXT.rules.title}</h3>${editedCount ? `<span class="sec-sum">${TEXT.rules.editedCount(editedCount)}</span>` : ""}</div>
        <div class="muted seq-help">${TEXT.rules.help}</div>
        <div class="opt-row"><button class="mode-tab outline" data-rules-export>${TEXT.rules.export}</button>
          <button class="mode-tab outline" data-rules-import>${TEXT.rules.import}</button>
          <button class="mode-tab outline" data-rules-reset-all>${interfaceState.resetArmed ? TEXT.rules.resetAllConfirm : TEXT.rules.resetAll}</button>
          <input type="file" accept=".json,application/json" data-rules-file hidden></div>
        <div class="opt-row"><span class="lab">${TEXT.rules.section}</span><select class="sort mini" data-rule-section>${Rules.SECTIONS.map((name) => `<option value="${name}"${name === section ? " selected" : ""}>${TEXT.rules.sections[name]}</option>`).join("")}</select></div>
        <div class="opt-row"><input class="search" data-rule-search value="${escape(interfaceState.ruleSearch)}" placeholder="${TEXT.rules.search}"></div>
        <div class="opt-row"><button class="mode-tab outline" data-rule-new>${TEXT.rules.newEntry}</button></div>
        <div class="seq-results rule-list">${list}</div></section>`;
    let editor = `<div class="res-card"><div class="muted">${TEXT.rules.pick}</div></div>`;
    if (key) {
      const draft = interfaceState.ruleDraft !== null ? interfaceState.ruleDraft : JSON.stringify(Rules.section(section)[key], null, 2);
      editor = `<div class="res-card">
        <div class="res-title outline">${escape(entryLabel(section, key))} <span class="muted">· ${escape(key)}</span></div>
        <textarea class="rule-text" data-rule-text spellcheck="false" rows="22">${escape(draft)}</textarea>
        <div class="opt-row"><button class="mode-tab outline" data-rule-save>${TEXT.rules.save}</button>
          ${Rules.isEdited(section, key) ? `<button class="mode-tab outline" data-rule-reset>${TEXT.rules.reset}</button>` : ""}</div>
        ${interfaceState.ruleMessage ? `<div class="cv-note">${escape(interfaceState.ruleMessage)}</div>` : ""}
      </div>`;
    }
    A.$("viewTest").innerHTML = `${modeTabs()}
      <div class="tv-grid">
        <div class="tv-setup">${left}</div>
        <div class="tv-results">${editor}${referenceCard(escape)}</div>
      </div>`;
  }

  function referenceCard(escape) {
    const rules = Rules.current();
    const examples = {};
    Object.values(rules.perks).forEach((perk) => (perk.effects || []).forEach((effect) => { if (!examples[effect.type]) examples[effect.type] = effect; }));
    Object.values(rules.core.statuses).forEach((status) => (status.onSelf || []).concat(status.onTarget || []).forEach((effect) => { if (!examples[effect.type]) examples[effect.type] = effect; }));
    const rows = Object.entries(examples).sort((a, b) => a[0].localeCompare(b[0])).map(([type, effect]) => `<div class="step col"><span><b class="ename">${escape(type)}</b></span><code class="rule-code">${escape(JSON.stringify(effect))}</code></div>`).join("");
    return `<div class="res-card"><details class="steps"><summary class="outline">${TEXT.rules.reference}</summary>
      <div class="muted">${TEXT.rules.referenceHelp}</div>${rows}</details></div>`;
  }

  function saveRuleDraft(A) {
    const section = interfaceState.ruleSection;
    const key = interfaceState.ruleKey;
    const text = interfaceState.ruleDraft !== null ? interfaceState.ruleDraft : JSON.stringify(Rules.section(section)[key]);
    let value;
    try { value = JSON.parse(text); } catch (error) { interfaceState.ruleMessage = TEXT.rules.invalidJson(error.message); return renderRules(A); }
    const problems = Rules.validateEntry(value);
    if (problems.length) { interfaceState.ruleMessage = problems.map((problem) => TEXT.rules.formulaProblem(problem.path, problem.error)).join(" · "); return renderRules(A); }
    Rules.setEntry(section, key, value);
    interfaceState.ruleDraft = null;
    interfaceState.ruleMessage = TEXT.rules.saved;
    renderRules(A);
  }

  function exportRules() {
    const blob = new Blob([Rules.exportEdits()], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "voxlbuilder-rules.json";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  function setPath(object, path, value) {
    const keys = path.split(".");
    let node = object;
    keys.slice(0, -1).forEach((key) => { if (!node[key] || typeof node[key] !== "object") node[key] = {}; node = node[key]; });
    const last = keys[keys.length - 1];
    if (value === undefined) delete node[last];
    else node[last] = value;
  }

  function readInput(element) {
    if (element.type === "checkbox") return element.checked;
    if (element.tagName === "SELECT") return /^-?\d+(\.\d+)?$/.test(element.value) ? +element.value : element.value;
    if (element.value === "") return undefined;
    const value = parseFloat(element.value);
    return Number.isFinite(value) ? value : undefined;
  }

  function writeSetting(settings, path, value) {
    if (path.startsWith("perkOn.")) {
      const id = path.slice(7);
      if (value) delete settings.perkOff[id];
      else settings.perkOff[id] = true;
      return;
    }
    if (path.startsWith("situational.") || path.startsWith("potions.")) {
      const [group, id] = [path.slice(0, path.indexOf(".")), path.slice(path.indexOf(".") + 1)];
      if (value) settings[group][id] = true;
      else delete settings[group][id];
      return;
    }
    setPath(settings, path, value);
  }

  function setEnemy(settings, id) {
    const enemy = id ? (window.VOXL_DATA.enemies || []).find((entry) => entry.id === id) : null;
    settings.enemy = enemy ? enemy.id : "";
    Object.keys(settings.target).forEach((type) => { settings.target[type] = (enemy && enemy.defenses[type]) || 0; });
    settings.inc.seq = null;
  }

  function bindTest(A) {
    const root = A.$("viewTest");
    const settings = () => A.build().test;
    let resultTimer = null;
    const changed = (full) => {
      A.save();
      if (full) return renderTest(A);
      clearTimeout(resultTimer);
      resultTimer = setTimeout(() => renderResults(A), 180);
    };
    const enemyOf = () => (settings().enemy ? (window.VOXL_DATA.enemies || []).find((entry) => entry.id === settings().enemy) : null);
    const incomingSteps = () => settings().inc.seq || (settings().inc.seq = Engine.defaultIncoming(enemyOf()).map((step) => ({ ...step })));
    const customOf = (id) => (settings().customs || []).find((custom) => custom.id === id);
    const typesOf = (target) => {
      const [kind, key] = target.split(":");
      const owner = kind === "c" ? customOf(key) : incomingSteps()[+key];
      return owner ? owner.types || (owner.types = {}) : null;
    };
    const numberOf = (element) => { const value = parseFloat(element.value); return Number.isFinite(value) ? value : null; };
    const editField = (element) => {
      const value = numberOf(element);
      if (element.dataset.custom) {
        const custom = customOf(element.dataset.custom);
        if (custom && element.dataset.field === "name") custom.name = element.value.slice(0, 30) || "Custom hit";
        else if (custom && value !== null) custom[element.dataset.field] = element.dataset.field === "hits" ? Math.max(1, Math.min(50, Math.round(value))) : Math.max(0, value);
        return true;
      }
      if (element.dataset.tsplit) {
        const types = typesOf(element.dataset.tsplit);
        if (types && value !== null) types[element.dataset.type] = Math.max(0, Math.min(10, value));
        return true;
      }
      if (element.dataset.incN !== undefined || element.dataset.incDmg !== undefined) {
        const step = incomingSteps()[+(element.dataset.incN !== undefined ? element.dataset.incN : element.dataset.incDmg)];
        if (step && value !== null) { if (element.dataset.incN !== undefined) step.n = Math.max(1, Math.min(50, Math.round(value))); else step.dmg = Math.max(0, value); }
        return true;
      }
      return false;
    };
    root.addEventListener("input", (event) => {
      const element = event.target;
      if (element.matches("[data-rule-text]")) { interfaceState.ruleDraft = element.value; return; }
      if (element.matches("[data-rule-search]")) {
        interfaceState.ruleSearch = element.value;
        const position = element.selectionStart;
        renderRules(A);
        const search = root.querySelector("[data-rule-search]");
        search.focus();
        search.setSelectionRange(position, position);
        return;
      }
      if (editField(element)) return changed(false);
      if (element.dataset.seqC !== undefined) {
        const step = (settings()[element.dataset.list] || [])[+element.dataset.seqC];
        if (!step) return;
        const charge = Math.max(0, Math.min(1, (+element.value || 0) / 100));
        if (charge > 0) step.c = charge; else delete step.c;
        element.nextElementSibling.textContent = TEXT.chargeLabel(Math.round(charge * 100), format(charge * +element.dataset.time, 1));
        return changed(false);
      }
      if (element.dataset.stepCond !== undefined) {
        const step = (settings()[element.dataset.list] || [])[+element.dataset.stepCond];
        const value = element.type === "checkbox" ? element.checked : parseFloat(element.value);
        if (!step || (typeof value === "number" && !Number.isFinite(value))) return;
        step.k = { ...(step.k || {}), [element.dataset.cond]: value };
        return changed(false);
      }
      if (element.dataset.seqP !== undefined || element.dataset.seqD !== undefined) {
        const isPotency = element.dataset.seqP !== undefined;
        const step = (settings()[element.dataset.list] || [])[+(isPotency ? element.dataset.seqP : element.dataset.seqD)];
        const value = parseFloat(element.value);
        if (!step) return;
        if (isPotency) { if (Number.isFinite(value)) step.p = Math.max(0, Math.min(100, value)); }
        else if (Number.isFinite(value) && value > 0) step.d = Math.min(600, Math.max(0.1, value));
        else delete step.d;
        return changed(false);
      }
      if (element.dataset.seqN !== undefined || element.dataset.seqW !== undefined) {
        const index = +(element.dataset.seqN !== undefined ? element.dataset.seqN : element.dataset.seqW);
        const value = parseFloat(element.value);
        const list = settings()[element.dataset.list] || [];
        if (!Number.isFinite(value) || !list[index]) return;
        if (element.dataset.seqN !== undefined) list[index].n = Math.max(1, Math.min(50, Math.round(value)));
        else list[index].w = Math.max(0.1, Math.min(60, value));
        return changed(false);
      }
      const field = element.closest("[data-path]");
      if (!field || field.type === "checkbox" || field.tagName === "SELECT") return;
      writeSetting(settings(), field.dataset.path, readInput(field));
      changed(false);
    });
    root.addEventListener("toggle", (event) => {
      const id = event.target.dataset && event.target.dataset.fold;
      if (!id) return;
      if (event.target.open) interfaceState.openFolds.add(id); else interfaceState.openFolds.delete(id);
      saveInterface();
    }, true);
    root.addEventListener("change", (event) => {
      const element = event.target;
      if (element.matches("[data-rule-section]")) {
        interfaceState.ruleSection = element.value;
        interfaceState.ruleKey = "";
        interfaceState.ruleDraft = null;
        interfaceState.ruleMessage = "";
        saveInterface();
        return renderRules(A);
      }
      if (element.matches("[data-rules-file]")) {
        const file = element.files && element.files[0];
        if (!file) return;
        file.text().then((text) => {
          try { Rules.importEdits(text); interfaceState.ruleMessage = TEXT.rules.imported; } catch (error) { interfaceState.ruleMessage = TEXT.rules.importFailed(error.message); }
          interfaceState.ruleDraft = null;
          renderRules(A);
        });
        return;
      }
      if (element.dataset.tsplitAdd !== undefined) {
        const types = typesOf(element.dataset.tsplitAdd);
        if (types && element.value) types[element.value] = Object.keys(types).length ? 0.5 : 1;
        return changed(true);
      }
      if (element.dataset.startAdd !== undefined) {
        if (element.value) settings().start[element.dataset.startAdd][element.value] = Rules.current().core.statuses[element.value].kind === "debuff" ? 1 : 0.3;
        return changed(true);
      }
      if (element.dataset.incGuard !== undefined) {
        const step = incomingSteps()[+element.dataset.incGuard];
        if (step) { if (element.checked) step.guardbreak = true; else delete step.guardbreak; }
        return changed(true);
      }
      if (editField(element)) return changed(true);
      if (element.matches("[data-enemy]")) { setEnemy(settings(), element.value); return changed(true); }
      const field = element.closest("[data-path]");
      if (!field || (field.type !== "checkbox" && field.tagName !== "SELECT")) return;
      writeSetting(settings(), field.dataset.path, readInput(field));
      changed(true);
    });
    root.addEventListener("click", (event) => {
      const find = (selector) => event.target.closest(selector);
      root.querySelectorAll(".step-picker[open]").forEach((picker) => { if (!picker.contains(event.target)) picker.open = false; });
      let element;
      if ((element = find("[data-toggle-sec]"))) {
        const id = element.dataset.toggleSec;
        if (interfaceState.closed.has(id)) interfaceState.closed.delete(id); else interfaceState.closed.add(id);
        saveInterface();
        return renderTest(A);
      }
      if ((element = find("[data-test-mode]"))) {
        interfaceState.mode = element.dataset.testMode;
        saveInterface();
        return renderTest(A);
      }
      if ((element = find("[data-test-tab]"))) {
        interfaceState.tab = element.dataset.testTab;
        saveInterface();
        return renderResults(A);
      }
      if ((element = find("[data-detail]")) && !element.disabled) { interfaceState.detail = element.dataset.detail; interfaceState.tab = "detail"; saveInterface(); return renderResults(A); }
      if ((element = find("[data-rule-key]"))) {
        interfaceState.ruleKey = element.dataset.ruleKey;
        interfaceState.ruleDraft = null;
        interfaceState.ruleMessage = "";
        saveInterface();
        return renderRules(A);
      }
      if (find("[data-rule-save]")) return saveRuleDraft(A);
      if (find("[data-rule-reset]")) {
        Rules.resetEntry(interfaceState.ruleSection, interfaceState.ruleKey);
        interfaceState.ruleDraft = null;
        interfaceState.ruleMessage = "";
        return renderRules(A);
      }
      if (find("[data-rule-new]")) {
        const key = (window.prompt(TEXT.rules.newKeyPrompt) || "").trim();
        if (!key) return;
        const template = interfaceState.ruleSection === "perks" ? { effects: [] } : interfaceState.ruleSection === "statuses" ? { name: key, kind: "buff", onSelf: [] } : { hits: [] };
        Rules.setEntry(interfaceState.ruleSection, key, Rules.section(interfaceState.ruleSection)[key] || template);
        interfaceState.ruleKey = key;
        interfaceState.ruleDraft = null;
        return renderRules(A);
      }
      if (find("[data-rules-export]")) return exportRules();
      if (find("[data-rules-import]")) return root.querySelector("[data-rules-file]").click();
      if (find("[data-rules-reset-all]")) {
        if (interfaceState.resetArmed) { Rules.resetAll(); interfaceState.resetArmed = false; interfaceState.ruleDraft = null; }
        else interfaceState.resetArmed = true;
        return renderRules(A);
      }
      if (find("[data-custom-new]")) {
        const customs = settings().customs || (settings().customs = []);
        let number = 1;
        while (customs.some((custom) => custom.id === "c" + number)) number++;
        if (customs.length < 8) customs.push({ id: "c" + number, name: "Custom hit " + number, dmg: 20, hits: 1, types: {} });
        return changed(true);
      }
      if ((element = find("[data-custom-del]"))) {
        const id = element.dataset.customDel;
        settings().customs = settings().customs.filter((custom) => custom.id !== id);
        Object.values(Engine.SEQUENCES).forEach(([listKey]) => { settings()[listKey] = (settings()[listKey] || []).filter((step) => step.a !== "custom:" + id); });
        return changed(true);
      }
      if ((element = find("[data-start-del]"))) {
        const [side, id] = element.dataset.startDel.split(":");
        delete settings().start[side][id];
        return changed(true);
      }
      if ((element = find("[data-tsplit-del]"))) { const types = typesOf(element.dataset.tsplitDel); if (types) delete types[element.dataset.type]; return changed(true); }
      if ((element = find("[data-inc-add]"))) {
        const steps = incomingSteps();
        const value = element.dataset.incAdd;
        const last = steps[steps.length - 1];
        if (value !== "c" && last && last.a === +value) last.n = Math.min(50, (last.n || 1) + 1);
        else if (steps.length < 20) steps.push(value === "c" ? { a: "c", n: 1, dmg: 20, types: { Physical: 1 } } : { a: +value, n: 1 });
        return changed(true);
      }
      if ((element = find("[data-inc-del]"))) { incomingSteps().splice(+element.dataset.incDel, 1); return changed(true); }
      if ((element = find("[data-inc-move]")) && !element.disabled) {
        const steps = incomingSteps();
        const from = +element.dataset.incMove;
        const to = from + +element.dataset.dir;
        if (to >= 0 && to < steps.length) [steps[from], steps[to]] = [steps[to], steps[from]];
        return changed(true);
      }
      if ((element = find("[data-seq-add]"))) {
        const listKey = element.dataset.list;
        const key = element.dataset.seqAdd;
        const steps = settings()[listKey] || (settings()[listKey] = []);
        const last = steps[steps.length - 1];
        const charged = element.dataset.charge !== undefined;
        const isStatus = key.startsWith("status:");
        const status = isStatus ? Rules.current().core.statuses[key.slice(7)] : null;
        if (last && last.a === key && key !== "wait" && !isStatus && !charged && !last.c) last.n = Math.min(50, (last.n || 1) + 1);
        else if (steps.length < 30) {
          steps.push(key === "wait" ? { a: "wait", n: 1, w: 1 } : isStatus ? { a: key, n: 1, p: status && status.kind === "debuff" ? 1 : 0.3 } : charged ? { a: key, n: 1, c: 1 } : { a: key, n: 1 });
        }
        return changed(true);
      }
      if ((element = find("[data-seq-del]"))) { settings()[element.dataset.list].splice(+element.dataset.seqDel, 1); return changed(true); }
      if ((element = find("[data-seq-move]")) && !element.disabled) {
        const steps = settings()[element.dataset.list];
        const from = +element.dataset.seqMove;
        const to = from + +element.dataset.dir;
        if (to < 0 || to >= steps.length) return;
        [steps[from], steps[to]] = [steps[to], steps[from]];
        return changed(true);
      }
      if ((element = find("[data-set]")) && !element.disabled) {
        const value = element.dataset.bool !== undefined ? element.dataset.bool === "1" : element.dataset.val;
        writeSetting(settings(), element.dataset.set, value);
        return changed(true);
      }
    });
    Rules.onChange(() => { if (A.ui.view === "test" && interfaceState.mode !== "rules") renderTest(A); });
  }

  window.VoxlViews.test = { render: renderTest, bind: bindTest };
})();
