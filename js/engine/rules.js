(function () {
  const STORAGE_KEY = "voxlbuilder:rules";
  const SECTIONS = {
    perks: () => window.VOXL_RULES.perks,
    statuses: () => window.VOXL_RULES.core.statuses,
    forms: () => window.VOXL_RULES.attacks.forms,
    arts: () => window.VOXL_RULES.attacks.arts,
    runes: () => window.VOXL_RULES.attacks.runes,
    spirits: () => window.VOXL_RULES.attacks.spirits,
    potions: () => window.VOXL_RULES.attacks.potions,
    constants: () => window.VOXL_RULES.core.constants,
    formulas: () => window.VOXL_RULES.core.formulas,
  };

  const loadOverrides = () => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      return saved && typeof saved === "object" ? saved : {};
    } catch (error) {
      return {};
    }
  };
  let overrides = loadOverrides();
  let cached = null;
  const listeners = [];

  const persist = () => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides)); } catch (error) { /* storage unavailable */ }
    cached = null;
    listeners.forEach((listener) => listener());
  };

  function section(name) {
    const merged = { ...SECTIONS[name]() };
    Object.entries(overrides[name] || {}).forEach(([key, value]) => {
      if (value === null) delete merged[key];
      else merged[key] = value;
    });
    return merged;
  }

  function current() {
    if (cached) return cached;
    const core = window.VOXL_RULES.core;
    const attacks = window.VOXL_RULES.attacks;
    cached = {
      core: { ...core, constants: section("constants"), formulas: section("formulas"), statuses: section("statuses") },
      attacks: { ...attacks, forms: section("forms"), arts: section("arts"), runes: section("runes"), spirits: section("spirits"), potions: section("potions") },
      perks: section("perks"),
    };
    return cached;
  }

  const clone = (value) => JSON.parse(JSON.stringify(value));

  function setEntry(sectionName, key, value) {
    if (!SECTIONS[sectionName]) throw new Error(`Unknown section ${sectionName}`);
    overrides[sectionName] = overrides[sectionName] || {};
    overrides[sectionName][key] = value === undefined ? null : clone(value);
    persist();
  }

  function resetEntry(sectionName, key) {
    if (overrides[sectionName]) delete overrides[sectionName][key];
    persist();
  }

  function resetAll() {
    overrides = {};
    persist();
  }

  const isEdited = (sectionName, key) => !!(overrides[sectionName] && key in overrides[sectionName]);
  const defaultEntry = (sectionName, key) => SECTIONS[sectionName]()[key];

  function exportEdits() {
    return JSON.stringify({ format: "voxlbuilder-rules", version: 1, edits: overrides }, null, 2);
  }

  function importEdits(text) {
    const parsed = JSON.parse(text);
    const edits = parsed && parsed.format === "voxlbuilder-rules" ? parsed.edits : parsed;
    if (!edits || typeof edits !== "object") throw new Error("Not a rules file");
    Object.keys(edits).forEach((name) => { if (!SECTIONS[name]) throw new Error(`Unknown section ${name}`); });
    overrides = clone(edits);
    persist();
  }

  function validateEntry(entry) {
    const problems = [];
    const visit = (value, path) => {
      if (typeof value === "string" && path.length && !["type", "trigger", "status", "to", "kind", "label", "name", "stat", "damageType", "dot", "from", "with", "id", "ability", "category", "group", "tag", "source", "counter", "mark", "consumeSelf", "consumeTarget", "resetCounter", "gainCounter", "race", "as"].includes(path[path.length - 1])) {
        try { window.VoxlExpression.parse(value); } catch (error) { problems.push({ path: path.join("."), formula: value, error: error.message }); }
      }
      if (Array.isArray(value)) value.forEach((item, index) => visit(item, path.concat(index)));
      else if (value && typeof value === "object") Object.entries(value).forEach(([key, item]) => visit(item, path.concat(key)));
    };
    visit(entry, []);
    return problems;
  }

  const onChange = (listener) => listeners.push(listener);

  window.VoxlRules = {
    SECTIONS: Object.keys(SECTIONS), current, section, setEntry, resetEntry, resetAll, isEdited, defaultEntry,
    exportEdits, importEdits, validateEntry, onChange, editedCount: () => Object.values(overrides).reduce((total, entries) => total + Object.keys(entries || {}).length, 0),
  };
})();
