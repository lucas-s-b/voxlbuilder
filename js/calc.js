// Stat math, following the Voxlpedia wiki:
//  - Forge upgrades (0-5): positive stats * (1 + lvl/10), negative stats / (1 + lvl/10)
//  - Enchants: stat * statMultiplier * categoryMultiplier + flat
//  - Infusion: the piece's perks and half of its stats
(function () {
  const E = window.VoxlEnchants;

  const BOOSTS = ["Physical Boost", "Magic Boost", "Fire Boost", "Water Boost", "Earth Boost", "Air Boost",
    "Hex Boost", "Holy Boost", "Dexterity Boost", "Summon Boost", "Speed Boost", "Attack Speed", "Jump Boost",
    "Armor Penetration"];
  const DEFENSES = ["Physical Defense", "Magic Defense", "Fire Defense", "Water Defense", "Earth Defense",
    "Air Defense", "Hex Defense", "Holy Defense", "Protection", "Warding", "Tenacity", "Cold Resistance",
    "Heat Resistance"];
  const FLAT_STATS = new Set(["Jump Boost", "Protection", "Tenacity", "Armor Penetration"]);

  const SLOTS = ["head", "ring", "chest", "rune", "legs"];
  const INFUSABLE = ["head", "chest", "legs", "ring"];
  const SLOT_NAMES = { head: "Helmet", chest: "Chestplate", legs: "Leggings", ring: "Ring", rune: "Rune" };
  const UPGRADE_COSTS = [500, 1500, 2000, 3000, 4000];
  const INFUSION_COST = { head: "1 Binding Orb", chest: "1 Binding Orb", legs: "1 Binding Orb", ring: "Free (Ice Caverns rift)" };

  const round = (n) => Math.round(n * 100 + (n >= 0 ? 0.00001 : -0.00001)) / 100;

  function category(stat, value) {
    const def = /Defense/.test(stat);
    if (value < 0) return def ? "Negative Defenses" : "Negative Stats";
    return def ? "Positive Defenses" : "Positive Stats";
  }

  function mergeEnchants(names) {
    const merged = { stats: {}, cat: { "Positive Stats": 1, "Negative Stats": 1, "Positive Defenses": 1, "Negative Defenses": 1 }, perks: [], noPerks: false, perkBoost: 1 };
    names.filter(Boolean).forEach((n) => {
      const e = E.EFFECTS[n];
      if (!e) return;
      Object.entries(e.cat || {}).forEach(([k, v]) => { merged.cat[k] *= v; });
      Object.entries(e.stats || {}).forEach(([k, v]) => {
        const m = merged.stats[k] || (merged.stats[k] = { multiplier: 1, flat: 0 });
        m.multiplier *= v.multiplier;
        m.flat += v.flat;
      });
      if (e.__perk__) merged.perks.push({ name: e.__perk__, enchant: n });
      if (e.noPerks) merged.noPerks = true;
      if (e.perkBoost) merged.perkBoost *= e.perkBoost;
    });
    return merged;
  }

  // Final stats + perks of one piece at an upgrade level with enchants.
  function pieceStats(item, level, enchants) {
    const u = 1 + (level || 0) / 10;
    const m = mergeEnchants(enchants || []);
    const out = {};
    const names = new Set([...Object.keys(item.stats), ...Object.keys(m.stats)]);
    names.forEach((stat) => {
      const base = item.stats[stat] || 0;
      const sm = m.stats[stat] || { multiplier: 1, flat: 0 };
      let v = base * sm.multiplier * m.cat[category(stat, base)];
      v = v > 0 ? v * u : v / u;
      v += sm.flat;
      v = round(v);
      if (v !== 0) out[stat] = v;
    });
    const perks = [];
    if (!m.noPerks) {
      item.perks.forEach((p) => perks.push({ id: p.id, amount: p.amount }));
    }
    m.perks.forEach((p) => perks.push({ id: slug(p.name), name: p.name, amount: 1, enchant: p.enchant }));
    return { stats: out, perks };
  }

  function infusionStats(item, level) {
    const r = pieceStats(item, level, []);
    const stats = {};
    Object.entries(r.stats).forEach(([k, v]) => { const h = round(v / 2); if (h !== 0) stats[k] = h; });
    return { stats, perks: r.perks };
  }

  function slug(s) { return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }

  // Sums every equipped piece and infusion of a build, plus `extras` ({name, stats, perks}: weapon, guild, race).
  function buildTotals(build, itemById, extras) {
    const stats = {};
    const perks = {};
    const add = (res, source) => {
      Object.entries(res.stats).forEach(([k, v]) => { stats[k] = round((stats[k] || 0) + v); });
      res.perks.forEach((p) => {
        const e = perks[p.id] || (perks[p.id] = { id: p.id, name: p.name, amount: 0, fromEnchants: 0, sources: [] });
        e.amount = round(e.amount + p.amount);
        if (p.enchant) e.fromEnchants += p.amount;
        e.sources.push(source + (p.enchant ? " (" + p.enchant + ")" : ""));
      });
    };
    SLOTS.forEach((slot) => {
      const s = build.slots[slot];
      const item = s && itemById[s.id];
      if (item) add(pieceStats(item, s.lvl, s.ench), item.name);
    });
    INFUSABLE.forEach((slot) => {
      const s = build.inf[slot];
      const item = s && itemById[s.id];
      if (item) add(infusionStats(item, s.lvl), item.name + " [infused]");
    });
    (extras || []).forEach((x) => add({ stats: x.stats || {}, perks: x.perks || [] }, x.name));
    scalePerkAmounts(perks);
    applyStatPerks(stats, perks);
    Object.keys(stats).forEach((k) => { stats[k] = round(stats[k]); if (stats[k] === 0) delete stats[k]; });
    return { stats, perks };
  }

  // Perk Effectiveness and Cursed raise most perk amounts by 10% each per perk (multiplicatively),
  // except these perks and anything granted by enchants.
  const UNSCALED_PERKS = ["cursed", "perk-effectiveness", "luminescent-fervor", "valor", "spirit-commune", "channeled-weapon", "quickcast", "thief-training", "vampire"];
  function scalePerkAmounts(perks) {
    const pe = perks["perk-effectiveness"] ? perks["perk-effectiveness"].amount : 0;
    const cu = perks.cursed ? perks.cursed.amount : 0;
    const mult = (1 + 0.1 * pe) * (1 + 0.1 * cu);
    if (mult === 1) return;
    Object.values(perks).forEach((p) => {
      if (UNSCALED_PERKS.includes(p.id)) return;
      p.amount = round((p.amount - p.fromEnchants) * mult + p.fromEnchants);
    });
  }

  // Perks that convert or add stats, in the order the wiki gives (Strong Tides → Brawny → Weight Distribution).
  function applyStatPerks(st, perks) {
    const a = (id) => (perks[id] ? perks[id].amount : 0);
    const get = (k) => st[k] || 0;
    if (a("strong-tides")) st["Water Boost"] = get("Water Boost") + get("Physical Boost") * 0.1 * a("strong-tides");
    if (a("brawny")) {
      const conv = Math.min(1, 0.2 * a("brawny"));
      ["Magic Boost", "Fire Boost", "Water Boost", "Earth Boost", "Air Boost", "Hex Boost", "Holy Boost", "Dexterity Boost"].forEach((k) => {
        if (get(k) > 0) { st["Physical Boost"] = get("Physical Boost") + get(k) * conv; st[k] = get(k) * (1 - conv); }
      });
    }
    if (a("weight-distribution")) {
      const avg = ((get("Physical Boost") + get("Dexterity Boost")) / 2) * 1.5;
      st["Physical Boost"] = avg;
      st["Dexterity Boost"] = avg;
    }
    if (a("quick-witted")) st["Dexterity Boost"] = get("Dexterity Boost") + Math.max(0, get("Speed Boost")) * 0.25 * a("quick-witted");
    if (a("whirl-foot")) st["Speed Boost"] = get("Speed Boost") + 0.05 * get("Air Boost") * a("whirl-foot");
    if (a("true-balance")) {
      const avg = ((get("Holy Boost") + get("Hex Boost")) / 2) * 1.5;
      st["Holy Boost"] = avg;
      st["Hex Boost"] = avg;
    }
    if (a("righted-wrongs")) {
      const neg = (k) => Math.max(0, -get(k));
      const w = neg("Warding"), d = neg("Physical Defense") + neg("Magic Defense"), t = neg("Tenacity");
      const o = Object.keys(st).filter((k) => !["Warding", "Physical Defense", "Magic Defense", "Tenacity"].includes(k)).reduce((s, k) => s + neg(k), 0);
      const dex = a("righted-wrongs") * (2 / 21) * (w + d * 3 + t * 0.4 + o * 2);
      st["Dexterity Boost"] = get("Dexterity Boost") + dex;
      st["Speed Boost"] = get("Speed Boost") + dex * 0.1;
    }
    if (a("lucky")) {
      st.Warding = get("Warding") - 25 * a("lucky");
      st.Protection = get("Protection") - 6 * a("lucky");
      st.Tenacity = get("Tenacity") - 0.1 * a("lucky");
    }
    // defensive conversions
    if (a("rocky-body")) st["Physical Defense"] = get("Physical Defense") + get("Earth Boost") * 0.5 * a("rocky-body");
    if (a("swift-guard")) st["Physical Defense"] = get("Physical Defense") + get("Dexterity Boost") * 0.1 * a("swift-guard");
    if (a("immovable")) st["Physical Defense"] = get("Physical Defense") + 30 * get("Tenacity") * a("immovable");
    if (a("frozen-heart")) {
      const g = (1 / 45 + a("frozen-heart") / 45) * get("Cold Resistance");
      ["Warding", "Physical Defense", "Magic Defense"].forEach((k) => { st[k] = get(k) + g; });
    }
    if (a("spellshield")) st.Protection = get("Protection") + 0.15 * (get("Magic Boost") + get("Magic Defense")) * a("spellshield");
    if (a("carapace")) st.Protection = get("Protection") + 0.075 * get("Earth Boost") * a("carapace");
    if (a("extra-layers")) { st.Warding = get("Warding") * (1 + 0.2 * a("extra-layers")); st.Protection = get("Protection") * (1 + 0.2 * a("extra-layers")); }
  }

  // Derived numbers from the wiki "Stats" page.
  function derived(stats, charLevel) {
    const pct = (k) => (stats[k] || 0);
    const reduction = (d) => (d >= 0 ? 100 - 100 / (1 + d / 100) : d);
    const out = [];
    const dex = pct("Dexterity Boost");
    if (dex) {
      out.push(["Crit Chance", round(dex / 10) + "%"]);
      out.push(["Crit Damage", "+" + round(dex / 10) + "%"]);
    }
    [["Physical Defense", "Phys Dmg Taken"], ["Magic Defense", "Magic Dmg Taken"]].forEach(([k, label]) => {
      const d = pct(k);
      if (d) out.push([label, (d >= 0 ? "-" + round(reduction(d)) : "+" + round(-d)) + "%"]);
    });
    const w = pct("Warding");
    if (w > 0) {
      out.push(["Debuff Potency", "-" + round(reduction(w)) + "%"]);
      out.push(["DoT Dmg Taken", "-" + round(100 - 100 / (1 + (w * 2) / 100)) + "%"]);
    } else if (w < 0) {
      out.push(["Debuff Potency", "+" + round(-w) + "%"]);
    }
    if (charLevel) out.push(["Lv HP/Dmg/Heal", "+" + round(charLevel * 1.25) + "%"]);
    return out;
  }

  function forgeCost(level) {
    return UPGRADE_COSTS.slice(0, level || 0).reduce((a, b) => a + b, 0);
  }

  function fmtStat(stat, v) {
    const sign = v > 0 ? "+" : "";
    return sign + round(v) + (FLAT_STATS.has(stat) ? "" : "%");
  }

  window.VoxlCalc = {
    BOOSTS, DEFENSES, FLAT_STATS, SLOTS, INFUSABLE, SLOT_NAMES, UPGRADE_COSTS, INFUSION_COST,
    pieceStats, infusionStats, buildTotals, derived, forgeCost, fmtStat, round, slug,
  };
})();
