(function () {
  const TOKEN = /(-?)(?:"([^"]*)"|(\S+))/g;
  const STAT_FILTER = /^#([a-z0-9]+)(?:(>=|<=|>|<|=)(-?\d+(?:\.\d+)?)?)?$/i;
  const COMPARE = {
    ">": (value, limit) => value > limit, ">=": (value, limit) => value >= limit,
    "<": (value, limit) => value < limit, "<=": (value, limit) => value <= limit, "=": (value, limit) => value === limit,
  };

  const normalize = (text) => String(text).toLowerCase().replace(/[^a-z0-9]/g, "");

  function resolveStats(key, statNames) {
    const exact = statNames.filter((name) => normalize(name) === key || normalize(name) === key + "boost");
    return exact.length ? exact : statNames.filter((name) => normalize(name).startsWith(key));
  }

  function parseTerm(negate, text, statNames) {
    const filter = text.match(STAT_FILTER);
    if (!filter) return { negate, text: text.toLowerCase() };
    const [, key, operator, limit] = filter;
    const compare = operator && limit !== undefined ? (value) => COMPARE[operator](value, +limit) : (value) => value !== 0;
    return { negate, stats: resolveStats(normalize(key), statNames), compare };
  }

  function parse(query, statNames) {
    return [...String(query || "").matchAll(TOKEN)]
      .map(([, negate, quoted, word]) => [!!negate, quoted !== undefined ? quoted : word])
      .filter(([, text]) => text && text !== "#")
      .map(([negate, text]) => parseTerm(negate, text, statNames));
  }

  function termMatches(term, entry) {
    if (term.text !== undefined) return entry.text.includes(term.text);
    return term.stats.some((name) => term.compare(entry.stats[name] || 0));
  }

  const matches = (terms, entry) => terms.every((term) => termMatches(term, entry) !== term.negate);

  const filterStat = (terms) => (terms.find((term) => term.stats && term.stats.length && !term.negate) || { stats: [] }).stats[0] || "";

  function entryText(fields, perks, perkInfo) {
    const perkData = window.VOXL_DATA.perks;
    const perkText = (perks || []).flatMap((perk) => {
      const info = perkInfo(perk.id);
      return [info.name, info.desc, ...((perkData[perk.id] && perkData[perk.id].tags) || [])];
    });
    return fields.flat().concat(perkText).filter(Boolean).join("\n").toLowerCase();
  }

  window.VoxlSearch = { parse, matches, filterStat, entryText };
})();
