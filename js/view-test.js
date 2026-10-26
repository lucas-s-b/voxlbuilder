// Test tab: damage simulator UI. Perk / status / potion toggles only appear when the build
// (or a picked potion) actually provides them.
(function () {
  const SOURCE_COLORS = { m1: "#ffd84a", m2: "#fff6b0", proc: "#ff9a3c", art: "#4af6ff", rune: "#c49aff", drac: "#ff6a3d", special: "#7dff8a", custom: "#ff8ad8", dot: "#ff5a5a" };
  const SOURCE_NAMES = { m1: "M1", m2: "M2", proc: "Procs & echoes", art: "Weapon Art", rune: "Rune", drac: "Draconic", special: "Special", custom: "Custom", dot: "DoTs & auras" };
  const FX = () => window.VoxlEffects;
  const ATTACK_LABEL = { m1: "M1 COMBO", m2: "M2", art: "ART", rune: "RUNE", drac: "DRACONIC", special: "SPECIAL", potion: "POTION", custom: "CUSTOM" };
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
      `<span class="tchip" style="--tc:${TC[t] || "#fff"}"><i></i>${esc(t)} ${fmt((v / tot) * 100, 0)}% · ${fmt(v, 2)}</span>`).join("")}</span>`;
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

  // Which setup sections are folded and which result tab is open; remembered per browser.
  const UI_KEY = "voxlbuilder:testui";
  const DEFAULT_CLOSED = ["target", "potions", "dots", "perks", "situation", "incoming"];
  const tui = (() => {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(UI_KEY)); } catch (e) { /* storage unavailable */ }
    return { closed: new Set(saved && Array.isArray(saved.closed) ? saved.closed : DEFAULT_CLOSED), tab: (saved && saved.tab) || "hit" };
  })();
  const saveUi = () => { try { localStorage.setItem(UI_KEY, JSON.stringify({ closed: [...tui.closed], tab: tui.tab })); } catch (e) { /* storage unavailable */ } };

  // ------------------------------------------------------------ setup column
  function renderTest(A) {
    const { esc, Dmg } = A;
    const { s, ctx, mods, wpn } = state(A);
    const TC = V().TYPE_COLORS;
    const atks = Dmg.attacks(ctx, mods, s);
    const has = (k) => atks.some((a) => a.key === k);
    if (!has(s.attack)) s.attack = "m1";
    const f = ctx.form;
    const btn = (key, val, label, on, dis) => `<button class="mode-tab outline${on ? " active" : ""}" data-set="${key}" data-val="${esc(val)}" ${dis ? "disabled" : ""}>${label}</button>`;
    const num = (path, val, attrs) => `<input class="num" type="number" data-path="${path}" value="${val === undefined || val === null ? "" : val}" ${attrs || ""}>`;
    const chk = (path, on, label) => `<label class="toggle"><input type="checkbox" data-path="${path}" ${on ? "checked" : ""}> <span>${label}</span></label>`;
    const sel = (path, options, value) => `<select class="sort mini" data-path="${path}">${options.map(([v, l]) => `<option value="${esc(v)}"${String(v) === String(value) ? " selected" : ""}>${esc(l)}</option>`).join("")}</select>`;

    // rotation table: one row per action the build can use
    const countMode = s.rotMode === "count";
    const rot = Dmg.rotation(s);
    const byKey = Object.fromEntries(atks.map((a) => [a.key, a]));
    const m1Len = byKey.m1.swings.length;
    const cdInput = (k) => `${num(`rot.${k}.cooldown`, rot[k].cooldown, 'min="0" step="0.5" title="0 = no cooldown"')}<span class="muted">s</span>`;
    // [label, sub-line, cooldown input] per action; null label = the build doesn't have it
    const sub = (name, cd) => `<i class="rot-name">${[name, cd].filter(Boolean).join(" · ")}</i>`;
    const spiritEnergy = byKey.special && byKey.special.spiritId && ctx.perks["spirit-commune"];
    const rowDefs = {
      m1: [countMode ? "M1 combos" : "M1 combo", sub(`${m1Len} swing${m1Len === 1 ? "" : "s"}`)],
      m2: [rot.m1.on ? "M2 after each combo" : "M2", ""],
      art: [byKey.art && byKey.art.cooldown && "Weapon art", byKey.art && sub(esc(byKey.art.name), `${byKey.art.cooldown}s cooldown`)],
      rune: [byKey.rune && byKey.rune.cooldown && "Rune", byKey.rune && sub(esc(byKey.rune.name), `${byKey.rune.cooldown}s cooldown`)],
      drac: [byKey.drac && "Draconic rune", byKey.drac && sub(esc(byKey.drac.name), `${byKey.drac.cooldown}s cooldown`)],
      special: [byKey.special && "Special", byKey.special && sub(esc(byKey.special.name), spiritEnergy ? "fires at full energy" : ""), !spiritEnergy && cdInput("special")],
      custom: ["Custom attack", "", cdInput("custom")],
    };
    // priority order, top first; the M2 row rides with the M1 combo
    const seq = [];
    Dmg.rotOrder(s).forEach((k) => { seq.push(k); if (k === "m1") seq.push("m2"); });
    const shownKeys = seq.filter((k) => has(k) && rowDefs[k][0]);
    const movable = shownKeys.filter((k) => k !== "m2");
    const arrows = (k) => {
      if (k === "m2") return `<span class="rot-move"></span>`;
      const i = movable.indexOf(k);
      return `<span class="rot-move"><button class="mv" data-move="${k}" data-dir="-1" ${i === 0 ? "disabled" : ""} title="Higher priority" aria-label="Move up">▲</button><button class="mv" data-move="${k}" data-dir="1" ${i === movable.length - 1 ? "disabled" : ""} title="Lower priority" aria-label="Move down">▼</button></span>`;
    };
    const rotRows = shownKeys.map((k) => {
      const [label, subLine, cdIn] = rowDefs[k];
      return `${arrows(k)}${chk(`rot.${k}.on`, rot[k].on, label + subLine)}${countMode ? `<span>${num(`rot.${k}.count`, rot[k].count, 'min="0" max="999" step="1"')}</span>` : ""}` +
        (cdIn && rot[k].on ? `<span></span><span class="rot-extra"><span class="lab">Cooldown</span>${cdIn}</span>` : "");
    }).join("");

    // timing: how long each action locks you and how long its hits keep landing (base seconds at 1.0 speed)
    const timingRows = ["m2", "art", "rune", "drac", "special", "custom"].filter((k) => has(k) && rot[k].on).map((k) => {
      const tm = Dmg.timing(ctx, mods, s, byKey[k]);
      const label = { m2: "M2", art: byKey.art && byKey.art.name, rune: byKey.rune && byKey.rune.name, drac: byKey.drac && byKey.drac.name, special: byKey.special && byKey.special.name, custom: "Custom attack" }[k];
      const path = `timing.${tm.key}`;
      const eff = `${fmt(tm.cast, 2)}s${tm.active > tm.cast + 1e-6 ? ` · hits over ${fmt(tm.active, 2)}s` : ""}`;
      return `<div class="tim-row"><div class="rot-lab">${esc(label)}${tm.note ? `<i class="rot-name">${esc(tm.note)}</i>` : ""}</div>
        <div class="tim-in"><label><span>Cast</span>${num(`${path}.cast`, (s.timing[tm.key] || {}).cast, `step="0.1" min="0.05" placeholder="${fmt(tm.baseCast, 2)}"`)}</label>
        <label><span>Active</span>${num(`${path}.active`, (s.timing[tm.key] || {}).active, `step="0.5" min="0" placeholder="${fmt(tm.baseActive, 2)}"`)}</label>
        <span class="rot-cd">→ ${eff}</span></div></div>`;
    }).join("");
    const spiritGated = byKey.special && byKey.special.spiritId && ctx.perks["spirit-commune"] && rot.special.on;

    // survival inputs (always shown: every build takes damage)
    const SUP = window.VoxlSupport;
    const inc = { ...SUP.defaults(), ...(s.inc || {}) };
    const P = (id) => ctx.perks[id] || 0;
    const sitNum = (k) => { const d = FX().SITUATION[k]; const v = s.sit[k] === undefined ? d.def : s.sit[k]; return `<label class="sit"><span>${esc(d.label)}</span>${num(`sit.${k}`, v, `step="${d.step}" min="${d.min}" max="${d.max}"`)}</label>`; };
    const hasSummonPerk = SUP.GROUPS.summons.some(P) || P("pain-distribution") || P("revel-in-death");
    const enemies = window.VOXL_DATA.enemies || [];
    const foe = inc.mode === "enemy" ? SUP.enemyById()[inc.enemy] : null;
    const atkNow = SUP.incoming(inc);
    const setBtn = (path, val, label, on, extra) => `<button class="mode-tab outline${on ? " active" : ""}" data-set="${path}" data-val="${esc(String(val))}" ${extra || ""}>${label}</button>`;
    const partsText = (parts) => Object.entries(parts).map(([t, v]) => `<span class="chip outline" style="color:${TC[t] || "#fff"}">${fmt(v, 1)} ${esc(t)}</span>`).join("");
    const enemyBlock = foe ? `
      <div class="enemy-row">${foe.image ? A.img(foe.image, foe.name) : ""}
        <select class="sort mini" data-path="inc.enemy" aria-label="Enemy">${enemies.map((e) => `<option value="${esc(e.id)}"${e.id === foe.id ? " selected" : ""}>${esc(e.name)} · ${fmt(e.hp, 0)} HP</option>`).join("")}</select></div>
      <div class="mode-tabs wrap atk-pick">${setBtn("inc.attack", "avg", "ANY ATTACK", inc.attack === "avg" || !foe.attacks[inc.attack])}${foe.attacks.map((x, i) =>
        setBtn("inc.attack", i, `${esc(x.name)} ${fmt(Object.values(x.parts).reduce((q, v) => q + v, 0), 1)}${x.guardbreak ? " ⛨" : ""}`, String(inc.attack) === String(i))).join("")}</div>
      <div class="inc-sum">${partsText(atkNow.parts)}<span class="muted">${atkNow.hits > 1 ? `${fmt(atkNow.hits, 1)} hits` : "1 hit"}${atkNow.guardbreak ? ` · ${atkNow.guardbreak < 1 ? Math.round(atkNow.guardbreak * 100) + "% " : ""}guardbreaks (⛨)` : ""}</span>
        <button class="mode-tab outline" data-enemy-target="${esc(foe.id)}" title="Copy this enemy's defenses into TARGET DEFENSES">USE AS TARGET</button></div>` : `
      <div class="sit-grid">
        <label class="sit"><span>Damage per hit</span>${num("inc.dmg", inc.dmg, 'step="1" min="0"')}</label>
      </div>
      <div class="mode-tabs wrap type-pick">${SUP.INC_TYPES.map((t) => `<button class="mode-tab outline${inc.type === t ? " active" : ""}" data-set="inc.type" data-val="${t}" style="color:${TC[t] || "#fff"}">${t.toUpperCase()}</button>`).join("")}</div>`;
    const survivalRows = `
      <div class="mode-tabs">${setBtn("inc.mode", "enemy", "WIKI ENEMY", inc.mode === "enemy")}${setBtn("inc.mode", "custom", "CUSTOM", inc.mode !== "enemy")}</div>
      ${enemyBlock}
      <div class="opt-row"><span class="lab">Attacks per 10s</span>${num("inc.per10", inc.per10, 'step="1" min="0" max="100"')}</div>
      <div class="opt-row"><span class="lab">You block</span><span class="mode-tabs">${[[0, "NONE"], [50, "HALF"], [100, "ALL"]].map(([v, l]) => setBtn("inc.blockPct", v, l, +inc.blockPct === v, 'data-num="1"')).join("")}</span></div>
      <details class="steps inc-more"><summary class="outline">MORE OPTIONS</summary>
        <div class="sit-grid">
          <label class="sit"><span>Stun per hit (s)</span>${num("inc.stun", inc.stun, 'step="0.1" min="0"')}</label>
          <label class="sit"><span>Your max HP</span>${num("inc.hp", inc.hp || "", `step="10" min="0" placeholder="${fmt(100 * (1 + ctx.level * 0.0125), 0)}"`)}</label>
          ${P("parry") || P("buckler") ? `<label class="sit"><span>Parries per 10s</span>${num("inc.parryPer10", inc.parryPer10, 'step="1" min="0"')}</label>` : ""}
          ${hasSummonPerk ? sitNum("summons") : ""}
          ${hasSummonPerk ? `<label class="sit"><span>Minion base DPS</span>${num("inc.summonDps", inc.summonDps, 'step="1" min="0"')}</label><label class="sit"><span>Minion base HP</span>${num("inc.summonHp", inc.summonHp, 'step="5" min="1"')}</label>` : ""}
          ${P("untethered") ? `<label class="sit"><span>Restricted speed</span>${num("inc.speed", inc.speed, 'step="1" min="0"')}</label>` : ""}
        </div>
        ${P("mounted-defense") ? chk("inc.mounted", inc.mounted, "Riding the Glacial Snapper mount") : ""}
        ${P("carapace") ? chk("inc.shieldUp", inc.shieldUp, "Shield (Protection) is up") : ""}
        ${P("lithic-veil") ? chk("inc.healingAllies", inc.healingAllies, "Lithic Veil is active (you healed someone)") : ""}
      </details>`;

    // potions
    const potions = FX().POTIONS.map((p) => `<div class="opt-row">${chk(`potions.${p.id}`, s.potions[p.id], `<b>${esc(p.name)}</b> <span class="muted">${esc(p.desc)}</span>`)}</div>`).join("");

    // statuses
    const statusRow = (id) => {
      const st = ctx.statuses[id];
      const set = s.status[id] || {};
      const srcSel = st.sources.length > 1
        ? sel(`status.${id}.src`, st.sources.map((x, i) => [i, `${x[0]}${typeof x[1] === "number" && st.def.potency ? " (" + fmt(x[1], 2) + ")" : ""}`]), st.src)
        : `<span class="muted">${esc(st.sources[0][0])}</span>`;
      const pot = st.def.potency ? `<span class="lab">potency</span>${num(`status.${id}.pot`, set.pot, `step="0.05" min="0" placeholder="${fmt(st.sources[st.src][1], 2)}"`)}` : "";
      return `<div class="opt-row">${chk(`status.${id}.on`, st.on, esc(st.def.name))}${srcSel}${pot}</div>`;
    };
    const selfSt = Object.keys(ctx.statuses).filter((id) => ctx.statuses[id].def.side === "self");
    const targetSt = Object.keys(ctx.statuses).filter((id) => ctx.statuses[id].def.side === "target");

    // DoTs
    const dotRows = Object.keys(Dmg.DOTS).filter((k) => ctx.dotSources[k].length).map((k) => {
      const p = ctx.S.potency[k];
      return `<div class="opt-row">${chk(`dots.${k}.on`, s.dots[k].on, `<b>${k}</b>`)}
        <span class="lab">source potency</span>${num(`dots.${k}.potency`, s.dots[k].potency, 'step="0.1" min="0"')}
        <span class="muted">from ${esc(ctx.dotSources[k].slice(0, 4).join(", "))}${ctx.dotSources[k].length > 4 ? "…" : ""}${p ? ` · +${fmt(0.1 * p, 2)} potency, ×${fmt(Dmg.potencyMult(p), 3)} dmg (${k} Potency ${fmt(p, 2)})` : ""}</span></div>`;
    }).join("");

    // perks
    const owned = Object.values(FX().PERKS).filter((pk) => ctx.perks[pk.id]);
    const perkRows = owned.map((pk) => {
      const on = s.perkOn[pk.id] === undefined ? pk.def : !!s.perkOn[pk.id];
      return `<div class="opt-row perk-row">${chk(`perkOn.${pk.id}`, on, `<b>${esc(perkName(pk.id))} +${fmt(ctx.perks[pk.id], 2)}</b>`)}<span class="muted">${esc(pk.label)}</span></div>`;
    }).join("");
    const auto = [...FX().ENGINE_PERKS, ...FX().FORM_PERKS].filter((id) => ctx.perks[id])
      .map((id) => `<span class="chip">${esc(perkName(id))} +${fmt(ctx.perks[id], 2)}</span>`).join("");

    // situation inputs needed by enabled perks
    const uses = new Set();
    owned.forEach((pk) => {
      const on = s.perkOn[pk.id] === undefined ? pk.def : !!s.perkOn[pk.id];
      if (on) pk.uses.forEach((u) => uses.add(u));
    });
    if (ctx.race.lowHpDamage) uses.add("selfHp");
    if (ctx.perks.perfection) uses.add("perfection");
    if (ctx.perks["blood-lust"]) uses.add("bloodlust");
    const sitRows = [...uses].filter((k) => FX().SITUATION[k] && !["hitsPer10", "blocksPer10"].includes(k)).map((k) => {
      const d = FX().SITUATION[k];
      const v = s.sit[k] === undefined ? d.def : s.sit[k];
      const input = d.options ? sel(`sit.${k}`, d.options.map((o) => [o, o]), v) : num(`sit.${k}`, v, `step="${d.step}" min="${d.min}" max="${d.max}"`);
      return `<label class="sit"><span>${esc(d.label)}</span>${input}</label>`;
    }).join("");
    const needSun = ["photosynthesis", "solar-light"].some((id) => ctx.perks[id]);
    const needShadow = ["vampire", "concealed-edge"].some((id) => ctx.perks[id]);
    const envRows = (needSun ? chk("sit.sun", s.sit.sun, "Standing in sunlight") : "") + (needShadow ? chk("sit.shadows", s.sit.shadows, "Standing in shadows / darkness") : "");

    const targetInputs = Object.keys(s.target).map((k) =>
      `<label class="def"><span class="outline" style="color:${TC[k]}">${k}</span>${num(`target.${k}`, s.target[k], 'step="5"')}</label>`).join("");
    const specialAtk = atks.find((a) => a.key === "special");

    // a foldable setup section; closed ones show a one-line summary instead of their controls
    const sec = (id, title, summary, body, head) => {
      const open = !tui.closed.has(id);
      return `<section class="cv-sec tsec${open ? " open" : ""}">
        <div class="cv-head"><button class="sec-toggle" data-toggle-sec="${id}" aria-expanded="${open}"><span class="caret">${open ? "▾" : "▸"}</span><h3 class="outline">${title}</h3></button>
          ${open ? head || "" : `<span class="sec-sum">${esc(summary || "")}</span>`}</div>
        ${open ? body : ""}</section>`;
    };
    const ATTACK_NAMES = { m1: "M1 combo", m2: "M2", art: "Weapon art", rune: "Rune", drac: "Draconic rune", special: "Special", potion: "Potion", custom: "Custom" };
    const onNames = (ids, name) => ids.filter(Boolean).map(name).join(", ");
    const statusOn = Object.keys(ctx.statuses).filter((id) => ctx.statuses[id].on).map((id) => ctx.statuses[id].def.name);
    const perksOn = owned.filter((pk) => (s.perkOn[pk.id] === undefined ? pk.def : !!s.perkOn[pk.id])).length;
    const rotOn = shownKeys.filter((k) => rot[k].on).map((k) => (countMode ? `${rot[k].count}× ` : "") + (["art", "rune", "drac"].includes(k) && byKey[k] ? byKey[k].name : ATTACK_NAMES[k]));
    const targetSum = Object.entries(s.target).filter(([, v]) => v).map(([k, v]) => `${k} ${v}%`).join(" · ") || "Dummy · no defenses";

    const prevSetup = A.$("viewTest").querySelector(".tv-setup");
    const keepTop = prevSetup ? prevSetup.scrollTop : 0;
    A.$("viewTest").innerHTML = `
      <div class="tv-grid">
        <div class="tv-setup">
          ${!wpn.parts.length ? `<div class="cv-warn">No weapon set — using 1-Handed Sword moves with Physical damage and no scaling. Build one in the CHARACTER tab.</div>` : ""}
          ${sec("attack", "ATTACK", `${ATTACK_NAMES[s.attack]} · crits ${s.crit}`, `
            <div class="mode-tabs wrap">
              ${btn("attack", "m1", "M1 COMBO", s.attack === "m1")}
              ${btn("attack", "m2", "M2", s.attack === "m2")}
              ${btn("attack", "art", "WEAPON ART", s.attack === "art", !has("art"))}
              ${btn("attack", "rune", "RUNE", s.attack === "rune", !has("rune"))}
              ${has("drac") ? btn("attack", "drac", "DRACONIC", s.attack === "drac") : ""}
              ${has("special") ? btn("attack", "special", "SPECIAL", s.attack === "special") : ""}
              ${has("potion") ? btn("attack", "potion", "POTION", s.attack === "potion") : ""}
              ${btn("attack", "custom", "CUSTOM", s.attack === "custom")}
            </div>
            <div class="opt-row"><span class="lab">Crits</span><span class="mode-tabs">${btn("crit", "avg", "AVERAGE", s.crit === "avg")}${btn("crit", "always", "ALWAYS", s.crit === "always")}${btn("crit", "never", "NEVER", s.crit === "never")}</span></div>
            <div class="form-line"><b>${esc(f.m1 === f.m2 ? f.m1 : `${f.m1} / ${f.m2}`)}</b> <span class="muted">M1 ${esc(V().comboText(f.m1Moves))} · M2 ${esc(V().movesText(f.m2Moves))}${mods.m2Override ? ` → ${esc(mods.m2Override.name)}` : ""}${f.notes.length ? " · " + f.notes.map(esc).join(" · ") : ""}</span></div>
            ${specialAtk && s.attack === "special" ? `<div class="opt-row"><span class="lab">Special attack</span>${sel("spirit", specialAtk.specials, specialAtk.specialId)}</div>` : ""}
            <div class="form-grid">
              <label><span>Base swing time (s)</span>${num("swingTime", s.swingTime, 'step="0.05" min="0.1"')}</label>
              <label><span>Extra attack speed %</span>${num("perkAtkSpeed", s.perkAtkSpeed, 'step="5"')}</label>
              <label><span>Other damage bonus %</span>${num("dmgBonus", s.dmgBonus, 'step="5"')}</label>
              ${s.attack === "custom" ? `<label><span>Custom base damage</span>${num("customBase", s.customBase, 'step="0.5" min="0"')}</label>
              <label><span>Custom hits</span>${num("customHits", s.customHits, 'step="1" min="1"')}</label>` : ""}
            </div>`)}
          ${sec("rotation", "ROTATION", `${countMode ? "By count" : `On cooldown · ${s.duration}s`} · ${rotOn.join(" › ") || "nothing ticked"}`, `
            ${countMode ? "" : `<div class="opt-row"><span class="lab">Fight length (s)</span>${num("duration", s.duration, 'step="5" min="5" max="300"')}</div>`}
            <div class="rot-grid${countMode ? " count" : ""}">
              <span class="rot-h">ORDER</span><span class="rot-h">ACTION</span>${countMode ? `<span class="rot-h">TIMES</span>` : ""}
              ${rotRows}
            </div>
            <div class="muted rot-hint">${countMode
              ? "Each ticked action runs that many times, top first; one on cooldown lets the next go. DPS = total ÷ time taken."
              : "Ready actions fire top first; ones above the M1 combo cut into it, ones below wait for it to finish."}${spiritGated ? " The spirit fires at full Spiritual Energy." : ""}</div>
            ${timingRows ? `<details class="steps sub-fold"${tui.closed.has("timing") ? "" : " open"} data-fold="timing"><summary class="outline">TIMING <span class="muted">cast = locked · active = hits keep landing (longer = move-stackable) · blank = estimate</span></summary>
            <div class="tim-list">${timingRows}</div>
            ${spiritGated ? `<div class="opt-row"><span class="lab">Spiritual Energy to release the spirit</span>${num("spiritMax", s.spiritMax, 'step="5" min="1"')}</div>` : ""}</details>` : ""}`,
            `<div class="mode-tabs">${btn("rotMode", "time", "ON COOLDOWN", !countMode)}${btn("rotMode", "count", "BY COUNT", countMode)}</div>`)}
          ${sec("target", "TARGET", targetSum, `<div class="def-grid">${targetInputs}</div>`,
            `<div class="mode-tabs"><button class="mode-tab outline" data-reset-target>DUMMY</button></div>`)}
          ${sec("status", "STATUS EFFECTS", statusOn.join(", ") || (selfSt.length || targetSt.length ? "none on" : "none in your build"), `
            ${selfSt.length ? `<div class="sub-h outline">ON YOU</div>${selfSt.map(statusRow).join("")}` : ""}
            ${targetSt.length ? `<div class="sub-h outline">ON TARGET</div>${targetSt.map(statusRow).join("")}` : ""}
            ${!selfSt.length && !targetSt.length ? `<div class="muted">Nothing in your build (or picked potions) applies a damage-relevant status.</div>` : ""}`)}
          ${sec("dots", "DAMAGE OVER TIME", onNames(Object.keys(Dmg.DOTS).filter((k) => ctx.S.target[k]), (k) => k) || (dotRows ? "off" : "no source in your build"), `
            ${dotRows || `<div class="muted">No Burn, Bleed or Poison source in your build.</div>`}
            ${dotRows ? `<div class="muted">Assumed applied for the whole fight; also counts the target as Burning/Bleeding/Poisoned for perks.</div>` : ""}`)}
          ${sec("perks", "PERKS", `${perksOn} of ${owned.length} damage perks on`, `
            ${perkRows || `<div class="muted">No perk in your build changes damage in a way the simulator models yet.</div>`}
            ${auto ? `<div class="sub-h outline">ALWAYS APPLIED</div><div class="chips">${auto}</div>` : ""}`)}
          ${sec("potions", "POTIONS", onNames(FX().POTIONS.filter((p) => s.potions[p.id]), (p) => p.name) || "none", `
            ${potions}
            ${ctx.perks["potion-chugger"] ? `<div class="muted">Potion Chugger: potions ×${fmt(ctx.potionMult, 2)} potency</div>` : ""}`)}
          ${sitRows || envRows ? sec("situation", "SITUATION", `${[...uses].filter((k) => FX().SITUATION[k] && !["hitsPer10", "blocksPer10"].includes(k)).length} inputs for your perks`, `<div class="sit-grid">${sitRows}</div>${envRows}`) : ""}
          ${sec("incoming", "INCOMING DAMAGE", `${atkNow.name} · ${inc.per10}/10s · block ${inc.blockPct}%`, survivalRows)}
        </div>
        <div class="tv-results" id="testResults"></div>
      </div>`;
    A.$("viewTest").querySelector(".tv-setup").scrollTop = keepTop; // re-rendering keeps your place in the setup pane
    renderResults(A);
  }

  // ------------------------------------------------------------ results column
  function renderResults(A) {
    const { esc, Dmg } = A;
    const { s, ctx, mods, totals } = state(A);
    const atks = Dmg.attacks(ctx, mods, s);
    const atk = atks.find((a) => a.key === s.attack) || atks[0];
    const rage = Dmg.ragePotency(ctx, false);
    const as = Dmg.attackSpeed(ctx, mods, s);
    const box = A.$("testResults");
    const add = (into, from, m) => { Object.entries(from || {}).forEach(([t, v]) => { into[t] = (into[t] || 0) + v * (m === undefined ? 1 : m); }); return into; };

    let hitCard, hitTop = null;
    if (!atk.hits || !atk.hits.length) {
      hitCard = `<div class="res-card"><div class="res-title outline">${esc(atk.name)}</div><div class="muted">No documented damage${atk.applies ? " — it applies " + esc(atk.applies.map((x) => x.status + (x.potency ? " " + x.potency : "")).join(", ")) : ""}.</div></div>`;
    } else {
      const h = Dmg.hit(ctx, mods, s, atk, { rage });
      hitTop = h;
      const procs = Dmg.procsFor(ctx, mods, s, atk, h, { rage, charges: 20, marked: true, interval: as.swingTime });
      const extras = [...h.echoes, ...procs].filter((x) => x.dmg > 0.0005);
      const extra = extras.reduce((a, x) => a + x.dmg, 0);
      const all = add({}, h.expByType);
      extras.forEach((x) => add(all, x.byType));
      let per = h.hits > 1 ? `<div class="muted">${fmt(h.hits, 0)} hits · ${fmt(h.expected / h.hits, 2)} per hit</div>` : "";
      if (atk.swings) {
        per = `<div class="swing-list">${atk.swings.map((sw) => {
          const r = Dmg.hit(ctx, mods, s, sw, { rage });
          return `<div class="step"><span>${sw.name}${sw.finisher ? " (finisher)" : ""}: <b>${fmt(r.expected)}</b></span>${typeChips(esc, r.expByType)}</div>`;
        }).join("")}</div>`;
      }
      const extraRows = extras.map((x) => `<div class="step col"><span><b class="ename">${esc(x.name)}</b> +${fmt(x.dmg, 2)}</span>${typeChips(esc, x.byType)}</div>`).join("");
      const steps = [
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
      hitCard = `<div class="res-card">
        <div class="res-title outline">${esc(atk.name)}${atk.cooldown ? ` <span class="muted">· ${atk.cooldown}s CD</span>` : ""}</div>
        <div class="big-row">
          <div><span class="lab">${s.crit === "avg" ? "EXPECTED" : s.crit === "always" ? "CRIT" : "NO CRIT"}</span><b class="big outline">${fmt(h.expected)}</b></div>
          <div><span class="lab">NORMAL</span><b class="mid outline">${fmt(h.normal)}</b><span class="lab">CRIT</span><b class="mid outline" style="color:#ffd84a">${fmt(h.critHit)}</b></div>
          <div><span class="lab">WITH PROCS</span><b class="big outline" style="color:#ff9a3c">${fmt(h.expected + extra)}</b><span class="muted">+${fmt(extra)} procs/echoes</span></div>
        </div>
        <div class="sub-h outline">DAMAGE TYPES (HIT)</div>
        <div class="bars">${typeBars(esc, h.expByType)}</div>
        ${per}
        ${extraRows ? `<details class="steps" open><summary class="outline">PROCS &amp; ECHOES</summary>${extraRows}</details>` : ""}
        ${extraRows ? `<div class="sub-h outline">DAMAGE TYPES (HIT + PROCS)</div><div class="bars">${typeBars(esc, all)}</div>` : ""}
        <details class="steps"><summary class="outline">FORMULA</summary>${steps.map(([k, v]) => `<div class="step"><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join("")}</details>
      </div>`;
    }

    const sim = Dmg.simulate(ctx, mods, s);
    const dots = Object.keys(Dmg.DOTS).filter((k) => ctx.S.target[k]).map((k) => {
      const d = Dmg.dot(ctx, mods, s, k, rage);
      return `<div class="step col"><span><b class="ename">${k}</b> ${fmt(d.perSecond, 2)} dmg/s <span class="muted">· potency ${fmt(d.potency, 2)}${d.potencyPerk ? ` · ×${fmt(d.potencyMult, 3)} from ${k} Potency ${fmt(d.potencyPerk, 2)}` : ""} · ${fmt(d.perSecond * sim.T, 0)} over ${fmt(sim.T, 2)}s</span></span>${typeChips(esc, d.byType)}</div>`;
    }).join("");
    const ticks = Dmg.ticks(ctx, mods, s, rage).map((x) => `<div class="step col"><span><b class="ename">${esc(x.name)}</b> ${fmt(x.perSecond, 2)} dmg/s</span>${typeChips(esc, x.byType)}</div>`).join("");

    const sus = Dmg.sustained(ctx, mods, s);
    const ROT_NAMES = { m1: ["M1 combo", "M1 combos"], m2: ["M2", "M2s"], art: ["weapon art", "weapon arts"], rune: ["rune", "runes"], drac: ["draconic rune", "draconic runes"], special: ["special", "specials"], custom: ["custom attack", "custom attacks"] };
    const used = Object.entries(sim.done).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${ROT_NAMES[k][n === 1 ? 0 : 1]}`).join(" · ");
    const runLine = sim.mode === "count"
      ? (used ? `Run: ${used} in ${fmt(sim.T, 2)}s${sim.capped ? " (stopped at the 600s limit)" : ""}` : "Tick at least one action with a count above 0 to start the run.")
      : (used ? `In ${fmt(sim.T, 0)}s: ${used}` : "Tick at least one action in ROTATION.");
    const art = atks.find((a) => a.key === "art"), rune = atks.find((a) => a.key === "rune");

    const SUP = window.VoxlSupport;
    const sup = SUP.evaluate(ctx, mods, s, sim, Dmg);
    const D = sup.defense, Hh = sup.healing, Sm = sup.summons;
    const P = (id) => ctx.perks[id] || 0;
    const timingLine = Object.entries(sim.timing || {}).filter(([k, t]) => k !== "m1" && sim.done[k] && t.active > t.cast + 1e-6)
      .map(([k, t]) => `${esc(k === "art" ? (art ? art.name : "Art") : k === "rune" ? (rune ? rune.name : "Rune") : k)} locks you ${fmt(t.cast, 2)}s, hits over ${fmt(t.active, 2)}s`).join(" · ");
    const factorRows = D.factors.map(([n, m]) => `<div class="step"><span>${esc(n)}</span><b>${m === null ? "" : "×" + fmt(m, 3)}</b></div>`).join("");
    const groupTitle = { defense: "DEFENSE", healing: "HEALING", summons: "MINIONS", poise: "POISE", utility: "UTILITY" };
    const perkCards = Object.entries(sup.rows).filter(([, l]) => l.length).map(([g, l]) => `<div class="sub-h outline">${groupTitle[g]}</div>` +
      l.map((r) => `<div class="step col"><span><b class="ename">${esc(r.name)} +${fmt(r.amt, 2)}</b> ${esc(r.text)}</span></div>`).join("")).join("");
    const survivalCard = `<div class="res-card">
        <div class="res-title outline">SURVIVAL <span class="muted">· ${esc(D.attack.name)} (${fmt(D.raw, 1)})</span></div>
        <div class="big-row">
          <div><span class="lab">TAKEN PER HIT</span><b class="big outline" style="color:#ff8a8a">${fmt(D.perHit, 2)}</b><span class="muted">${fmt(D.takenPct, 1)}% of the hit</span></div>
          <div><span class="lab">TAKEN PER SECOND</span><b class="big outline" style="color:#ffb27a">${fmt(D.perSec, 2)}</b><span class="muted">${fmt(D.hitsPerSec * 10, 0)} attacks per 10s${Number.isFinite(D.hitsToDie) ? ` · dead in ${D.hitsToDie} hits` : ""}</span></div>
          <div><span class="lab">HEALING PER SECOND</span><b class="big outline" style="color:#6dff9a">${fmt(Hh.total, 2)}</b><span class="muted">net ${fmt(Hh.total - D.perSec, 2)}/s</span></div>
        </div>
        <div class="muted">Max HP ${fmt(D.maxHp, 0)}${D.shield ? ` · shield ${fmt(D.shield, 0)} absorbs 75% for ~${fmt(D.hitsToBreak, 1)} hits` : ""} · effective HP ${Number.isFinite(D.ehp) ? fmt(D.ehp, 0) : "∞"} · stun ${fmt(D.stun.raw, 2)}s → ${fmt(D.stun.after, 2)}s${D.stun.bulwark ? " (Bulwark)" : ""}${D.stun.artCast !== null ? ` (${fmt(D.stun.artCast, 2)}s while casting)` : ""} · DoTs on you ×${fmt(D.dotTaken, 3)} · debuff potency on you ×${fmt(D.debuffPotency, 3)}</div>
        <details class="steps"><summary class="outline">DAMAGE TAKEN STEPS</summary>${factorRows}</details>
        ${Hh.list.length ? `<div class="sub-h outline">HEALING</div>${Hh.list.map(([n, v, note]) => `<div class="step"><span>${esc(n)} <span class="muted">${esc(note || "")}</span></span><b>${fmt(v, 2)}/s</b></div>`).join("")}
        <div class="muted">Healing ×${fmt(Hh.mult, 3)} (Heal Boost, Holy Tides, Critical Healing) · level ×${fmt(Hh.lvlMult, 3)}</div>` : ""}
        ${SUP.GROUPS.summons.some(P) ? `<div class="sub-h outline">MINIONS</div>
        <div class="step"><span>${fmt(Sm.count, 0)} minion${Sm.count === 1 ? "" : "s"} (cap ${Sm.cap}) · damage ×${fmt(Sm.dmgMult, 2)} · HP ${fmt(Sm.hp, 0)}</span><b>${fmt(Sm.dps, 1)} dmg/s</b></div>` : ""}
        ${sup.poise.mult !== 1 || sup.poise.parry ? `<div class="muted">Poise damage ×${fmt(sup.poise.mult, 3)}${sup.poise.parry ? ` · parry ${sup.poise.parry} poise` : ""}</div>` : ""}
      </div>`;

    // classify every perk the build has
    const fx = FX();
    const sources = fx.sourcePerks();
    const groups = { status: [], attack: [], none: [], missing: [] };
    Object.values(totals.perks).forEach((pk) => {
      const id = pk.id;
      if (fx.PERKS[id] || fx.ENGINE_PERKS.includes(id) || fx.FORM_PERKS.includes(id) || fx.STAT_PERKS.includes(id) || SUP.PERK_IDS.includes(id)) return;
      const name = A.perkInfo(id, pk.name).name;
      if (fx.SPIRITS[id] || fx.EXTRA_ATTACKS[id]) groups.attack.push(name);
      else if (sources.has(id)) groups.status.push(name);
      else {
        const tags = ((window.VOXL_DATA.perks[id] || {}).tags) || [];
        (tags.some((t) => OFFENSIVE_TAGS.includes(t)) ? groups.missing : groups.none).push(name);
      }
    });
    const chips = (l) => `<div class="chips">${l.map((n) => `<span class="chip">${esc(n)}</span>`).join("")}</div>`;

    const extraNow = hitTop ? Dmg.procsFor(ctx, mods, s, atk, hitTop, { rage, charges: 20, marked: true, interval: as.swingTime }).reduce((q, x) => q + x.dmg, 0) + hitTop.echoTotal : 0;
    const tab = ["hit", "dps", "survival", "perks"].includes(tui.tab) ? tui.tab : "hit";
    const kpi = (id, lab, val, sub, color) => `<button class="kpi${tab === id ? " on" : ""}" data-test-tab="${id}" aria-pressed="${tab === id}">
      <span class="lab">${lab}</span><b class="outline" style="color:${color}">${val}</b><span class="kpi-sub">${sub}</span></button>`;
    const modeled = Object.values(sup.rows).reduce((q, l) => q + l.length, 0);
    const dpsTab = `
      ${dots || ticks ? `<div class="res-card"><div class="res-title outline">DAMAGE OVER TIME &amp; AURAS</div>${dots}${ticks}</div>` : ""}
      <div class="res-card">
        <div class="res-title outline">DPS</div>
        <div class="big-row">
          <div><span class="lab">SUSTAINED</span><b class="big outline">${fmt(sus.dps)}</b><span class="muted">melee ${fmt(sus.m1)} + DoT ${fmt(sus.dots)}</span></div>
          <div><span class="lab">AVERAGE (${fmt(sim.T, 2)}s)</span><b class="big outline" style="color:#6dff9a">${fmt(sim.avg)}</b><span class="muted">${sim.mode === "count" ? "total ÷ time taken" : "with rotation"}</span></div>
          <div><span class="lab">PEAK SECOND</span><b class="mid outline" style="color:#ffd84a">${fmt(sim.peak)}</b><span class="muted">total ${fmt(sim.total, 0)}</span></div>
        </div>
        <div class="run-line">${esc(runLine)}</div>
        ${timingLine ? `<div class="muted">${timingLine}</div>` : ""}
        <div class="muted">Swing every ${fmt(as.swingTime, 3)}s (weapon ${fmt(as.weaponSpeed, 2)} × stat ${fmt(as.statMult, 3)} × perks +${fmt(as.perkPct, 1)}%${as.timeMult !== 1 ? ` ÷ ${fmt(as.timeMult, 2)}` : ""})${art && art.cooldown ? ` · ${esc(art.name)} every ${art.cooldown}s` : ""}${rune && rune.cooldown ? ` · ${esc(rune.name)} every ${rune.cooldown}s` : ""}</div>
        ${chart(sim)}
        <div class="legend">${Object.keys(SOURCE_NAMES).filter((k) => sim.bySource[k] > 0).map((k) =>
          `<span><i style="background:${SOURCE_COLORS[k]}"></i>${SOURCE_NAMES[k]} ${fmt((sim.bySource[k] / Math.max(1, sim.total)) * 100, 0)}%</span>`).join("")}</div>
        <div class="sub-h outline">DAMAGE BY TYPE (WHOLE FIGHT)</div>
        <div class="bars">${typeBars(esc, sim.typeTotals)}</div>
        <div class="muted">Toggled buffs count as active for the whole fight; the Rage Rune only during its windows. Only one action at a time: each locks you for its cast time.</div>
      </div>
    `;
    const perksTab = `${perkCards ? `<div class="res-card steps"><div class="res-title outline">DEFENSE, HEALING, MINION &amp; UTILITY PERKS</div>${perkCards}</div>` : `<div class="res-card"><div class="muted">No defense, healing, minion or utility perks in your build.</div></div>`}
      ${groups.status.length || groups.attack.length || groups.none.length || groups.missing.length ? `<details class="res-card steps"><summary class="outline">OTHER PERKS IN YOUR BUILD</summary>
        ${groups.status.length ? `<div class="sub-h outline">PROVIDE A STATUS / DOT / POTENCY (SEE TOGGLES)</div>${chips(groups.status)}` : ""}
        ${groups.attack.length ? `<div class="sub-h outline">ADD AN ATTACK (SPECIAL)</div>${chips(groups.attack)}` : ""}
        ${groups.none.length || groups.missing.length ? `<div class="sub-h outline">NOT SIMULATED</div>${chips(groups.none.concat(groups.missing))}` : ""}
      </details>` : ""}`;
    box.innerHTML = `
      <div class="kpis">
        ${kpi("hit", esc(ATTACK_LABEL[atk.key] || "HIT"), hitTop ? fmt(hitTop.expected + extraNow) : "—", hitTop ? `${esc(atk.name)}` : "no damage", "#fff3dc")}
        ${kpi("dps", `AVG DPS`, fmt(sim.avg), `${fmt(sim.total, 0)} in ${fmt(sim.T, 2)}s`, "#6dff9a")}
        ${kpi("survival", "TAKEN / S", fmt(D.perSec, 1), `heal ${fmt(Hh.total, 1)}/s`, "#ff9a9a")}
        ${kpi("perks", "PERKS", String(modeled), "defense, heal, utility", "#ffd84a")}
      </div>
      <div class="tab-body">${tab === "hit" ? hitCard : tab === "dps" ? dpsTab : tab === "survival" ? survivalCard : perksTab}</div>`;
  }

  function chart(sim) {
    const W = 600, H = 150, pad = 20;
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
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Damage per second over the fight">
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

  function bindTest(A) {
    const root = A.$("viewTest");
    root.addEventListener("input", (e) => {
      const el = e.target.closest("[data-path]");
      if (!el || el.type === "checkbox" || el.tagName === "SELECT") return;
      setPath(A.build().test, el.dataset.path, read(el));
      A.save();
      renderResults(A);
    });
    root.addEventListener("toggle", (e) => {
      const d = e.target.closest && e.target.closest("[data-fold]");
      if (!d) return;
      if (d.open) tui.closed.delete(d.dataset.fold); else tui.closed.add(d.dataset.fold);
      saveUi();
    }, true);
    root.addEventListener("change", (e) => {
      const el = e.target.closest("[data-path]");
      if (!el || (el.type !== "checkbox" && el.tagName !== "SELECT")) return;
      setPath(A.build().test, el.dataset.path, el.dataset.path === "inc.enemy" ? el.value : read(el));
      if (el.dataset.path === "inc.enemy") A.build().test.inc.attack = "avg";
      A.save();
      renderTest(A);
    });
    root.addEventListener("click", (e) => {
      const tg = e.target.closest("[data-toggle-sec]");
      if (tg) {
        const id = tg.dataset.toggleSec;
        if (tui.closed.has(id)) tui.closed.delete(id); else tui.closed.add(id);
        saveUi();
        return renderTest(A);
      }
      const tb = e.target.closest("[data-test-tab]");
      if (tb) {
        tui.tab = tb.dataset.testTab;
        saveUi();
        renderResults(A);
        if (window.matchMedia("(max-width: 820px)").matches) A.$("testResults").scrollIntoView({ block: "start", behavior: "smooth" });
        return;
      }
      const el = e.target.closest("[data-set]");
      if (el && !el.disabled) {
        setPath(A.build().test, el.dataset.set, el.dataset.num !== undefined ? +el.dataset.val : el.dataset.val);
        A.save();
        return renderTest(A);
      }
      const mv = e.target.closest("[data-move]");
      if (mv && !mv.disabled) {
        // swap with the neighbouring visible row, keeping hidden actions where they were
        const test = A.build().test;
        const vis = [...new Set([...root.querySelectorAll("[data-move]")].map((b) => b.dataset.move))];
        const i = vis.indexOf(mv.dataset.move), j = i + +mv.dataset.dir;
        if (j < 0 || j >= vis.length) return;
        [vis[i], vis[j]] = [vis[j], vis[i]];
        let n = 0;
        test.rotOrder = A.Dmg.rotOrder(test).map((k) => (vis.includes(k) ? vis[n++] : k));
        A.save();
        return renderTest(A);
      }
      const et = e.target.closest("[data-enemy-target]");
      if (et) {
        const foe = window.VoxlSupport.enemyById()[et.dataset.enemyTarget];
        const tg = A.build().test.target;
        Object.keys(tg).forEach((k) => { tg[k] = (foe && foe.defenses[k]) || 0; });
        A.save();
        return renderTest(A);
      }
      if (e.target.closest("[data-reset-target]")) {
        Object.keys(A.build().test.target).forEach((k) => { A.build().test.target[k] = 0; });
        A.save();
        renderTest(A);
      }
    });
  }

  window.VoxlViews.test = { render: renderTest, bind: bindTest };
})();
