const path = require("path");
const zlib = require("zlib");
const root = path.join(__dirname, "..");
global.window = global;
const store = {};
global.localStorage = { getItem: (key) => (key in store ? store[key] : null), setItem: (key, value) => { store[key] = String(value); }, removeItem: (key) => { delete store[key]; } };
[
  "data/data.js", "data/rules/core.js", "data/rules/attacks.js", "data/rules/perks.js",
  "js/engine/expression.js", "js/engine/rules.js", "js/engine/profile.js", "js/engine/combat.js", "js/engine/simulate.js", "js/engine/settings.js",
  "js/enchants.js", "js/calc.js", "js/model.js",
].forEach((file) => require(path.join(root, file)));

const itemById = Object.fromEntries(window.VOXL_DATA.items.map((item) => [item.id, item]));

function decodeShare(link) {
  const encoded = link.split("#c=")[1];
  const bytes = Buffer.from(encoded.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  const compact = JSON.parse(zlib.inflateRawSync(bytes).toString());
  const build = { name: compact.n, level: compact.l || 80, slots: {}, inf: {}, test: compact.x || {} };
  Object.entries(compact.s || {}).forEach(([slot, value]) => { build.slots[slot] = { id: value[0], lvl: value[1], ench: (value[2] || []).map((name) => name || null) }; });
  Object.entries(compact.i || {}).forEach(([slot, value]) => { build.inf[slot] = { id: value[0], lvl: value[1] }; });
  build.race = compact.r || null;
  if (compact.g) build.guild = { id: compact.g[0], rank: compact.g[1], ability: compact.g[2] || undefined, color: compact.g[3] || undefined };
  build.weapon = compact.w ? { mode: compact.w[0], handle: compact.w[1] || null, blade: compact.w[2] || null, gloves: compact.w[3] || null, essence: compact.w[4] || null, shrine: !!compact.w[5], art: compact.w[6] || null }
    : { mode: "sword", handle: null, blade: null, gloves: null, essence: null, shrine: false, art: null };
  return build;
}

function profileOf(build, settings) {
  const totals = window.VoxlCalc.buildTotals(build, itemById, window.VoxlModel.extraSources(build));
  const weapon = window.VoxlModel.weapon(build);
  return window.VoxlEngine.buildProfile(build, totals, weapon, settings || {});
}

module.exports = { decodeShare, profileOf, itemById, Engine: window.VoxlEngine };
