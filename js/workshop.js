// Workshop: publish, browse, like and import builds. Builds live in a Supabase project (supabase/schema.sql);
// the site talks to its REST API with the public key from js/config.js.
(function () {
  const cfg = window.VOXL_CONFIG || {};
  const connected = () => !!(cfg.supabaseUrl && cfg.supabaseKey);
  const COLS = "id,created_at,title,author,description,tags,code,race,guild,weapon,art,level,likes";
  const PAGE = 24;
  const TAGS = ["pve", "pvp", "boss", "dungeon", "solo", "dps", "tank", "support", "healer", "summoner", "crit", "dot",
    "burn", "bleed", "poison", "mage", "melee", "ranged", "monk", "beginner", "endgame", "budget", "fun"];
  const MINE_KEY = "voxlbuilder:mybuilds", LIKED_KEY = "voxlbuilder:liked", AUTHOR_KEY = "voxlbuilder:author";

  const read = (k, def) => { try { return JSON.parse(localStorage.getItem(k)) || def; } catch (e) { return def; } };
  const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } };

  // ------------------------------------------------------------ REST calls
  async function call(path, opts = {}) {
    const res = await fetch(cfg.supabaseUrl.replace(/\/+$/, "") + "/rest/v1/" + path, {
      ...opts,
      // new "sb_publishable_" keys go in the apikey header only; legacy anon JWT keys also as a bearer token
      headers: { apikey: cfg.supabaseKey, ...(/^sb_/.test(cfg.supabaseKey) ? {} : { Authorization: "Bearer " + cfg.supabaseKey }), "Content-Type": "application/json", ...(opts.headers || {}) },
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (data && (data.code === "PGRST205" || data.code === "PGRST202")) throw new Error("The workshop database isn't set up yet.");
    if (!res.ok) throw new Error((data && (data.message || data.hint)) || res.statusText || "Request failed");
    return data;
  }
  const rpc = (fn, args) => call("rpc/" + fn, { method: "POST", body: JSON.stringify(args) });

  function listQuery(f) {
    const p = new URLSearchParams({ select: COLS, limit: String(PAGE), offset: String(f.page * PAGE) });
    p.set("order", f.sort === "new" ? "created_at.desc" : "likes.desc,created_at.desc");
    const q = (f.q || "").replace(/[^\p{L}\p{N} '-]/gu, " ").trim();
    if (q) p.set("or", `(title.ilike.*${q}*,author.ilike.*${q}*,description.ilike.*${q}*)`);
    if (f.tags.length) p.set("tags", `cs.{${f.tags.map((t) => `"${t}"`).join(",")}}`);
    ["race", "guild", "weapon"].forEach((k) => { if (f[k]) p.set(k, "eq." + f[k]); });
    if (f.mine) p.set("id", `in.(${Object.keys(read(MINE_KEY, {})).map((id) => `"${id}"`).join(",") || '""'})`);
    return "builds?" + p.toString();
  }

  async function sha256(text) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  async function publish(A, meta) {
    const b = A.build();
    const code = await A.encodeShare(b);
    const token = [...crypto.getRandomValues(new Uint8Array(24))].map((x) => x.toString(16).padStart(2, "0")).join("");
    const perkMap = {};
    Object.values(A.totalsOf(b).perks).forEach((p) => { perkMap[p.id] = p.amount; });
    const wpn = A.M.weapon(b);
    const id = await rpc("publish_build", {
      p_title: meta.title, p_author: meta.author, p_description: meta.description, p_tags: meta.tags, p_code: code,
      p_race: b.race || null, p_guild: b.guild ? b.guild.id : null, p_weapon: wpn.parts.length === 2 ? A.M.weaponForm(b, perkMap).m1 : null,
      p_art: b.weapon && b.weapon.art ? b.weapon.art : null, p_level: b.level, p_edit_hash: await sha256(token),
    });
    const mine = read(MINE_KEY, {});
    mine[id] = token;
    write(MINE_KEY, mine);
    return id;
  }

  // ------------------------------------------------------------ view
  const st = { sort: "top", q: "", tags: [], race: "", guild: "", weapon: "", page: 0, mine: false, publish: false,
    items: [], more: false, loading: false, error: "", form: { title: "", description: "", tags: [], custom: "" } };
  let A = null, timer = null;

  const ago = (iso) => {
    const s = (Date.now() - new Date(iso).getTime()) / 1000;
    if (s < 3600) return Math.max(1, Math.round(s / 60)) + "m ago";
    if (s < 86400) return Math.round(s / 3600) + "h ago";
    if (s < 86400 * 30) return Math.round(s / 86400) + "d ago";
    return new Date(iso).toLocaleDateString();
  };

  async function refresh(append) {
    if (!connected()) return render();
    st.loading = true; st.error = "";
    if (!append) { st.page = 0; st.items = []; }
    render();
    try {
      const rows = await call(listQuery(st));
      st.items = append ? st.items.concat(rows) : rows;
      st.more = rows.length === PAGE;
    } catch (e) {
      st.error = e.message;
    }
    st.loading = false;
    render();
  }

  function render() {
    if (!A) return;
    const { esc, img, M, D } = A;
    const root = A.$("viewWorkshop");
    if (!connected()) {
      root.innerHTML = `<section class="cv-sec ws-off"><div class="cv-head"><h3 class="outline">WORKSHOP</h3></div>
        <div class="cv-note">The workshop isn't connected to its database yet. Once the site owner adds the Supabase project to
        <b>js/config.js</b>, you can publish builds, search them by name and tags, like them and load them in one click.</div></section>`;
      return;
    }
    const mine = read(MINE_KEY, {}), liked = read(LIKED_KEY, {});
    const sel = (key, opts, val, all) => `<select class="sort mini" data-ws="${key}" aria-label="${all}"><option value="">${all}</option>${opts.map(([v, l]) =>
      `<option value="${esc(v)}"${v === val ? " selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
    const tagBtn = (t, on, attr) => `<button class="mode-tab outline ws-tag${on ? " active" : ""}" ${attr}="${esc(t)}">${esc(t.toUpperCase())}</button>`;
    const f = st.form;
    const publishPanel = st.publish ? `<section class="cv-sec ws-pub">
        <div class="cv-head"><h3 class="outline">PUBLISH THIS BUILD</h3><span class="cv-sub outline">LOADOUT · ${esc(A.build().name)}</span></div>
        <div class="form-grid">
          <label><span>Title</span><input class="search" data-wsf="title" maxlength="60" value="${esc(f.title)}" placeholder="e.g. Air Draconic Storm Caster"></label>
          <label><span>Your name</span><input class="search" data-wsf="author" maxlength="30" value="${esc(read(AUTHOR_KEY, ""))}" placeholder="Anonymous"></label>
        </div>
        <label class="ws-desc"><span>Description</span><textarea class="search" data-wsf="description" maxlength="1000" rows="3" placeholder="How to play it, rotation, what it's good at…">${esc(f.description)}</textarea></label>
        <div class="sub-h outline">TAGS (UP TO 8)</div>
        <div class="mode-tabs wrap">${TAGS.map((t) => tagBtn(t, f.tags.includes(t), "data-wsf-tag")).join("")}
          ${f.tags.filter((t) => !TAGS.includes(t)).map((t) => tagBtn(t, true, "data-wsf-tag")).join("")}</div>
        <div class="opt-row"><input class="search ws-custom" data-wsf="custom" maxlength="20" value="${esc(f.custom)}" placeholder="Add your own tag"><button class="mode-tab outline" data-ws-addtag>ADD</button></div>
        <div class="ws-pub-actions"><button class="txtbtn green outline" data-ws-publish>PUBLISH</button><button class="txtbtn red outline" data-ws-cancel>CANCEL</button></div>
        <div class="muted">Publishing shares this loadout's gear, weapon, race, guild and Test settings. Only you (from this browser) can delete it.</div>
      </section>` : "";
    const races = D.races.map((r) => [r.id, r.name]), guilds = D.guilds.map((g) => [g.id, g.name]);
    const weapons = Object.keys(M.MOVES).sort().map((w) => [w, w]);
    const cards = st.items.map((b) => {
      const race = M.raceById[b.race], guild = M.guildById[b.guild], art = M.artById[b.art];
      return `<article class="ws-card dark" data-card="${esc(b.id)}">
        <div class="ws-card-top"><b class="ws-title outline">${esc(b.title)}</b><span class="ws-by">by ${esc(b.author)} · ${ago(b.created_at)}</span></div>
        <div class="ws-meta">
          ${race ? `<span class="ws-ico" title="${esc(race.name)}">${img(race.image, race.name)}</span>` : ""}
          ${guild ? `<span class="ws-ico" title="${esc(guild.name)}">${img(guild.image, guild.name)}</span>` : ""}
          ${art ? `<span class="ws-ico" title="${esc(art.name)}">${img(art.image, art.name)}</span>` : ""}
          <span class="ws-line">${esc([b.weapon, race && race.name, guild && guild.name, art && art.name].filter(Boolean).join(" · ") || "No weapon")}</span>
        </div>
        <div class="ws-gear" data-gear="${esc(b.id)}"></div>
        ${b.tags.length ? `<div class="chips">${b.tags.map((t) => `<span class="chip ws-chip" data-ws-tagfilter="${esc(t)}">${esc(t)}</span>`).join("")}</div>` : ""}
        ${b.description ? `<p class="ws-text">${esc(b.description)}</p>` : ""}
        <div class="ws-actions">
          <button class="txtbtn green outline small" data-ws-load="${esc(b.id)}">LOAD</button>
          <button class="txtbtn blue outline small" data-ws-link="${esc(b.id)}">LINK</button>
          <button class="txtbtn ${liked[b.id] ? "yellow" : "blue"} outline small" data-ws-like="${esc(b.id)}" aria-pressed="${!!liked[b.id]}">♥ ${b.likes}</button>
          ${mine[b.id] ? `<button class="txtbtn red outline small" data-ws-delete="${esc(b.id)}">DELETE</button>` : ""}
        </div>
      </article>`;
    }).join("");
    // re-rendering replaces the inputs: keep the one being typed in focused, with its caret
    const act = document.activeElement;
    const keep = act && root.contains(act) && (act.dataset.ws || act.dataset.wsf)
      ? { sel: act.dataset.ws ? `[data-ws="${act.dataset.ws}"]` : `[data-wsf="${act.dataset.wsf}"]`, start: act.selectionStart, end: act.selectionEnd } : null;
    const scroll = root.scrollTop;
    root.innerHTML = `
      <section class="cv-sec ws-bar">
        <div class="cv-head"><h3 class="outline">WORKSHOP</h3>
          <div class="mode-tabs">
            <button class="mode-tab outline${st.sort === "top" && !st.mine ? " active" : ""}" data-ws-sort="top">TOP</button>
            <button class="mode-tab outline${st.sort === "new" && !st.mine ? " active" : ""}" data-ws-sort="new">NEW</button>
            <button class="mode-tab outline${st.mine ? " active" : ""}" data-ws-mine>MY BUILDS</button>
            <button class="mode-tab outline${st.publish ? " active" : ""}" data-ws-open>+ PUBLISH</button>
          </div></div>
        <div class="filters ws-filters">
          <input class="search" type="search" data-ws="q" value="${esc(st.q)}" placeholder="Search builds by name, author or description…" autocomplete="off">
          ${sel("race", races, st.race, "Any race")}${sel("guild", guilds, st.guild, "Any guild")}${sel("weapon", weapons, st.weapon, "Any weapon")}
        </div>
        <details class="steps sub-fold ws-tagfold" data-ws-tagfold${st.tagsOpen || st.tags.length ? " open" : ""}>
          <summary class="outline">FILTER BY TAG${st.tags.length ? ` <span class="muted">(${st.tags.join(", ")})</span>` : ""}</summary>
          <div class="mode-tabs wrap ws-tags">${TAGS.map((t) => tagBtn(t, st.tags.includes(t), "data-ws-tag")).join("")}</div></details>
      </section>
      ${publishPanel}
      ${st.error ? `<div class="cv-warn">${esc(st.error)}</div>` : ""}
      <div class="ws-results">${cards || (st.loading ? "" : `<div class="grid-empty outline">${st.mine ? "YOU HAVEN'T PUBLISHED A BUILD HERE YET" : "NO BUILDS FOUND"}</div>`)}</div>
      ${st.loading ? `<div class="grid-empty outline">LOADING…</div>` : st.more ? `<div class="ws-more"><button class="txtbtn blue outline" data-ws-more>LOAD MORE</button></div>` : ""}`;
    root.scrollTop = scroll;
    if (keep) {
      const el = root.querySelector(keep.sel);
      if (el) { el.focus(); try { el.setSelectionRange(keep.start, keep.end); } catch (e) { /* selects have no caret */ } }
    }
    fillGear(root);
  }

  // small gear icons on each card, decoded from its share code
  async function fillGear(root) {
    const byId = Object.fromEntries(A.D.items.map((i) => [i.id, i]));
    for (const b of st.items) {
      const el = root.querySelector(`[data-gear="${CSS.escape(b.id)}"]`);
      if (!el || el.dataset.done) continue;
      el.dataset.done = "1";
      const m = b.code.match(/^([bc])=(.+)$/);
      const build = m && await A.decodeShare(m[1], m[2]);
      if (!build) continue;
      el.innerHTML = ["head", "chest", "legs", "ring", "rune"].map((slot) => {
        const s = build.slots[slot], it = s && byId[s.id];
        return it ? `<span class="ws-ico" title="${A.esc(it.name)}${s.lvl ? " +" + s.lvl : ""}">${A.img(it.image, it.name)}</span>` : "";
      }).join("");
    }
  }

  async function loadBuild(id, label) {
    const row = st.items.find((b) => b.id === id) || (await call(`builds?select=${COLS}&id=eq.${encodeURIComponent(id)}`))[0];
    if (!row) { A.toast("That build isn't in the workshop anymore"); return false; }
    const m = row.code.match(/^([bc])=(.+)$/);
    const build = m && await A.decodeShare(m[1], m[2]);
    if (!build) { A.toast("That build couldn't be read"); return false; }
    return A.loadIntoLoadout(build, label || `"${row.title}"`);
  }

  function bind(api) {
    A = api;
    const root = A.$("viewWorkshop");
    root.addEventListener("input", (e) => {
      const el = e.target;
      if (el.dataset.ws === "q") { st.q = el.value; clearTimeout(timer); timer = setTimeout(() => refresh(), 350); }
      if (el.dataset.wsf) {
        if (el.dataset.wsf === "author") write(AUTHOR_KEY, el.value.slice(0, 30));
        else st.form[el.dataset.wsf] = el.value;
      }
    });
    root.addEventListener("change", (e) => {
      const el = e.target;
      if (el.tagName === "SELECT" && el.dataset.ws) { st[el.dataset.ws] = el.value; refresh(); }
    });
    root.addEventListener("toggle", (e) => { if (e.target.matches && e.target.matches("[data-ws-tagfold]")) st.tagsOpen = e.target.open; }, true);
    root.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && e.target.dataset.wsf === "custom") { e.preventDefault(); root.querySelector("[data-ws-addtag]").click(); }
    });
    root.addEventListener("click", async (e) => {
      const t = (s) => e.target.closest(s);
      let el;
      if ((el = t("[data-ws-sort]"))) { st.sort = el.dataset.wsSort; st.mine = false; return refresh(); }
      if (t("[data-ws-mine]")) { st.mine = !st.mine; return refresh(); }
      if (t("[data-ws-open]")) { st.publish = !st.publish; if (st.publish && !st.form.title) st.form.title = A.build().name; return render(); }
      if (t("[data-ws-cancel]")) { st.publish = false; return render(); }
      if ((el = t("[data-ws-tag]")) || (el = t("[data-ws-tagfilter]"))) {
        const tag = el.dataset.wsTag || el.dataset.wsTagfilter;
        st.tags = st.tags.includes(tag) ? st.tags.filter((x) => x !== tag) : st.tags.concat(tag);
        return refresh();
      }
      if ((el = t("[data-wsf-tag]"))) {
        const tag = el.dataset.wsfTag, f = st.form;
        f.tags = f.tags.includes(tag) ? f.tags.filter((x) => x !== tag) : f.tags.length < 8 ? f.tags.concat(tag) : f.tags;
        return render();
      }
      if (t("[data-ws-addtag]")) {
        const tag = st.form.custom.toLowerCase().replace(/[^a-z0-9 +-]/g, "").trim().slice(0, 20);
        if (tag && !st.form.tags.includes(tag) && st.form.tags.length < 8) st.form.tags.push(tag);
        st.form.custom = "";
        return render();
      }
      if ((el = t("[data-ws-publish]"))) {
        const f = st.form;
        if (f.title.trim().length < 3) return A.toast("Give the build a title (3+ characters)");
        el.disabled = true;
        try {
          const id = await publish(A, { title: f.title.trim(), author: read(AUTHOR_KEY, "").trim() || "Anonymous", description: f.description.trim(), tags: f.tags });
          st.publish = false;
          st.form = { title: "", description: "", tags: [], custom: "" };
          A.copy(location.href.split("#")[0] + "#w=" + id, "Published! Link copied");
          st.mine = true;
          refresh();
        } catch (err) {
          el.disabled = false;
          A.toast(err.message);
        }
        return;
      }
      if ((el = t("[data-ws-load]"))) return loadBuild(el.dataset.wsLoad);
      if ((el = t("[data-ws-link]"))) return A.copy(location.href.split("#")[0] + "#w=" + el.dataset.wsLink, "Workshop link copied!");
      if ((el = t("[data-ws-like]"))) {
        const id = el.dataset.wsLike, liked = read(LIKED_KEY, {});
        try {
          const n = await rpc("like_build", { p_id: id, p_like: !liked[id] });
          if (liked[id]) delete liked[id]; else liked[id] = 1;
          write(LIKED_KEY, liked);
          const row = st.items.find((b) => b.id === id);
          if (row) row.likes = n;
          render();
        } catch (err) { A.toast(err.message); }
        return;
      }
      if ((el = t("[data-ws-delete]"))) {
        const id = el.dataset.wsDelete;
        if (!confirm("Delete this build from the workshop? This can't be undone.")) return;
        try {
          const mine = read(MINE_KEY, {});
          const ok = await rpc("delete_build", { p_id: id, p_token: mine[id] });
          if (!ok) return A.toast("Couldn't delete it (it may already be gone)");
          delete mine[id];
          write(MINE_KEY, mine);
          st.items = st.items.filter((b) => b.id !== id);
          render();
          A.toast("Build deleted");
        } catch (err) { A.toast(err.message); }
        return;
      }
      if (t("[data-ws-more]")) { st.page += 1; return refresh(true); }
    });
  }

  let loaded = false;
  window.VoxlWorkshop = {
    bind,
    render: () => { if (!loaded && connected()) { loaded = true; return refresh(); } render(); },
    // "#w=<id>" links: load that build into the active loadout
    openLink: async (api, id) => {
      A = api;
      if (!connected()) { api.toast("The workshop isn't connected yet"); return; }
      try { await loadBuild(id); } catch (e) { api.toast("Couldn't load that workshop build: " + e.message); }
    },
  };
})();
