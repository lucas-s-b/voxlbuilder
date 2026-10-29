const zlib = require("zlib");
const empty = [null, null, null];
const builds = {
  gladiator: {
    n: "Gladiator bleed", l: 80, s: { head: ["gladiator-mask", 5, empty], chest: ["gladiator-chestplate", 5, empty], legs: ["gladiator-leggings", 5, empty], ring: ["lucky-ring", 5, empty], rune: ["rage-rune", 5, empty] },
    i: {}, r: "human", g: ["gladiator", 3, "", ""], w: ["sword", "jagged-handle", "greatsword-blade", "", "", 0, "slam"],
    x: { seq: [{ a: "rune", n: 1 }, { a: "m1", n: 6 }, { a: "art", n: 1 }, { a: "m1", n: 3 }, { a: "m2", n: 1 }], seqRepeat: true, duration: 30, version: 2 },
  },
  mage: {
    n: "Mage burn", l: 80, s: { head: ["mageling-hood", 5, empty], chest: ["mageling-cloak", 5, empty], legs: ["mageling-pants", 5, empty], ring: ["caster-ring", 5, empty], rune: ["fireball-rune", 5, empty] },
    i: {}, r: "high-elf", g: ["scholar", 3, "", ""], w: ["sword", "exhaust-handle", "mage-blade", "", "", 0, "flame-slash"],
    x: { seq: [{ a: "art", n: 1 }, { a: "rune", n: 1 }, { a: "m1", n: 6 }, { a: "m2", n: 1 }], seqRepeat: true, duration: 30, version: 2 },
  },
  monk: {
    n: "Woof monk", l: 80, s: { head: ["winter-woof-hood", 5, empty], chest: ["winter-woof-cloak", 5, empty], legs: ["winter-woof-pants", 5, empty], ring: ["wind-ring", 5, empty], rune: ["rage-rune", 5, empty] },
    i: {}, r: "ork", g: ["monk", 3, "", ""], w: ["monk", "", "", "winter-woof-gloves", "lightning-essence", 0, "barrage"],
    x: { seq: [{ a: "m1", n: 9 }, { a: "m2", n: 1 }, { a: "art", n: 1 }], seqRepeat: true, duration: 30, version: 2 },
  },
};
const encode = (compact) => "#c=" + zlib.deflateRawSync(Buffer.from(JSON.stringify(compact))).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
module.exports = { builds, links: Object.fromEntries(Object.entries(builds).map(([key, compact]) => [key, encode(compact)])) };
if (require.main === module) console.log(JSON.stringify(module.exports.links, null, 1));
