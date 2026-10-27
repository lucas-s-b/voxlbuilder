// Test tab: build an attack sequence, toggle the buffs your build can use, pick an enemy, read the results.
// Perk / status / potion toggles only appear when the build (or a picked potion) actually provides them.
(function () {
  const SOURCE_COLORS = { m1: "#ffd84a", m2: "#fff6b0", proc: "#ff9a3c", art: "#4af6ff", rune: "#c49aff", drac: "#ff6a3d", special: "#7dff8a", custom: "#ff8ad8", dot: "#ff5a5a" };
  const SOURCE_NAMES = { m1: "M1", m2: "M2", proc: "Procs & chains", art: "Weapon art", rune: "Rune", drac: "Draconic", special: "Special", custom: "Custom", dot: "DoTs & auras" };
  const FX = () => window.VoxlEffects;
  const V = () => window.VoxlViews;
  const fmt = (n, d) => V().fmt(n, d);
  const pct = (n) => fmt(n * 100, 1) + "%";
  const OFFENSIVE_TAGS = ["Offensive", "Damage Boost", "Damage Type", "Crit", "Crit Damage", "Attack Speed", "Finisher", "Weapon Art Activated",
    "Rune Activated", "Burn Potency", "Bleed Potency", "Poison Potency", "Cooldown Reduction", "Stance Change"];

  // "Holy 50% · 12.3" chips for a {type: damage} breakdown.
  function typeChips(esc, byType) {
    const tot = Object.values(byType || {}).reduce((a, b) => a + b, 0);
    if (!tot) return "";
    const TC = V().TYPE_COLORS;
    return `<span class="tchips">${Object.entries(byType).filter(([, v]) => v > 0.0005).sort((a, b) => b[1] - a[1]).map(([t, v]) =>
      `<span class="tchip" style="--tc:${TC[t] || "#fff"}"><i></i>${esc(t)} ${fmt((v / tot) * 100, 0)}%</span>`).join("")}</span>`;
  }

  function typeBars(esc, byType) {
    const TC = V().TYPE_COLORS;
    const rows = Object.entries(byType).filter(([, v]) => v > 0.0005).sort((a, b) => b[1] - a[1]);
    const tot = rows.reduce((a, [, v]) => a + v, 0);
    const max = Math.max(...rows.map(([, v]) => v), 1e-9);
    return rows.map(([t, v]) => `<div class="bar-row"><span class="outline" style="color:${TC[t]}">${t}</span>
      <span class="bar"><span style="width:${(v / max) * 100}%;background:${TC[t]}"></span></span><b>${fmt((v / tot) * 100, 0)}% · ${fmt(v)}</b></div>`).join("");
  }

  function state(A) {
    const b = A.build();
    const s = b.test;
    const totals = A.totalsOf(b);
    const wpn = A.M.weapon(b);
    const ctx = A.Dmg.context(b, totals, wpn, s);
    const mods = A.Dmg.collect(ctx, s);
    return { b, s, totals, wpn, ctx, mods };
  }

  const perkName = (id) => (window.VOXL_DATA.perks[id] || { name: id }).name;
  const perkOn = (s, pk) => (s.perkOn[pk.id] === undefined ? pk.def : !!s.perkOn[pk.id]);

  // Folded sections, open result tab and the action shown in Hit details; remembered per browser.
  const UI_KEY = "voxlbuilder:testui2";
  const tui = (() => {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(UI_KEY)); } catch (e) { /* storage unavailable */ }
    return { closed: new Set(saved && Array.isArray(saved.closed) ? saved.closed : ["enemy", "advanced"]), tab: (saved && saved.tab) || "seq", detail: (saved && saved.detail) || "" };
  })();
  const saveUi = () => { try { localStorage.setItem(UI_KEY, JSON.stringify({ closed: [...tui.closed], tab: tui.tab, detail: tui.detail })); } catch (e) { /* storage unavailable */ } };

  // "Holy 0.5 + Physical 0.5"
  const typesText = (types, none) => Object.entries(types || {}).filter(([, v]) => v > 0).map(([t, v]) => `${t} ${fmt(v, 2)}`).join(" + ") || none;

  // The actions a sequence step can be, for this build: [key, name, sub-line, icon html]
  function actionList(A, ctx, atks, s) {
    const by = Object.fromEntries(atks.map((a) => [a.key, a]));
    const f = ctx.form;
    const badge = (t) => `<span class="seq-badge outline">${t}</span>`;
    const out = [["m1", "M1 combo", `${f.m1} · ${by.m1.swings.length} swings`, badge("M1")], ["m2", "M2", f.m2, badge("M2")]];
    if (by.art) out.push(["art", by.art.name, by.art.cooldown ? `Weapon art · ${by.art.cooldown}s cooldown` : "Weapon art", ctx.wpn.art && ctx.wpn.art.image ? A.img(ctx.wpn.art.image, by.art.name) : badge("A")]);
    if (by.rune) out.push(["rune", by.rune.name, by.rune.cooldown ? `Rune · ${by.rune.cooldown}s cooldown` : "Rune", ctx.rune && ctx.rune.image ? A.img(ctx.rune.image, by.rune.name) : badge("R")]);
    if (by.drac) out.push(["drac", by.drac.name, `Draconic rune · ${by.drac.cooldown}s cooldown`, A.img("guild-draconic.png", "Draconic")]);
    if (by.special) out.push(["special", by.special.name, by.special.spiritId ? "Monk spirit" : "Perk attack", badge("SP")]);
    (s.customs || []).forEach((c) => out.push([`custom:${c.id}`, c.name, `${fmt(+c.dmg || 0, 1)} × ${c.hits || 1} · ${typesText(c.types, "weapon types")}`, badge("C")]));
    out.push(["wait", "Wait", "Pause for a few seconds", badge("⏱")]);
    return out;
  }

  // ------------------------------------------------------------ setup column
  function renderTest(A) {
    const { esc, Dmg } = A;
    const { s, ctx, mods, wpn } = state(A);
    const TC = V().TYPE_COLORS;
    const atks = Dmg.attacks(ctx, mods, s);
    const byKey = Object.fromEntries(atks.map((a) => [a.key, a]));
    const num = (path, val, attrs) => `<input class="num" type="number" data-path="${path}" value="${val === undefined || val === null ? "" : val}" ${attrs || ""}>`;
    const chk = (path, on, label) => `<label class="toggle"><input type="checkbox" data-path="${path}" ${on ? "checked" : ""}> <span>${label}</span></label>`;
    const sel = (path, options, value) => `<select class="sort mini" data-path="${path}">${options.map(([v, l]) => `<option value="${esc(v)}"${String(v) === String(value) ? " selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
    const setBtn = (path, val, label, on, extra) => `<button class="mode-tab outline${on ? " active" : ""}" data-set="${path}" data-val="${esc(String(val))}" ${extra || ""}>${label}</button>`;

    // damage-type split editor: rows of type + coefficient, plus a picker to add a type
    const typeSplit = (target, types, none) => {
      const rows = Object.entries(types || {}).map(([t, v]) => `<span class="tsplit-row"><span class="chip outline" style="color:${TC[t] || "#fff"}">${t}</span>
        <input class="num" type="number" data-tsplit="${target}" data-type="${t}" value="${v}" step="0.05" min="0" max="10" aria-label="${t} coefficient">
        <button class="mv del" data-tsplit-del="${target}" data-type="${t}" aria-label="Remove ${t}">✕</button></span>`).join("");
      const left = window.VoxlSupport.INC_TYPES.filter((t) => !(types || {})[t]);
      return `<div class="tsplit">${rows || `<span class="muted">${none}</span>`}
        ${left.length ? `<select class="sort mini" data-tsplit-add="${target}" aria-label="Add a damage type"><option value="">+ Type…</option>${left.map((t) => `<option>${t}</option>`).join("")}</select>` : ""}</div>`;
    };

    // ---- 1. sequence
    const actions = actionList(A, ctx, atks, s);
    const act = Object.fromEntries(actions.map((x) => [x[0], x]));
    const seq = Array.isArray(s.seq) ? s.seq : [];
    const steps = seq.map((st, i) => {
      const a = act[st.a];
      const missing = !a;
      return `<div class="seq-step${missing ? " missing" : ""}">
        <span class="seq-num outline">${i + 1}</span>
        <span class="seq-ico portrait sm">${a ? a[3] : ""}</span>
        <span class="seq-name"><b>${esc(a ? a[1] : st.a)}</b><i>${esc(missing ? "Not in this build" : a[2])}</i></span>
        <span class="seq-n">${st.a === "wait"
          ? `<input class="num" type="number" data-seq-w="${i}" value="${st.w || 1}" step="0.5" min="0.1" max="60" aria-label="Seconds"><span class="muted">s</span>`
          : `<span class="muted">×</span><input class="num" type="number" data-seq-n="${i}" value="${st.n || 1}" step="1" min="1" max="50" aria-label="Times">`}</span>
        <span class="seq-btns">
          <button class="mv" data-seq-move="${i}" data-dir="-1" ${i === 0 ? "disabled" : ""} aria-label="Move up">▲</button>
          <button class="mv" data-seq-move="${i}" data-dir="1" ${i === seq.length - 1 ? "disabled" : ""} aria-label="Move down">▼</button>
          <button class="mv del" data-seq-del="${i}" aria-label="Remove">✕</button>
        </span></div>`;
    }).join("");
    const addBtns = actions.map(([k, name, , ico]) => `<button class="seq-add" data-seq-add="${k}" title="Add ${esc(name)}"><span class="seq-ico portrait sm">${ico}</span><span>${esc(name)}</span></button>`).join("");
    const seqSection = `
      <div class="seq-list">${steps || `<div class="seq-empty">No steps yet. Add attacks below in the order you use them.</div>`}</div>
      <div class="sub-h outline">ADD A STEP</div>
      <div class="seq-adds">${addBtns}</div>
      <div class="seq-mode">
        ${setBtn("seqRepeat", "", "RUN ONCE", !s.seqRepeat, 'data-bool="0"')}
        ${setBtn("seqRepeat", "1", "REPEAT FOR", !!s.seqRepeat, 'data-bool="1"')}
        ${s.seqRepeat ? `${num("duration", s.duration, 'step="5" min="5" max="300"')}<span class="muted">seconds</span>` : ""}
      </div>
      <div class="muted seq-help">${s.seqRepeat
        ? "Loops your steps; anything still on cooldown is skipped that loop."
        : "Runs your steps once, in order. A step still on cooldown waits for it."}</div>
      <div class="opt-row"><span class="lab">Crits</span><span class="mode-tabs">${setBtn("crit", "avg", "AVERAGE", s.crit === "avg")}${setBtn("crit", "always", "ALWAYS", s.crit === "always")}${setBtn("crit", "never", "NEVER", s.crit === "never")}</span></div>
      ${byKey.special && byKey.special.specials.length > 1 ? `<div class="opt-row"><span class="lab">Special attack</span>${sel("spirit", byKey.special.specials, byKey.special.specialId)}</div>` : ""}
      <div class="sub-h outline">CUSTOM ATTACKS</div>
      ${(s.customs || []).map((c) => `<div class="custom-card">
        <div class="custom-top"><input class="search" data-custom="${c.id}" data-field="name" value="${esc(c.name)}" maxlength="30" aria-label="Custom attack name">
          <button class="mv del" data-custom-del="${c.id}" aria-label="Delete ${esc(c.name)}">✕</button></div>
        <div class="opt-row"><span class="lab">Damage</span><input class="num" type="number" data-custom="${c.id}" data-field="dmg" value="${c.dmg}" step="0.5" min="0" aria-label="Base damage">
          <span class="lab">× hits</span><input class="num" type="number" data-custom="${c.id}" data-field="hits" value="${c.hits}" step="1" min="1" max="50" aria-label="Hits"></div>
        <div class="opt-row"><span class="lab">Damage type</span>${typeSplit("c:" + c.id, c.types, "Same as your weapon")}</div></div>`).join("")}
      ${(s.customs || []).length < 8 ? `<button class="mode-tab outline" data-custom-new>+ NEW CUSTOM ATTACK</button>` : ""}`;

    // ---- 2. buffs & conditions
    const statusRow = (id) => {
      const st = ctx.statuses[id];
      const set = s.status[id] || {};
      const srcSel = st.sources.length > 1
        ? sel(`status.${id}.src`, st.sources.map((x, i) => [i, `${x[0]}${typeof x[1] === "number" && st.def.potency ? " (" + fmt(x[1], 2) + ")" : ""}`]), st.src)
        : `<span class="muted">${esc(st.sources[0][0])}</span>`;
      const pot = st.def.potency && st.on ? num(`status.${id}.pot`, set.pot, `step="0.05" min="0" placeholder="${fmt(st.sources[st.src][1], 2)}" title="Potency"`) : "";
      return `<div class="buff-row">${chk(`status.${id}.on`, st.on, `<b>${esc(st.def.name)}</b>`)}${st.on ? srcSel + pot : `<span class="muted">${esc(st.sources[0][0])}</span>`}</div>`;
    };
    const selfSt = Object.keys(ctx.statuses).filter((id) => ctx.statuses[id].def.side === "self");
    const targetSt = Object.keys(ctx.statuses).filter((id) => ctx.statuses[id].def.side === "target");
    const dotRows = Object.keys(Dmg.DOTS).filter((k) => ctx.dotSources[k].length).map((k) =>
      `<div class="buff-row">${chk(`dots.${k}.on`, s.dots[k].on, `<b>${k}</b>`)}${s.dots[k].on ? num(`dots.${k}.potency`, s.dots[k].potency, 'step="0.1" min="0" title="Source potency"') : ""}<span class="muted">${esc(ctx.dotSources[k].slice(0, 2).join(", "))}${ctx.dotSources[k].length > 2 ? "…" : ""}</span></div>`).join("");
    const potionRows = FX().POTIONS.map((p) => `<div class="buff-row">${chk(`potions.${p.id}`, s.potions[p.id], `<b>${esc(p.name)}</b>`)}<span class="muted">${esc(p.desc)}</span></div>`).join("");
    const owned = Object.values(FX().PERKS).filter((pk) => ctx.perks[pk.id]);
    const situational = owned.filter((pk) => !pk.def);
    const perkRow = (pk) => `<div class="buff-row">${chk(`perkOn.${pk.id}`, perkOn(s, pk), `<b>${esc(perkName(pk.id))}</b>`)}<span class="muted">${esc(pk.label)}</span></div>`;
    // number inputs some enabled perks need
    const uses = new Set();
    owned.forEach((pk) => { if (perkOn(s, pk)) pk.uses.forEach((u) => uses.add(u)); });
    if (ctx.race.lowHpDamage) uses.add("selfHp");
    if (ctx.perks.perfection) uses.add("perfection");
    if (ctx.perks["blood-lust"]) uses.add("bloodlust");
    const sitKeys = [...uses].filter((k) => FX().SITUATION[k] && !["hitsPer10", "blocksPer10"].includes(k));
    const sitRows = sitKeys.map((k) => {
      const d = FX().SITUATION[k];
      const v = s.sit[k] === undefined ? d.def : s.sit[k];
      const input = d.options ? sel(`sit.${k}`, d.options.map((o) => [o, o]), v) : num(`sit.${k}`, v, `step="${d.step}" min="${d.min}" max="${d.max}"`);
      return `<label class="sit"><span>${esc(d.label)}</span>${input}</label>`;
    }).join("");
    const needSun = ["photosynthesis", "solar-light"].some((id) => ctx.perks[id]);
    const needShadow = ["vampire", "concealed-edge"].some((id) => ctx.perks[id]);
    const envRows = (needSun ? chk("sit.sun", s.sit.sun, "Standing in sunlight") : "") + (needShadow ? chk("sit.shadows", s.sit.shadows, "Standing in shadows / darkness") : "");
    const group = (title, body) => (body ? `<div class="buff-group"><div class="sub-h outline">${title}</div>${body}</div>` : "");
    const alwaysOn = owned.filter((pk) => pk.def);
    const buffsSection = `
      ${group("ON YOU", selfSt.map(statusRow).join(""))}
      ${group("ON THE ENEMY", targetSt.map(statusRow).join("") + dotRows)}
      ${group("POTIONS", potionRows)}
      ${group("SITUATIONAL PERKS", situational.map(perkRow).join(""))}
      ${sitRows || envRows ? group("CONDITIONS", `<div class="sit-grid">${sitRows}</div>${envRows}`) : ""}
      ${alwaysOn.length ? `<details class="steps sub-fold"><summary class="outline">${alwaysOn.length} PERKS ALWAYS ON <span class="muted">untick to compare</span></summary>${alwaysOn.map(perkRow).join("")}</details>` : ""}`;

    // ---- 3. enemy: sets the target's defenses and who hits you
    const SUP = window.VoxlSupport;
    const inc = { ...SUP.defaults(), ...(s.inc || {}) };
    const P = (id) => ctx.perks[id] || 0;
    const enemies = window.VOXL_DATA.enemies || [];
    const foe = s.enemy ? SUP.enemyById()[s.enemy] : null;
    const atkNow = SUP.incoming(inc);
    const defChips = Object.entries(s.target).filter(([, v]) => v).map(([k, v]) => `<span class="chip outline" style="color:${TC[k]}">${k} ${v > 0 ? "+" : ""}${v}%</span>`).join("") || `<span class="muted">No defenses</span>`;
    const incSeq = Array.isArray(inc.seq) ? inc.seq : SUP.defaultSeq(foe);
    const foeIco = foe && foe.image ? A.img(foe.image, foe.name) : `<span class="seq-badge outline">🎯</span>`;
    const incSteps = incSeq.map((st, i) => {
      const a = SUP.stepAttack(st, foe);
      return `<div class="seq-step${a ? "" : " missing"}">
        <span class="seq-num outline">${i + 1}</span>
        <span class="seq-ico portrait sm">${st.a === "c" ? `<span class="seq-badge outline">C</span>` : foeIco}</span>
        <span class="seq-name"><b>${esc(a ? a.name : "Unknown attack")}</b><i>${a ? esc(typesText(a.parts, "no damage")) + (a.guardbreak ? " · guardbreak" : "") : ""}</i></span>
        <span class="seq-n"><span class="muted">×</span><input class="num" type="number" data-inc-n="${i}" value="${st.n || 1}" step="1" min="1" max="50" aria-label="Times"></span>
        <span class="seq-btns">
          <button class="mv" data-inc-move="${i}" data-dir="-1" ${i === 0 ? "disabled" : ""} aria-label="Move up">▲</button>
          <button class="mv" data-inc-move="${i}" data-dir="1" ${i === incSeq.length - 1 ? "disabled" : ""} aria-label="Move down">▼</button>
          <button class="mv del" data-inc-del="${i}" aria-label="Remove">✕</button>
        </span></div>
        ${st.a === "c" ? `<div class="custom-card inc-custom">
          <div class="opt-row"><span class="lab">Damage</span><input class="num" type="number" data-inc-dmg="${i}" value="${st.dmg}" step="1" min="0" aria-label="Damage"></div>
          <div class="opt-row"><span class="lab">Damage type</span>${typeSplit("i:" + i, st.types, "Physical")}</div></div>` : ""}`;
    }).join("");
    const incAdds = (foe ? foe.attacks.map((x, i) => `<button class="seq-add" data-inc-add="${i}" title="Add ${esc(x.name)}"><span class="seq-ico portrait sm">${foeIco}</span>
        <span>${esc(x.name)} ${fmt(Object.values(x.parts).reduce((q, v) => q + v, 0), 1)}${x.guardbreak ? " ⛨" : ""}</span></button>`) : [])
      .concat(`<button class="seq-add" data-inc-add="c" title="Add a custom hit"><span class="seq-ico portrait sm"><span class="seq-badge outline">C</span></span><span>Custom hit</span></button>`).join("");
    const enemySection = `
      <div class="enemy-row">${foe && foe.image ? A.portrait(A.img(foe.image, foe.name), true) : `<span class="seq-badge outline">🎯</span>`}
        <select class="sort mini" data-enemy aria-label="Enemy">
          <option value="">Training dummy (no defenses)</option>
          ${enemies.map((e) => `<option value="${esc(e.id)}"${foe && e.id === foe.id ? " selected" : ""}>${esc(e.name)} · ${fmt(e.hp, 0)} HP</option>`).join("")}
        </select></div>
      <div class="sub-h outline">ITS DEFENSES</div>
      <div class="chips">${defChips}</div>
      <details class="steps sub-fold"><summary class="outline">EDIT DEFENSES</summary>
        <div class="def-grid">${Object.keys(s.target).map((k) => `<label class="def"><span class="outline" style="color:${TC[k]}">${k}</span>${num(`target.${k}`, s.target[k], 'step="5"')}</label>`).join("")}</div></details>
      <div class="sub-h outline">ITS ATTACKS ON YOU, IN ORDER</div>
      <div class="seq-list">${incSteps || `<div class="seq-empty">No attacks. Add them below.</div>`}</div>
      <div class="seq-adds">${incAdds}</div>
      <div class="opt-row"><span class="lab">Hits per 10s</span>${num("inc.per10", inc.per10, 'step="1" min="0" max="100"')}
        <span class="lab">You block</span>${num("inc.blockPct", inc.blockPct, 'step="5" min="0" max="100"')}<span class="muted">% of hits</span></div>`;

    // a foldable section; closed ones show a one-line summary
    const sec = (id, n, title, summary, body) => {
      const open = !tui.closed.has(id);
      return `<section class="cv-sec tsec${open ? " open" : ""}">
        <div class="cv-head"><button class="sec-toggle" data-toggle-sec="${id}" aria-expanded="${open}"><span class="caret">${open ? "▾" : "▸"}</span>${n ? `<span class="sec-n outline">${n}</span>` : ""}<h3 class="outline">${title}</h3></button>
          ${open ? "" : `<span class="sec-sum">${esc(summary || "")}</span>`}</div>
        ${open ? body : ""}</section>`;
    };
    const onCount = selfSt.concat(targetSt).filter((id) => ctx.statuses[id].on).length + Object.keys(Dmg.DOTS).filter((k) => ctx.S.target[k]).length +
      FX().POTIONS.filter((p) => s.potions[p.id]).length + situational.filter((pk) => perkOn(s, pk)).length;
    const seqSummary = seq.map((st) => (act[st.a] ? act[st.a][1] : st.a) + (st.a === "wait" ? ` ${st.w || 1}s` : st.n > 1 ? ` ×${st.n}` : "")).join(" → ") || "no steps";

    const prevSetup = A.$("viewTest").querySelector(".tv-setup");
    const keepTop = prevSetup ? prevSetup.scrollTop : 0;
    A.$("viewTest").innerHTML = `
      <div class="tv-grid">
        <div class="tv-setup">
          ${!wpn.parts.length ? `<div class="cv-warn">No weapon set: using 1-Handed Sword moves with Physical damage. Build one in the CHARACTER tab.</div>` : ""}
          ${sec("seq", 1, "SEQUENCE", seqSummary, seqSection)}
          ${sec("buffs", 2, "BUFFS", onCount ? `${onCount} on` : "none on", buffsSection)}
          ${sec("enemy", 3, "ENEMY", atkNow.name, enemySection)}
        </div>
        <div class="tv-results" id="testResults"></div>
      </div>`;
    A.$("viewTest").querySelector(".tv-setup").scrollTop = keepTop; // re-rendering keeps your place in the setup pane
    renderResults(A);
  }

  // ------------------------------------------------------------ results column
  function hitCardFor(A, ctx, mods, s, atk, as) {
    const { esc, Dmg } = A;
    const rage = Dmg.ragePotency(ctx, false);
    const add = (into, from) => { Object.entries(from || {}).forEach(([t, v]) => { into[t] = (into[t] || 0) + v; }); return into; };
    if (!atk || !atk.hits || !atk.hits.length) {
      return `<div class="res-card"><div class="res-title outline">${esc(atk ? atk.name : "Nothing")}</div><div class="muted">No documented damage${atk && atk.applies ? ": it applies " + esc(atk.applies.map((x) => x.status + (x.potency ? " " + fmt(x.potency, 2) : "")).join(", ")) : ""}.</div></div>`;
    }
    const h = Dmg.hit(ctx, mods, s, atk, { rage });
    const procs = Dmg.procsFor(ctx, mods, s, atk, h, { rage, charges: 20, marked: true, interval: as.swingTime });
    const extras = [...h.echoes, ...procs].filter((x) => x.dmg > 0.0005);
    const extra = extras.reduce((a, x) => a + x.dmg, 0);
    const all = add(add({}, h.expByType), {});
    extras.forEach((x) => add(all, x.byType));
    const swings = atk.swings ? `<div class="swing-list">${atk.swings.map((sw) => {
      const r = Dmg.hit(ctx, mods, s, sw, { rage });
      return `<div class="step"><span>${sw.name}${sw.finisher ? " (finisher)" : ""}</span><b>${fmt(r.expected)}</b></div>`;
    }).join("")}</div>` : h.hits > 1 ? `<div class="muted">${fmt(h.hits, 0)} hits · ${fmt(h.expected / h.hits, 2)} each</div>` : "";
    const formula = [
      ["Base damage", fmt(h.base, 2)],
      ["Scaling bonus", "+" + pct(h.effBoost) + " (" + Object.entries(h.scalings).map(([k, v]) => `${k} ${fmt(v, 2)}`).join(", ") + ")"],
      ["Level ×", fmt(h.lvl, 3)],
      ...h.bonuses.map(([n, m]) => [n + " ×", fmt(m, 3)]),
      ...(rage ? [["Rage potency", fmt(rage, 2)]] : []),
      ...Object.entries(h.types).map(([t, f]) => [`${t} damage type`, fmt(f, 3)]),
      ...Object.entries(h.typeMults).filter(([, m]) => m !== 1).map(([t, m]) => [`${t} type ×`, fmt(m, 3)]),
      ["Armor penetration", fmt(h.pen, 1)],
      ...Object.entries(h.armorByType).map(([t, m]) => [`Armor × (${t})`, fmt(m, 3)]),
      ["Crit chance / multiplier", pct(h.crit.p) + " / ×" + fmt(h.crit.mult, 3) + (h.crit.only !== 1 ? ` (+×${fmt(h.crit.only, 3)} on crit)` : "")],
      ...(mods.lucky ? [["Lucky (proc rerolls)", fmt(mods.lucky, 2)]] : []),
    ];
    return `<div class="res-card">
      <div class="res-title outline">${esc(atk.name)}${atk.cooldown ? ` <span class="muted">· ${atk.cooldown}s cooldown</span>` : ""}</div>
      <div class="big-row">
        <div><span class="lab">ONE USE</span><b class="big outline">${fmt(h.expected + extra)}</b><span class="muted">${extra ? `${fmt(h.expected)} + ${fmt(extra)} procs/chains` : s.crit === "avg" ? "average with crits" : s.crit === "always" ? "always crit" : "never crit"}</span></div>
        <div><span class="lab">NORMAL / CRIT</span><b class="mid outline">${fmt(h.normal)}</b><b class="mid outline" style="color:#ffd84a">${fmt(h.critHit)}</b></div>
      </div>
      <div class="bars">${typeBars(esc, all)}</div>
      ${swings}
      ${extras.length ? `<div class="sub-h outline">PROCS &amp; CHAINS</div>${extras.map((x) => `<div class="step"><span>${esc(x.name)}</span><b>+${fmt(x.dmg, 1)}</b></div>`).join("")}` : ""}
      <details class="steps"><summary class="outline">FORMULA</summary>${formula.map(([k, v]) => `<div class="step"><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join("")}</details>
      <div class="muted">Uses your toggled buffs as always on (in the sequence, timed buffs only count inside their windows).</div>
    </div>`;
  }

  function renderResults(A) {
    const { esc, Dmg } = A;
    const { s, ctx, mods, totals } = state(A);
    const atks = Dmg.attacks(ctx, mods, s);
    const byKey = Object.fromEntries(atks.map((a) => [a.key, a]));
    const as = Dmg.attackSpeed(ctx, mods, s);
    const box = A.$("testResults");
    const sim = Dmg.simulate(ctx, mods, s);
    const actions = actionList(A, ctx, atks, s);
    const act = Object.fromEntries(actions.map((x) => [x[0], x]));
    const SUP = window.VoxlSupport;
    const sup = SUP.evaluate(ctx, mods, s, sim, Dmg);
    const D = sup.defense, Hh = sup.healing, Sm = sup.summons;
    const P = (id) => ctx.perks[id] || 0;

    // ---- sequence tab
    const total = Math.max(1e-9, sim.total);
    const stepRows = (sim.steps || []).map((st) => {
      const a = act[st.a];
      const name = a ? a[1] : st.a;
      const when = st.t0 === null ? "not used" : `${fmt(st.t0, 2)}s → ${fmt(st.t1, 2)}s`;
      const extra = [st.n > 1 ? `×${st.n}` : "", st.waited ? `waited ${fmt(st.waited, 2)}s for cooldown` : "", st.skipped ? `skipped ${st.skipped}× on cooldown` : "", st.note].filter(Boolean).join(" · ");
      return `<button class="seq-res" data-detail="${st.a}" ${st.a === "wait" ? "disabled" : ""}>
        <span class="seq-num outline">${st.i + 1}</span><span class="seq-ico portrait sm">${a ? a[3] : ""}</span>
        <span class="seq-name"><b>${esc(name)}</b><i>${esc(when)}${extra ? " · " + esc(extra) : ""}</i></span>
        <span class="seq-dmg"><b class="outline">${st.a === "wait" ? "—" : fmt(st.dmg, 0)}</b>${st.a === "wait" ? "" : `<i>${fmt((st.dmg / total) * 100, 0)}%</i>`}</span></button>`;
    }).join("");
    const dotTotal = sim.bySource.dot || 0;
    const dotRow = dotTotal > 0 ? `<div class="seq-res static"><span class="seq-num outline">+</span><span class="seq-ico portrait sm"><span class="seq-badge outline">☠</span></span>
        <span class="seq-name"><b>DoTs &amp; auras</b><i>${esc(Object.keys(Dmg.DOTS).filter((k) => ctx.S.target[k]).join(", ") || "auras")} for the whole ${fmt(sim.T, 2)}s</i></span>
        <span class="seq-dmg"><b class="outline">${fmt(dotTotal, 0)}</b><i>${fmt((dotTotal / total) * 100, 0)}%</i></span></div>` : "";
    const seqTab = `<div class="res-card">
        <div class="res-title outline">YOUR SEQUENCE <span class="muted">· click a step for its details</span></div>
        <div class="seq-results">${stepRows || `<div class="muted">Add steps to your sequence on the left.</div>`}${dotRow}</div>
        ${sim.T > 0 ? chart(sim) : ""}
        <div class="legend">${Object.keys(SOURCE_NAMES).filter((k) => sim.bySource[k] > 0).map((k) =>
          `<span><i style="background:${SOURCE_COLORS[k]}"></i>${SOURCE_NAMES[k]} ${fmt((sim.bySource[k] / total) * 100, 0)}%</span>`).join("")}</div>
        ${Object.keys(sim.typeTotals).length ? `<div class="sub-h outline">DAMAGE BY TYPE</div><div class="bars">${typeBars(esc, sim.typeTotals)}</div>` : ""}
        <div class="muted">Swing every ${fmt(as.swingTime, 3)}s. One action at a time; each locks you for its cast time.</div>
      </div>`;

    // ---- hit details tab
    const usable = actions.filter(([k]) => k !== "wait" && byKey[k]);
    const detailKey = usable.some(([k]) => k === tui.detail) ? tui.detail : ((s.seq || []).map((x) => x.a).find((k) => usable.some(([u]) => u === k)) || "m1");
    const detailTab = `<div class="mode-tabs wrap detail-pick">${usable.map(([k, name]) => `<button class="mode-tab outline${k === detailKey ? " active" : ""}" data-detail="${k}">${esc(name.toUpperCase())}</button>`).join("")}</div>
      ${hitCardFor(A, ctx, mods, s, byKey[detailKey], as)}`;

    // ---- survival tab
    const factorRows = D.factors.map(([n, m]) => `<div class="step"><span>${esc(n)}</span><b>${m === null ? "" : "×" + fmt(m, 3)}</b></div>`).join("");
    const survivalTab = `<div class="res-card">
        <div class="res-title outline">SURVIVAL <span class="muted">· ${esc(D.attack.name)} (${fmt(D.raw, 1)})</span></div>
        <div class="big-row">
          <div><span class="lab">TAKEN PER HIT</span><b class="big outline" style="color:#ff8a8a">${fmt(D.perHit, 2)}</b><span class="muted">${fmt(D.takenPct, 1)}% of the hit${Number.isFinite(D.hitsToDie) ? ` · dead in ${D.hitsToDie} hits` : ""}</span></div>
          <div><span class="lab">TAKEN / HEALED PER S</span><b class="mid outline" style="color:#ffb27a">${fmt(D.perSec, 2)}</b><b class="mid outline" style="color:#6dff9a">${fmt(Hh.total, 2)}</b></div>
        </div>
        <div class="kv">
          <span>Max HP</span><b>${fmt(D.maxHp, 0)}</b>
          ${D.shield ? `<span>Shield</span><b>${fmt(D.shield, 0)} (absorbs 75% for ~${fmt(D.hitsToBreak, 1)} hits)</b>` : ""}
          <span>Effective HP</span><b>${Number.isFinite(D.ehp) ? fmt(D.ehp, 0) : "∞"}</b>
          <span>Stun</span><b>${fmt(D.stun.raw, 2)}s → ${fmt(D.stun.after, 2)}s${D.stun.bulwark ? " (Bulwark)" : ""}</b>
          <span>DoTs on you</span><b>×${fmt(D.dotTaken, 3)}</b>
        </div>
        <details class="steps"><summary class="outline">HOW DAMAGE TAKEN IS WORKED OUT</summary>${factorRows}</details>
        ${Hh.list.length ? `<div class="sub-h outline">HEALING</div>${Hh.list.map(([n, v]) => `<div class="step"><span>${esc(n)}</span><b>${fmt(v, 2)}/s</b></div>`).join("")}` : ""}
        ${SUP.GROUPS.summons.some(P) ? `<div class="sub-h outline">MINIONS</div>
        <div class="step"><span>${fmt(Sm.count, 0)} minion${Sm.count === 1 ? "" : "s"} · damage ×${fmt(Sm.dmgMult, 2)} · HP ${fmt(Sm.hp, 0)}</span><b>${fmt(Sm.dps, 1)} dmg/s</b></div>` : ""}
      </div>`;

    // ---- perks tab
    const fx = FX();
    const sources = fx.sourcePerks();
    const groups = { status: [], attack: [], none: [] };
    Object.values(totals.perks).forEach((pk) => {
      const id = pk.id;
      if (fx.PERKS[id] || fx.ENGINE_PERKS.includes(id) || fx.FORM_PERKS.includes(id) || fx.STAT_PERKS.includes(id) || SUP.PERK_IDS.includes(id)) return;
      const name = A.perkInfo(id, pk.name).name;
      if (fx.SPIRITS[id] || fx.EXTRA_ATTACKS[id]) groups.attack.push(name);
      else if (sources.has(id)) groups.status.push(name);
      else groups.none.push(name);
    });
    const chips = (l) => `<div class="chips">${l.map((n) => `<span class="chip">${esc(n)}</span>`).join("")}</div>`;
    const groupTitle = { defense: "DEFENSE", healing: "HEALING", summons: "MINIONS", poise: "POISE", utility: "UTILITY" };
    const perkCards = Object.entries(sup.rows).filter(([, l]) => l.length).map(([g, l]) => `<div class="sub-h outline">${groupTitle[g]}</div>` +
      l.map((r) => `<div class="step col"><span><b class="ename">${esc(r.name)} +${fmt(r.amt, 2)}</b> ${esc(r.text)}</span></div>`).join("")).join("");
    const perksTab = `<div class="res-card"><div class="res-title outline">NON-DAMAGE PERKS</div>${perkCards || `<div class="muted">No defense, healing, minion or utility perks in your build.</div>`}
        ${groups.status.length ? `<div class="sub-h outline">GIVE A BUFF OR DOT (SEE BUFFS)</div>${chips(groups.status)}` : ""}
        ${groups.attack.length ? `<div class="sub-h outline">ADD AN ATTACK (SPECIAL)</div>${chips(groups.attack)}` : ""}
        ${groups.none.length ? `<div class="sub-h outline">NOT SIMULATED</div>${chips(groups.none)}` : ""}</div>`;

    const tab = ["seq", "detail", "survival", "perks"].includes(tui.tab) ? tui.tab : "seq";
    const kpi = (id, lab, val, sub, color) => `<button class="kpi${tab === id ? " on" : ""}" data-test-tab="${id}" aria-pressed="${tab === id}">
      <span class="lab">${lab}</span><b class="outline" style="color:${color}">${val}</b><span class="kpi-sub">${sub}</span></button>`;
    const one = byKey[detailKey] && byKey[detailKey].hits && byKey[detailKey].hits.length ? Dmg.hit(ctx, mods, s, byKey[detailKey], { rage: Dmg.ragePotency(ctx, false) }) : null;
    box.innerHTML = `
      <div class="kpis">
        ${kpi("seq", "TOTAL", fmt(sim.total, 0), `in ${fmt(sim.T, 2)}s`, "#fff3dc")}
        ${kpi("seq", "DPS", fmt(sim.avg), sim.repeat ? "over the fight" : "total ÷ time", "#6dff9a")}
        ${kpi("detail", "ONE HIT", one ? fmt(one.expected) : "—", esc(act[detailKey] ? act[detailKey][1] : ""), "#ffd84a")}
        ${kpi("survival", "TAKEN / S", fmt(D.perSec, 1), `healed ${fmt(Hh.total, 1)}/s`, "#ff9a9a")}
      </div>
      <div class="res-tabs mode-tabs">
        ${[["seq", "SEQUENCE"], ["detail", "HIT DETAILS"], ["survival", "SURVIVAL"], ["perks", "OTHER PERKS"]].map(([k, l]) => `<button class="mode-tab outline${tab === k ? " active" : ""}" data-test-tab="${k}">${l}</button>`).join("")}
      </div>
      <div class="tab-body">${tab === "seq" ? seqTab : tab === "detail" ? detailTab : tab === "survival" ? survivalTab : perksTab}</div>`;
  }

  function chart(sim) {
    const W = 600, H = 140, pad = 20;
    const n = sim.bins.length;
    const bw = (W - pad) / n;
    const max = Math.max(1, sim.peak);
    let bars = "";
    sim.bins.forEach((b, i) => {
      let y = H - pad;
      Object.keys(SOURCE_NAMES).forEach((k) => {
        if (!b[k]) return;
        const h = (b[k] / max) * (H - pad - 8);
        y -= h;
        bars += `<rect x="${pad + i * bw + 0.5}" y="${y}" width="${Math.max(1, bw - 1)}" height="${h}" fill="${SOURCE_COLORS[k]}"><title>${i}s: ${SOURCE_NAMES[k]} ${fmt(b[k])}</title></rect>`;
      });
    });
    const avgY = H - pad - (sim.avg / max) * (H - pad - 8);
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Damage per second over the sequence">
      <line x1="${pad}" y1="${H - pad}" x2="${W}" y2="${H - pad}" stroke="#0006"/>
      ${bars}
      <line x1="${pad}" y1="${avgY}" x2="${W}" y2="${avgY}" stroke="#6dff9a" stroke-dasharray="4 3"/>
      <text x="${pad}" y="${H - 5}" fill="#fff3dc" font-size="13" font-weight="600">0s</text>
      <text x="${W}" y="${H - 5}" fill="#fff3dc" font-size="13" font-weight="600" text-anchor="end">${fmt(sim.T, 2)}s</text>
    </svg>`;
  }

  // ------------------------------------------------------------ events
  function setPath(obj, path, value) {
    const keys = path.split(".");
    let o = obj;
    keys.slice(0, -1).forEach((k) => { if (!o[k] || typeof o[k] !== "object") o[k] = {}; o = o[k]; });
    const last = keys[keys.length - 1];
    if (value === undefined) delete o[last]; else o[last] = value;
  }

  function read(el) {
    if (el.type === "checkbox") return el.checked;
    if (el.tagName === "SELECT") return /^-?\d+(\.\d+)?$/.test(el.value) ? +el.value : el.value;
    if (el.value === "") return undefined;
    const v = parseFloat(el.value);
    return Number.isFinite(v) ? v : undefined;
  }

  // choosing an enemy copies its defenses to the target and makes it the one hitting you
  function setEnemy(test, id) {
    const SUP = window.VoxlSupport;
    const foe = id ? SUP.enemyById()[id] : null;
    test.enemy = foe ? foe.id : "";
    Object.keys(test.target).forEach((k) => { test.target[k] = (foe && foe.defenses[k]) || 0; });
    test.inc = { ...SUP.defaults(), ...(test.inc || {}), mode: foe ? "enemy" : "custom", seq: null, ...(foe ? { enemy: foe.id } : {}) };
  }

  function bindTest(A) {
    const root = A.$("viewTest");
    const test = () => A.build().test;
    const changed = (full) => { A.save(); if (full) renderTest(A); else renderResults(A); };
    const SUP = window.VoxlSupport;
    const foeOf = () => (test().enemy ? SUP.enemyById()[test().enemy] : null);
    const incSeq = () => test().inc.seq || (test().inc.seq = SUP.defaultSeq(foeOf()));
    const custom = (id) => (test().customs || []).find((c) => c.id === id);
    // "c:<custom id>" or "i:<enemy step>" -> that attack's {type: coefficient}
    const typesOf = (target) => {
      const [kind, key] = target.split(":");
      const owner = kind === "c" ? custom(key) : incSeq()[+key];
      return owner ? owner.types || (owner.types = {}) : null;
    };
    const numOf = (el) => { const v = parseFloat(el.value); return Number.isFinite(v) ? v : null; };
    // custom attack / type split / enemy step fields; typing updates the numbers, leaving the field redraws
    const editField = (el) => {
      const v = numOf(el);
      if (el.dataset.custom) {
        const c = custom(el.dataset.custom);
        if (c && el.dataset.field === "name") c.name = el.value.slice(0, 30) || "Custom hit";
        else if (c && v !== null) c[el.dataset.field] = el.dataset.field === "hits" ? Math.max(1, Math.min(50, Math.round(v))) : Math.max(0, v);
        return true;
      }
      if (el.dataset.tsplit) {
        const ty = typesOf(el.dataset.tsplit);
        if (ty && v !== null) ty[el.dataset.type] = Math.max(0, Math.min(10, v));
        return true;
      }
      if (el.dataset.incN !== undefined || el.dataset.incDmg !== undefined) {
        const st = incSeq()[+(el.dataset.incN !== undefined ? el.dataset.incN : el.dataset.incDmg)];
        if (st && v !== null) { if (el.dataset.incN !== undefined) st.n = Math.max(1, Math.min(50, Math.round(v))); else st.dmg = Math.max(0, v); }
        return true;
      }
      return false;
    };
    root.addEventListener("input", (e) => {
      const el = e.target;
      if (editField(el)) return changed(false);
      if (el.dataset.seqN !== undefined || el.dataset.seqW !== undefined) {
        const i = +(el.dataset.seqN !== undefined ? el.dataset.seqN : el.dataset.seqW);
        const v = parseFloat(el.value);
        if (!Number.isFinite(v) || !test().seq[i]) return;
        if (el.dataset.seqN !== undefined) test().seq[i].n = Math.max(1, Math.min(50, Math.round(v)));
        else test().seq[i].w = Math.max(0.1, Math.min(60, v));
        return changed(false);
      }
      const p = el.closest("[data-path]");
      if (!p || p.type === "checkbox" || p.tagName === "SELECT") return;
      setPath(test(), p.dataset.path, read(p));
      changed(false);
    });
    root.addEventListener("change", (e) => {
      const el = e.target;
      if (el.dataset.tsplitAdd !== undefined) {
        const ty = typesOf(el.dataset.tsplitAdd);
        if (ty && el.value) ty[el.value] = Object.keys(ty).length ? 0.5 : 1;
        return changed(true);
      }
      if (editField(el)) return changed(true);
      if (el.matches("[data-enemy]")) { setEnemy(test(), el.value); return changed(true); }
      const p = el.closest("[data-path]");
      if (!p || (p.type !== "checkbox" && p.tagName !== "SELECT")) return;
      setPath(test(), p.dataset.path, read(p));
      changed(true);
    });
    root.addEventListener("click", (e) => {
      const t = (sel) => e.target.closest(sel);
      let el;
      if ((el = t("[data-toggle-sec]"))) {
        const id = el.dataset.toggleSec;
        if (tui.closed.has(id)) tui.closed.delete(id); else tui.closed.add(id);
        saveUi();
        return renderTest(A);
      }
      if ((el = t("[data-test-tab]"))) {
        tui.tab = el.dataset.testTab;
        saveUi();
        renderResults(A);
        if (window.matchMedia("(max-width: 820px)").matches) A.$("testResults").scrollIntoView({ block: "start", behavior: "smooth" });
        return;
      }
      if ((el = t("[data-detail]")) && !el.disabled) { tui.detail = el.dataset.detail; tui.tab = "detail"; saveUi(); return renderResults(A); }
      if (t("[data-custom-new]")) {
        const cs = test().customs || (test().customs = []);
        let n = 1;
        while (cs.some((c) => c.id === "c" + n)) n++;
        if (cs.length < 8) cs.push({ id: "c" + n, name: "Custom hit " + n, dmg: 20, hits: 1, types: {} });
        return changed(true);
      }
      if ((el = t("[data-custom-del]"))) {
        const id = el.dataset.customDel;
        test().customs = test().customs.filter((c) => c.id !== id);
        test().seq = (test().seq || []).filter((st) => st.a !== "custom:" + id);
        return changed(true);
      }
      if ((el = t("[data-tsplit-del]"))) { const ty = typesOf(el.dataset.tsplitDel); if (ty) delete ty[el.dataset.type]; return changed(true); }
      if ((el = t("[data-inc-add]"))) {
        const seq = incSeq(), v = el.dataset.incAdd, last = seq[seq.length - 1];
        if (v !== "c" && last && last.a === +v) last.n = Math.min(50, (last.n || 1) + 1); // adding the same attack again stacks it
        else if (seq.length < 20) seq.push(v === "c" ? SUP.customHit() : { a: +v, n: 1 });
        return changed(true);
      }
      if ((el = t("[data-inc-del]"))) { incSeq().splice(+el.dataset.incDel, 1); return changed(true); }
      if ((el = t("[data-inc-move]")) && !el.disabled) {
        const seq = incSeq(), i = +el.dataset.incMove, j = i + +el.dataset.dir;
        if (j >= 0 && j < seq.length) [seq[i], seq[j]] = [seq[j], seq[i]];
        return changed(true);
      }
      if ((el = t("[data-seq-add]"))) {
        const k = el.dataset.seqAdd, seq = test().seq || (test().seq = []);
        const last = seq[seq.length - 1];
        if (last && last.a === k && k !== "wait") last.n = Math.min(50, (last.n || 1) + 1); // adding the same action again stacks it
        else if (seq.length < 30) seq.push(k === "wait" ? { a: "wait", n: 1, w: 1 } : { a: k, n: 1 });
        return changed(true);
      }
      if ((el = t("[data-seq-del]"))) { test().seq.splice(+el.dataset.seqDel, 1); return changed(true); }
      if ((el = t("[data-seq-move]")) && !el.disabled) {
        const seq = test().seq, i = +el.dataset.seqMove, j = i + +el.dataset.dir;
        if (j < 0 || j >= seq.length) return;
        [seq[i], seq[j]] = [seq[j], seq[i]];
        return changed(true);
      }
      if ((el = t("[data-set]")) && !el.disabled) {
        const v = el.dataset.bool !== undefined ? el.dataset.bool === "1" : el.dataset.num !== undefined ? +el.dataset.val : el.dataset.val;
        setPath(test(), el.dataset.set, v);
        return changed(true);
      }
    });
  }

  window.VoxlViews.test = { render: renderTest, bind: bindTest };
})();
