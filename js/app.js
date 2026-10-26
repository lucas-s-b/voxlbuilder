(function () {
  const D = window.VOXL_DATA;
  const C = window.VoxlCalc;
  const E = window.VoxlEnchants;
  const M = window.VoxlModel;
  const Dmg = window.VoxlDamage;
  const $ = (id) => document.getElementById(id);

  const itemById = Object.fromEntries(D.items.map((i) => [i.id, i]));
  const enchByName = Object.fromEntries(D.enchants.map((e) => [e.name, e]));
  const STORE_KEY = "voxlbuilder:v1";
  const MAX_LVL = 5;

  const STAT_COLORS = {
    "Physical Boost": "#ff7a7a", "Magic Boost": "#4af6ff", "Fire Boost": "#ff7b1c", "Water Boost": "#5aa2ff",
    "Earth Boost": "#f0a86e", "Air Boost": "#ffffff", "Hex Boost": "#ff6cfd", "Holy Boost": "#f6ffb0",
    "Dexterity Boost": "#ffd283", "Summon Boost": "#c49aff", "Speed Boost": "#eaff3a", "Attack Speed": "#fff04e",
    "Jump Boost": "#e9b8ff", "Armor Penetration": "#e5e5e5",
    "Physical Defense": "#ff8f8f", "Magic Defense": "#4af6ff", "Fire Defense": "#ff6a3a", "Water Defense": "#5aa2ff",
    "Earth Defense": "#f0a86e", "Air Defense": "#ffffff", "Hex Defense": "#d36bff", "Holy Defense": "#e8c25a",
    Protection: "#6dff6d", Warding: "#4dff7a", Tenacity: "#9cc4ff", "Cold Resistance": "#b3dcff", "Heat Resistance": "#ffb07a",
  };

  // ------------------------------------------------------------ pixel icons
  function pix(rows, colors) {
    let rects = "";
    rows.forEach((r, y) => [...r].forEach((ch, x) => {
      if (colors[ch]) rects += `<rect x="${x}" y="${y}" width="1" height="1" fill="${colors[ch]}"/>`;
    }));
    return `<svg viewBox="0 0 ${rows[0].length} ${rows.length}" shape-rendering="crispEdges" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${rects}</svg>`;
  }
  const GHOST = {
    head: ["....XXXX....", "..XXXXXXXX..", ".XXXXXXXXXX.", ".XXXXXXXXXX.", "XXXXXXXXXXXX", "XXX......XXX", "XXX.XXXX.XXX", "XXX.XXXX.XXX", "XXX..XX..XXX", "XXX......XXX", ".XX......XX.", "............"],
    chest: ["..XX....XX..", ".XXXX..XXXX.", "XXXXXXXXXXXX", "XXXXXXXXXXXX", "XX.XXXXXX.XX", "XX.XXXXXX.XX", "...XXXXXX...", "...XXXXXX...", "...XXXXXX...", "...XXXXXX...", "...XXXXXX...", "............"],
    legs: [".XXXXXXXXXX.", ".XXXXXXXXXX.", ".XXXXXXXXXX.", ".XXXX..XXXX.", ".XXXX..XXXX.", ".XXXX..XXXX.", ".XXXX..XXXX.", ".XXXX..XXXX.", ".XXXX..XXXX.", "XXXXX..XXXXX", "XXXXX..XXXXX", "............"],
    ring: ["....XXXX....", "...XXXXXX...", "....XXXX....", "..XXX..XXX..", ".XX......XX.", "XX........XX", "XX........XX", "XX........XX", ".XX......XX.", "..XXX..XXX..", "....XXXX....", "............"],
    rune: ["...XXXXXX...", "..XXXXXXXX..", ".XXXX..XXXX.", ".XXX.XX.XXX.", ".XXX.XX.XXX.", ".XXXX..XXXX.", ".XXXXX.XXXX.", ".XXXX.XXXXX.", ".XXXXX.XXXX.", ".XXXXXXXXXX.", "..XXXXXXXX..", "............"],
  };
  const TAB_ICONS = {
    stats: pix(["............", ".........XX.", ".........XX.", "......XX.XX.", "......XX.XX.", "...XX.XX.XX.", "...XX.XX.XX.", "XX.XX.XX.XX.", "XX.XX.XX.XX.", "XX.XX.XX.XX.", "XXXXXXXXXXXX", "............"], { X: "#1b1108" }),
    perks: pix([".....XX.....", ".....XX.....", "....XYYX....", "XXXXXYYXXXXX", ".XXYYYYYYXX.", "..XXYYYYXX..", "...XYYYYX...", "..XXYXXYXX..", "..XXX..XXX..", ".XX......XX.", "............", "............"], { X: "#1b1108", Y: "#ffd84a" }),
    build: pix([".XXXXXXXXX..", "X.YYYYYYY.X.", ".XYYYYYYYX..", ".XY.....YX..", ".XYYYYYYYX..", ".XY.....YX..", ".XYYYYYYYX..", ".XY....YYX..", ".XYYYYYYYX..", "..XXXXXXXXX.", ".X.YYYYYYY.X", "..XXXXXXXXX."], { X: "#1b1108", Y: "#f3e6cc" }),
  };

  // ------------------------------------------------------------ textures
  function noiseTex(base, palette, density) {
    const size = 32, c = document.createElement("canvas");
    c.width = c.height = size;
    const g = c.getContext("2d");
    g.fillStyle = base;
    g.fillRect(0, 0, size, size);
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      if (rnd() < density) { g.fillStyle = palette[Math.floor(rnd() * palette.length)]; g.fillRect(x, y, 1, 1); }
    }
    return `url(${c.toDataURL()})`;
  }
  const root = document.documentElement.style;
  root.setProperty("--sand-tex", noiseTex("#c39b62", ["#b38a52", "#cfa96e", "#a87f4a", "#d6b47c", "#bb9159"], 0.55));
  root.setProperty("--dark-tex", noiseTex("#6b5133", ["#5e4629", "#765a39", "#634a2e", "#806442"], 0.5));
  root.setProperty("--stat-tex", noiseTex("#6e5d49", ["#665542", "#776552", "#5f4f3d", "#7d6b57"], 0.5));
  Object.entries(D.multiFrames || {}).forEach(([kind, f]) => {
    root.setProperty(`--${kind}-border`, `url(${f.border})`);
    root.setProperty(`--${kind}-mask`, `url(${f.mask})`);
  });

  // ------------------------------------------------------------ state
  const emptyBuild = (n) => sanitize({ name: "Build " + n, level: 80 });

  function load() {
    let s = null;
    try { s = JSON.parse(localStorage.getItem(STORE_KEY)); } catch (e) { /* storage unavailable */ }
    if (!s || !Array.isArray(s.loadouts) || s.loadouts.length !== 3) {
      s = { active: 0, loadouts: [emptyBuild(1), emptyBuild(2), emptyBuild(3)], favorites: [] };
    }
    s.loadouts = s.loadouts.map((b, i) => sanitize(b) || emptyBuild(i + 1));
    s.favorites = Array.isArray(s.favorites) ? s.favorites.filter((id) => itemById[id]) : [];
    s.active = [0, 1, 2].includes(s.active) ? s.active : 0;
    return s;
  }

  // Drops unknown items/enchants so stale saves and hand-edited links stay valid.
  function sanitize(b) {
    if (!b || typeof b !== "object") return null;
    const out = {
      name: String(b.name || "Build").slice(0, 40),
      level: clamp(parseInt(b.level, 10) || 80, 1, 80),
      notes: String(b.notes || "").slice(0, 2000),
      slots: {}, inf: {},
    };
    C.SLOTS.forEach((slot) => {
      const s = b.slots && b.slots[slot];
      if (s && itemById[s.id] && itemById[s.id].slot === slot) {
        const ench = [0, 1, 2].map((i) => (s.ench && enchByName[s.ench[i]] ? s.ench[i] : null));
        out.slots[slot] = { id: s.id, lvl: clamp(s.lvl | 0, 0, MAX_LVL), ench: validEnchants(ench) };
      }
    });
    C.INFUSABLE.forEach((slot) => {
      const s = b.inf && b.inf[slot];
      if (s && itemById[s.id] && itemById[s.id].slot === slot) out.inf[slot] = { id: s.id, lvl: clamp(s.lvl | 0, 0, MAX_LVL) };
    });
    out.race = M.raceById[b.race] ? b.race : null;
    out.guild = b.guild && M.guildById[b.guild.id] ? { id: b.guild.id, rank: clamp(b.guild.rank | 0 || 1, 1, 3) } : null;
    if (out.guild && out.guild.id === "draconic") {
      // draconic rune infusion choice and Dragon Blooded color
      if (M.DRACONIC.abilities.some((x) => x.id === b.guild.ability)) out.guild.ability = b.guild.ability;
      if (M.DRACONIC.colors.includes(b.guild.color)) out.guild.color = b.guild.color;
    }
    const w = b.weapon || {};
    const part = (id, kind) => (M.partById[id] && M.partById[id].kind === kind ? id : null);
    out.weapon = {
      mode: w.mode === "monk" ? "monk" : "sword",
      handle: part(w.handle, "handle"), blade: part(w.blade, "blade"),
      gloves: part(w.gloves, "gloves"), essence: part(w.essence, "essence"),
      shrine: !!w.shrine, art: M.artById[w.art] ? w.art : null,
    };
    out.test = sanitizeTest(b.test);
    return out;
  }

  function sanitizeTest(t) {
    const d = Dmg.defaults();
    if (!t || typeof t !== "object") return d;
    const out = { ...d };
    ["attack", "swingTime", "perkAtkSpeed", "customBase", "customHits", "crit", "dmgBonus", "rotMode", "duration"].forEach((k) => {
      if (t[k] !== undefined && typeof t[k] === typeof d[k]) out[k] = t[k];
    });
    if (!["time", "count"].includes(out.rotMode)) out.rotMode = "time";
    // older saves had three checkboxes instead of the rotation table
    const legacy = { m2: t.useM2, art: t.useArt, rune: t.useRune };
    out.rot = Object.fromEntries(Object.entries(d.rot).map(([k, def]) => {
      const v = t.rot && typeof t.rot[k] === "object" && t.rot[k] ? t.rot[k] : {};
      const r = { ...def };
      if (typeof legacy[k] === "boolean") r.on = legacy[k];
      if (typeof v.on === "boolean") r.on = v.on;
      if (typeof v.count === "number" && Number.isFinite(v.count)) r.count = clamp(Math.round(v.count), 0, 999);
      if ("cooldown" in def && typeof v.cooldown === "number" && Number.isFinite(v.cooldown)) r.cooldown = clamp(v.cooldown, 0, 600);
      return [k, r];
    }));
    if (typeof t.spirit === "string") out.spirit = t.spirit;
    if (!["m1", "m2", "art", "rune", "drac", "special", "potion", "custom"].includes(out.attack)) out.attack = "m1";
    if (!["avg", "always", "never"].includes(out.crit)) out.crit = "avg";
    Object.keys(d.target).forEach((k) => { if (t.target && typeof t.target[k] === "number") out.target[k] = t.target[k]; });
    Object.keys(d.dots).forEach((k) => {
      const v = t.dots && t.dots[k];
      if (v) out.dots[k] = { on: !!v.on, potency: typeof v.potency === "number" ? v.potency : 0 };
    });
    const plain = (o, ok) => Object.fromEntries(Object.entries(o && typeof o === "object" ? o : {})
      .filter(([k, v]) => /^[a-z0-9-]+$/i.test(k) && ok(v)));
    if (typeof t.spiritMax === "number" && t.spiritMax > 0) out.spiritMax = Math.min(1000, t.spiritMax);
    out.rotOrder = Dmg.rotOrder(t);
    const num = (v, lo, hi) => (typeof v === "number" && Number.isFinite(v) ? clamp(v, lo, hi) : undefined);
    out.timing = Object.fromEntries(Object.entries(t.timing && typeof t.timing === "object" ? t.timing : {})
      .filter(([k, v]) => /^[a-z0-9:-]+$/i.test(k) && v && typeof v === "object")
      .map(([k, v]) => [k, { ...(num(v.cast, 0.05, 60) !== undefined ? { cast: num(v.cast, 0.05, 60) } : {}), ...(num(v.active, 0, 120) !== undefined ? { active: num(v.active, 0, 120) } : {}) }]));
    const incDef = window.VoxlSupport.defaults();
    const inc = t.inc && typeof t.inc === "object" ? t.inc : {};
    out.inc = Object.fromEntries(Object.entries(incDef).map(([k, d]) => [k, typeof inc[k] === typeof d ? inc[k] : d]));
    if (!window.VoxlSupport.INC_TYPES.includes(out.inc.type)) out.inc.type = incDef.type;
    out.potions = plain(t.potions, (v) => typeof v === "boolean");
    out.perkOn = plain(t.perkOn, (v) => typeof v === "boolean");
    out.sit = plain(t.sit, (v) => ["number", "string", "boolean"].includes(typeof v));
    out.status = Object.fromEntries(Object.entries(plain(t.status, (v) => v && typeof v === "object")).map(([k, v]) => [k, {
      on: !!v.on, src: Number.isInteger(v.src) ? v.src : 0, ...(typeof v.pot === "number" ? { pot: v.pot } : {}),
    }]));
    return out;
  }

  function validEnchants(list) {
    const kept = [];
    return list.map((n) => {
      if (!n || E.conflictReason(kept, n)) return null;
      kept.push(n);
      return n;
    });
  }

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  let store = load();
  const ui = {
    view: "inv", slot: "head", mode: "item", selected: null, hover: null, search: "", sort: "", favOnly: false, tab: "stats", socket: null,
    partKind: "handle", partSearch: "", partSort: "", hoverEntity: null, pinEntity: null,
  };
  const VIEWS = [["inv", "INVENTORY"], ["char", "CHARACTER"], ["test", "TEST"]];
  let undoSnapshot = null;

  const build = () => store.loadouts[store.active];
  const totalsOf = (b) => C.buildTotals(b, itemById, M.extraSources(b));
  const target = () => (ui.mode === "inf" ? build().inf[ui.slot] : build().slots[ui.slot]);

  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch (e) { /* storage unavailable */ }
    const url = location.pathname + location.search + "#b=" + encodeBuild(build());
    history.replaceState(null, "", url);
  }

  function snapshot() { undoSnapshot = { active: store.active, build: JSON.parse(JSON.stringify(build())) }; }
  function undo() {
    if (!undoSnapshot) return;
    store.loadouts[undoSnapshot.active] = undoSnapshot.build;
    store.active = undoSnapshot.active;
    undoSnapshot = null;
    commit();
    toast("Undone");
  }

  // ------------------------------------------------------------ share links
  function encodeBuild(b) {
    const compact = { n: b.name, l: b.level, t: b.notes || undefined, s: {}, i: {} };
    Object.entries(b.slots).forEach(([k, v]) => { compact.s[k] = [v.id, v.lvl, v.ench.map((e) => e || "")]; });
    Object.entries(b.inf).forEach(([k, v]) => { compact.i[k] = [v.id, v.lvl]; });
    if (b.race) compact.r = b.race;
    if (b.guild) compact.g = [b.guild.id, b.guild.rank];
    const w = b.weapon;
    if (w && (w.handle || w.blade || w.gloves || w.essence || w.art)) {
      compact.w = [w.mode, w.handle || "", w.blade || "", w.gloves || "", w.essence || "", w.shrine ? 1 : 0, w.art || ""];
    }
    compact.x = b.test;
    const bytes = new TextEncoder().encode(JSON.stringify(compact));
    let bin = "";
    bytes.forEach((x) => { bin += String.fromCharCode(x); });
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function decodeBuild(str) {
    try {
      const bin = atob(str.replace(/-/g, "+").replace(/_/g, "/"));
      const c = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (ch) => ch.charCodeAt(0))));
      const b = { name: c.n, level: c.l, notes: c.t, slots: {}, inf: {} };
      Object.entries(c.s || {}).forEach(([k, v]) => { b.slots[k] = { id: v[0], lvl: v[1], ench: (v[2] || []).map((e) => e || null) }; });
      Object.entries(c.i || {}).forEach(([k, v]) => { b.inf[k] = { id: v[0], lvl: v[1] }; });
      b.race = c.r;
      if (c.g) b.guild = { id: c.g[0], rank: c.g[1] };
      if (c.w) b.weapon = { mode: c.w[0], handle: c.w[1], blade: c.w[2], gloves: c.w[3], essence: c.w[4], shrine: !!c.w[5], art: c.w[6] };
      b.test = c.x;
      return sanitize(b);
    } catch (e) {
      return null;
    }
  }

  function shareUrl() { return location.href.split("#")[0] + "#b=" + encodeBuild(build()); }

  async function copy(text, okMsg) {
    try {
      await navigator.clipboard.writeText(text);
      toast(okMsg);
    } catch (e) {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); toast(okMsg); } catch (err) { toast("Copy failed — select the link manually"); }
      ta.remove();
    }
  }

  // ------------------------------------------------------------ helpers
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const img = (file, alt) => (file ? `<img src="assets/img/${esc(file)}" alt="${esc(alt || "")}" loading="lazy" draggable="false">` : "");
  const enchColors = (ench) => (ench || []).filter(Boolean).map((n) => E.COLORS[n] || "#fff");

  // The wiki's enchant images are the in-game slot frames. Double/triple enchants use the wiki's
  // DE/TE frame art with the enchant colors painted through its mask, as the wiki does.
  function framesHTML(ench) {
    const list = (ench || []).filter((n) => n && enchByName[n] && enchByName[n].image);
    if (list.length <= 1) {
      return list.map((n) => `<img class="frame" src="assets/img/${esc(enchByName[n].image)}" alt="" draggable="false">`).join("");
    }
    const colors = list.map((n) => E.COLORS[n] || "#fff");
    const stops = list.length === 2 ? colors : colors.slice().reverse();
    return `<span class="mframe ${list.length === 2 ? "de" : "te"}"><span class="mfill" style="background:linear-gradient(315deg, ${stops.join(", ")})"></span></span>`;
  }

  function nameHTML(item, ench, cls) {
    const names = (ench || []).filter(Boolean);
    const full = esc((names.length ? names.join(" ") + " " : "") + item.name);
    const colors = enchColors(names);
    if (!colors.length) return `<span class="${cls || ""} outline">${full}</span>`;
    if (colors.length === 1) return `<span class="${cls || ""} outline" style="color:${colors[0]}">${full}</span>`;
    const grad = `linear-gradient(90deg, ${colors.join(", ")})`;
    return `<span class="${cls || ""}" style="background:${grad};-webkit-background-clip:text;background-clip:text;color:transparent;text-shadow:none;filter:drop-shadow(2px 0 0 #000) drop-shadow(-2px 0 0 #000) drop-shadow(0 2px 0 #000) drop-shadow(0 -2px 0 #000)">${full}</span>`;
  }

  function perkInfo(id, fallbackName) {
    const p = D.perks[id];
    if (p) return { name: p.name, desc: p.desc };
    const ench = D.enchants.find((e) => E.EFFECTS[e.name] && E.EFFECTS[e.name].__perk__ && C.slug(E.EFFECTS[e.name].__perk__) === id);
    return { name: fallbackName || (ench && E.EFFECTS[ench.name].__perk__) || id, desc: ench ? ench.perkDesc : "" };
  }

  function statLine(stat, v, cls) {
    return `<div class="${cls || "stat-line"} outline" style="color:${STAT_COLORS[stat] || "#fff"}">${esc(stat)}: ${C.fmtStat(stat, v)}</div>`;
  }

  let toastTimer;
  function toast(msg, action) {
    const t = $("toast");
    t.innerHTML = `<span>${esc(msg)}</span>` + (action ? `<button type="button">${esc(action.label)}</button>` : "");
    if (action) t.querySelector("button").onclick = () => { action.run(); t.classList.remove("show"); };
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), action ? 6000 : 2200);
  }

  // ------------------------------------------------------------ rendering
  function renderTop() {
    const b = build();
    const filled = Object.keys(b.slots).length + Object.keys(b.inf).length;
    $("equipCount").textContent = filled + "/9";
    $("buildNameBtn").textContent = b.name || "Unnamed";
    $("charLevelLabel").textContent = b.level;
    $("dataDate").textContent = "data scraped " + D.scraped;
  }

  function renderCross() {
    const b = build();
    $("cross").innerHTML = C.SLOTS.map((slot) => {
      const s = b.slots[slot];
      const item = s && itemById[s.id];
      const frames = item ? framesHTML(s.ench) : "";
      const sel = ui.slot === slot && ui.mode === "item" ? " selected" : "";
      return `<div class="cell cell-${slot}">
        <button class="slot${frames ? " enchanted" : ""}${sel}" data-slot="${slot}" title="${esc(C.SLOT_NAMES[slot])}${item ? ": " + esc(item.name) : " (empty)"}">
          <span class="slot-inner">${item ? img(item.image, item.name) : `<span class="ghost">${pix(GHOST[slot], { X: "#1a1007" })}</span>`}</span>
          ${frames}
          ${item && s.lvl ? `<span class="slot-lvl outline">+${s.lvl}</span>` : ""}
        </button></div>`;
    }).join("");
    renderInfusions();
  }

  function renderInfusions() {
    const b = build();
    $("infusions").innerHTML = C.INFUSABLE.map((slot) => {
      const fi = b.inf[slot];
      const item = fi && itemById[fi.id];
      const sel = ui.slot === slot && ui.mode === "inf" ? " selected" : "";
      return `<button class="inf-slot${sel}${item ? " filled" : ""}" data-inf="${slot}" title="${esc(C.SLOT_NAMES[slot])} infusion${item ? ": " + esc(item.name) : " (empty)"}">
        ${item ? img(item.image, item.name) : `<span class="ghost">${pix(GHOST[slot], { X: "#1a1007" })}</span>`}
        ${item && fi.lvl ? `<span class="inf-lvl outline">+${fi.lvl}</span>` : ""}</button>`;
    }).join("");
  }

  function renderLoadouts() {
    $("loadouts").innerHTML = [0, 1, 2].map((i) =>
      `<button class="loadout outline${store.active === i ? " active" : ""}" data-loadout="${i}" title="Loadout ${i + 1}: ${esc(store.loadouts[i].name)}">${i + 1}</button>`).join("");
  }

  function renderMidHead() {
    $("slotTitle").textContent = (ui.mode === "inf" ? C.SLOT_NAMES[ui.slot] + " INFUSION" : C.SLOT_NAMES[ui.slot]).toUpperCase();
    $("modeTabs").innerHTML = C.INFUSABLE.includes(ui.slot)
      ? `<button class="mode-tab outline${ui.mode === "item" ? " active" : ""}" data-mode="item">EQUIPPED</button><button class="mode-tab outline${ui.mode === "inf" ? " active" : ""}" data-mode="inf">INFUSION</button>`
      : "";
  }

  function renderForge() {
    const t = target();
    const item = t && itemById[t.id];
    const isInf = ui.mode === "inf";
    const lvl = t ? t.lvl : 0;
    const pips = Array.from({ length: MAX_LVL }, (_, i) =>
      `<button class="pip${i < lvl ? " on" : ""}" data-pip="${i + 1}" ${item ? "" : "disabled"} aria-label="Upgrade level ${i + 1}"></button>`).join("");
    const levelRow = `<div class="forge-row"><span class="lab">LEVEL</span>
      <button class="stepper" data-step="-1" ${item && lvl > 0 ? "" : "disabled"} aria-label="Lower level">-</button>
      <span class="pips">${pips}</span>
      <button class="stepper" data-step="1" ${item && lvl < MAX_LVL ? "" : "disabled"} aria-label="Raise level">+</button>
      <span class="outline" style="color:#fff36a">+${lvl}</span>
      ${lvl ? `<span class="cost">${C.forgeCost(lvl).toLocaleString()} V$</span>` : ""}</div>`;
    let third;
    if (isInf) {
      third = `<div class="forge-note">Infusions grant the piece's perk and 50% of its stats. Can't be enchanted. Cost: ${esc(C.INFUSION_COST[ui.slot])}.</div>`;
    } else {
      const sockets = [0, 1, 2].map((i) => {
        const n = t && t.ench[i];
        const e = n && enchByName[n];
        return `<button class="socket${e ? " filled" : ""}" data-socket="${i}" ${item ? "" : "disabled"} title="${n ? esc(n) + " — click to change" : "Add enchant"}">${e ? `${framesHTML([n])}<span class="sock-lab outline" style="color:${E.COLORS[n] || "#fff"}">${esc(n.replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase())}</span>` : "+"}</button>`;
      }).join("");
      third = `<div class="forge-row"><span class="lab">ENCHANTS</span><span class="sockets">${sockets}</span></div>`;
    }
    $("forge").innerHTML = `
      <div class="forge-thumb">${item ? img(item.image, item.name) : "EMPTY"}</div>
      <div class="forge-name">${item ? nameHTML(item, isInf ? [] : t.ench) : `<span class="outline" style="color:#e6d3b1">Empty — pick an item below and press EQUIP</span>`}</div>
      ${levelRow}${third}`;
  }

  function slotItems() {
    return D.items.filter((i) => i.slot === ui.slot);
  }

  function renderSortOptions() {
    const present = new Set();
    slotItems().forEach((i) => Object.keys(i.stats).forEach((k) => present.add(k)));
    const opts = [...C.BOOSTS, ...C.DEFENSES].filter((k) => present.has(k));
    if (ui.sort && !present.has(ui.sort)) ui.sort = "";
    $("sortStat").innerHTML = `<option value="">Sort: A–Z</option>` + opts.map((k) => `<option value="${esc(k)}"${ui.sort === k ? " selected" : ""}>${esc(k)}</option>`).join("");
  }

  function renderGrid() {
    const q = ui.search.trim().toLowerCase();
    const fav = new Set(store.favorites);
    const t = target();
    let list = slotItems().filter((i) => {
      if (ui.favOnly && !fav.has(i.id)) return false;
      if (!q) return true;
      const perkNames = i.perks.map((p) => perkInfo(p.id).name).join(" ");
      return (i.name + " " + (i.set || "") + " " + perkNames).toLowerCase().includes(q);
    });
    if (ui.sort) {
      list.sort((a, b) => (b.stats[ui.sort] || 0) - (a.stats[ui.sort] || 0) || a.name.localeCompare(b.name));
    } else {
      list.sort((a, b) => (fav.has(b.id) - fav.has(a.id)) || a.name.localeCompare(b.name));
    }
    $("itemGrid").innerHTML = list.length ? list.map((i) => {
      const v = ui.sort && i.stats[ui.sort];
      return `<button class="tile${ui.selected === i.id ? " selected" : ""}" data-item="${esc(i.id)}" role="option" aria-selected="${ui.selected === i.id}">
        ${t && t.id === i.id ? `<span class="badge eq outline">E</span>` : ""}
        ${fav.has(i.id) ? `<span class="badge fav outline">★</span>` : ""}
        ${img(i.image, i.name)}
        ${v ? `<span class="badge val" style="color:${STAT_COLORS[ui.sort] || "#fff"}">${C.fmtStat(ui.sort, v)}</span>` : ""}
        <span class="tname">${esc(i.name)}</span></button>`;
    }).join("") : `<div class="grid-empty outline">NO ITEMS FOUND</div>`;
    $("favOnly").setAttribute("aria-pressed", String(ui.favOnly));
    updateActionButtons();
  }

  function updateActionButtons() {
    const t = target();
    $("equipBtn").disabled = !ui.selected || (t && t.id === ui.selected);
    $("favBtn").disabled = !ui.selected && !t;
    $("destroyBtn").disabled = !t;
    const favId = ui.selected || (t && t.id);
    $("favBtn").textContent = favId && store.favorites.includes(favId) ? "UNFAVORITE" : "FAVORITE";
  }

  function renderSidetabs() {
    const tabs = [["stats", "Statistics"], ["perks", "Perks"], ["build", "Build & share"]];
    $("sidetabs").innerHTML = tabs.map(([k, label]) =>
      `<button class="sidetab${ui.tab === k ? " active" : ""}" data-tab="${k}" title="${label}" aria-label="${label}">${TAB_ICONS[k]}</button>`).join("");
  }

  function renderRight() {
    const b = build();
    const totals = totalsOf(b);
    const body = $("rightBody");
    if (ui.tab === "stats") {
      const boosts = C.BOOSTS.filter((k) => totals.stats[k]);
      const defs = C.DEFENSES.filter((k) => totals.stats[k]);
      const der = C.derived(totals.stats, b.level);
      body.innerHTML = `
        <div class="sec-title boosts outline">[Boosts]</div><div class="rule"></div>
        ${boosts.length ? boosts.map((k) => statLine(k, totals.stats[k])).join("") : `<div class="empty-note">No boosts yet</div>`}
        <div class="sec-title defenses outline">[Defenses]</div><div class="rule"></div>
        ${defs.length ? defs.map((k) => statLine(k, totals.stats[k])).join("") : `<div class="empty-note">No defenses yet</div>`}
        <div class="sec-title derived outline">[Derived]</div><div class="rule"></div>
        ${der.map(([k, v]) => `<div class="stat-line outline" style="color:#e6d3ff">${esc(k)}: ${esc(v)}</div>`).join("")}`;
    } else if (ui.tab === "perks") {
      const perks = Object.values(totals.perks).sort((a, b2) => b2.amount - a.amount || perkInfo(a.id, a.name).name.localeCompare(perkInfo(b2.id, b2.name).name));
      body.innerHTML = `<div class="sec-title perks outline">[Perks]</div><div class="rule"></div>` + (perks.length ? perks.map((p) => {
        const info = perkInfo(p.id, p.name);
        return `<div class="perk-card"><div class="pn outline">${esc(info.name)}: +${C.round(p.amount)}</div>
          ${info.desc ? `<div class="pd">${esc(info.desc)}</div>` : ""}
          <div class="ps">From: ${esc(p.sources.join(", "))}</div></div>`;
      }).join("") : `<div class="empty-note">Equip items to collect perks</div>`);
    } else {
      const forge = C.SLOTS.reduce((a, s) => a + (b.slots[s] ? C.forgeCost(b.slots[s].lvl) : 0), 0) +
        C.INFUSABLE.reduce((a, s) => a + (b.inf[s] ? C.forgeCost(b.inf[s].lvl) : 0), 0);
      const orbs = ["head", "chest", "legs"].filter((s) => b.inf[s]).length;
      const enchCount = C.SLOTS.reduce((a, s) => a + (b.slots[s] ? b.slots[s].ench.filter(Boolean).length : 0), 0);
      body.innerHTML = `
        <div class="sec-title build outline">[Build]</div><div class="rule"></div>
        <label class="field"><span class="outline">NAME</span><input id="fName" maxlength="40" value="${esc(b.name)}"></label>
        <label class="field"><span class="outline">CHARACTER LEVEL (1-80)</span><input id="fLevel" type="number" min="1" max="80" value="${b.level}"></label>
        <label class="field"><span class="outline">NOTES</span><textarea id="fNotes" maxlength="2000" placeholder="Playstyle, weapon, rotation…">${esc(b.notes)}</textarea></label>
        <div class="mini-stats">Forge cost: <b>${forge.toLocaleString()} V$</b><br>Binding Orbs for infusions: <b>${orbs}</b><br>Enchants used: <b>${enchCount}</b></div>
        <div class="btn-row">
          <button class="txtbtn green outline small" id="copyLink">COPY LINK</button>
          <button class="txtbtn blue outline small" id="copyText">COPY AS TEXT</button>
          <button class="txtbtn red outline small" id="resetBuild">RESET LOADOUT</button>
        </div>`;
    }
  }

  function renderDesc() {
    const box = $("desc");
    // hover previews; otherwise the last thing clicked in the Character tab stays pinned so it can be scrolled
    const ent = ui.hoverEntity || (ui.view === "char" && ui.pinEntity);
    if (ent) {
      box.innerHTML = window.VoxlViews.describe(api, ent);
      return;
    }
    if (ui.view !== "inv") {
      box.innerHTML = ui.view === "char"
        ? `<div class="d-hint">Pick a race, a guild and rank, and build your weapon from two parts. Hover anything to preview it; click to pin its details here. Weapon, guild and race stats are added to your totals.</div>`
        : `<div class="d-hint">Choose an attack, toggle buffs, DoTs and the target's defenses. Damage follows the wiki's damage formula. The rotation runs one action at a time with cast times, and the Survival card covers defense, healing and minion perks.</div>`;
      return;
    }
    const t = target();
    let id = ui.hover || ui.selected || (t && t.id);
    let fromSlot = null;
    if (ui.hoverSlot) {
      const hs = ui.hoverSlot;
      const s = hs.inf ? build().inf[hs.slot] : build().slots[hs.slot];
      if (s) { id = s.id; fromSlot = { ...s, inf: hs.inf }; }
    }
    const item = id && itemById[id];
    if (!item) {
      box.innerHTML = `<div class="d-hint">Click a slot on the left, pick an item from the list and press <b>EQUIP</b> (or double-click). Use the <b>INFUSIONS</b> row under the slots to set infusions. Hover anything to see its stats here.</div>`;
      return;
    }
    // Preview with the level/enchants of whatever is being edited.
    const ctx = fromSlot || (t ? { lvl: t.lvl, ench: t.ench, inf: ui.mode === "inf" } : { lvl: 0, ench: [], inf: ui.mode === "inf" });
    const res = ctx.inf ? C.infusionStats(item, ctx.lvl) : C.pieceStats(item, ctx.lvl, ctx.ench);
    const stats = [...C.BOOSTS, ...C.DEFENSES].filter((k) => res.stats[k]);
    const where = C.SLOT_NAMES[item.slot] + (item.set ? " · " + item.set + " set" : "");
    const tag = (ctx.lvl ? ` · +${ctx.lvl}` : "") + (ctx.inf ? " · infused (50%)" : "");
    box.innerHTML = `
      <div class="d-name">${nameHTML(item, ctx.inf ? [] : ctx.ench)}</div>
      <div class="d-sub">${esc(where)}${esc(tag)}</div>
      ${item.desc ? `<div class="d-desc">"${esc(item.desc)}"</div>` : ""}
      ${stats.map((k) => statLine(k, res.stats[k], "d-stat")).join("")}
      ${item.cooldown ? `<div class="d-stat outline" style="color:#cfe">Cooldown: ${item.cooldown}s</div>` : ""}
      ${res.perks.map((p) => { const info = perkInfo(p.id, p.name); return `<div class="d-perk"><b class="outline">${esc(info.name)}: +${C.round(p.amount)}</b> ${esc(info.desc)}</div>`; }).join("")}
      ${item.details && item.details.length ? `<ul class="d-list">${item.details.map((d) => `<li>${esc(d)}</li>`).join("")}</ul>` : ""}
      ${item.obtain && item.obtain.length ? `<div class="d-sub" style="margin-top:8px">Obtain: ${esc(item.obtain.join(" · "))}</div>` : ""}
      <div class="d-sub"><a href="https://voxlpedia.miraheze.org/wiki/${encodeURIComponent(item.page.replace(/ /g, "_"))}" target="_blank" rel="noopener">Open on wiki ↗</a></div>`;
  }

  function renderAll() {
    renderTop();
    renderCross();
    renderLoadouts();
    renderMidHead();
    renderForge();
    renderSortOptions();
    renderGrid();
    renderSidetabs();
    renderRight();
    renderView();
  }

  // Re-render everything that depends on the build (not the grid scroll position).
  function commit() {
    save();
    renderTop();
    renderCross();
    renderLoadouts();
    renderMidHead();
    renderForge();
    refreshGridBadges();
    renderRight();
    renderView();
  }

  function renderView() {
    $("viewTabs").innerHTML = VIEWS.map(([k, label]) =>
      `<button class="vtab outline${ui.view === k ? " active" : ""}" data-view="${k}">${label}</button>`).join("");
    VIEWS.forEach(([k]) => { $("view-" + k).hidden = ui.view !== k; });
    if (ui.view === "char") window.VoxlViews.char.render(api);
    if (ui.view === "test") window.VoxlViews.test.render(api);
    renderBadges();
    renderDesc();
  }

  function renderBadges() {
    const b = build();
    const wpn = M.weapon(b);
    const race = b.race ? M.raceById[b.race].name : "No race";
    const guild = b.guild ? `${M.guildById[b.guild.id].name} R${b.guild.rank}` : "No guild";
    const perkMap = {};
    Object.values(totalsOf(b).perks).forEach((p) => { perkMap[p.id] = p.amount; });
    const weapon = wpn.parts.length === 2 ? M.weaponForm(b, perkMap).m1 : wpn.parts.length ? "Incomplete weapon" : "No weapon";
    $("charBadges").innerHTML = [race, guild, weapon].map((t) =>
      `<button class="badge-btn outline" data-view="char">${esc(t)}</button>`).join("");
  }

  function refreshGridBadges() {
    const scroll = $("itemGrid").scrollTop;
    renderGrid();
    $("itemGrid").scrollTop = scroll;
  }

  // ------------------------------------------------------------ actions
  function selectSlot(slot, mode) {
    if (ui.slot !== slot) {
      ui.search = "";
      $("search").value = "";
    }
    ui.slot = slot;
    ui.mode = mode === "inf" && C.INFUSABLE.includes(slot) ? "inf" : "item";
    ui.selected = null;
    renderCross();
    renderMidHead();
    renderForge();
    renderSortOptions();
    renderGrid();
    $("itemGrid").scrollTop = 0;
    renderDesc();
  }

  function equip(id) {
    const item = itemById[id];
    if (!item || item.slot !== ui.slot) return;
    const b = build();
    snapshot();
    if (ui.mode === "inf") {
      const prev = b.inf[ui.slot];
      b.inf[ui.slot] = { id, lvl: prev ? prev.lvl : 0 };
    } else {
      const prev = b.slots[ui.slot];
      b.slots[ui.slot] = { id, lvl: prev ? prev.lvl : 0, ench: prev ? prev.ench.slice() : [null, null, null] };
    }
    ui.selected = null;
    commit();
  }

  function destroy() {
    const b = build();
    const t = target();
    if (!t) return;
    snapshot();
    const name = itemById[t.id].name;
    if (ui.mode === "inf") delete b.inf[ui.slot]; else delete b.slots[ui.slot];
    commit();
    toast("Removed " + name, { label: "UNDO", run: undo });
  }

  function toggleFavorite() {
    const t = target();
    const id = ui.selected || (t && t.id);
    if (!id) return;
    const i = store.favorites.indexOf(id);
    if (i >= 0) store.favorites.splice(i, 1); else store.favorites.push(id);
    save();
    refreshGridBadges();
  }

  function setLevel(lvl) {
    const t = target();
    if (!t) return;
    t.lvl = clamp(lvl, 0, MAX_LVL);
    commit();
  }

  // ------------------------------------------------------------ enchant modal
  let lastFocus = null;
  function openEnchants(socket) {
    const t = target();
    if (!t || ui.mode !== "item") return;
    ui.socket = socket;
    lastFocus = document.activeElement;
    const item = itemById[t.id];
    $("enchantTitle").innerHTML = `SOCKET ${socket + 1} · ${nameHTML(item, t.ench)}`;
    const others = t.ench.filter((n, i) => n && i !== socket);
    const card = (e) => {
      const reason = E.conflictReason(others, e.name);
      const current = t.ench[socket] === e.name;
      const src = E.SOURCE_NOTES[e.name];
      return `<button class="ench${current ? " current" : ""}" data-ench="${esc(e.name)}" ${reason && !current ? `disabled title="${esc(reason)}"` : ""}>
        <span class="ench-prev">${img(item.image, "")}${framesHTML([e.name])}</span>
        <span class="en outline" style="color:${E.COLORS[e.name] || "#fff"}">${esc(e.name)}</span>
        <span class="ee">${esc(E.describe(e.name).join(" · "))}${src ? `<br><span class="esrc">${esc(src)}</span>` : ""}${reason && !current ? `<br><span class="esrc">✖ ${esc(reason)}</span>` : ""}</span>
      </button>`;
    };
    $("enchantList").innerHTML = D.enchants.map(card).join("");
    $("enchantRemove").disabled = !t.ench[socket];
    $("enchantModal").hidden = false;
    $("enchantClose").focus();
  }

  function closeEnchants() {
    $("enchantModal").hidden = true;
    ui.socket = null;
    if (lastFocus) lastFocus.focus();
  }

  function applyEnchant(name) {
    const t = target();
    if (!t || ui.socket == null) return;
    snapshot();
    t.ench[ui.socket] = name;
    closeEnchants();
    commit();
  }

  // ------------------------------------------------------------ text export
  function buildText() {
    const b = build();
    const totals = totalsOf(b);
    const lines = [`Voxlblade build: ${b.name} (LV ${b.level})`];
    const wpn = M.weapon(b);
    if (b.race) lines.push("Race: " + M.raceById[b.race].name);
    if (b.guild) lines.push(`Guild: ${M.guildById[b.guild.id].name} rank ${b.guild.rank}`);
    if (wpn.parts.length) lines.push(`Weapon: ${wpn.typeName} — ${wpn.parts.map((p) => p.name).join(" + ")}${b.weapon.shrine ? " (Shrine of Balance)" : ""}${wpn.art ? " · " + wpn.art.name : ""}`);
    C.SLOTS.forEach((slot) => {
      const s = b.slots[slot];
      const f = b.inf[slot];
      let line = C.SLOT_NAMES[slot] + ": ";
      line += s ? [...s.ench.filter(Boolean), itemById[s.id].name].join(" ") + (s.lvl ? " +" + s.lvl : "") : "—";
      if (f) line += ` | Infused: ${itemById[f.id].name}${f.lvl ? " +" + f.lvl : ""}`;
      lines.push(line);
    });
    const st = [...C.BOOSTS, ...C.DEFENSES].filter((k) => totals.stats[k]).map((k) => `${k} ${C.fmtStat(k, totals.stats[k])}`);
    if (st.length) lines.push("Stats: " + st.join(", "));
    const pk = Object.values(totals.perks).map((p) => `${perkInfo(p.id, p.name).name} +${C.round(p.amount)}`);
    if (pk.length) lines.push("Perks: " + pk.join(", "));
    if (b.notes) lines.push("Notes: " + b.notes);
    lines.push(shareUrl());
    return lines.join("\n");
  }

  // ------------------------------------------------------------ events
  ["cross", "infusions"].forEach((id) => {
    $(id).addEventListener("click", (e) => {
      const inf = e.target.closest("[data-inf]");
      if (inf) return selectSlot(inf.dataset.inf, "inf");
      const slot = e.target.closest("[data-slot]");
      if (slot) selectSlot(slot.dataset.slot, "item");
    });
    $(id).addEventListener("mouseover", (e) => {
      const inf = e.target.closest("[data-inf]");
      const slot = e.target.closest("[data-slot]");
      const next = inf ? { slot: inf.dataset.inf, inf: true } : slot ? { slot: slot.dataset.slot, inf: false } : null;
      if (JSON.stringify(next) !== JSON.stringify(ui.hoverSlot || null)) { ui.hoverSlot = next; renderDesc(); }
    });
    $(id).addEventListener("mouseleave", () => { ui.hoverSlot = null; renderDesc(); });
  });

  $("loadouts").addEventListener("click", (e) => {
    const b = e.target.closest("[data-loadout]");
    if (!b) return;
    store.active = +b.dataset.loadout;
    ui.selected = null;
    save();
    renderAll();
  });

  $("modeTabs").addEventListener("click", (e) => {
    const b = e.target.closest("[data-mode]");
    if (b) selectSlot(ui.slot, b.dataset.mode);
  });

  $("forge").addEventListener("click", (e) => {
    const pip = e.target.closest("[data-pip]");
    if (pip) { const n = +pip.dataset.pip; return setLevel(target() && target().lvl === n ? n - 1 : n); }
    const step = e.target.closest("[data-step]");
    if (step && target()) return setLevel(target().lvl + +step.dataset.step);
    const sock = e.target.closest("[data-socket]");
    if (sock) openEnchants(+sock.dataset.socket);
  });

  $("itemGrid").addEventListener("click", (e) => {
    const tile = e.target.closest("[data-item]");
    if (!tile) return;
    ui.selected = tile.dataset.item;
    $("itemGrid").querySelectorAll(".tile.selected").forEach((x) => { x.classList.remove("selected"); x.setAttribute("aria-selected", "false"); });
    tile.classList.add("selected");
    tile.setAttribute("aria-selected", "true");
    updateActionButtons();
    renderDesc();
  });
  $("itemGrid").addEventListener("dblclick", (e) => {
    const tile = e.target.closest("[data-item]");
    if (tile) equip(tile.dataset.item);
  });
  $("itemGrid").addEventListener("mouseover", (e) => {
    const tile = e.target.closest("[data-item]");
    const id = tile ? tile.dataset.item : null;
    if (id !== ui.hover) { ui.hover = id; renderDesc(); }
  });
  $("itemGrid").addEventListener("mouseleave", () => { ui.hover = null; renderDesc(); });

  $("search").addEventListener("input", (e) => { ui.search = e.target.value; renderGrid(); });
  $("sortStat").addEventListener("change", (e) => { ui.sort = e.target.value; renderGrid(); $("itemGrid").scrollTop = 0; });
  $("favOnly").addEventListener("click", () => { ui.favOnly = !ui.favOnly; renderGrid(); });

  $("equipBtn").addEventListener("click", () => ui.selected && equip(ui.selected));
  $("favBtn").addEventListener("click", toggleFavorite);
  $("destroyBtn").addEventListener("click", destroy);

  $("sidetabs").addEventListener("click", (e) => {
    const b = e.target.closest("[data-tab]");
    if (!b) return;
    ui.tab = b.dataset.tab;
    renderSidetabs();
    renderRight();
  });

  $("buildNameBtn").addEventListener("click", () => {
    ui.tab = "build";
    renderSidetabs();
    renderRight();
    const f = $("fName");
    f.focus();
    f.select();
  });

  $("shareBtn").addEventListener("click", () => copy(shareUrl(), "Build link copied!"));

  $("rightBody").addEventListener("input", (e) => {
    const b = build();
    if (e.target.id === "fName") { b.name = e.target.value.slice(0, 40); save(); renderTop(); renderLoadouts(); }
    if (e.target.id === "fNotes") { b.notes = e.target.value.slice(0, 2000); save(); }
    if (e.target.id === "fLevel") {
      const v = parseInt(e.target.value, 10);
      if (v >= 1 && v <= 80) { b.level = v; save(); renderTop(); }
    }
  });
  $("rightBody").addEventListener("change", (e) => {
    if (e.target.id === "fLevel") { e.target.value = build().level; }
  });
  $("rightBody").addEventListener("click", (e) => {
    if (e.target.id === "copyLink") copy(shareUrl(), "Build link copied!");
    if (e.target.id === "copyText") copy(buildText(), "Build summary copied!");
    if (e.target.id === "resetBuild") {
      snapshot();
      store.loadouts[store.active] = emptyBuild(store.active + 1);
      ui.selected = null;
      save();
      renderAll();
      toast("Loadout reset", { label: "UNDO", run: undo });
    }
  });

  $("enchantList").addEventListener("click", (e) => {
    const b = e.target.closest("[data-ench]");
    if (b && !b.disabled) applyEnchant(b.dataset.ench);
  });
  $("enchantRemove").addEventListener("click", () => applyEnchant(null));
  $("enchantClose").addEventListener("click", closeEnchants);
  $("enchantModal").addEventListener("click", (e) => { if (e.target === $("enchantModal")) closeEnchants(); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$("enchantModal").hidden) closeEnchants();
  });

  // ------------------------------------------------------------ views
  const api = {
    D, C, E, M, Dmg, $, esc, img, ui, build, save, commit, totalsOf, perkInfo, statLine, nameHTML, renderDesc,
  };
  window.VoxlApp = api;
  window.VoxlViews.char.bind(api);
  window.VoxlViews.test.bind(api);

  document.addEventListener("click", (e) => {
    const v = e.target.closest("[data-view]");
    if (!v || v.dataset.view === ui.view) return;
    ui.view = v.dataset.view;
    ui.hoverEntity = null;
    renderView();
  });

  // ------------------------------------------------------------ boot
  const m = location.hash.match(/^#b=([A-Za-z0-9_-]+)/);
  if (m) {
    const shared = decodeBuild(m[1]);
    if (shared && JSON.stringify(shared) !== JSON.stringify(build())) {
      snapshot();
      store.loadouts[store.active] = shared;
      try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch (e) { /* storage unavailable */ }
      setTimeout(() => toast(`Loaded shared build into loadout ${store.active + 1}`, { label: "UNDO", run: undo }), 300);
    }
  }
  renderAll();
  save();
})();
