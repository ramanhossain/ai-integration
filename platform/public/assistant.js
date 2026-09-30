// AI-assistent. Een bolletje rechtsonder klapt uit tot invoerbalk (of Ctrl/Cmd+J); het gesprek
// opent als paneel rechts. Openen start altijd een nieuw gesprek en de assistent leest meteen
// de pagina (samenvatting + advies). Eerdere gesprekken staan in de geschiedenis (per browser).
// - In de proceseditor bouwt de assistent live mee: elke opdracht past het proces direct
//   op het canvas aan (met ongedaan maken). Opslaan blijft een eigen stap.
// - Elders ontwerpt hij nieuwe processen en beantwoordt hij vragen over status,
//   goedkeuringen, triggers, queues en datatabellen van de gekozen omgeving.
/* global VIEWS, S, api, esc, toast, go, markDirty, cleanDef */
(function () {
  const $d = (s) => document.querySelector(s);
  const dock = $d("#dock");
  const log = $d("#dock-log");
  const prompt = $d("#dock-prompt");
  const bar = $d("#askbar");
  const barInput = $d("#askbar-input");
  const PC = window.ProcessCanvas;
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* geen opslag */ } }
  };
  let open = false;
  let min = false;
  let width = store.get("aip.dock.w", 420);
  let canvases = [];
  let busy = false;
  let lastMode = null;
  let conv = null; // huidig gesprek { id, title, at, msgs: [{ role, html, def? }] }
  const HIST_KEY = "aip.chats";
  const loadHist = () => { const h = store.get(HIST_KEY, []); return Array.isArray(h) ? h : []; };
  function saveConv() {
    if (!conv || !conv.msgs.some((m) => m.role === "user")) return; // alleen echte gesprekken bewaren
    conv.at = new Date().toISOString();
    const h = loadHist().filter((c) => c.id !== conv.id);
    h.unshift(conv);
    let out = h.slice(0, 30);
    // localStorage is beperkt: oude gesprekken laten vallen tot het past.
    while (out.length) { try { localStorage.setItem(HIST_KEY, JSON.stringify(out)); break; } catch { out = out.slice(0, -1); } }
  }
  // Iconen in de vaste HTML invullen.
  document.querySelectorAll("#dock [data-ico], #askbar [data-ico]").forEach((b) => { b.innerHTML = window.ic(b.dataset.ico, b.id === "dock-go" ? 18 : 16); b.setAttribute("data-ico-done", ""); });

  const editorMode = () => S.view === "editor" && S.editor && S.canvas && !S.readonlyView;

  // ---------- menu in-/uitklappen ----------
  const navBtn = $d("#navtoggle");
  function setNav(collapsed) {
    document.body.classList.toggle("nav-collapsed", collapsed);
    navBtn.setAttribute("aria-expanded", String(!collapsed));
    store.set("aip.nav.collapsed", collapsed);
    if (S.canvas) setTimeout(() => S.canvas && S.canvas.fit(), 200);
  }
  setNav(store.get("aip.nav.collapsed", false));
  navBtn.addEventListener("click", () => setNav(!document.body.classList.contains("nav-collapsed")));

  // ---------- venster ----------
  // Paneel rechts: de inhoud (en het canvas) schuift op zodat alles zichtbaar blijft.
  function applySpace() {
    width = Math.max(320, Math.min(width, Math.max(360, window.innerWidth - 480)));
    const narrow = window.innerWidth <= 860;
    dock.style.setProperty("--dock-w", `${width}px`);
    document.documentElement.style.setProperty("--dock-space", open ? "0px" : "84px");
    document.documentElement.style.setProperty("--dock-space-r", open && !narrow ? `${width}px` : "0px");
    document.body.classList.toggle("dock-open", open);
    dock.classList.toggle("hide", !open);
    if (S.canvas) setTimeout(() => S.canvas && S.canvas.fit(), 80);
  }
  window.addEventListener("resize", () => { if (open) applySpace(); });
  // Openen (vanuit gesloten) begint altijd een nieuw gesprek; readPage=true laat de
  // assistent direct de huidige pagina lezen.
  function openDock(focus = true, opts = {}) {
    const wasOpen = open;
    open = true;
    min = false;
    applySpace();
    syncMode();
    refreshEngine();
    if (!wasOpen) newChat({ readPage: opts.readPage !== false });
    if (focus) setTimeout(() => prompt.focus(), 0);
  }
  function closeDock() {
    open = false;
    showHist(false);
    applySpace();
  }

  // Breedte verslepen aan de linkerrand van het paneel.
  $d("#dock-resize").addEventListener("pointerdown", (e) => {
    e.preventDefault();
    $d("#dock-resize").classList.add("on");
    const move = (ev) => {
      width = window.innerWidth - ev.clientX;
      applySpace();
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      $d("#dock-resize").classList.remove("on");
      store.set("aip.dock.w", width);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  });


  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-dock]");
    if (!b) return;
    e.preventDefault();
    const a = b.dataset.dock;
    if (a === "open") openDock();
    if (a === "toggle") (open ? closeDock() : openDock());
    if (a === "close") closeDock();
    if (a === "new") { if (!open) openDock(); else newChat({ readPage: true }); }
    if (a === "history") showHist(histEl.classList.contains("hide"));
  });
  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") {
      e.preventDefault();
      open ? closeDock() : openDock();
    }
  });

  // Bolletje onderaan: klik klapt de invoerbalk uit; versturen opent het gesprek.
  const barToggle = $d("#askbar-toggle");
  function setBar(expanded, focus = true) {
    bar.classList.toggle("collapsed", !expanded);
    barToggle.setAttribute("aria-expanded", String(expanded));
    barToggle.setAttribute("aria-label", expanded ? "Gesprek openen in het zijpaneel" : "AI-assistent uitklappen");
    barToggle.title = expanded ? "Gesprek openen (Ctrl/Cmd+J)" : "AI-assistent";
    if (expanded && focus) setTimeout(() => barInput.focus(), 180);
  }
  barToggle.addEventListener("click", () => {
    if (bar.classList.contains("collapsed")) setBar(true);
    else { setBar(false, false); openDock(); }
  });
  document.addEventListener("pointerdown", (e) => {
    if (!bar.classList.contains("collapsed") && !bar.contains(e.target) && !barInput.value.trim()) setBar(false, false);
  });
  bar.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); barInput.value = ""; setBar(false, false); barToggle.focus(); } });
  bar.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = barInput.value.trim();
    barInput.value = "";
    setBar(false, false);
    openDock(false, { readPage: !text });
    if (text) { prompt.value = text; send(); } else prompt.focus();
  });

  // Pagina AI-assistent: nieuw gesprek starten en eerdere gesprekken openen.
  VIEWS.assistant = async (main) => {
    const h = loadHist();
    main.innerHTML = `<div class="head"><div><h1>AI-assistent</h1><p>Ontwerpt integraties, beantwoordt vragen en leest de pagina die je bekijkt. Openen kan ook via het bolletje rechtsonder of Ctrl/Cmd+J.</p></div>
      <div class="row"><button class="btn" data-dock="new" data-ico-done>${window.ic("chatPlus")}<span>Nieuw gesprek</span></button></div></div>
      <div class="card"><div class="ch"><h3>${window.ic("history")} Eerdere gesprekken</h3></div><div class="cb">${h.length ? histListHtml(h) : '<div class="empty">Nog geen gesprekken.</div>'}</div></div>`;
  };

  // ---------- geschiedenis ----------
  const histEl = $d("#dock-hist");
  const histBtn = $d("#dock-hist-btn");
  const when = (iso) => { const d = new Date(iso); const today = new Date().toDateString() === d.toDateString(); return today ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : d.toLocaleDateString([], { day: "numeric", month: "short" }) + " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); };
  function histListHtml(h) {
    return `<ul class="hist-list">${h.map((c) => `<li class="${conv && c.id === conv.id ? "cur" : ""}"><button type="button" class="hist-open" data-hist-open="${esc(c.id)}"><b>${esc(c.title || "Gesprek")}</b><small>${esc(when(c.at))} · ${((n) => `${n} ${n === 1 ? "vraag" : "vragen"}`)(c.msgs.filter((m) => m.role === "user").length)}${c.page ? ` · ${esc(c.page)}` : ""}</small></button>${window.iconBtn("trash", "Gesprek verwijderen", `data-hist-del="${esc(c.id)}"`)}</li>`).join("")}</ul>`;
  }
  function showHist(on) {
    histBtn.setAttribute("aria-expanded", String(on));
    histEl.classList.toggle("hide", !on);
    if (!on) return;
    const h = loadHist();
    histEl.innerHTML = `<h4><span>Eerdere gesprekken</span></h4>${h.length ? histListHtml(h) : '<div class="empty">Nog geen eerdere gesprekken.</div>'}`;
  }
  document.addEventListener("click", (e) => {
    const o = e.target.closest("[data-hist-open]");
    if (o) {
      const c = loadHist().find((x) => x.id === o.dataset.histOpen);
      if (!c) return;
      if (!open) { open = true; applySpace(); syncMode(); refreshEngine(); }
      loadConv(c);
      showHist(false);
      return;
    }
    const d = e.target.closest("[data-hist-del]");
    if (d) {
      e.stopPropagation();
      const rest = loadHist().filter((x) => x.id !== d.dataset.histDel);
      store.set(HIST_KEY, rest);
      if (conv && conv.id === d.dataset.histDel) conv = { ...conv, id: newId() };
      if (!histEl.classList.contains("hide")) showHist(true);
      if (S.view === "assistant") VIEWS.assistant(document.getElementById("main"));
    }
  });
  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  function pageTitle() {
    if (editorMode()) return S.editor.def.integration;
    const h1 = document.querySelector("#main h1");
    return h1 ? h1.textContent.trim() : document.title;
  }
  function newChat(opts = {}) {
    saveConv();
    clearLog();
    showHist(false);
    conv = { id: newId(), title: "", at: new Date().toISOString(), page: pageTitle(), msgs: [] };
    lastMode = editorMode() ? `editor:${S.editor.def.integration}` : `page:${location.hash}`;
    if (opts.readPage && S.view !== "assistant") {
      if (editorMode()) welcome();
      readPage(undefined, { auto: true });
    } else welcome();
    prompt.focus();
  }
  function loadConv(c) {
    saveConv();
    clearLog();
    conv = JSON.parse(JSON.stringify(c));
    for (const m of conv.msgs) renderMsg(m);
    log.scrollTop = log.scrollHeight;
  }

  // ---------- context (editor of niet) ----------
  const CHIPS_GENERAL = [
    ["Status", "status"],
    ["Openstaande goedkeuringen", "openstaande goedkeuringen"],
    ["Triggers", "triggers"],
    ["Queues", "queues"],
    ["Datatabellen", "datatabellen"],
    ["Voorbeeld: webshop → ERP", "Stuur iedere nieuwe webshop-order naar het ERP. Controleer duplicaten op order-id en retry drie keer, daarna naar de dead-letter queue."]
  ];
  const CHIPS_EDITOR = [
    ["+ Validatie", "voeg een validatie toe op orderId en customer.email"],
    ["+ Duplicaatcheck", "voeg een duplicaatcheck op orderId toe"],
    ["+ HTTP-aanroep", "voeg een HTTP-aanroep toe naar https://api.voorbeeld.nl/orders"],
    ["+ E-mail", "stuur een e-mail naar ops@bedrijf.nl"],
    ["+ Datatabel", "sla op in tabel orderstatus"],
    ["Trigger: elke 5 min", "zet de trigger op elke 5 minuten"],
    ["Trigger: webhook", "zet de trigger op webhook /orders"],
    ["Retry 3×", "3 keer opnieuw proberen en daarna dead-letter"]
  ];
  function syncMode() {
    const mode = editorMode() ? `editor:${S.editor.def.integration}` : "general";
    const ctx = $d("#dock-ctx");
    const saveLbl = $d("#dock-save").closest("label");
    if (editorMode()) {
      ctx.textContent = `Bewerkt live: ${S.editor.def.integration}`;
      ctx.classList.remove("hide");
      saveLbl.classList.add("hide");
      prompt.placeholder = "Wat moet er aan dit proces veranderen? Bijv. “voeg een e-mail toe naar ops@bedrijf.nl na de validatie”";
      barInput.placeholder = `Pas ${S.editor.def.integration} aan met de AI-assistent…`;
    } else {
      ctx.classList.add("hide");
      saveLbl.classList.remove("hide");
      prompt.placeholder = "Beschrijf een integratie, of vraag: “status”, “openstaande goedkeuringen”, “triggers op PROD”";
      barInput.placeholder = "Vraag de AI-assistent of beschrijf een integratie…";
    }
    $d("#dock-chips").innerHTML = (editorMode() ? CHIPS_EDITOR : CHIPS_GENERAL).map(([l, v]) => `<button type="button" data-chip="${esc(v)}">${esc(l)}</button>`).join("");
  }
  // Andere pagina terwijl het gesprek open is: markeren; vragen gaan dan over de nieuwe pagina.
  function pageChanged() {
    syncMode();
    const m = editorMode() ? `editor:${S.editor.def.integration}` : `page:${location.hash}`;
    if (m === lastMode) return;
    lastMode = m;
    if (!open || !conv || !conv.msgs.length) return;
    const last = conv.msgs[conv.msgs.length - 1];
    const html = `Nu op: ${esc(pageTitle())}`;
    if (last.role === "sep") { last.html = html; const el = log.lastElementChild; if (el) el.innerHTML = html; saveConv(); }
    else add("sep", html);
  }
  window.addEventListener("hashchange", () => setTimeout(pageChanged, 400));
  // De editor kan pas na het laden in S.editor staan.
  setInterval(() => { const m = editorMode() ? `editor:${S.editor.def.integration}` : `page:${location.hash}`; if (m !== lastMode && lastMode && lastMode.startsWith("editor:") !== m.startsWith("editor:")) pageChanged(); }, 700);

  // ---------- berichten ----------
  function clearLog() {
    for (const c of canvases) c.destroy();
    canvases = [];
    log.innerHTML = "";
  }
  // Bericht toevoegen; wordt bewaard in het gesprek (behalve tijdelijke "typing").
  function add(role, html, extra = {}) {
    const m = { role, html, ...extra };
    if (conv && !/typing/.test(role)) {
      conv.msgs.push(m);
      if (role === "user" && (!conv.title || conv.autoTitle)) { conv.title = html.replace(/<[^>]+>/g, "").replace(/&[a-z#0-9]+;/gi, " ").slice(0, 80); conv.autoTitle = false; }
      if (role === "bot" && !conv.title && extra.pageRead) { conv.title = `Pagina: ${conv.page || pageTitle()}`; conv.autoTitle = true; }
      saveConv();
    }
    return renderMsg(m);
  }
  function renderMsg(m) {
    const el = document.createElement("div");
    el.className = `msg ${m.role}`;
    el.innerHTML = m.html;
    el._msg = m;
    log.appendChild(el);
    if (m.def) {
      const host = el.querySelector(".mini");
      if (host) { const c = PC.mount(host, { def: JSON.parse(JSON.stringify(m.def)), readonly: true }); c.fit(); canvases.push(c); }
    }
    log.scrollTop = log.scrollHeight;
    return el;
  }
  function welcome() {
    if (editorMode()) {
      add("bot", `Ik bouw live mee aan <b>${esc(S.editor.def.integration)}</b>. Zeg wat er moet veranderen en ik pas het proces direct op het canvas aan.
        <div class="hint" style="margin-top:6px">Bijvoorbeeld: “voeg een duplicaatcheck op orderId toe”, “stuur daarna een e-mail naar ops@bedrijf.nl”, “verwijder de e-mail”, “zet de trigger op elke 5 minuten”. Elke wijziging kun je ongedaan maken; opslaan doe je zelf.</div>`);
    } else {
      add("bot", `Hoi! Ik ontwerp integraties en beantwoord vragen over het platform op de gekozen omgeving (<span class="env ${S.env}">${S.env}</span>).
        <div class="hint" style="margin-top:6px">Ik lees steeds de pagina die je bekijkt; vraag gerust wat hier staat of wat beter kan. Open een proces in de editor om het live met mij aan te passen.</div>`);
    }
  }
  async function refreshEngine() {
    try {
      const a = await api("/api/v1/agents");
      $d("#dock-engine").textContent = a.claude.available ? `Claude · ${a.claude.model}` : "heuristiek (geen API-key)";
      $d("#dock-engine").className = `chip ${a.claude.available ? "ok" : "none"}`;
    } catch { /* stil */ }
  }

  $d("#dock-chips").addEventListener("click", (e) => {
    const c = e.target.closest("[data-chip]");
    if (!c) return;
    prompt.value = c.dataset.chip;
    send();
  });
  prompt.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
    if (e.key === "Escape") { e.stopPropagation(); closeDock(); }
  });
  $d("#dock-form").addEventListener("submit", (e) => { e.preventDefault(); send(); });

  function envFrom(text) {
    const m = text.toLowerCase().match(/\b(dev|test|acc|acceptatie|prod|productie)\b/);
    if (!m) return S.env;
    return { acceptatie: "acc", productie: "prod" }[m[1]] || m[1];
  }

  // ---------- live bewerken in de editor ----------
  // Nieuwe stappen een plek geven naast hun voorganger; volgende elementen schuiven op.
  function placeNew(def, before) {
    const byId = new Map(def.steps.map((s) => [s.id, s]));
    const posOf = (id) => (id === "start" ? def.layout && def.layout.start : byId.get(id) && byId.get(id).position);
    const fresh = def.steps.filter((s) => !s.position);
    for (const n of fresh) {
      const g = PC.geom(n);
      const inc = def.connections.find((c) => c.to === n.id && posOf(c.from));
      let x, y;
      if (inc) {
        const p = posOf(inc.from);
        const pg = PC.geom(inc.from === "start" ? { type: "start" } : byId.get(inc.from));
        x = p.x + pg.w + 110;
        y = p.y + pg.h / 2 - g.h / 2;
        // ruimte maken: alles rechts van de voorganger op ongeveer dezelfde rij schuift op
        const edge = p.x + pg.w - 5;
        for (const s of def.steps) {
          if (s === n || !s.position) continue;
          if (s.position.x >= edge && Math.abs(s.position.y + PC.geom(s).h / 2 - (y + g.h / 2)) < 120) s.position = { x: s.position.x + g.w + 110, y: s.position.y };
        }
      } else {
        const xs = def.steps.filter((s) => s.position).map((s) => s.position.x);
        x = (xs.length ? Math.max(...xs) : 100) + 210;
        y = 200;
      }
      n.position = { x: Math.round(x / 10) * 10, y: Math.round(y / 10) * 10 };
    }
    return fresh.map((s) => s.id).filter((id) => !before.has(id));
  }

  async function editLive(text) {
    const E = S.editor;
    const res = await api("/api/v1/agents/builder/edit", { body: { definition: cleanDef(E.def), prompt: text } });
    if (res.ask === "trigger") {
      const cur = E.def.trigger?.type || "manual";
      const msg = add("bot", `Hoe moet <b>${esc(E.def.integration)}</b> starten? Nu: <b>${esc((PC.TRIGGERS[cur] || { label: cur }).label)}</b>.
        <div class="row" style="margin-top:8px;gap:6px">${Object.entries(PC.TRIGGERS).map(([k, v]) => `<button class="btn sm ${k === cur ? "" : "sec"}" data-settrig="${k}">${esc(v.label)}</button>`).join("")}</div>
        <div class="hint" style="margin-top:6px">Je kunt het ook direct zeggen, bijv. “zet de trigger op API-endpoint”, “start dagelijks om 7 uur” of “maak er een queue-trigger van met queue orders”.</div>`);
      msg.querySelectorAll("[data-settrig]").forEach((b) => b.addEventListener("click", () => {
        if (S.editor !== E) return toast("De editor is gesloten", true);
        setProcessTrigger(b.dataset.settrig, false);
        if (S.canvas) S.canvas.flash(["start"]);
        msg.querySelectorAll("[data-settrig]").forEach((x) => x.classList.toggle("sec", x !== b));
        const m2 = add("bot", `Trigger gewijzigd naar <b>${esc(PC.TRIGGERS[b.dataset.settrig].label)}</b>. <button class="btn sm sec" data-cfgstart>Details instellen</button>`);
        m2.querySelector("[data-cfgstart]").addEventListener("click", () => openNode("start"));
      }));
      return;
    }
    if (!res.understood) {
      add("bot", `Dat kon ik niet vertalen naar een wijziging. Probeer bijvoorbeeld “voeg een e-mail toe naar ops@bedrijf.nl”, “verwijder de duplicaatcheck” of “zet de trigger op elke 5 minuten”.${res.by === "heuristic" ? '<div class="hint">Met een Claude API-key (ANTHROPIC_API_KEY) begrijp ik vrije opdrachten veel beter.</div>' : ""}`);
      return;
    }
    if (S.editor !== E || !S.canvas) { add("bot", "De editor is intussen gesloten; de wijziging is niet toegepast."); return; }
    S.canvas.pushHistory();
    const before = new Set(E.def.steps.map((s) => s.id));
    const oldPos = Object.fromEntries(E.def.steps.map((s) => [s.id, s.position]));
    const oldSig = Object.fromEntries(E.def.steps.map((s) => [s.id, JSON.stringify([s.name, s.type, s.config])]));
    const oldTrigger = JSON.stringify(E.def.trigger || {});
    const oldLayout = E.def.layout;
    const nd = res.definition;
    for (const k of Object.keys(E.def)) delete E.def[k];
    Object.assign(E.def, nd);
    const keepLayout = before.size && E.def.steps.some((s) => before.has(s.id));
    if (keepLayout) {
      E.def.layout = E.def.layout || oldLayout;
      for (const s of E.def.steps) if (!s.position && oldPos[s.id]) s.position = oldPos[s.id];
      placeNew(E.def, before);
    } else {
      for (const s of E.def.steps) delete s.position;
      delete E.def.layout;
    }
    PC.normalize(E.def);
    S.canvas.redraw();
    S.canvas.fit();
    markDirty();
    if (typeof refreshTriggerBtn === "function") refreshTriggerBtn();
    const added = E.def.steps.filter((s) => !before.has(s.id));
    const changedIds = E.def.steps.filter((s) => !before.has(s.id) || oldSig[s.id] !== JSON.stringify([s.name, s.type, s.config])).map((s) => s.id);
    if (JSON.stringify(E.def.trigger || {}) !== oldTrigger) changedIds.push("start");
    if (added.length) S.canvas.select(added[added.length - 1].id);
    S.canvas.flash(changedIds);
    const msg = add("bot", `Aangepast op het canvas <span class="faint">(${res.by === "claude" ? "Claude" : "heuristiek"})</span>:
      <ul class="changes">${res.changes.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>
      <div class="row" style="margin-top:6px"><button class="btn sm sec" data-undo>Ongedaan maken</button><button class="btn sm" data-act="ed-save">Opslaan als nieuwe versie</button><button class="btn sm sec" data-act="ed-execute">▶ Test</button></div>`);
    msg.querySelector("[data-undo]").addEventListener("click", (ev) => {
      if (!S.canvas || S.editor !== E) return toast("De editor is gesloten", true);
      S.canvas.undo();
      S.canvas.fit();
      ev.target.disabled = true;
      ev.target.textContent = "Ongedaan gemaakt";
    });
  }

  // ---------- pagina lezen en advies geven ----------
  // De assistent leest de hele pagina (tekst van #main, en een geopend detailvenster);
  // in de editor ook de actuele procesdefinitie. De server combineert dat met de echte
  // platformdata en geeft samenvatting, aandachtspunten en advies terug.
  function pageContext(question) {
    const main = document.getElementById("main");
    const h1 = main && main.querySelector("h1");
    const ctx = { view: S.view, env: S.env, title: h1 ? h1.textContent.trim() : document.title, text: main ? main.innerText.slice(0, 60000) : "" };
    if (S.param) ctx.param = String(S.param);
    if (S.view === "editor" && S.editor) { ctx.definition = cleanDef(S.editor.def); ctx.dirty = Boolean(S.editor.dirty); ctx.param = S.editor.def.integration; }
    const ndv = document.querySelector(".ndv");
    if (ndv) ctx.text += `\n\n[Geopend detailvenster]\n${ndv.innerText.slice(0, 20000)}`;
    if (question) ctx.question = question;
    return ctx;
  }
  const LEVEL = { risk: "Risico", warn: "Let op", info: "Tip", ok: "In orde" };
  async function pageAdvice(question) {
    const res = await api("/api/v1/agents/page/advise", { body: pageContext(question) });
    const f = res.findings || [];
    add("bot", `<div class="adv-h"><span aria-hidden="true">◎</span> ${esc(res.page)} <span class="faint">gelezen · ${res.by === "claude" ? "Claude" : "heuristiek"}</span></div>
      <div>${esc(res.answer || res.summary)}</div>
      ${res.answer && res.answer.indexOf(res.summary) < 0 ? `<div class="faint" style="font-size:.78rem;margin-top:4px">${esc(res.summary)}</div>` : ""}
      ${f.length ? `<ul class="adv-list">${f.map((x) => `<li><span class="dot ${esc(x.level)}" role="img" aria-label="${LEVEL[x.level] || ""}" title="${LEVEL[x.level] || ""}"></span><div><b>${esc(x.title)}</b>${x.detail ? `<div class="d">${esc(x.detail)}</div>` : ""}${x.go ? `<button class="btn sm sec" data-go="${esc(x.go)}">${esc(x.goLabel || "Openen")}</button>` : ""}</div></li>`).join("")}</ul>` : ""}
      ${(res.suggestions || []).length ? `<div class="adv-sug">${res.suggestions.map((x) => `<button type="button" data-ask="${esc(x)}">${esc(x)}</button>`).join("")}</div>` : ""}`, { pageRead: true });
  }
  async function readPage(question, opts = {}) {
    if (busy) return;
    busy = true;
    $d("#dock-go").disabled = true;
    if (!opts.auto) add("user", esc(question || "Lees deze pagina en geef advies"));
    const typing = add("bot typing", `Pagina lezen: ${esc(pageTitle())}…`);
    try { await pageAdvice(question); }
    catch (err) { add("bot", `<div class="ndv-err">✕ ${esc(err.message)}</div>`); }
    finally { typing.remove(); log.scrollTop = log.scrollHeight; busy = false; $d("#dock-go").disabled = false; prompt.focus(); }
  }
  log.addEventListener("click", (e) => {
    const b = e.target.closest("[data-ask]");
    if (b) { prompt.value = b.dataset.ask; send(); return; }
    if (e.target.closest("[data-readpage]")) { readPage(); return; }
    const sv = e.target.closest("[data-save-def]");
    if (sv) saveDesigned(sv);
  });
  async function saveDesigned(btn) {
    const el = btn.closest(".msg");
    const m = el && el._msg;
    if (!m || !m.def) return;
    try {
      const saved = await api("/api/v1/integrations", { body: m.def });
      const open = `<button class="btn sm" data-go="editor/${encodeURIComponent(saved.integration)}">Openen in editor</button>`;
      btn.outerHTML = open;
      m.html = m.html.replace(/<button class="btn sm" data-save-def>[^<]*<\/button>/, open);
      saveConv();
      toast(`Opgeslagen als v${saved.version} op DEV`);
    } catch (err) { toast(err.message, true); }
  }
  // Vragen over de pagina zelf (uitleg, advies, oorzaak) gaan naar de pagina-adviseur.
  const PAGE_Q = /(deze pagina|dit scherm|dit proces|deze uitvoering|wat zie ik|wat staat (hier|er)|advies|adviseer|leg (dit |het )?uit|uitleg|wat kan (er )?beter|verbeterpunten|waarom|klopt (dit|het)|veilig|klaar voor|aandacht|hoe los ik|oplossen|samenvat|wat moet ik|this page|this screen|this process|this run|what am i looking at|what is (this|on this)|advice|advise|recommend|explain|what could be better|improve|why\b|is (this|it) (correct|right|secure|safe)|secure|ready for|attention|how do i fix|fix this|summar|what should i)/i;

  // ---------- vragen en ontwerpen (buiten de editor) ----------
  async function answer(text) {
    const t = text.toLowerCase();
    const env = envFrom(text);
    const isQuestion = text.length <= 80 && /^(status|dashboard|hoe|wat|welke|toon|laat|lijst|openstaande|goedkeur|trigger|queue|datatab|tabellen|what|which|how|show|list|pending|approval|data ?table|tables|are|is|do|does|can)\b/i.test(text.trim());
    const endsQ = /\?\s*$/.test(text);
    if (PAGE_Q.test(text)) return pageAdvice(text);
    if (editorMode() && !isQuestion && !endsQ) return editLive(text);
    const isDesign = !isQuestion && (text.length > 80 || /^(maak|bouw|ontwerp|stuur|koppel|synchroniseer|haal|zet|lees|schrijf|verwerk|importeer|exporteer|verstuur|controleer|ik wil|make|build|create|design|send|sync|synchroni[sz]e|fetch|read|write|process|import|export|check|i want|i need)\b/i.test(text.trim()));
    if (isDesign) return design(text);
    if (/goedkeur|approval|akkoord|approve/.test(t)) {
      const list = await api("/api/v1/approvals?status=pending");
      if (!list.length) return add("bot", "Er staan geen goedkeuringen open.");
      return add("bot", `Er ${list.length === 1 ? "staat 1 goedkeuring" : `staan ${list.length} goedkeuringen`} open:
        <table><tbody>${list.slice(0, 8).map((a) => `<tr><td class="mono">${esc(a.action.type)}</td><td><span class="risk ${a.riskLevel}">${a.riskLevel}</span></td><td>${esc(a.action.target?.integration || "")}</td><td class="faint">${a.approvals.filter((x) => x.decision === "approve").length}/${a.requiredApprovals}</td></tr>`).join("")}</tbody></table>
        <div class="row" style="margin-top:6px"><button class="btn sm" data-go="approvals">Naar goedkeuringen</button></div>`);
    }
    if (/trigger/.test(t)) {
      const list = (await api("/api/v1/triggers")).filter((x) => x.env === env);
      if (!list.length) return add("bot", `Op <span class="env ${env}">${env}</span> is geen proces gedeployed, dus er draaien geen triggers.`);
      return add("bot", `Triggers op <span class="env ${env}">${env}</span>:
        <table><tbody>${list.map((x) => `<tr><td><b>${esc(x.integration)}</b></td><td>${esc((PC.TRIGGERS[x.type] || { label: x.type }).label)}</td><td>${x.type === "manual" ? '<span class="chip none">handmatig</span>' : x.paused ? '<span class="chip warn">gepauzeerd</span>' : '<span class="chip ok">actief</span>'}</td><td class="faint">${x.fires} runs · ${x.errors} fouten</td></tr>`).join("")}</tbody></table>
        <div class="row" style="margin-top:6px"><button class="btn sm" data-go="triggers">Naar triggers</button></div>`);
    }
    if (/queue|wachtrij/.test(t)) {
      const list = await api(`/api/v1/queues?env=${env}`);
      if (!list.length) return add("bot", `Er zijn nog geen queues op <span class="env ${env}">${env}</span>.`);
      return add("bot", `Queues op <span class="env ${env}">${env}</span>:
        <table><tbody>${list.map((q) => `<tr><td><b>${esc(q.queue)}</b></td><td>${q.depth} berichten</td><td class="faint">${q.processed} verwerkt · ${q.failed} mislukt</td></tr>`).join("")}</tbody></table>
        <div class="row" style="margin-top:6px"><button class="btn sm" data-go="queues">Naar queues</button></div>`);
    }
    if (/datatab|tabel|data ?table/.test(t)) {
      const list = await api(`/api/v1/datatables/${env}`);
      if (!list.length) return add("bot", `Er zijn nog geen datatabellen op <span class="env ${env}">${env}</span>.`);
      return add("bot", `Datatabellen op <span class="env ${env}">${env}</span>:
        <table><tbody>${list.map((d) => `<tr><td><b>${esc(d.name)}</b></td><td>${d.rowCount} rijen</td><td class="faint">${d.columns.map((c) => esc(c.name)).join(", ")}</td></tr>`).join("")}</tbody></table>
        <div class="row" style="margin-top:6px"><button class="btn sm" data-go="datatables">Naar datatabellen</button></div>`);
    }
    if (/\b(status|dashboard|fouten|monitor|hoe gaat|errors|how is|how are)\b/.test(t)) {
      const d = await api(`/api/v1/dashboard?env=${env}`);
      const r = d.runs;
      return add("bot", `Op <span class="env ${env}">${env}</span>: <b>${r.totalRuns}</b> uitvoeringen, succesratio <b>${r.successRate}%</b>, <b>${r.error}</b> fouten${r.deadLettered ? ` (${r.deadLettered} in dead-letter)` : ""}, gemiddeld ${r.avgDurationMs} ms.
        ${d.approvals.pending ? `<br>${d.approvals.pending} goedkeuring(en) staan open.` : ""}${d.incidents.open ? `<br>${d.incidents.open} incident(en) gemeld.` : ""}
        ${r.recentErrors.length ? `<div style="margin-top:6px" class="muted">Laatste fout: <b>${esc(r.recentErrors[0].integration)}</b> — ${esc(r.recentErrors[0].error || "")}</div>` : ""}
        <div class="row" style="margin-top:6px"><button class="btn sm" data-go="dashboard">Naar dashboard</button></div>`);
    }
    if (endsQ || isQuestion || editorMode()) return pageAdvice(text);
    return design(text);
  }

  async function design(text) {
    const save = $d("#dock-save").checked;
    const res = await api("/api/v1/agents/builder/design", { body: { prompt: text, register: save } });
    const def = res.integration;
    add("bot", `Ik heb <b>${esc(def.integration)}</b> ontworpen: ${def.steps.length} stappen, trigger ${esc((PC.TRIGGERS[def.trigger?.type] || { label: def.trigger?.type }).label)} <span class="faint">(${res.by === "claude" ? "Claude" : "heuristiek"})</span>.
      ${res.registered ? `Opgeslagen als versie op <span class="env dev">dev</span>.` : "Nog niet opgeslagen."}
      <div class="mini"></div>
      <div class="row">${res.registered ? `<button class="btn sm" data-go="editor/${encodeURIComponent(def.integration)}">Openen in editor</button>` : `<button class="btn sm" data-save-def>Opslaan op DEV</button>`}</div>`, { def });
    if (res.registered && S.view === "processes") window.dispatchEvent(new HashChangeEvent("hashchange"));
  }

  async function send() {
    const text = prompt.value.trim();
    if (!text || busy) return;
    busy = true;
    $d("#dock-go").disabled = true;
    add("user", esc(text));
    prompt.value = "";
    const typing = add("bot typing", editorMode() ? "Proces aanpassen…" : "Bezig…");
    try {
      await answer(text);
    } catch (err) {
      add("bot", `<div class="ndv-err">✕ ${esc(err.message)}</div>`);
    } finally {
      typing.remove();
      log.scrollTop = log.scrollHeight;
      busy = false;
      $d("#dock-go").disabled = false;
      prompt.focus();
    }
  }

  // "Aan chat toevoegen" vanuit het contextmenu: paneel openen met de stap als onderwerp.
  window.aipAssistant = {
    readPage(question) { openDock(false, { readPage: false }); readPage(question); },
    addNode(id, name) {
      openDock(false, { readPage: false });
      const label = id === "start" ? "het startevent" : `"${name}"`;
      add("bot", `Onderwerp: <b>${esc(id === "start" ? "startevent" : name)}</b>. Zeg wat er moet gebeuren, bijv. “voeg een e-mail toe na ${esc(label)}”, “verwijder ${esc(label)}” of “hernoem ${esc(label)} naar …”.`);
      prompt.value = id === "start" ? "" : ` na ${label}`;
      prompt.focus();
      prompt.setSelectionRange(0, 0);
    }
  };

  // Start: gesloten (openen begint altijd met een nieuw gesprek).
  applySpace();
  setTimeout(syncMode, 300);
})();
