// Character (race, guild, weapon) and Test (damage simulator) views.
// Rendered by app.js through window.VoxlApp (A), which exposes state and shared helpers.
(function () {
  const TYPE_COLORS = {
    Physical: "#ff7a7a", Magic: "#4af6ff", Fire: "#ff7b1c", Water: "#5aa2ff", Earth: "#f0a86e",
    Air: "#ffffff", Hex: "#ff6cfd", Holy: "#f6ffb0", True: "#e5e5e5", Dexterity: "#ffd283", Summon: "#c49aff",
  };
  const PART_LABEL = { handle: "HANDLE", blade: "BLADE", gloves: "GLOVES", essence: "ESSENCE" };
  const movesText = (hits) => (hits || []).map(([d, n]) => (n > 1 ? `${d}×${n}` : `${d}`)).join(" + ");
  const comboText = (swings) => (swings || []).map(movesText).join(", ");

  const fmt = (n, d = 1) => (Number.isFinite(n) ? (Math.round(n * Math.pow(10, d)) / Math.pow(10, d)).toLocaleString() : "—");

  // ============================================================ CHARACTER
  function partKinds(mode) { return mode === "monk" ? ["gloves", "essence"] : ["handle", "blade"]; }

  // Damage, cooldown and timing of a weapon art with the current build and Test settings (vs the Test target).
  function artNumbers(A) {
    const build = A.build();
    const totals = A.totalsOf(build);
    const weapon = A.M.weapon(build);
    const cache = {};
    return (art) => {
      if (cache[art.id]) return cache[art.id];
      const profile = A.Engine.buildProfile(build, totals, { ...weapon, art }, build.test);
      const preview = A.Engine.abilityPreview(profile, "art", 30);
      cache[art.id] = {
        atk: { cooldown: preview ? preview.cooldown : art.cooldown },
        h: preview && preview.damage > 0 ? { expected: preview.damage, hits: preview.hitCount, expByType: preview.byType } : null,
        tm: { cast: preview ? preview.cast : 1, active: preview ? preview.active : 1 }, wpn: weapon,
      };
      return cache[art.id];
    };
  }

  function renderChar(A) {
    const { esc, img, M, D } = A;
    const b = A.build();
    const ui = A.ui;
    const w = b.weapon;
    const kinds = partKinds(w.mode);
    if (!kinds.includes(ui.partKind)) ui.partKind = kinds[0];
    const wpn = M.weapon(b);
    const perkMap = {};
    Object.values(A.totalsOf(b).perks).forEach((p) => { perkMap[p.id] = p.amount; });
    const form = M.weaponForm(b, perkMap);
    const race = b.race && M.raceById[b.race];
    const gr = M.guildRank(b);

    const raceTiles = D.races.map((r) => `
      <button class="pick${b.race === r.id ? " on" : ""}" data-race="${esc(r.id)}" data-ent="race:${esc(r.id)}">
        ${A.portrait(r.image ? img(r.image, r.name) : "")}<span class="pick-name outline">${esc(r.name)}</span></button>`).join("");
    const guildTiles = `<button class="pick${!b.guild ? " on" : ""}" data-guild="">
        <span class="pick-none outline">—</span><span class="pick-name outline">None</span></button>` +
      D.guilds.map((g) => `
      <button class="pick${b.guild && b.guild.id === g.id ? " on" : ""}" data-guild="${esc(g.id)}" data-ent="guild:${esc(g.id)}">
        ${A.portrait(g.image ? img(g.image, g.name) : "")}<span class="pick-name outline">${esc(g.name)}</span></button>`).join("");
    // Draconic guild: pick the draconic rune (extra rune key) and your Dragon Blooded color
    const dr = M.draconic(b);
    const DR = M.DRACONIC;
    const dracBlock = dr ? `<div class="drac-box">
        <div class="sub-h outline">DRACONIC RUNE · EXTRA RUNE KEY</div>
        <div class="mode-tabs wrap">${DR.abilities.map((x) => `<button class="mode-tab outline${dr.ability.id === x.id ? " active" : ""}" data-drac-ability="${x.id}"${x.rank > dr.rank ? ` disabled title="Unlocked at rank ${x.rank}"` : ""}>${esc(x.name.toUpperCase())}${x.rank > dr.rank ? ` · R${x.rank}` : ""}</button>`).join("")}</div>
        <div class="cv-note"><b class="outline">${esc(dr.ability.name)}:</b> ${esc(dr.ability.text)} · ${dr.ability.cooldown}s cooldown</div>
        <div class="sub-h outline">DRAGON BLOODED COLOR</div>
        <div class="mode-tabs wrap">${DR.colors.map((c) => `<button class="mode-tab outline${dr.color === c ? " active" : ""}" data-drac-color="${c}" style="color:${TYPE_COLORS[c]}">${DR.skins[c].toUpperCase()}</button>`).join("")}</div>
        <div class="cv-note">${dr.blooded
          ? `<b class="outline">${esc(dr.color)}:</b> ${esc(dr.ability.id === "infusion" ? DR.infusion[dr.color] : DR.attack[dr.color].text)}`
          : "Not Dragon Blooded: draconic abilities deal Physical damage and get no color bonus."}</div>
      </div>` : "";
    const ranks = b.guild ? [1, 2, 3].map((r) =>
      `<button class="mode-tab outline${b.guild.rank === r ? " active" : ""}" data-rank="${r}">RANK ${r}</button>`).join("") : "";

    const slotBtn = (kind) => {
      const p = w[kind] && M.partById[w[kind]];
      return `<button class="part-slot${ui.partKind === kind ? " selected" : ""}" data-pk="${kind}" ${p ? `data-ent="part:${esc(p.id)}"` : ""}>
        <span class="part-img portrait">${p ? img(p.image, p.name) : `<span class="part-empty outline">+</span>`}</span>
        <span class="part-lab outline">${PART_LABEL[kind]}</span>
        <span class="part-name">${p ? esc(p.name) : "Empty"}</span></button>`;
    };

    const typeBars = Object.entries(wpn.types).map(([t, v]) =>
      `<div class="tbar"><span class="tname outline" style="color:${TYPE_COLORS[t] || "#fff"}">${esc(t)}</span><span class="tval">${fmt(v, 2)}</span></div>`).join("");
    const scal = Object.entries(wpn.scalings).map(([t, v]) =>
      `<span class="chip outline" style="color:${TYPE_COLORS[t] || "#fff"}">${esc(t)} ${fmt(v, 3)}</span>`).join("");
    const boosts = [...A.C.BOOSTS, ...A.C.DEFENSES].filter((k) => wpn.stats[k]).map((k) => A.statLine(k, wpn.stats[k], "d-stat")).join("");
    const perks = wpn.perks.map((p) => `<span class="chip outline" style="color:#ffd84a">${esc(A.perkInfo(p.id).name)} +${fmt(p.amount, 2)}</span>`).join("");

    const monkWarn = w.mode === "monk" && !(b.guild && b.guild.id === "monk")
      ? `<div class="cv-warn">Gloves and Essences need the Monk guild.</div>` : "";

    // weapon arts: only the ones this weapon can equip (Weapon Arts page requirements)
    const nums = artNumbers(A);
    const allowed = D.arts.filter((a) => !M.artMissing(wpn, a.id).length);
    const locked = D.arts.filter((a) => M.artMissing(wpn, a.id).length);
    const shown = allowed.slice();
    if (wpn.art && !allowed.includes(wpn.art)) shown.unshift(wpn.art); // keep a no-longer-valid pick visible so it can be removed
    const artTiles = shown.map((a) => {
      const n = nums(a);
      const bad = !allowed.includes(a);
      return `<button class="pick art-pick${w.art === a.id ? " on" : ""}${bad ? " bad" : ""}" data-art="${esc(a.id)}" data-ent="art:${esc(a.id)}">
        ${A.portrait(a.image ? img(a.image, a.name) : `<span class="pick-none outline">?</span>`)}<span class="pick-name outline">${esc(a.name)}</span>
        <span class="pick-sub">${n.atk.cooldown ? n.atk.cooldown + "s" : "—"}${n.h ? " · " + fmt(n.h.expected, 0) : ""}</span></button>`;
    }).join("");
    const eq = wpn.art;
    let artCard = "";
    if (eq) {
      const n = nums(eq);
      const miss = M.artMissing(wpn, eq.id);
      const kv = (o, d = 3) => Object.entries(o || {}).map(([k, v]) => `<span class="chip outline" style="color:${TYPE_COLORS[k] || "#fff"}">${esc(k)} ${fmt(v, d)}</span>`).join("");
      artCard = `<div class="art-card dark">
        <div class="art-card-top">${eq.image ? A.portrait(img(eq.image, eq.name)) : ""}<div>
          <div class="ws-type outline" style="color:#95feff">${esc(eq.name.toUpperCase())}</div>
          <div class="ws-line">${esc(eq.desc)}</div></div></div>
        ${miss.length ? `<div class="cv-warn">This weapon can't equip it: needs ${esc(miss.join(", "))}</div>` : ""}
        <div class="art-stats">
          <div><span class="lab">DAMAGE / CAST</span><b class="outline">${n.h ? fmt(n.h.expected, 1) : "—"}</b><span class="muted">${n.h ? `${fmt(n.h.hits, 0)} hit${n.h.hits === 1 ? "" : "s"} · vs Test target` : "no documented damage"}</span></div>
          <div><span class="lab">COOLDOWN</span><b class="outline">${n.atk.cooldown ? n.atk.cooldown + "s" : "—"}</b><span class="muted">base ${eq.cooldown || "?"}s</span></div>
          <div><span class="lab">CAST</span><b class="outline">${fmt(n.tm.cast, 2)}s</b><span class="muted">${n.tm.active > n.tm.cast + 1e-6 ? `hits over ${fmt(n.tm.active, 2)}s` : "locks you"}</span></div>
          <div><span class="lab">DPS ON CD</span><b class="outline">${n.h && n.atk.cooldown ? fmt(n.h.expected / n.atk.cooldown, 2) : "—"}</b><span class="muted">damage ÷ cooldown</span></div>
        </div>
        <div class="ws-line">Base damage: <b>${esc(eq.baseText || "—")}</b></div>
        ${n.h ? `<div class="ws-line">Damage by type:</div><div class="chips">${kv(n.h.expByType, 1)}</div>` : ""}
        <div class="ws-line">Damage type: ${eq.types ? kv(eq.types) : `<span class="muted">${esc(eq.typesText || "same as weapon")}</span>`}</div>
        <div class="ws-line">Scaling: ${eq.scalings ? kv(eq.scalings) : `<span class="muted">${esc(eq.scalingText || "same as weapon")}</span>`}</div>
        ${eq.requirements.length ? `<div class="ws-line muted">Requires: ${esc(eq.requirements.join(" · "))}</div>` : ""}
      </div>`;
    }
    const lockedList = locked.map((a) => `<div class="step"><span>${a.image ? A.portrait(img(a.image, a.name), true) : ""}<b>${esc(a.name)}</b></span><span class="muted">${esc(M.artMissing(wpn, a.id).join(" · "))}</span></div>`).join("");

    // Pickers collapse to the current choice once one is made; CHANGE opens the full grid again.
    const open = ui.pickOpen || (ui.pickOpen = {});
    const isOpen = (k, chosen) => !chosen || !!open[k];
    const current = (key, icon, name, sub) => `<div class="pick-current">
        <span class="pc-ico portrait">${icon || ""}</span><div class="pc-text"><b class="outline">${name}</b><span>${sub}</span></div>
        <button class="mode-tab outline" data-pick-open="${key}">${open[key] ? "CLOSE" : "CHANGE"}</button></div>`;
    const sec = (n, title, head, body) => `<section class="cv-sec">
        <div class="cv-head"><span class="sec-n outline">${n}</span><h3 class="outline">${title}</h3>${head || ""}</div>${body}</section>`;

    const raceBody = race
      ? current("race", race.image ? img(race.image, race.name) : "", esc(race.name), esc(race.passive)) + (open.race ? `<div class="pick-grid">${raceTiles}</div>` : "")
      : `<div class="pick-grid">${raceTiles}</div><div class="cv-note">Pick a race. Its passive is added to your stats and the Test tab.</div>`;
    const guildBody = (gr
      ? current("guild", gr.guild.image ? img(gr.guild.image, gr.guild.name) : "", `${esc(gr.guild.name)} · rank ${gr.rank}`, esc(gr.guild.desc)) + (open.guild ? `<div class="pick-grid">${guildTiles}</div>` : "")
      : `<div class="pick-grid">${guildTiles}</div><div class="cv-note">Pick a guild and rank. Its stats and perks are added to your build.</div>`) + dracBlock;
    const n0 = eq ? nums(eq) : null;
    const artBody = wpn.parts.length < 2
      ? `<div class="cv-note">Build your weapon first: the arts you can use depend on it.</div>`
      : (eq ? current("art", eq.image ? img(eq.image, eq.name) : "", esc(eq.name),
          `${n0.h ? fmt(n0.h.expected, 0) + " damage" : "No damage"} · ${n0.atk.cooldown || "?"}s cooldown · ${fmt(n0.tm.cast, 2)}s cast`) : "") +
        (isOpen("art", eq) ? `<div class="pick-grid art-picks">${artTiles}</div>` : "") +
        (eq ? `<details class="steps sub-fold"><summary class="outline">ART DETAILS</summary>${artCard}</details>` : "") +
        (locked.length && isOpen("art", eq) ? `<details class="steps art-locked"><summary class="outline">LOCKED FOR THIS WEAPON (${locked.length})</summary>${lockedList}</details>` : "");
    const partsOpen = open.parts || wpn.parts.length < 2;
    const weaponBody = `
      ${monkWarn}
      <div class="wpn-top">${slotBtn(kinds[0])}<span class="wpn-plus outline">+</span>${slotBtn(kinds[1])}
        <div class="wpn-sum dark">
          <div class="ws-type outline">${esc(wpn.typeName.toUpperCase())}${wpn.parts.length === 2 && form.m1 !== wpn.typeName ? ` → ${esc(form.m1.toUpperCase())}` : ""}</div>
          ${wpn.parts.length === 2 ? `<div class="ws-line">M1 <b>${esc(comboText(form.m1Moves))}</b> · M2 <b>${esc(movesText(form.m2Moves))}</b></div>` : `<div class="ws-line muted">Pick ${kinds.map((k) => PART_LABEL[k].toLowerCase()).join(" and ")}</div>`}
          <div class="ws-line">Speed <b>${wpn.attackSpeed ? fmt(wpn.attackSpeed, 2) : "—"}</b>${wpn.hybrid ? ` · <span style="color:#6dff9a">hybrid ×1.5</span>` : ""}</div>
        </div>
      </div>
      <label class="toggle"><input type="checkbox" data-shrine ${w.shrine ? "checked" : ""}> <span>Shrine of Balance <span class="muted">(only if you used it in game)</span></span></label>
      ${partsOpen ? `<div class="parts-box">
        <div class="filters">
          <input class="search" id="partSearch" type="search" placeholder="Search ${PART_LABEL[ui.partKind].toLowerCase()}s…" value="${esc(ui.partSearch || "")}" autocomplete="off">
          <select class="sort" id="partSort" title="Sort parts">
            <option value="">Sort: A–Z</option><option value="tier"${ui.partSort === "tier" ? " selected" : ""}>Tier</option>
            <option value="speed"${ui.partSort === "speed" ? " selected" : ""}>Attack speed</option>
          </select>
          ${wpn.parts.length === 2 ? `<button class="mode-tab outline" data-pick-open="parts">DONE</button>` : ""}
        </div>
        <div class="grid dark part-grid" id="partGrid"></div></div>` : `<div class="muted">Click a part above to change it.</div>`}
      ${wpn.parts.length ? `<details class="steps sub-fold"><summary class="outline">WEAPON STATS</summary>
        <div class="wpn-detail dark">
          <div><div class="wd-h outline">DAMAGE TYPE</div>${typeBars || `<span class="muted">—</span>`}</div>
          <div><div class="wd-h outline">SCALINGS</div><div class="chips">${scal || `<span class="muted">—</span>`}</div></div>
          <div><div class="wd-h outline">BOOSTS</div>${boosts || `<span class="muted">—</span>`}</div>
          <div><div class="wd-h outline">PERKS</div><div class="chips">${perks || `<span class="muted">—</span>`}</div></div>
        </div>${form.notes.length ? `<div class="muted">${form.notes.map(esc).join(" · ")}</div>` : ""}</details>` : ""}`;

    A.$("viewChar").innerHTML = `
      <div class="cv-grid">
        <div class="cv-col">
          ${sec(1, "RACE", "", raceBody)}
          ${sec(2, "GUILD", `<div class="mode-tabs">${ranks}</div>`, guildBody)}
        </div>
        <div class="cv-col">
          ${sec(3, "WEAPON", `<div class="mode-tabs">
              <button class="mode-tab outline${w.mode === "sword" ? " active" : ""}" data-wmode="sword">HANDLE + BLADE</button>
              <button class="mode-tab outline${w.mode === "monk" ? " active" : ""}" data-wmode="monk">GLOVES + ESSENCE</button></div>`, weaponBody)}
          ${sec(4, "WEAPON ART", `<span class="cv-sub outline">${allowed.length} OF ${D.arts.length}</span>`, artBody)}
        </div>
      </div>`;
    if (partsOpen) renderPartGrid(A);
  }

  function renderPartGrid(A) {
    const { esc, img, D } = A;
    const ui = A.ui;
    const w = A.build().weapon;
    const q = (ui.partSearch || "").toLowerCase();
    let list = D.parts.filter((p) => p.kind === ui.partKind && (!q || (p.name + " " + p.partType).toLowerCase().includes(q)));
    if (ui.partSort === "tier") list.sort((a, b) => b.tier - a.tier || a.name.localeCompare(b.name));
    else if (ui.partSort === "speed") list.sort((a, b) => b.attackSpeed - a.attackSpeed || a.name.localeCompare(b.name));
    else list.sort((a, b) => a.name.localeCompare(b.name));
    A.$("partGrid").innerHTML = list.length ? list.map((p) => `
      <button class="tile${w[p.kind] === p.id ? " selected" : ""}" data-part="${esc(p.id)}" data-ent="part:${esc(p.id)}">
        ${w[p.kind] === p.id ? `<span class="badge eq outline">E</span>` : ""}
        <span class="badge fav outline" style="color:#c9a8ff">T${p.tier}</span>
        ${A.portrait(img(p.image, p.name))}<span class="tname">${esc(p.name)}</span></button>`).join("")
      : `<div class="grid-empty outline">NO PARTS FOUND</div>`;
  }

  function bindChar(A) {
    const root = A.$("viewChar");
    root.addEventListener("click", (e) => {
      const b = A.build();
      const t = (sel) => e.target.closest(sel);
      let el;
      const ent = t("[data-ent]");
      if (ent) A.ui.pinEntity = ent.dataset.ent;
      const open = A.ui.pickOpen || (A.ui.pickOpen = {});
      if ((el = t("[data-pick-open]"))) { const k = el.dataset.pickOpen; open[k] = !open[k]; return renderChar(A); }
      if ((el = t("[data-race]"))) { b.race = b.race === el.dataset.race ? null : el.dataset.race; open.race = false; return A.commit(); }
      if ((el = t("[data-guild]"))) {
        const id = el.dataset.guild;
        b.guild = id ? { id, rank: b.guild ? b.guild.rank : 3 } : null;
        open.guild = false;
        return A.commit();
      }
      if ((el = t("[data-rank]"))) { b.guild.rank = +el.dataset.rank; return A.commit(); }
      if ((el = t("[data-drac-ability]")) && !el.disabled) { b.guild.ability = el.dataset.dracAbility; return A.commit(); }
      if ((el = t("[data-drac-color]"))) { b.guild.color = el.dataset.dracColor; return A.commit(); }
      if ((el = t("[data-wmode]"))) { b.weapon.mode = el.dataset.wmode; A.ui.partKind = partKinds(b.weapon.mode)[0]; return A.commit(); }
      if ((el = t("[data-pk]"))) {
        // clicking a part slot opens the part list for it (clicking the open one again closes it)
        open.parts = !(open.parts && A.ui.partKind === el.dataset.pk);
        A.ui.partKind = el.dataset.pk; A.ui.partSearch = "";
        return renderChar(A);
      }
      if ((el = t("[data-part]"))) {
        const p = A.M.partById[el.dataset.part];
        b.weapon[p.kind] = b.weapon[p.kind] === p.id ? null : p.id;
        return A.commit();
      }
      if ((el = t("[data-art]"))) { b.weapon.art = b.weapon.art === el.dataset.art ? null : el.dataset.art; open.art = false; return A.commit(); }
    });
    root.addEventListener("change", (e) => {
      if (e.target.matches("[data-shrine]")) { A.build().weapon.shrine = e.target.checked; A.commit(); }
      if (e.target.id === "partSort") { A.ui.partSort = e.target.value; renderPartGrid(A); }
    });
    root.addEventListener("input", (e) => {
      if (e.target.id === "partSearch") { A.ui.partSearch = e.target.value; renderPartGrid(A); }
    });
    bindHover(A, root);
  }

  function bindHover(A, root) {
    root.addEventListener("mouseover", (e) => {
      const el = e.target.closest("[data-ent]");
      const ent = el ? el.dataset.ent : null;
      if (ent !== A.ui.hoverEntity) { A.ui.hoverEntity = ent; A.renderDesc(); }
    });
    root.addEventListener("mouseleave", () => { A.ui.hoverEntity = null; A.renderDesc(); });
  }

  // Description panel content for weapon parts, races, guilds and weapon arts.
  function describe(A, ent) {
    const { esc, M, C } = A;
    const [kind, id] = ent.split(":");
    const wiki = (page) => `<div class="d-sub"><a href="https://voxlpedia.miraheze.org/wiki/${encodeURIComponent(page.replace(/ /g, "_"))}" target="_blank" rel="noopener">Open on wiki ↗</a></div>`;
    const perkLines = (perks) => perks.map((p) => { const i = A.perkInfo(p.id); return `<div class="d-perk"><b class="outline">${esc(i.name)}: +${fmt(p.amount, 2)}</b> ${esc(i.desc)}</div>`; }).join("");
    if (kind === "part") {
      const p = M.partById[id];
      if (!p) return "";
      const kv = (o) => Object.entries(o).map(([k, v]) => `<span class="chip outline" style="color:${TYPE_COLORS[k] || "#fff"}">${esc(k)} ${v}</span>`).join("");
      return `<div class="d-name outline">${esc(p.name)}</div>
        <div class="d-sub">Tier ${p.tier} · ${esc(p.partType)} · Attack Speed ${p.attackSpeed}</div>
        ${Object.keys(p.types).length ? `<div class="d-sub">Damage type: <span class="chips">${kv(p.types)}</span></div>` : ""}
        ${Object.keys(p.scalings).length ? `<div class="d-sub">Scaling: <span class="chips">${kv(p.scalings)}</span></div>` : ""}
        ${[...C.BOOSTS, ...C.DEFENSES].filter((k) => p.stats[k]).map((k) => A.statLine(k, p.stats[k], "d-stat")).join("")}
        ${perkLines(p.perks)}
        ${p.obtain.length ? `<div class="d-sub" style="margin-top:8px">${esc(p.obtain.join(" "))}</div>` : ""}${wiki(p.page)}`;
    }
    if (kind === "race") {
      const r = M.raceById[id];
      return `<div class="d-name outline">${esc(r.name)}</div><div class="d-desc">"${esc(r.desc)}"</div>
        <div class="d-perk"><b class="outline">Passive:</b> ${esc(r.passive)}</div>
        <ul class="d-list">${r.details.map((d) => `<li>${esc(d)}</li>`).join("")}</ul>${wiki("Races")}`;
    }
    if (kind === "guild") {
      const g = M.guildById[id];
      const b = A.build();
      const rank = b.guild && b.guild.id === id ? b.guild.rank : 3;
      const r = g.ranks[rank - 1] || g.ranks[g.ranks.length - 1];
      return `<div class="d-name outline">${esc(g.name)} · Rank ${rank}</div><div class="d-desc">${esc(g.desc)}</div>
        ${[...C.BOOSTS, ...C.DEFENSES].filter((k) => r.stats[k]).map((k) => A.statLine(k, r.stats[k], "d-stat")).join("")}
        ${perkLines(r.perks)}
        ${g.requirements.length ? `<div class="d-sub" style="margin-top:8px">Requires: ${esc(g.requirements.join(" · "))}</div>` : ""}${wiki(g.page)}`;
    }
    if (kind === "art") {
      const a = M.artById[id];
      const n = artNumbers(A)(a);
      const miss = M.artMissing(n.wpn, a.id);
      return `<div class="d-name outline" style="color:#95feff">${esc(a.name)}</div><div class="d-desc">"${esc(a.desc)}"</div>
        ${miss.length ? `<div class="d-sub" style="color:#ff9a9a">Your weapon needs: ${esc(miss.join(", "))}</div>` : ""}
        <div class="d-stat outline" style="color:#ffe9a8">${n.h ? `${fmt(n.h.expected, 1)} damage per cast (${fmt(n.h.hits, 0)} hits)` : "No documented damage"} · ${n.atk.cooldown ? n.atk.cooldown + "s" : "?"} cooldown · ${fmt(n.tm.cast, 2)}s cast${n.tm.active > n.tm.cast + 1e-6 ? `, hits over ${fmt(n.tm.active, 2)}s` : ""}</div>
        <div class="d-sub">Base cooldown: ${a.cooldown || "?"}s · Base damage: ${esc(a.baseText || "—")}</div>
        <div class="d-sub">Type: ${esc(a.typesText || "—")} · Scaling: ${esc(a.scalingText || "—")}</div>
        ${a.requirements.length ? `<div class="d-perk"><b class="outline">Requirements</b></div><ul class="d-list">${a.requirements.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
        ${a.notes.length ? `<ul class="d-list">${a.notes.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}${wiki("Weapon Arts")}`;
    }
    return "";
  }

  window.VoxlViews = {
    char: { render: renderChar, bind: bindChar },
    describe, TYPE_COLORS, fmt, movesText, comboText,
  };
})();
