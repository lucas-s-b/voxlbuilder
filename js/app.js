(function () {
  const D = window.VOXL_DATA;
  const C = window.VoxlCalc;
  const E = window.VoxlEnchants;
  const M = window.VoxlModel;
  const Engine = window.VoxlEngine;
  const $ = (id) => document.getElementById(id);

  const itemById = Object.fromEntries(D.items.map((i) => [i.id, i]));
  const SEARCH_STATS = [...new Set(D.items.concat(D.parts).flatMap((entry) => Object.keys(entry.stats || {})))];
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
  // One <rect> per horizontal run of the same color.
  function pix(rows, colors) {
    let rects = "";
    rows.forEach((r, y) => {
      for (let x = 0; x < r.length;) {
        let end = x + 1;
        while (end < r.length && r[end] === r[x]) end++;
        if (colors[r[x]]) rects += `<rect x="${x}" y="${y}" width="${end - x}" height="1" fill="${colors[r[x]]}"/>`;
        x = end;
      }
    });
    return `<svg viewBox="0 0 ${rows[0].length} ${rows.length}" shape-rendering="crispEdges" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${rects}</svg>`;
  }

  // In-game equipment slots, cut 1:1 from the game (assets/img/slot-*.png): frame, corner knots, bottom shadow and
  // the slot's silhouette while it's empty. They're a dark tint over the sand panel, like in game.
  const slotArt = (slot, empty) =>
    `<img src="assets/img/${empty ? "slot-" + slot : "slot-frame"}.png" alt="" draggable="false">`;

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

  const sanitizeTest = (saved) => Engine.sanitizeSettings(saved);

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
  const VIEWS = [["inv", "INVENTORY"], ["char", "CHARACTER"], ["test", "TEST"], ["shop", "WORKSHOP"]];
  let undoSnapshot = null;

  const build = () => store.loadouts[store.active];
  const totalsOf = (b) => C.buildTotals(b, itemById, M.extraSources(b));
  const target = () => (ui.mode === "inf" ? build().inf[ui.slot] : build().slots[ui.slot]);
  // The rune infusion slot only exists with the Draconic guild; it holds the draconic rune (an ability, not an item).
  const canInfuse = (slot) => C.INFUSABLE.includes(slot) || (slot === "rune" && !!M.draconic(build()));
  const isDracInf = () => ui.mode === "inf" && ui.slot === "rune" && !!M.draconic(build());
  const dracId = (ability) => "drac:" + ability.id;
  // id of whatever sits in the slot being edited
  const currentId = () => (isDracInf() ? dracId(M.draconic(build()).ability) : (target() || {}).id);

  let saveSeq = 0;
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch (e) { /* storage unavailable */ }
    // keep the address bar on the current build's share code (encoding is async; only the latest save writes it)
    const seq = ++saveSeq;
    encodeShare(build()).then((code) => { if (seq === saveSeq) history.replaceState(null, "", location.pathname + location.search + "#" + code); });
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
  // "#c=" codes: the compact build with only the Test settings that differ from the defaults, deflated and base64url'd.
  // Older "#b=" codes (plain base64 JSON) still load.
  const testDefaults = () => Engine.defaultSettings();

  // the parts of `v` that differ from `d` (objects compared key by key, everything else as a whole)
  function diff(v, d) {
    const obj = (x) => x && typeof x === "object" && !Array.isArray(x);
    if (obj(v) && obj(d)) {
      const out = {};
      Object.keys(v).forEach((k) => { const x = diff(v[k], d[k]); if (x !== undefined) out[k] = x; });
      return Object.keys(out).length ? out : undefined;
    }
    return JSON.stringify(v) === JSON.stringify(d) ? undefined : v;
  }

  function compactBuild(b) {
    const compact = { n: b.name, l: b.level, t: b.notes || undefined, s: {}, i: {} };
    Object.entries(b.slots).forEach(([k, v]) => { compact.s[k] = [v.id, v.lvl, v.ench.map((e) => e || "")]; });
    Object.entries(b.inf).forEach(([k, v]) => { compact.i[k] = [v.id, v.lvl]; });
    if (b.race) compact.r = b.race;
    if (b.guild) compact.g = [b.guild.id, b.guild.rank, b.guild.ability || "", b.guild.color || ""];
    const w = b.weapon;
    if (w && (w.handle || w.blade || w.gloves || w.essence || w.art)) {
      compact.w = [w.mode, w.handle || "", w.blade || "", w.gloves || "", w.essence || "", w.shrine ? 1 : 0, w.art || ""];
    }
    const x = diff(b.test, testDefaults());
    if (x) compact.x = x;
    return compact;
  }

  function expandBuild(c) {
    const b = { name: c.n, level: c.l, notes: c.t, slots: {}, inf: {} };
    Object.entries(c.s || {}).forEach(([k, v]) => { b.slots[k] = { id: v[0], lvl: v[1], ench: (v[2] || []).map((e) => e || null) }; });
    Object.entries(c.i || {}).forEach(([k, v]) => { b.inf[k] = { id: v[0], lvl: v[1] }; });
    b.race = c.r;
    if (c.g) b.guild = { id: c.g[0], rank: c.g[1], ability: c.g[2] || undefined, color: c.g[3] || undefined };
    if (c.w) b.weapon = { mode: c.w[0], handle: c.w[1], blade: c.w[2], gloves: c.w[3], essence: c.w[4], shrine: !!c.w[5], art: c.w[6] };
    b.test = c.x || {};
    return b;
  }

  const b64url = (bytes) => { let bin = ""; bytes.forEach((x) => { bin += String.fromCharCode(x); }); return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
  const unb64url = (str) => Uint8Array.from(atob(str.replace(/-/g, "+").replace(/_/g, "/")), (ch) => ch.charCodeAt(0));
  const pipeBytes = async (bytes, stream) => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
  const canZip = typeof CompressionStream === "function" && typeof DecompressionStream === "function";

  // "c=…" (or "b=…" in browsers without CompressionStream)
  async function encodeShare(b) {
    const json = new TextEncoder().encode(JSON.stringify(compactBuild(b)));
    return canZip ? "c=" + b64url(await pipeBytes(json, new CompressionStream("deflate-raw"))) : "b=" + b64url(json);
  }

  async function decodeShare(kind, str) {
    try {
      const bytes = unb64url(str);
      const raw = kind === "c" ? await pipeBytes(bytes, new DecompressionStream("deflate-raw")) : bytes;
      return sanitize(expandBuild(JSON.parse(new TextDecoder().decode(raw))));
    } catch (e) {
      return null;
    }
  }

  async function shareUrl() { return location.href.split("#")[0] + "#" + await encodeShare(build()); }

  async function copy(textOrPromise, okMsg) {
    const text = await textOrPromise;
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
  const portrait = (html, small) => `<span class="portrait${small ? " sm" : ""}">${html}</span>`;
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
    const drac = M.draconic(b) ? 1 : 0;
    const filled = Object.keys(b.slots).length + Object.keys(b.inf).length + drac;
    $("equipCount").textContent = filled + "/" + (9 + drac);
    $("buildNameBtn").textContent = b.name || "Unnamed";
    $("charLevelLabel").textContent = b.level;
    $("dataDate").textContent = "data scraped " + D.scraped;
  }

  function slotHTML(slot, inf) {
    const b = build();
    const s = inf ? b.inf[slot] : b.slots[slot];
    const item = s && itemById[s.id];
    const frames = item && !inf ? framesHTML(s.ench) : "";
    const sel = ui.slot === slot && (ui.mode === "inf") === inf ? " selected" : "";
    const title = C.SLOT_NAMES[slot] + (inf ? " infusion" : "") + (item ? ": " + item.name : " (empty)");
    return `<div class="cell cell-${slot}">
      <button class="slot${frames ? " enchanted" : ""}${sel}" ${inf ? "data-inf" : "data-slot"}="${slot}" title="${esc(title)}">
        ${frames ? "" : `<span class="slot-art">${slotArt(slot, !item)}</span>`}
        ${item ? `<span class="slot-inner">${img(item.image, item.name)}</span>` : ""}
        ${frames}
        ${item && s.lvl ? `<span class="slot-lvl outline">+${s.lvl}</span>` : ""}
      </button></div>`;
  }

  function renderCross() {
    $("cross").innerHTML = C.SLOTS.map((slot) => slotHTML(slot, false)).join("");
    renderInfusions();
  }

  // Same cross as the equipment, one infusion per piece; the rune spot only appears with the Draconic guild.
  function renderInfusions() {
    const drac = M.draconic(build());
    $("infusions").innerHTML = C.SLOTS.map((slot) => {
      if (slot !== "rune") return slotHTML(slot, true);
      if (!drac) return "";
      const sel = ui.slot === "rune" && ui.mode === "inf" ? " selected" : "";
      return `<div class="cell cell-rune"><button class="slot drac${sel}" data-inf="rune" title="Rune infusion (Draconic): ${esc(drac.ability.name)}">
        <span class="slot-art">${slotArt("rune", false)}</span>
        <span class="slot-inner">${img("guild-draconic.png", drac.ability.name)}</span></button></div>`;
    }).join("");
  }

  function renderLoadouts() {
    $("loadouts").innerHTML = [0, 1, 2].map((i) =>
      `<button class="loadout outline${store.active === i ? " active" : ""}" data-loadout="${i}" title="Loadout ${i + 1}: ${esc(store.loadouts[i].name)}">${i + 1}</button>`).join("");
  }

  function renderMidHead() {
    if (ui.mode === "inf" && !canInfuse(ui.slot)) ui.mode = "item"; // e.g. left the Draconic guild while on the rune infusion
    $("slotTitle").textContent = (isDracInf() ? "RUNE INFUSION · DRACONIC" : ui.mode === "inf" ? C.SLOT_NAMES[ui.slot] + " INFUSION" : C.SLOT_NAMES[ui.slot]).toUpperCase();
    $("modeTabs").innerHTML = canInfuse(ui.slot)
      ? `<button class="mode-tab outline${ui.mode === "item" ? " active" : ""}" data-mode="item">EQUIPPED</button><button class="mode-tab outline${ui.mode === "inf" ? " active" : ""}" data-mode="inf">INFUSION</button>`
      : "";
  }

  function renderForge() {
    if (isDracInf()) {
      const dr = M.draconic(build());
      const colorText = dr.blooded ? (dr.ability.id === "infusion" ? M.DRACONIC.infusion[dr.color] : M.DRACONIC.attack[dr.color].text) : "Not Dragon Blooded: Physical damage, no color bonus.";
      $("forge").innerHTML = `
        <div class="forge-thumb portrait">${img("guild-draconic.png", dr.ability.name)}</div>
        <div class="forge-name"><span class="outline" style="color:#ff9a6a">${esc(dr.ability.name.toUpperCase())}</span></div>
        <div class="forge-note">${esc(dr.ability.text)} · ${dr.ability.cooldown}s cooldown</div>
        <div class="forge-note">${esc(dr.blooded ? dr.color + ": " : "")}${esc(colorText)} Pick another draconic rune below; ranks unlock more.</div>`;
      return;
    }
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
      <div class="forge-thumb portrait">${item ? img(item.image, item.name) : "EMPTY"}</div>
      <div class="forge-name">${item ? nameHTML(item, isInf ? [] : t.ench) : `<span class="outline" style="color:#e6d3b1">Empty — pick an item below and press EQUIP</span>`}</div>
      ${levelRow}${third}`;
  }

  function slotItems() {
    return isDracInf() ? [] : D.items.filter((i) => i.slot === ui.slot);
  }

  function renderSortOptions() {
    const present = new Set();
    slotItems().forEach((i) => Object.keys(i.stats).forEach((k) => present.add(k)));
    const opts = [...C.BOOSTS, ...C.DEFENSES].filter((k) => present.has(k));
    if (ui.sort && !present.has(ui.sort)) ui.sort = "";
    $("sortStat").innerHTML = `<option value="">Sort: A–Z</option>` + opts.map((k) => `<option value="${esc(k)}"${ui.sort === k ? " selected" : ""}>${esc(k)}</option>`).join("");
  }

  function renderDracGrid(q) {
    const dr = M.draconic(build());
    const list = M.DRACONIC.abilities.filter((x) => window.VoxlSearch.matches(q, { text: window.VoxlSearch.entryText([x.name, x.text], [], perkInfo), stats: {} }));
    $("itemGrid").innerHTML = list.length ? list.map((x) => {
      const id = dracId(x), locked = x.rank > dr.rank;
      return `<button class="tile${ui.selected === id ? " selected" : ""}${locked ? " locked" : ""}" data-item="${id}" role="option" aria-selected="${ui.selected === id}"${locked ? ` title="Unlocked at Draconic rank ${x.rank}"` : ""}>
        ${dr.ability.id === x.id ? `<span class="badge eq outline">E</span>` : ""}
        ${locked ? `<span class="badge fav outline" style="color:#c9a8ff">R${x.rank}</span>` : ""}
        ${portrait(img("guild-draconic.png", x.name))}<span class="tname">${esc(x.name)}</span></button>`;
    }).join("") : `<div class="grid-empty outline">NO RUNES FOUND</div>`;
  }

  function renderGrid() {
    const q = window.VoxlSearch.parse(ui.search, SEARCH_STATS);
    const sortStat = ui.sort || window.VoxlSearch.filterStat(q);
    if (isDracInf()) {
      renderDracGrid(q);
      $("favOnly").setAttribute("aria-pressed", String(ui.favOnly));
      updateActionButtons();
      return;
    }
    const fav = new Set(store.favorites);
    const t = target();
    let list = slotItems().filter((i) => {
      if (ui.favOnly && !fav.has(i.id)) return false;
      if (!q.length) return true;
      return window.VoxlSearch.matches(q, { text: window.VoxlSearch.entryText([i.name, i.set, i.desc, i.details || []], i.perks, perkInfo), stats: i.stats });
    });
    if (sortStat) {
      list.sort((a, b) => (b.stats[sortStat] || 0) - (a.stats[sortStat] || 0) || a.name.localeCompare(b.name));
    } else {
      list.sort((a, b) => (fav.has(b.id) - fav.has(a.id)) || a.name.localeCompare(b.name));
    }
    $("itemGrid").innerHTML = list.length ? list.map((i) => {
      const v = sortStat && i.stats[sortStat];
      return `<button class="tile${ui.selected === i.id ? " selected" : ""}" data-item="${esc(i.id)}" role="option" aria-selected="${ui.selected === i.id}">
        ${t && t.id === i.id ? `<span class="badge eq outline">E</span>` : ""}
        ${fav.has(i.id) ? `<span class="badge fav outline">★</span>` : ""}
        ${portrait(img(i.image, i.name))}
        ${v ? `<span class="badge val" style="color:${STAT_COLORS[sortStat] || "#fff"}">${C.fmtStat(sortStat, v)}</span>` : ""}
        <span class="tname">${esc(i.name)}</span></button>`;
    }).join("") : `<div class="grid-empty outline">NO ITEMS FOUND</div>`;
    $("favOnly").setAttribute("aria-pressed", String(ui.favOnly));
    updateActionButtons();
  }

  function updateActionButtons() {
    const t = target();
    $("equipBtn").disabled = !ui.selected || ui.selected === currentId();
    $("favBtn").disabled = isDracInf() || (!ui.selected && !t);
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
      box.innerHTML = ui.view === "shop"
        ? `<div class="d-hint">Browse builds other players published. Search, filter by tags, race, guild or weapon, like the ones you enjoy and press LOAD to put one into your current loadout (you can undo). Use + PUBLISH to share yours.</div>`
        : ui.view === "char"
        ? `<div class="d-hint">Pick a race, a guild and rank, and build your weapon from two parts. Hover anything to preview it; click to pin its details here. Weapon, guild and race stats are added to your totals.</div>`
        : `<div class="d-hint">Choose an attack, toggle buffs, DoTs and the target's defenses. Damage follows the wiki's damage formula. The rotation runs one action at a time with cast times, and the Survival card covers defense, healing and minion perks.</div>`;
      return;
    }
    const t = target();
    let id = ui.hover || ui.selected || currentId();
    let fromSlot = null;
    if (ui.hoverSlot) {
      const hs = ui.hoverSlot;
      const drac = hs.inf && hs.slot === "rune" && M.draconic(build());
      const s = hs.inf ? build().inf[hs.slot] : build().slots[hs.slot];
      if (drac) id = dracId(drac.ability);
      else if (s) { id = s.id; fromSlot = { ...s, inf: hs.inf }; }
    }
    if (id && id.startsWith("drac:")) {
      box.innerHTML = dracDesc(id);
      return;
    }
    const item = id && itemById[id];
    if (!item) {
      box.innerHTML = `<div class="d-hint">Click a slot on the left, pick an item from the list and press <b>EQUIP</b> (or double-click). The <b>INFUSIONS</b> cross beside it holds each piece's infusion. Hover anything to see its stats here.</div>`;
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

  function dracDesc(id) {
    const dr = M.draconic(build());
    const x = M.DRACONIC.abilities.find((a) => dracId(a) === id);
    if (!dr || !x) return "";
    const colorText = !dr.blooded ? "Not Dragon Blooded: Physical damage, no color bonus." : x.id === "infusion" ? M.DRACONIC.infusion[dr.color] : M.DRACONIC.attack[dr.color].text;
    return `<div class="d-name"><span class="outline" style="color:#ff9a6a">${esc(x.name)}</span></div>
      <div class="d-sub">Draconic rune · extra rune key · rank ${x.rank}${x.rank > dr.rank ? " (locked at your rank)" : ""}</div>
      <div class="d-stat outline" style="color:#ffe9a8">${x.cooldown}s cooldown</div>
      <div class="d-perk">${esc(x.text)}</div>
      <div class="d-perk"><b class="outline">${esc(dr.blooded ? dr.color : "Physical")}:</b> ${esc(colorText)}</div>
      <div class="d-sub" style="margin-top:8px">The Dragon Blooded color is picked with the guild in the Character tab.</div>`;
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
    // Test and Workshop show their own numbers: they get the full width instead of the stats column
    document.querySelector("main.inv").classList.toggle("wide", ui.view === "test" || ui.view === "shop");
    if (ui.view === "char") window.VoxlViews.char.render(api);
    if (ui.view === "test") window.VoxlViews.test.render(api);
    if (ui.view === "shop") window.VoxlWorkshop.render();
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
    ui.mode = mode === "inf" && canInfuse(slot) ? "inf" : "item";
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
    const b = build();
    if (isDracInf()) {
      const dr = M.draconic(b);
      const x = M.DRACONIC.abilities.find((a) => dracId(a) === id);
      if (!x) return;
      if (x.rank > dr.rank) return toast(`${x.name} unlocks at Draconic rank ${x.rank}`);
      snapshot();
      b.guild.ability = x.id;
      ui.selected = null;
      return commit();
    }
    const item = itemById[id];
    if (!item || item.slot !== ui.slot) return;
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
  async function buildText() {
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
    lines.push(await shareUrl());
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
  // (shareUrl is async: copy() awaits it)

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
    D, C, E, M, Engine, SEARCH_STATS, $, esc, img, portrait, ui, build, save, commit, totalsOf, perkInfo, statLine, nameHTML, renderDesc,
  };
  window.VoxlApp = api;
  window.VoxlViews.char.bind(api);
  window.VoxlViews.test.bind(api);
  window.VoxlWorkshop.bind(api);

  document.addEventListener("click", (e) => {
    const v = e.target.closest("[data-view]");
    if (!v || v.dataset.view === ui.view) return;
    ui.view = v.dataset.view;
    ui.hoverEntity = null;
    renderView();
  });

  // Put a build into the active loadout (undoable).
  function loadIntoLoadout(shared, label) {
    if (!shared) return false;
    if (JSON.stringify(shared) === JSON.stringify(build())) { toast(`That build is already in loadout ${store.active + 1}`); return true; }
    snapshot();
    store.loadouts[store.active] = shared;
    ui.selected = null;
    commit();
    toast(`Loaded ${label || "shared build"} into loadout ${store.active + 1}`, { label: "UNDO", run: undo });
    return true;
  }
  api.encodeShare = encodeShare;
  api.decodeShare = decodeShare;
  api.loadIntoLoadout = loadIntoLoadout;
  api.copy = copy;
  api.toast = toast;
  api.shareUrl = shareUrl;

  // ------------------------------------------------------------ boot
  renderAll();
  (async () => {
    const m = location.hash.match(/^#([bc])=([A-Za-z0-9_-]+)/);
    const w = location.hash.match(/^#w=([A-Za-z0-9_-]+)/);
    if (m) {
      const shared = await decodeShare(m[1], m[2]);
      if (shared) loadIntoLoadout(shared);
      else toast("That build link is broken");
    } else if (w && window.VoxlWorkshop) {
      await window.VoxlWorkshop.openLink(api, w[1]);
      return; // keeps the #w= link in the address bar
    }
    save();
  })();
})();
