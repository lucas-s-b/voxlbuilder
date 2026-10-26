// Enchant rules and effects, mirrored from the Voxlpedia wiki
// (Template:EnchantTable and MediaWiki:Stat_Enchantment_Armor.js).
(function () {
  const COLORS = {
    Legendary: "rgb(255, 238, 0)", Refined: "rgb(245, 255, 124)", Strengthened: "rgb(255, 106, 106)",
    Dexterous: "rgb(255, 210, 131)", Burning: "rgb(255, 106, 0)", Wet: "rgb(61, 145, 255)",
    Earthen: "rgb(173, 88, 49)", Magical: "rgb(74, 246, 255)", Cursed: "rgb(255, 90, 253)",
    Windy: "rgb(255, 255, 255)", Enlightened: "rgb(244, 255, 169)", Summoners: "rgb(179, 116, 255)",
    Hardened: "rgb(144, 255, 103)", Warded: "rgb(128, 255, 202)", Tenacious: "rgb(124, 177, 255)",
    Insulated: "rgb(169, 169, 212)", Vampiric: "rgb(255, 64, 121)", Tanky: "rgb(20, 152, 17)",
    Berserking: "rgb(255, 102, 0)", Fragile: "rgb(202, 213, 78)", Worthless: "rgb(153, 24, 24)",
    Thirsty: "rgb(162, 52, 38)", Corroded: "rgb(105, 149, 68)", Corrupt: "rgb(145, 0, 217)",
    Sweet: "rgb(255, 159, 103)", Mythical: "rgb(128, 0, 255)", Flawless: "rgb(255, 255, 255)",
    Brawny: "rgb(255, 58, 58)", Quick: "rgb(255, 240, 78)", Blazing: "rgb(255, 65, 1)",
    Raining: "rgb(93, 198, 255)", Stone: "rgb(182, 171, 154)", Surging: "rgb(0, 213, 255)",
    Eldritch: "rgb(181, 0, 72)", Tempestuous: "rgb(255, 255, 255)", Blessed: "rgb(253, 255, 130)",
    Sacrificial: "rgb(255, 0, 136)", "Wall of": "rgb(107, 139, 173)", "Spell Proof": "rgb(110, 255, 219)",
    Ferocious: "rgb(119, 141, 203)", Contained: "rgb(161, 176, 190)", Necrotic: "rgb(75, 255, 156)",
    "Turtle King's": "rgb(28, 198, 23)", Frenzied: "rgb(255, 102, 0)", Piercing: "rgb(229, 229, 229)",
    Restored: "rgb(206, 239, 113)", Quenched: "rgb(255, 0, 0)", Acidic: "rgb(111, 255, 0)",
    Warped: "rgb(122, 61, 255)", Candied: "rgb(246, 178, 255)",
  };

  // Shorthand: s(mult, flat, unit)
  const s = (multiplier, flat, unit) => ({ multiplier, flat, unit: unit === undefined ? "%" : unit });
  const perk = (name) => ({ __perk__: name });

  // Category multipliers apply to every stat of that sign/kind on the item.
  // "Defenses" means stats whose name contains "Defense".
  const EFFECTS = {
    Legendary: { cat: { "Positive Stats": 1.5, "Positive Defenses": 1.5 } },
    Mythical: { cat: { "Positive Stats": 2, "Negative Stats": 1.2, "Positive Defenses": 2, "Negative Defenses": 1.2 }, noPerks: true },
    Refined: { cat: { "Positive Stats": 1.35, "Negative Stats": 0.5, "Positive Defenses": 1.35, "Negative Defenses": 0.5 } },
    Flawless: { cat: { "Negative Stats": 0, "Negative Defenses": 0 }, ...perk("Perfection") },
    Strengthened: { stats: { "Physical Boost": s(1.2, 10) } },
    Brawny: { stats: { "Physical Boost": s(1, 5) }, ...perk("Brawny") },
    Dexterous: { stats: { "Dexterity Boost": s(1.2, 10), "Jump Boost": s(1, 2, ""), "Speed Boost": s(1, 5) } },
    Quick: { stats: { "Attack Speed": s(1, 10), "Jump Boost": s(1, 2, ""), "Speed Boost": s(1, 5) } },
    Burning: { stats: { "Fire Boost": s(1.2, 10) } },
    Blazing: { stats: { "Fire Boost": s(1, 5) }, ...perk("Wildfire") },
    Wet: { stats: { "Water Boost": s(1.2, 10) } },
    Raining: { stats: { "Water Boost": s(1, 5) }, ...perk("Rainstorm") },
    Earthen: { stats: { "Earth Boost": s(1.2, 10) } },
    Stone: { stats: { "Earth Boost": s(1, 5), "Speed Boost": s(1, -5) }, ...perk("Stone Weapon") },
    Magical: { stats: { "Magic Boost": s(1.2, 10) } },
    Surging: { stats: { "Magic Boost": s(1, 5) }, ...perk("Magic Surge") },
    Cursed: { stats: { "Hex Boost": s(1.2, 10) } },
    Eldritch: { ...perk("Dark One") },
    Windy: { stats: { "Air Boost": s(1.2, 10) } },
    Tempestuous: { stats: { "Air Boost": s(1, 5) }, ...perk("Tempest") },
    Enlightened: { stats: { "Holy Boost": s(1.2, 10) } },
    Blessed: { stats: { "Holy Boost": s(1, 5), "Water Boost": s(1, 5) }, ...perk("Heal Boost") },
    Summoners: { stats: { "Summon Boost": s(1.2, 10) } },
    Sacrificial: { stats: { "Summon Boost": s(1.1, 5) }, ...perk("Minion Absorption") },
    Hardened: { stats: { Protection: s(1, 7.5, "") } },
    "Wall of": { ...perk("Wall") },
    Warded: { stats: { Warding: s(1, 30) } },
    "Spell Proof": { ...perk("Hex Shield") },
    Tenacious: { stats: { Tenacity: s(1, 0.1, "") } },
    Ferocious: { stats: { Tenacity: s(1, 0.05, "") }, ...perk("Ferocity") },
    Insulated: { stats: { "Cold Resistance": s(1, 100), "Heat Resistance": s(1, 100) } },
    Contained: { stats: { "Cold Resistance": s(1, 20), "Heat Resistance": s(1, 20) }, ...perk("Contained") },
    Vampiric: { stats: { "Holy Defense": s(1, -40) }, ...perk("Lifesteal") },
    Necrotic: { ...perk("Undead Might") },
    Tanky: { cat: { "Positive Defenses": 1.5 }, stats: { "Physical Defense": s(1, 10), "Speed Boost": s(1, -5) } },
    "Turtle King's": { cat: { "Positive Defenses": 1.2 }, stats: { "Physical Defense": s(1, 5), "Magic Defense": s(1, 5) }, ...perk("Turtle") },
    Berserking: { cat: { "Positive Defenses": 0.5, "Negative Defenses": 2 }, stats: { "Physical Boost": s(1.2, 20), Protection: s(1, -10, "") } },
    Frenzied: { stats: { Protection: s(1, -2, "") }, ...perk("Frenzy") },
    Fragile: { stats: { "Physical Defense": s(1, -20) } },
    Piercing: { stats: { "Armor Penetration": s(1, 10, "") } },
    Worthless: { cat: { "Positive Stats": 0.5, "Negative Stats": 2, "Positive Defenses": 0.5, "Negative Defenses": 2 } },
    Restored: { cat: { "Negative Stats": -1, "Negative Defenses": -1 } },
    Thirsty: { stats: { "Physical Defense": s(1, -5) } },
    Quenched: { stats: { "Physical Boost": s(1, 5) }, ...perk("Life Drinker") },
    Corroded: { stats: { Warding: s(1, -20) } },
    Acidic: { stats: { "Earth Boost": s(1, 3), "Hex Boost": s(1, 3) }, ...perk("Melting Shred") },
    Sweet: { stats: { "Magic Boost": s(1.1, 5), "Holy Boost": s(1.1, 5), "Summon Boost": s(1.1, 5), "Speed Boost": s(1, -7) } },
    Candied: { stats: { "Summon Boost": s(1.2, 5) }, ...perk("Sweet Tooth") },
    Corrupt: { cat: { "Positive Stats": 0, "Negative Stats": -2, "Positive Defenses": 0, "Negative Defenses": -2 } },
    Warped: { cat: { "Positive Stats": 0, "Negative Stats": 0, "Positive Defenses": 0, "Negative Defenses": 0 }, ...perk("Perk Effectiveness") },
  };

  // Must be the only enchant on a piece.
  const EXCLUSIVE = ["Legendary", "Mythical", "Corrupt", "Warped"];
  // Special-source enchant families: a piece can only carry one family.
  const SOURCE_FAMILIES = [["Thirsty", "Quenched"], ["Sweet", "Candied"], ["Corroded", "Acidic"]];
  const SOURCE_NOTES = {
    Legendary: "Legendary mobs only", Mythical: "Ascended Legendary",
    Corrupt: "Corrupt mobs only", Warped: "Ascended Corrupt",
    Thirsty: "Bloody mobs (Blood Moon)", Quenched: "Ascended Thirsty",
    Corroded: "Lord Frogg's Cavern", Acidic: "Ascended Corroded",
    Sweet: "The Bumblz Hive", Candied: "Ascended Sweet",
  };

  function familyOf(name) {
    const e = VOXL_DATA.enchants.find((x) => x.name === name);
    return e ? (e.base || e.name) : name;
  }

  // Returns null if `candidate` may join `others` on one piece, otherwise a reason.
  function conflictReason(others, candidate) {
    others = others.filter(Boolean);
    if (others.includes(candidate)) return "Already on this piece";
    const fam = familyOf(candidate);
    if (others.some((o) => familyOf(o) === fam)) return "Its default/ascended form is already on this piece";
    if (EXCLUSIVE.includes(candidate) && others.length) return candidate + " can't be part of a double or triple enchant";
    const ex = others.find((o) => EXCLUSIVE.includes(o));
    if (ex) return ex + " can't be combined with other enchants";
    const myFam = SOURCE_FAMILIES.find((f) => f.includes(candidate));
    if (myFam) {
      const clash = others.find((o) => SOURCE_FAMILIES.some((f) => f !== myFam && f.includes(o)));
      if (clash) return "Can't be combined with " + clash;
    }
    return null;
  }

  const fmtNum = (n) => String(Math.round(n * 100) / 100);

  // Human readable effect lines for an enchant.
  function describe(name) {
    const e = EFFECTS[name];
    if (!e) return [];
    const lines = [];
    const cat = e.cat || {};
    const catLabel = { "Positive Stats": "Positive Stats", "Negative Stats": "Negative Stats", "Positive Defenses": "Positive Defenses", "Negative Defenses": "Negative Defenses" };
    // Collapse "Stats" + "Defenses" pairs that share a multiplier.
    ["Positive", "Negative"].forEach((sign) => {
      const a = cat[sign + " Stats"], b = cat[sign + " Defenses"];
      if (a !== undefined && a === b) lines.push(sign + " Stats: x" + fmtNum(a));
      else {
        if (a !== undefined) lines.push(catLabel[sign + " Stats"] + ": x" + fmtNum(a));
        if (b !== undefined) lines.push(catLabel[sign + " Defenses"] + ": x" + fmtNum(b));
      }
    });
    Object.entries(e.stats || {}).forEach(([stat, v]) => {
      if (v.multiplier !== 1) lines.push(stat + ": x" + fmtNum(v.multiplier));
      if (v.flat) lines.push(stat + ": " + (v.flat > 0 ? "+" : "") + fmtNum(v.flat) + v.unit);
    });
    if (e.noPerks) lines.push("Item Perks: x0");
    if (e.__perk__) lines.push(e.__perk__ + ": +1");
    return lines;
  }

  window.VoxlEnchants = { COLORS, EFFECTS, EXCLUSIVE, SOURCE_FAMILIES, SOURCE_NOTES, conflictReason, describe, familyOf };
})();
