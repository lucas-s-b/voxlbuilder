const { profileOf, Engine } = require("./harness");
const rules = window.VoxlRules.current();

const build = {
  name: "Test", level: 80, slots: { rune: { id: process.env.RUNE || "fireball-rune", lvl: 0, ench: [null, null, null] } }, inf: {}, race: null, guild: null,
  weapon: { mode: "sword", handle: "reinforced-handle", blade: "sharp-blade", gloves: null, essence: null, shrine: false, art: process.env.ART || "cross-slash" },
};
const baseStats = { "Physical Boost": 60, "Dexterity Boost": 50, "Magic Boost": 30, "Fire Boost": 30, "Water Boost": 20, "Earth Boost": 20, "Air Boost": 20, "Hex Boost": 20, "Holy Boost": 20,
  "Summon Boost": 20, Protection: 20, "Physical Defense": 20, "Magic Defense": 10, Warding: 10, Tenacity: 0.2, "Attack Speed": 5 };
const steps = [{ a: "m1", n: 2 }, { a: "art", n: 1 }, { a: "rune", n: 1 }, { a: "m2", n: 1 }, { a: "m1", n: 1 }, { a: "m2", n: 1 }];

function profileWith(perks, settings) {
  const totals = { stats: { ...baseStats }, perks: Object.fromEntries(Object.entries(perks).map(([id, amount]) => [id, { id, amount }])) };
  const weapon = window.VoxlModel.weapon(build);
  window.VoxlEngine.applyStatEffects(totals.stats, perks);
  return Engine.buildProfile(build, totals, weapon, settings);
}

function metrics(profile) {
  const options = { steps, repeat: true, duration: 30, runs: 12, targetDefenses: { Physical: 20, Magic: 20 } };
  const dps = Engine.simulate(profile, { ...options, mode: "dps" });
  const incoming = Engine.incomingFrom({ inc: { seq: [{ a: "c", n: 1, dmg: 25, types: { Physical: 1 } }, { a: "c", n: 1, dmg: 25, types: { Fire: 1 }, guardbreak: true }], per10: 5, blockPct: 30, parryPct: 20, stun: 0.5 } }, null);
  const tank = Engine.simulate(profile, { ...options, mode: "tank", incoming, simulateHp: true });
  return {
    damage: dps.damage, healing: dps.healing.self + dps.healing.allies, applications: Object.values(dps.applications).reduce((sum, entry) => sum + entry.count, 0),
    uptime: Object.keys(dps.uptime).sort().join(","), taken: tank.taken.total, tankHeal: tank.healing.self + tank.healing.allies, stun: tank.taken.stun,
    dodged: tank.taken.dodged, blocked: tank.taken.blocked, shield: tank.taken.shield, errors: dps.errors.concat(tank.errors),
  };
}

const richConditions = Object.fromEntries(rules.core.conditions.filter((condition) => condition.type === "boolean").map((condition) => [condition.id, true]));
Object.assign(richConditions, { selfHp: 40, targetHp: 30, summons: 3, sunSources: 2, enemies: 3, inShadow: true, weaponSheathed: true });
const rich = process.env.RICH === "1";
const settings = rich
  ? { crit: "avg", conditions: richConditions, situational: {}, start: { self: { rage: 0.3, bounce: 0.2, reinforce: 0.3, tailwind: 0.1, regen: 1, burn: 0, poison: 0, bleed: 0 }, target: { bleed: 1, burn: 1, poison: 1, slowness: 1, taunt: 1, sticky: 1, weakness: 0.2 } } }
  : { crit: "avg", conditions: {}, situational: {} };
const baseline = metrics(profileWith({}, settings));
console.log("baseline", JSON.stringify(baseline));
const silent = [];
const failures = [];
const ids = Object.keys(rules.perks).filter((id) => !id.startsWith("race:") && rules.perks[id].simulated !== false && !rules.perks[id].form && !(process.argv[2] && process.argv[2] !== id));
ids.forEach((id) => {
  try {
    const amount = +(process.env.AMOUNT || 2);
    const perks = { [id]: amount };
    if (rules.perks[id].spirit) perks["spirit-commune"] = 3;
    const result = metrics(profileWith(perks, { ...settings, situational: { [id]: true } }));
    if (result.errors.length) failures.push([id, result.errors.slice(0, 3)]);
    const changed = Object.keys(baseline).filter((key) => key !== "errors" && JSON.stringify(result[key]) !== JSON.stringify(baseline[key]));
    if (!changed.length) silent.push(id);
    if (process.argv[2]) console.log(id, JSON.stringify(result));
  } catch (error) {
    failures.push([id, error.stack.split("\n").slice(0, 4).join(" | ")]);
  }
});
console.log("checked", ids.length, "silent", silent.length, silent.join(", "));
if (process.env.OUT) require("fs").writeFileSync(process.env.OUT, JSON.stringify(silent));
console.log("failures", failures.length);
failures.forEach((failure) => console.log(" ", failure[0], JSON.stringify(failure[1])));
