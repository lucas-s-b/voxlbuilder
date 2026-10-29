const assert = require("assert");
const { Engine } = require("./harness");
const combat = Engine.internals;
const close = (actual, expected, label) => { assert(Math.abs(actual - expected) < 1e-6 * Math.max(1, Math.abs(expected)), `${label}: ${actual} != ${expected}`); console.log("ok", label, +actual.toFixed(6)); };

const build = { name: "T", level: 80, slots: {}, inf: {}, race: null, guild: null, weapon: { mode: "sword", handle: "reinforced-handle", blade: "sharp-blade", gloves: null, essence: null, shrine: false, art: null } };
function profileWith(stats, perks, settings) {
  const weapon = window.VoxlModel.weapon(build);
  const totals = { stats: { ...stats }, perks: Object.fromEntries(Object.entries(perks || {}).map(([id, amount]) => [id, { id, amount }])) };
  return Engine.buildProfile(build, totals, weapon, Engine.sanitizeSettings(settings || {}));
}
const firstSwing = (profile, defenses) => {
  const report = Engine.simulate(profile, { mode: "dps", steps: [{ a: "swing:0", n: 1 }], repeat: false, runs: 1, targetDefenses: defenses || {} });
  return report.damage;
};

// weapon: reinforced handle (Dex 0.3, Phys 0.3) + sharp blade (Dex 0.3, Phys 0.3) → hybrid? same scalings, so Phys 0.6, Dex 0.6
const weapon = window.VoxlModel.weapon(build);
console.log("weapon scalings", weapon.scalings, "types", weapon.types);
const boost = 1 + 0.6 * 1.0 + 0.6 * 0.5;
close(firstSwing(profileWith({ "Physical Boost": 100, "Dexterity Boost": 50 }, {}, { crit: "never" })), 6 * boost * 2, "1-handed swing, no crit");
close(firstSwing(profileWith({ "Physical Boost": 100, "Dexterity Boost": 50 }, {}, { crit: "always" })), 6 * boost * 2 * (1.5 + 0.05), "crit multiplier 1.5 + dex/10%");
close(firstSwing(profileWith({ "Physical Boost": 100, "Dexterity Boost": 50 }, {}, { crit: "never" }), { Physical: 20 }), 6 * boost * 2 / 1.2, "20% physical defense, no pen");
close(firstSwing(profileWith({ "Physical Boost": 100, "Dexterity Boost": 50, "Armor Penetration": 10 }, {}, { crit: "never" }), { Physical: 50 }), 6 * boost * 2 / (1 + 0.5 / (1 + 5 * 0.1)), "50% defense, 10 pen (above threshold)");
close(firstSwing(profileWith({ "Physical Boost": 100, "Dexterity Boost": 50, "Armor Penetration": 30 }, {}, { crit: "never" }), { Physical: 20 }), 6 * boost * 2 * 1.1, "20% defense, 30 pen (negative armor)");
close(firstSwing(profileWith({}, {}, { crit: "never", start: { self: { rage: 0.5 } } })), 6 * 2 * 1.5, "rage 0.5 on physical");
close(firstSwing(profileWith({}, {}, { crit: "never", start: { target: { shatter: 0.2 } } }), { Physical: 20 }), 6 * 2, "shatter 0.2 cancels 20% defense");
close(firstSwing(profileWith({}, {}, { crit: "never", start: { self: { weakness: 1 } } })), 6 * 2 / 2, "weakness 1 on you halves damage");

const burnTick = (perks, potency) => {
  const profile = profileWith({}, perks, { crit: "never", start: { target: { burn: potency } } });
  return Engine.simulate(profile, { mode: "dps", steps: [{ a: "wait", n: 1, w: 1 }], repeat: false, runs: 1 }).damage;
};
close(burnTick({}, 0), 1.75 * 2, "burn tick, 0 potency, level 80");
close(burnTick({ "burn-potency": 2 }, 0), 1.75 * 2 * Math.pow(1.2, 1.2), "burn tick, 2 burn potency perk (start status keeps its potency)");
close(combat.armorMultiplier(50, 0, Engine.buildProfile ? window.VoxlRules.current().core.constants : {}), 1 / 1.5, "armor 50% no pen");
close(combat.luckyChance({ profile: { constants: { luckyRerollShare: 0.6667 } }, profile2: 0, variables: {} , }, 0.3, true), 0.3, "lucky off");

// Lucky: 1 - (1-p)(1-2/3 p)^L
const luckyContext = { profile: profileWith({}, { lucky: 1 }), self: { statuses: {} }, target: { statuses: {} }, time: 0, variables: {} };
combat.active.context = luckyContext;
close(combat.luckyChance(luckyContext, 0.3), 1 - 0.7 * (1 - 0.6667 * 0.3), "lucky 1 on 30%");
combat.active.context = null;

// cooldown: 12s base, 20% reduction, speed 0.5 → floor(12*0.8/1.5)=6
const cooldownProfile = profileWith({}, {}, {});
const context = Engine.newContext(cooldownProfile, { steps: [] }, 1);
close(combat.abilityCooldown(context, "art", 12, null).final, 12, "cooldown without effects stays 12");
const caster = Engine.newContext(profileWith({}, { caster: 2 }, {}), { steps: [] }, 1);
console.log("caster 2 art cooldown 12 ->", combat.abilityCooldown(caster, "art", 12, null));
console.log("all formula checks passed");
