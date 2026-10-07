// AIP Integratieplatform — GUI. Vanilla JS, praat alleen met de publieke API
// (dezelfde API die agents en externe systemen gebruiken).

// ---------- basis ----------
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
async function api(path, opts = {}) {
  const init = { ...opts, headers: { "x-aip-user": who(), "x-aip-lang": window.I18N ? window.I18N.lang : "nl", ...(opts.headers || {}) } };
  if (opts.body !== undefined) {
    init.method = opts.method || "POST";
    init.headers["content-type"] = "application/json";
    init.body = JSON.stringify(opts.body);
  }
  const r = await fetch(path, init);
  const body = await r.json().catch(() => ({}));
  if (r.status === 401 && !path.startsWith("/api/v1/auth/") && window.AIP_AUTH) window.AIP_AUTH.expired();
  if (!r.ok) throw new Error(body.error || body.message || r.statusText);
  return body;
}
function toast(msg, err) {
  const t = $("#toast");
  t.textContent = msg;
  t.className = "toast show" + (err ? " err" : "");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (t.className = "toast"), 3200);
}
const fmtTime = (iso) => (iso ? new Date(iso).toLocaleTimeString("nl-NL") : "—");
const fmtDateTime = (iso) => (iso ? new Date(iso).toLocaleString("nl-NL", { dateStyle: "short", timeStyle: "medium" }) : "—");
// Ingelogde gebruiker; zonder accounts (AIP_AUTH=off) de gekozen testgebruiker.
function who() { const me = window.AIP_ME; if (me && me.authEnabled && me.user) return me.user.email; const el = document.getElementById("approver"); return (el && el.value.trim()) || "anoniem"; }

const ENVS = [
  { id: "dev", label: "DEV", name: "Development", color: "var(--env-dev)" },
  { id: "test", label: "TEST", name: "Test", color: "var(--env-test)" },
  { id: "acc", label: "ACC", name: "Acceptatie", color: "var(--env-acc)" },
  { id: "prod", label: "PROD", name: "Productie", color: "var(--env-prod)" }
];
const envOf = (id) => ENVS.find((e) => e.id === id);

// Staptypes komen uit de procesontwerper (editor.js).
const STEP_TYPES = window.ProcessCanvas.TYPES;

const S = {
  env: localGet("aip.env") || "dev",
  view: "dashboard",
  param: null,
  editor: null, // { def, name, isNew, dirty, state, tab, lastRun, testInput }
  canvas: null,
  events: [],
  pending: 0
};
function localGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function localSet(k, v) { try { localStorage.setItem(k, v); } catch {} }

// ---------- omgevingswisselaar ----------
// Omgevingen zonder toegang zijn uitgeschakeld; alleen-lezen krijgt een oogje.
const envAccess = (id) => (window.AIP_AUTH ? window.AIP_AUTH.access(id) : "edit");
function renderEnvs() {
  if (envAccess(S.env) === "none") { const first = ENVS.find((e) => envAccess(e.id) !== "none"); if (first) S.env = first.id; }
  $("#envs").innerHTML = ENVS.map((e) => { const a = envAccess(e.id); return `<button data-env="${e.id}" class="${S.env === e.id ? "on" : ""}${a === "none" ? " noacc" : ""}" ${a === "none" ? "disabled" : ""} title="${e.name}${a === "none" ? " — geen toegang" : a === "view" ? " — alleen lezen" : ""}"><span class="sw" style="background:${e.color}"></span>${e.label}${a === "view" ? ' <span class="ro" aria-label="alleen lezen">👁</span>' : ""}</button>`; }).join("");
  document.querySelector(".top").style.setProperty("--env-color", envOf(S.env).color);
}
$("#envs").addEventListener("click", (e) => {
  const b = e.target.closest("[data-env]");
  if (!b) return;
  S.env = b.dataset.env;
  localSet("aip.env", S.env);
  renderEnvs();
  toast(`Omgeving: ${envOf(S.env).name}`);
  if (S.view === "instances") go(`instances/${S.env}`);
  else if (S.view === "files") go("files");
  else if (S.view !== "instance") render();
});

// ---------- modal ----------
function openModal(html) { $("#modal-box").className = "box"; $("#modal-box").innerHTML = html; $("#modal").classList.remove("hide"); }
function closeModal() { $("#modal").classList.add("hide"); $("#modal-box").innerHTML = ""; }
$("#modal").addEventListener("click", (e) => { if (e.target.id === "modal" || e.target.closest("[data-close]")) closeModal(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });

// ---------- plugins (connectors) voor de editor ----------
async function loadPluginList() {
  try {
    const r = await api("/api/v1/plugins?status=beschikbaar");
    window.AIP_PLUGINS = r.items.map((p) => ({ id: p.id, name: p.name, category: p.category, description: p.description, color: p.color }));
    if (S.canvas && S.canvas.redraw) S.canvas.redraw();
  } catch { window.AIP_PLUGINS = []; }
}

// ---------- meervoudige selectie in tabellen ----------
// Rij: selCell(sleutel); kop: selHead(); actiebalk: bulkBar(scope, acties) in dezelfde .card.
// Klik met Shift selecteert een reeks. Acties komen binnen via BULK[scope][actie](sleutels, knop).
const selHead = () => `<th class="selc"><input type="checkbox" data-selall aria-label="Alles selecteren"></th>`;
const selCell = (key, label) => `<td class="selc"><input type="checkbox" data-sel="${esc(key)}" aria-label="Selecteer ${esc(label || key)}"></td>`;
const bulkBar = (scope, actions) => `<div class="bulkbar hide" data-bulkbar="${scope}" role="region" aria-label="Acties voor de selectie"><b class="n" aria-live="polite"></b>
  ${actions.map(([act, label, cls, icon]) => icon ? `<button class="btn sm ${cls || "sec"} icon" data-bulk="${act}" data-ico-done title="${esc(label)}" aria-label="${esc(label)}">${ic(icon)}</button>` : `<button class="btn sm ${cls || "sec"}" data-bulk="${act}">${label}</button>`).join("")}<span style="flex:1"></span><button class="btn sm sec" data-bulk="__clear">Selectie opheffen</button></div>`;
const BULK = {};
let lastSelIdx = null;
function selScope(el) { return el.closest(".card") || document; }
function selected(scopeEl) { return [...scopeEl.querySelectorAll("[data-sel]:checked")].map((i) => i.dataset.sel); }
function syncBulk(scopeEl) {
  const boxes = [...scopeEl.querySelectorAll("[data-sel]")];
  const n = boxes.filter((b) => b.checked).length;
  const all = scopeEl.querySelector("[data-selall]");
  if (all) { all.checked = n > 0 && n === boxes.length; all.indeterminate = n > 0 && n < boxes.length; }
  boxes.forEach((b) => b.closest("tr")?.classList.toggle("selr", b.checked));
  const bar = scopeEl.querySelector("[data-bulkbar]");
  if (bar) { bar.classList.toggle("hide", !n); bar.querySelector(".n").textContent = `${n} geselecteerd`; }
}
document.addEventListener("click", (e) => {
  const box = e.target.closest("[data-sel]");
  if (!box) return;
  const scopeEl = selScope(box);
  const boxes = [...scopeEl.querySelectorAll("[data-sel]")];
  const idx = boxes.indexOf(box);
  if (e.shiftKey && lastSelIdx != null && boxes[lastSelIdx]) {
    const [a, b] = [Math.min(idx, lastSelIdx), Math.max(idx, lastSelIdx)];
    for (let i = a; i <= b; i++) boxes[i].checked = box.checked;
  }
  lastSelIdx = idx;
  syncBulk(scopeEl);
});
document.addEventListener("change", (e) => {
  if (!e.target.matches("[data-selall]")) return;
  const scopeEl = selScope(e.target);
  scopeEl.querySelectorAll("[data-sel]").forEach((b) => (b.checked = e.target.checked));
  lastSelIdx = null;
  syncBulk(scopeEl);
});
document.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-bulk]");
  if (!b) return;
  const scopeEl = selScope(b);
  const keys = selected(scopeEl);
  if (b.dataset.bulk === "__clear") { scopeEl.querySelectorAll("[data-sel]").forEach((x) => (x.checked = false)); syncBulk(scopeEl); return; }
  const scope = b.closest("[data-bulkbar]").dataset.bulkbar;
  const fn = BULK[scope] && BULK[scope][b.dataset.bulk];
  if (!fn || !keys.length) return;
  b.disabled = true;
  try { await fn(keys, b); } catch (err) { toast(err.message, true); } finally { b.disabled = false; }
});
// Bevestiging als modal (lijst van wat er gebeurt).
function askConfirm(title, html, okLabel, danger) {
  return new Promise((resolve) => {
    openModal(`<div class="ch"><h3>${title}</h3><button class="x" data-close aria-label="Sluiten">×</button></div><div class="cb">${html}</div>
      <div class="cf"><button class="btn sec" data-close>Annuleren</button><button class="btn ${danger ? "no" : ""}" id="cm-ok">${okLabel}</button></div>`);
    let done = false;
    document.querySelectorAll("#modal-box [data-close]").forEach((x) => x.addEventListener("click", () => { if (!done) { done = true; resolve(false); } }));
    document.getElementById("cm-ok").addEventListener("click", () => { done = true; closeModal(); resolve(true); });
    setTimeout(() => document.getElementById("cm-ok")?.focus(), 30);
  });
}
const nameList = (keys) => `<ul class="nlist">${keys.slice(0, 12).map((k) => `<li>${esc(k)}</li>`).join("")}${keys.length > 12 ? `<li class="faint">… en nog ${keys.length - 12}</li>` : ""}</ul>`;

// ---------- routing ----------
function route() {
  if (window.AIP_AUTH && !window.AIP_ME) return; // eerst inloggen
  // Een open venster hoort bij de vorige pagina (anders werkt het op het verkeerde proces).
  if (!$("#modal").classList.contains("hide")) closeModal();
  const [view, ...rest] = (location.hash.replace(/^#/, "") || "dashboard").split("/");
  S.view = VIEWS[view] ? view : "dashboard";
  S.param = rest.length ? decodeURIComponent(rest.join("/")) : null;
  document.querySelectorAll("[data-nav]").forEach((a) => {
    const nav = a.dataset.nav;
    const active = nav === S.view || (S.view === "editor" && nav === "processes") || (S.view === "instance" && nav === "instances");
    a.classList.toggle("on", active);
  });
  render();
}
window.addEventListener("hashchange", route);
function go(hash) { if (location.hash === "#" + hash) route(); else location.hash = hash; }

async function render() {
  const main = $("#main");
  destroyCanvas();
  // Live verversen van dezelfde pagina: aangevinkte rijen blijven aangevinkt.
  const page = `${S.view}/${S.param || ""}/${S.env}`;
  const keep = {};
  if (render.page === page) document.querySelectorAll("[data-bulkbar]").forEach((bar) => { keep[bar.dataset.bulkbar] = selected(selScope(bar)); });
  render.page = page;
  try {
    await VIEWS[S.view](main);
  } catch (e) {
    main.innerHTML = `<div class="card"><div class="cb"><b>Kon deze pagina niet laden.</b><p class="muted">${esc(e.message)}</p></div></div>`;
  }
  for (const [scope, keys] of Object.entries(keep)) {
    if (!keys.length) continue;
    const bar = document.querySelector(`[data-bulkbar="${scope}"]`);
    if (!bar) continue;
    const sc = selScope(bar);
    sc.querySelectorAll("[data-sel]").forEach((x) => { if (keys.includes(x.dataset.sel)) x.checked = true; });
    syncBulk(sc);
  }
}

// ---------- status (topbar + badge) ----------
function fourEyesOn() { return !S.settings || S.settings.fourEyes !== false; }

async function refreshStatus() {
  try { S.settings = await api("/api/v1/settings"); } catch {}
  try {
    const h = await api("/health");
    $("#store-pill").textContent = `opslag: ${h.persistence}`;
  } catch {}
  try {
    const a = await api("/api/v1/agents");
    $("#claude-pill").textContent = a.claude.available ? `AI: ${a.claude.model}` : "AI: heuristiek";
  } catch {}
  try {
    const p = await api("/api/v1/approvals?status=pending");
    S.pending = p.length;
    const b = $("#ap-badge");
    b.textContent = p.length;
    b.classList.toggle("hide", p.length === 0);
  } catch {}
}

// ---------- views ----------
const VIEWS = {};

// DASHBOARD (monitoring)
VIEWS.dashboard = async (main) => {
  const [d, runs] = await Promise.all([api(`/api/v1/dashboard?env=${S.env}`), api(`/api/v1/runs?limit=40&env=${S.env}`)]);
  const r = d.runs;
  const o = d.overall || r;
  const chartRuns = runs.slice(0, 40).reverse();
  const maxMs = Math.max(1, ...chartRuns.map((x) => x.durationMs));
  const cw = 640, ch = 150, bw = chartRuns.length ? Math.max(6, Math.min(22, (cw - 60) / chartRuns.length - 4)) : 10;
  const bars = chartRuns.map((x, i) => {
    const h = Math.max(4, (x.durationMs / maxMs) * (ch - 30));
    const xx = 52 + i * (bw + 4);
    return `<rect x="${xx}" y="${ch - 18 - h}" width="${bw}" height="${h}" rx="2" fill="${x.status === "success" ? "#1f9d55" : "#d64545"}"><title>${esc(x.integration)} · ${x.env} · ${x.durationMs} ms · ${x.status}</title></rect>`;
  }).join("");
  const rate = r.successRate;
  const circ = 2 * Math.PI * 42;
  const envCards = ENVS.map((e) => {
    const pe = o.perEnv[e.id] || { runs: 0, error: 0 };
    const health = pe.runs === 0 ? ["none", "geen verkeer"] : pe.error === 0 ? ["ok", "gezond"] : pe.error / pe.runs > 0.3 ? ["err", "verstoord"] : ["warn", "waarschuwing"];
    return `<div class="stage ${e.id === S.env ? "cur" : ""}" style="--c:${e.color}" data-envpick="${e.id}" title="Toon ${e.name}">
      <div class="n">${e.name}</div>
      <div class="row" style="justify-content:space-between;margin-top:6px"><span class="vv">${d.deployedPerEnv[e.id] ?? 0}</span><span class="chip ${health[0]}">${health[1]}</span></div>
      <div class="faint" style="font-size:.75rem">processen gedeployed · ${pe.runs} runs · ${pe.error} fouten</div></div>`;
  }).join("");

  main.innerHTML = `
  <div class="head"><div><h1>Dashboard <span class="env ${S.env}" style="vertical-align:middle;font-size:.72rem">${S.env}</span></h1><p>Monitoring van ${envOf(S.env).name} — live bijgewerkt. Wissel bovenin van omgeving.</p></div>
    <div class="row"><button class="btn sec" data-act="refresh">Vernieuwen</button><button class="btn" data-act="demo-traffic">Genereer testverkeer</button></div></div>
  <div class="kpis">
    <div class="kpi"><div class="l">Uitvoeringen</div><div class="v">${r.totalRuns}</div><div class="s">${o.totalRuns} op alle omgevingen</div></div>
    <div class="kpi ${rate >= 95 ? "good" : rate >= 80 ? "warn" : "bad"}"><div class="l">Succesratio</div><div class="v">${rate}%</div><div class="s">${r.success} geslaagd</div></div>
    <div class="kpi ${r.error ? "bad" : ""}"><div class="l">Fouten</div><div class="v">${r.error}</div><div class="s">${r.deadLettered} in dead-letter</div></div>
    <div class="kpi"><div class="l">Gem. duur</div><div class="v">${r.avgDurationMs}<span style="font-size:.9rem;font-weight:500"> ms</span></div><div class="s">per uitvoering</div></div>
    <div class="kpi ${d.approvals.pending ? "warn" : ""}"><div class="l">Goedkeuringen</div><div class="v">${d.approvals.pending}</div><div class="s">${d.approvals.pendingByRisk.red} RED · ${d.approvals.pendingByRisk.orange} ORANGE</div></div>
    <div class="kpi ${d.incidents.open ? "bad" : ""}"><div class="l">Incidenten</div><div class="v">${d.incidents.open}</div><div class="s">${d.integrations} processen totaal</div></div>
  </div>
  <div class="g2" style="margin-bottom:14px">
    <div class="card"><div class="ch"><h3>Uitvoeringen (laatste ${chartRuns.length})</h3><div class="legend"><span><i style="background:#1f9d55"></i>geslaagd</span><span><i style="background:#d64545"></i>gefaald</span><span>hoogte = duur</span></div></div>
      <div class="cb tw">${chartRuns.length ? `<svg width="${Math.max(cw, 60 + chartRuns.length * (bw + 4))}" height="${ch}" viewBox="0 0 ${Math.max(cw, 60 + chartRuns.length * (bw + 4))} ${ch}">
        <line x1="46" y1="${ch - 18}" x2="${Math.max(cw, 60 + chartRuns.length * (bw + 4))}" y2="${ch - 18}" stroke="#dde3ee"/>
        <line x1="46" y1="12" x2="${Math.max(cw, 60 + chartRuns.length * (bw + 4))}" y2="12" stroke="#eef1f6" stroke-dasharray="3 3"/>
        <text x="42" y="16" text-anchor="end" font-size="10" fill="#8b97ab">${maxMs}ms</text><text x="42" y="${ch - 15}" text-anchor="end" font-size="10" fill="#8b97ab">0</text>${bars}</svg>` : `<div class="empty">Nog geen uitvoeringen op ${S.env.toUpperCase()}.${S.env === "prod" ? "" : " Klik op “Genereer testverkeer”."}</div>`}</div></div>
    <div class="card"><div class="ch"><h3>Succesratio</h3></div><div class="cb" style="display:flex;align-items:center;gap:18px">
      <svg width="110" height="110" viewBox="0 0 110 110"><circle cx="55" cy="55" r="42" fill="none" stroke="#fbe6e6" stroke-width="12"/>
        <circle cx="55" cy="55" r="42" fill="none" stroke="#1f9d55" stroke-width="12" stroke-dasharray="${(rate / 100) * circ} ${circ}" transform="rotate(-90 55 55)" stroke-linecap="round"/>
        <text x="55" y="61" text-anchor="middle" font-size="20" font-weight="700" fill="#1b2536">${rate}%</text></svg>
      <div class="stack" style="gap:4px;font-size:.85rem"><div><b>${r.success}</b> <span class="muted">geslaagd</span></div><div><b>${r.error}</b> <span class="muted">gefaald</span></div><div><b>${r.deadLettered}</b> <span class="muted">dead-letter</span></div></div></div></div>
  </div>
  <div class="card" style="margin-bottom:14px"><div class="ch"><h3>Alle omgevingen</h3><a href="#infra">Infrastructuur →</a></div><div class="cb"><div class="g4">${envCards}</div></div></div>
  <div class="g2">
    <div class="card"><div class="ch"><h3>Recente uitvoeringen</h3><a href="#instances">Alle instanties →</a></div>
      <div class="tw">${d.recentRuns.length ? `<table><thead><tr><th>Tijd</th><th>Proces</th><th>Omgeving</th><th>Versie</th><th>Status</th><th>Duur</th></tr></thead><tbody>
      ${d.recentRuns.map((x) => `<tr class="click" data-go="instance/${x.id}"><td class="mono">${fmtTime(x.at)}</td><td><b>${esc(x.integration)}</b></td><td><span class="env ${x.env}">${x.env}</span></td><td class="ver">${verLabel(x)}</td><td>${x.status === "success" ? '<span class="chip ok">geslaagd</span>' : `<span class="chip err">gefaald${x.deadLettered ? " · DLQ" : ""}</span>`}</td><td class="mono">${x.durationMs} ms</td></tr>`).join("")}
      </tbody></table>` : `<div class="empty">Geen uitvoeringen</div>`}</div></div>
    <div class="card"><div class="ch"><h3>Recente fouten</h3></div><div class="cb">
      ${r.recentErrors.length ? r.recentErrors.map((x) => `<div style="padding:8px 0;border-bottom:1px solid var(--border)"><div class="row" style="justify-content:space-between"><b>${esc(x.integration)}</b><span class="env ${x.env}">${x.env}</span></div><div class="muted" style="font-size:.8rem">${esc(x.error || "")}</div><div class="faint mono" style="font-size:.7rem">${fmtDateTime(x.at)}</div></div>`).join("") : `<div class="empty">Geen fouten 🎉</div>`}
    </div></div>
  </div>`;
};

// PROCESSEN
VIEWS.processes = async (main) => {
  const [list, deps, trigs] = await Promise.all([api("/api/v1/integrations"), api("/api/v1/deployments"), api("/api/v1/triggers")]);
  const depOf = (n) => deps.find((d) => d.integration === n);
  const trigOf = (n) => trigs.find((t) => t.integration === n && t.env === S.env);
  const status = (n) => {
    const t = trigOf(n);
    if (!t) return `<span class="faint">niet op ${S.env.toUpperCase()}</span>`;
    if (t.type === "manual") return `<span class="chip none">handmatig</span>`;
    return t.paused ? `<span class="chip warn">gedeactiveerd</span>` : `<span class="chip ok">actief</span>`;
  };
  main.innerHTML = `
  <div class="head"><div><h1>Processen</h1><p>Elk proces wordt gebouwd op DEV en gepromoveerd naar TEST → ACC → PROD. De kolom van <span class="env ${S.env}">${S.env}</span> is gemarkeerd; ▶ voert daar uit. Vink processen aan om ze in één keer te deployen.</p></div>
    <div class="row">${iconBtn("upload", "Proces importeren (JSON)", 'data-act="import"', "sec")}${iconBtn("sparkles", "Bouwen met de AI-assistent", 'data-go="assistant"', "sec")}<button class="btn" data-go="editor/new" data-ico-done>${ic("plus")}<span>Nieuw proces</span></button></div></div>
  <div class="card">${bulkBar("processes", [["deploy", "Selectie deployen naar TEST, ACC of PROD", "", "rocket"], ["resume", `Activeren op ${S.env.toUpperCase()}`, "", "power"], ["pause", `Deactiveren op ${S.env.toUpperCase()}`, "", "pause"], ["delete", "Verwijderen", "no", "trash"]])}<div class="tw">${list.length ? `<table><thead><tr>${selHead()}<th>Proces</th><th>Trigger</th><th>Status op ${S.env.toUpperCase()}</th><th>Laatste versie</th>${ENVS.map((e) => `<th class="${e.id === S.env ? "cur" : ""}"><span class="env ${e.id}">${e.label}</span></th>`).join("")}<th></th></tr></thead><tbody>
  ${list.map((i) => {
    const d = depOf(i.integration) || { envs: {}, promotable: [] };
    const cells = ENVS.map((e) => {
      const v = d.envs[e.id];
      const can = (d.promotable || []).includes(e.id);
      const src = ENVS[ENVS.indexOf(e) - 1];
      return `<td class="${e.id === S.env ? "cur" : ""}"><div class="envcell">${v != null ? `<span class="ver">v${v}</span>` : `<span class="faint">—</span>`}
        ${can ? `<button class="btn sm sec" data-act="deploy" data-name="${esc(i.integration)}" data-env="${e.id}" data-ico-done title="v${d.envs[src.id]} van ${src.label} naar ${e.label} deployen" aria-label="v${d.envs[src.id]} naar ${e.label} deployen">${ic("rocket", 14)}<span>v${d.envs[src.id]}</span></button>` : ""}
        ${skipBtn(i.integration, d, e, can ? d.envs[src.id] : null)}</div></td>`;
    }).join("");
    return `<tr>${selCell(i.integration)}<td><a href="#editor/${encodeURIComponent(i.integration)}"><b>${esc(i.integration)}</b></a><div class="faint" style="font-size:.78rem;max-width:320px">${esc(i.description || "")}</div></td>
      <td><span class="chip info">${esc((PC.TRIGGERS[i.trigger?.type] || { label: i.trigger?.type }).label)}</span></td><td>${status(i.integration)}</td><td class="ver"><button type="button" class="ver-dd" data-act="version-menu" data-name="${esc(i.integration)}" data-ico-done aria-haspopup="menu" title="Versies: vergelijken of terugzetten">v${esc(i.version)} <svg class="ico" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></button></td>${cells}
      <td><div class="row icons" style="justify-content:flex-end;flex-wrap:nowrap">${S.env === "dev" ? iconBtn("edit", "Bewerken op DEV", `data-go="editor/${encodeURIComponent(i.integration)}"`) : iconBtn("eye", "Bekijken (alleen-lezen)", `data-go="editor/${encodeURIComponent(i.integration)}"`)}${iconBtn("rocket", "Deployen naar TEST, ACC of PROD (ook overslaan of terugzetten)", `data-act="deploy-dialog" data-name="${esc(i.integration)}"`)}${iconBtn("history", "Versies: terugzetten of vergelijken", `data-act="versions" data-name="${esc(i.integration)}"`)}${iconBtn("download", "Exporteren als JSON", `data-act="export" data-name="${esc(i.integration)}"`)}${d.envs[S.env] != null ? iconBtn("play", `Uitvoeren op ${S.env.toUpperCase()}`, `data-act="run" data-name="${esc(i.integration)}"`, "sm run") : iconBtn("play", `Niet gedeployed op ${S.env.toUpperCase()}`, `data-act="run" data-name="${esc(i.integration)}" disabled`, "sm sec")}</div></td></tr>`;
  }).join("")}</tbody></table>` : `<div class="empty">Nog geen processen. Maak er een met “+ Nieuw proces” of met de AI-assistent.</div>`}</div></div>`;
};

// ACC/PROD: DEV-versie direct deployen en de omgevingen ertussen overslaan. Opent de
// deploy-dialoog (met waarschuwing en keuze van de infrastructuur); daarna volgt goedkeuring.
function skipBtn(name, d, e, promoteV) {
  const devV = d.envs.dev;
  if (e.id === "dev" || e.id === "test" || devV == null || d.envs[e.id] === devV || promoteV === devV) return "";
  const between = ENVS.slice(1, ENVS.indexOf(e)).filter((x) => d.envs[x.id] !== devV).map((x) => x.label);
  const tip = `DEV v${devV} direct naar ${e.label}${between.length ? ` (${between.join(" en ")} overslaan)` : ""}`;
  return `<button class="btn sm sec skip" data-act="deploy-dialog" data-name="${esc(name)}" data-env="${e.id}" data-v="${devV}" data-ico-done title="${esc(tip)}" aria-label="${esc(tip)}">${ic("rocket", 14)}<span>DEV v${devV}</span></button>`;
}

async function bulkTriggers(keys, action) {
  const r = await api("/api/v1/integrations/bulk", { body: { action, names: keys, env: S.env } });
  const ok = r.results.filter((x) => x.ok).length, skip = r.results.filter((x) => !x.ok);
  toast(`${ok} ${action === "pause" ? "gedeactiveerd" : "geactiveerd"} op ${S.env.toUpperCase()}${skip.length ? ` · ${skip.length} overgeslagen (${skip[0].error})` : ""}`, !ok && skip.length > 0);
  render();
}
BULK.processes = {
  deploy: (keys) => bulkDeployDialog(keys),
  resume: (keys) => bulkTriggers(keys, "resume"),
  pause: (keys) => bulkTriggers(keys, "pause"),
  delete: async (keys) => {
    const ok = await askConfirm(`${keys.length} proces${keys.length === 1 ? "" : "sen"} verwijderen?`, `${nameList(keys)}<p class="muted" style="font-size:.85rem">Een proces dat alleen op DEV staat wordt direct verwijderd. Staat het op TEST, ACC of PROD, dan wordt eerst goedkeuring gevraagd (PROD: vier-ogenprincipe). Eerdere versies blijven bewaard in de historie.</p>`, "Verwijderen", true);
    if (!ok) return;
    const r = await api("/api/v1/integrations/bulk", { body: { action: "delete", names: keys } });
    const del = r.results.filter((x) => x.deleted).length, wait = r.results.filter((x) => !x.deleted && x.approval).length;
    toast(`${del} verwijderd${wait ? ` · ${wait} ${wait === 1 ? "wacht" : "wachten"} op goedkeuring` : ""}`);
    refreshStatus();
    render();
  }
};

// PROCES-EDITOR — BPMN-canvas (zie editor.js)
const PC = window.ProcessCanvas;
const DEFAULT_TEST_INPUT = JSON.stringify({ orderId: "TEST-ORDER-93822", id: "TEST-ORDER-93822", priority: true, customer: { email: "klant@example.nl" } }, null, 2);
const NEW_DEF = () => ({
  integration: "NieuwProces",
  trigger: { type: "manual" },
  // Een nieuw proces begint alleen met het startevent (de trigger); stappen voeg je zelf toe.
  steps: [],
  connections: [],
  retry: { attempts: 3, backoff: "exponential", onExhaust: "dead-letter-queue" },
  monitoring: { enabled: true },
  agents: { monitoring: true, testing: true, security: true },
  approval: { productionDeployment: "required" }
});
const verLabel = (r) => (r.test ? "test" : `v${r.version ?? "?"}`);
function destroyCanvas() {
  if (S.canvas) { S.canvas.destroy(); S.canvas = null; }
  PC.closeNodeDetail();
}

VIEWS.editor = async (main) => {
  const name = S.param;
  // Bewerken kan alleen op DEV. Op TEST/ACC/PROD toont de editor de daar actieve versie, alleen-lezen.
  S.readonlyView = S.env !== "dev";
  if (S.readonlyView) return renderEnvView(main, name);
  if (!S.editor || S.editor.name !== name) {
    let E;
    if (name === "new" || !name) {
      // Standaardnaam die nog niet bestaat (NieuwProces, NieuwProces2, …).
      const taken = new Set((await api("/api/v1/integrations").catch(() => [])).map((x) => x.integration));
      const def0 = NEW_DEF();
      for (let i = 2; taken.has(def0.integration); i++) def0.integration = `NieuwProces${i}`;
      E = { name, isNew: true, def: def0, dirty: true, state: null };
    }
    else {
      const [def, state] = await Promise.all([
        api(`/api/v1/integrations/${encodeURIComponent(name)}`),
        api(`/api/v1/integrations/${encodeURIComponent(name)}/deployments`)
      ]);
      E = { name, isNew: false, def: JSON.parse(JSON.stringify(def)), dirty: false, state };
    }
    PC.normalize(E.def);
    E.tab = "editor";
    E.lastRun = null;
    E.testInput = localGet(`aip.test.${name}`) || DEFAULT_TEST_INPUT;
    S.editor = E;
  }
  renderEditor(main);
};

function renderEditor(main) {
  destroyCanvas();
  const E = S.editor, def = E.def;
  const envBadges = E.state
    ? ENVS.map((e) => `<span class="env ${e.id}" style="opacity:${E.state.envs[e.id] != null ? 1 : 0.35}">${e.label} ${E.state.envs[e.id] != null ? "v" + E.state.envs[e.id] : "—"}</span>`).join(" ")
    : `<span class="chip none">nog niet opgeslagen</span>`;
  const next = E.state && (E.state.promotable || [])[0];
  main.innerHTML = `
  <div class="crumbs"><a href="#processes">Processen</a> / ${esc(def.integration)}</div>
  <div class="ed-head">
    <div class="ed-title"><div class="t"><h1 id="ed-name">${esc(def.integration)}</h1><span class="dirty ${E.dirty ? "" : "hide"}" id="ed-dirty">● niet opgeslagen</span></div><div class="row">${envBadges}</div></div>
    <div class="ed-tabs"><button class="${E.tab === "editor" ? "on" : ""}" data-act="ed-tab" data-tab="editor">Editor</button><button class="${E.tab === "runs" ? "on" : ""}" data-act="ed-tab" data-tab="runs">Uitvoeringen</button><button class="${E.tab === "versions" ? "on" : ""}" data-act="ed-tab" data-tab="versions">Versies</button></div>
    <div class="row">
      <button class="btn sec" data-act="ed-trigger" id="ed-trigger-btn" title="Kies hoe dit proces start">⚡ ${esc((PC.TRIGGERS[def.trigger?.type] || { label: "Trigger kiezen" }).label)}</button>
      ${iconBtn("settings", "Procesinstellingen", 'data-act="ed-settings"', "sec")}
      ${iconBtn("download", "Proces exporteren als JSON (Integration-as-Code)", 'data-act="ed-export"', "sec")}
      ${iconBtn("upload", "Proces importeren uit een JSON-bestand", 'data-act="import"', "sec")}
      ${E.state ? iconBtn("rocket", "Deployen naar TEST, ACC of PROD (ook overslaan of terugzetten)", `data-act="deploy-dialog" data-name="${esc(def.integration)}" data-env="${next || "test"}"`, "sec") : ""}
      <button class="btn" data-act="ed-save" data-ico-done title="Opslaan als nieuwe versie op DEV">${ic("save")}<span>Opslaan</span></button>
    </div>
  </div>
  ${E.tab === "editor"
    ? `<div class="ed-stage"><div id="canvas-host" style="height:100%"></div><div id="ed-banner-host"></div>
        <aside class="ed-side ${E.sideOpen ? "" : "hide"}" id="ed-side" aria-label="Procesinstellingen"></aside>
        <div class="ed-run"><button class="btn run" data-act="ed-execute">▶ Proces uitvoeren</button><button class="btn sec" data-act="ed-testdata">Testdata</button></div></div>
       <div id="ed-logs-host"></div>`
    // Nieuw, nog niet opgeslagen proces: uitleggen in plaats van een uitgeschakeld tabblad.
    : E.isNew ? `<div class="card"><div class="cb ed-newinfo">${ic(E.tab === "runs" ? "play" : "history", 28)}
        <h3>${E.tab === "runs" ? "Nog geen uitvoeringen" : "Nog geen versies"}</h3>
        <p class="muted">Dit proces is nog niet opgeslagen. ${E.tab === "runs" ? "Uitvoeringen verschijnen hier zodra het proces is opgeslagen en draait (via de trigger, ▶ Uitvoeren of een test)." : "Bij elke keer opslaan ontstaat een nieuwe versie op DEV; die zie je hier, met datum, notitie en waar hij draait."}</p>
        <div class="row" style="justify-content:center"><button class="btn sec" data-act="ed-tab" data-tab="editor">Terug naar de editor</button><button class="btn" data-act="ed-save" data-ico-done>${ic("save")}<span>Nu opslaan</span></button></div></div></div>`
    : E.tab === "versions" ? `<div id="ed-versions"><div class="card"><div class="empty">laden…</div></div></div>`
    : `<div class="card"><div class="tw" id="ed-runs"><div class="empty">laden…</div></div></div>`}`;
  if (E.isNew && E.tab !== "editor") return;
  if (E.tab === "versions") { renderVersions($("#ed-versions"), def.integration, E.dirty).catch((e) => toast(e.message, true)); return; }
  if (E.tab === "editor") {
    S.canvas = PC.mount($("#canvas-host"), {
      def,
      run: E.lastRun,
      onChange: () => { markDirty(); refreshTriggerBtn(); },
      onOpenNode: openNode,
      onExecuteStep: async (id) => { await openNode(id); setTimeout(() => document.querySelector("#ndv-run")?.click(), 50); },
      onAddToChat: (id, name) => window.aipAssistant && window.aipAssistant.addNode(id, name),
      onConvertToSubprocess: convertToSubprocess,
      onChooseTrigger: triggerChooser,
      onToast: toast
    });
    S.canvas.fit();
    updateRunUI();
    if (E.sideOpen) renderSide();
    // Nieuw proces: eerst kiezen hoe het start.
    if (E.isNew && !E.triggerAsked) { E.triggerAsked = true; setTimeout(() => triggerChooser(), 150); }
  } else {
    loadEditorRuns().catch((e) => toast(e.message, true));
  }
}

// ---------- TEST/ACC/PROD: alleen-lezen ----------
async function renderEnvView(main, name) {
  destroyCanvas();
  const env = S.env, E = envOf(env);
  const toDev = `<button class="btn" data-act="to-dev">✎ Bewerken op DEV</button>`;
  if (!name || name === "new") {
    main.innerHTML = `<div class="crumbs"><a href="#processes">Processen</a> / nieuw</div>
      <div class="card ro-card"><div class="cb"><h3 style="margin-top:0">Nieuwe processen maak je op DEV</h3><p class="muted">Je staat op <span class="env ${env}">${env}</span>. Op TEST, ACC en PROD wordt nooit iets bewerkt: je bouwt op DEV en deployt daarna.</p>${toDev}</div></div>`;
    return;
  }
  const info = await api(`/api/v1/integrations/${encodeURIComponent(name)}/versions`);
  if (S.view !== "editor" || S.env !== env) return;
  const v = info.envs[env];
  const tab = S.envViewTab || "process";
  const badges = ENVS.map((e) => `<span class="env ${e.id}" style="opacity:${info.envs[e.id] != null ? 1 : 0.35}">${e.label} ${info.envs[e.id] != null ? "v" + info.envs[e.id] : "—"}</span>`).join(" ");
  main.innerHTML = `
  <div class="crumbs"><a href="#processes">Processen</a> / ${esc(name)}</div>
  <div class="ed-head">
    <div class="ed-title"><div class="t"><h1>${esc(name)}</h1><span class="chip warn">🔒 alleen-lezen op ${E.label}</span></div><div class="row">${badges}</div></div>
    <div class="ed-tabs"><button class="${tab === "process" ? "on" : ""}" data-act="ev-tab" data-tab="process">Proces</button><button class="${tab === "versions" ? "on" : ""}" data-act="ev-tab" data-tab="versions">Versies</button></div>
    <div class="row">${toDev}<button class="btn sec" data-act="deploy-dialog" data-name="${esc(name)}" data-env="${env}">${v != null ? "Andere versie op " + E.label + "…" : "Deploy naar " + E.label + "…"}</button></div>
  </div>
  <div class="ro-note"><b>Op ${E.name} wordt niet bewerkt.</b> Je ziet ${v != null ? `versie <b>v${v}</b> zoals die hier draait` : "dat dit proces hier nog niet staat"}. Wijzigingen maak je op DEV (opslaan = nieuwe versie op DEV) en daarna deploy je naar ${E.label}. Een oudere versie terugzetten kan via Versies.</div>
  ${tab === "versions" ? `<div id="ed-versions"></div>`
    : v != null ? `<div class="ed-stage ro"><div id="canvas-host" style="height:100%"></div></div>`
    : `<div class="card"><div class="empty">${esc(name)} staat nog niet op ${E.label}.<br><button class="btn sm" style="margin-top:10px" data-act="deploy-dialog" data-name="${esc(name)}" data-env="${env}">Deploy naar ${E.label}…</button></div></div>`}`;
  if (tab === "versions") return renderVersions($("#ed-versions"), name, false);
  if (v != null) {
    const def = await api(`/api/v1/integrations/${encodeURIComponent(name)}/versions/${v}`);
    if (S.view !== "editor" || S.env !== env || !$("#canvas-host")) return;
    const d = JSON.parse(JSON.stringify(def));
    PC.normalize(d);
    S.canvas = PC.mount($("#canvas-host"), { def: d, readonly: true });
    S.canvas.fit();
  }
}

// ---------- versies: bekijken, terugzetten op DEV, deployen ----------
const KIND = { build: "opgeslagen", deploy: "gedeployed", rollback: "teruggezet" };
async function renderVersions(host, name, dirty) {
  const info = await api(`/api/v1/integrations/${encodeURIComponent(name)}/versions`);
  if (!host.isConnected) return;
  host.innerHTML = `
  <div class="card" style="margin-bottom:14px"><div class="ch"><h3>Versies</h3><span class="faint">Opslaan maakt een nieuwe versie op DEV. Terugzetten op DEV maakt een kopie als nieuwste versie; de historie blijft intact.</span></div>
    <div class="tw"><table><thead><tr><th>Versie</th><th>Gemaakt</th><th>Door</th><th>Notitie</th><th>Actief op</th><th>Stappen</th><th></th></tr></thead><tbody>
    ${info.versions.map((x) => `<tr><td class="ver"><b>v${x.version}</b></td><td class="mono">${x.createdAt ? fmtDateTime(x.createdAt) : "—"}</td><td>${esc(x.createdBy || "—")}</td>
      <td class="muted">${esc(x.note || "")}</td>
      <td>${x.activeOn.length ? x.activeOn.map((e) => `<span class="env ${e}">${e}</span>`).join(" ") : '<span class="faint">—</span>'}</td>
      <td class="mono">${x.steps}</td>
      <td><div class="row" style="justify-content:flex-end;flex-wrap:nowrap">
        <button class="btn sm sec" data-act="ver-view" data-name="${esc(name)}" data-v="${x.version}">Bekijken</button>
        ${x.version !== info.envs.dev ? `<button class="btn sm sec" data-act="ver-restore" data-name="${esc(name)}" data-v="${x.version}" ${dirty ? 'data-dirty="1"' : ""}>Terugzetten op DEV</button>` : ""}
        <button class="btn sm" data-act="deploy-dialog" data-name="${esc(name)}" data-v="${x.version}">Deploy…</button>
      </div></td></tr>`).join("")}
    </tbody></table></div></div>
  <div class="card"><div class="ch"><h3>Geschiedenis</h3></div><div class="tw">${info.history.length ? `<table><thead><tr><th>Tijd</th><th>Omgeving</th><th>Actie</th><th>Versie</th><th>Door</th></tr></thead><tbody>
    ${info.history.slice(0, 60).map((h) => `<tr><td class="mono">${fmtDateTime(h.at)}</td><td><span class="env ${h.env}">${h.env}</span></td>
      <td>${h.kind === "rollback" ? '<span class="chip warn">teruggezet</span>' : h.kind === "deploy" ? '<span class="chip ok">gedeployed</span>' : '<span class="chip none">opgeslagen</span>'}</td>
      <td class="mono">${h.from != null ? `v${h.from} → ` : ""}<b>v${h.version}</b></td><td>${esc(h.by || "")}</td></tr>`).join("")}
    </tbody></table>` : `<div class="empty">Nog geen geschiedenis.</div>`}</div></div>`;
}

async function viewVersion(name, v) {
  const def = await api(`/api/v1/integrations/${encodeURIComponent(name)}/versions/${v}`);
  openModal(`<div class="ch"><h3>${esc(name)} · v${v} <span class="chip warn">alleen-lezen</span></h3><button class="x" data-close aria-label="Sluiten">×</button></div>
    <div class="cb ver-view"><div id="ver-canvas" style="height:100%"></div></div>
    <div class="cf"><button class="btn sec" data-close>Sluiten</button><button class="btn" data-act="deploy-dialog" data-name="${esc(name)}" data-v="${v}">Deploy v${v}…</button></div>`);
  const d = JSON.parse(JSON.stringify(def));
  PC.normalize(d);
  if (S.verCanvas) S.verCanvas.destroy();
  S.verCanvas = PC.mount(document.getElementById("ver-canvas"), { def: d, readonly: true });
  S.verCanvas.fit();
}

async function restoreVersion(name, v, dirty) {
  const ok = await askConfirm(`v${v} terugzetten op DEV?`, `<p>De inhoud van <b>v${v}</b> wordt de nieuwste versie op DEV (een kopie; de historie blijft bewaard). TEST, ACC en PROD veranderen niet; die krijgen deze versie pas na een deploy.</p>${dirty ? `<div class="xf-note warn">Je hebt niet-opgeslagen wijzigingen in de editor; die gaan verloren.</div>` : ""}`, "Terugzetten op DEV");
  if (!ok) return;
  const r = await api(`/api/v1/integrations/${encodeURIComponent(name)}/versions/${v}/restore`, { body: { owner: who() } });
  toast(`v${v} teruggezet op DEV als v${r.version}`);
  S.editor = null;
  if (S.env !== "dev") { S.env = "dev"; localSet("aip.env", "dev"); renderEnvs(); }
  go(`editor/${encodeURIComponent(name)}`);
}

// Deploy-venster: kies omgeving en versie. Gewone promotie, overslaan (bv. DEV → PROD) of terugzetten.
// Omgevingsvarianten (agentgroepen) kiezen binnen een dialoog. Alleen zichtbaar als de
// omgeving meer dan één variant heeft (bijv. PROD op AWS en Azure).
function targetsPickerHtml(groups, current) {
  if (groups.length <= 1) return "";
  const cur = current || { groups: [groups[0].id], mode: "failover" };
  const pv = (p) => (typeof pvBadge === "function" ? pvBadge(p) : "");
  return `<label class="xf-l">Draait op (agent / infrastructuur)</label>
    <ul class="tg-list">${groups.map((g) => `<li><label class="chk"><input type="checkbox" data-tg value="${esc(g.id)}" ${cur.groups.includes(g.id) ? "checked" : ""}> ${pv(g.provider)} <b>${esc(g.name)}</b>${g.region ? ` <span class="faint">${esc(g.region)}</span>` : ""}</label> ${g.builtin || g.online ? '<span class="chip ok">online</span>' : '<span class="chip warn">geen agent online</span>'}</li>`).join("")}</ul>
    <div class="seg ndv-seg tg-seg" role="radiogroup" aria-label="Bij meerdere varianten">
      <button type="button" data-tgmode="failover" class="${cur.mode !== "all" ? "on" : ""}" title="De eerste gezonde variant voert uit (bovenste eerst)">Failover</button>
      <button type="button" data-tgmode="all" class="${cur.mode === "all" ? "on" : ""}" title="Elke variant voert uit (actief-actief, bijv. AWS én Azure)">Alle varianten</button></div>`;
}
function bindTargetsPicker(box) {
  box.querySelectorAll("[data-tgmode]").forEach((b) => b.addEventListener("click", () => { box.querySelectorAll("[data-tgmode]").forEach((x) => x.classList.toggle("on", x === b)); }));
}
function readTargetsPicker(box) {
  const boxes = box.querySelectorAll("[data-tg]");
  if (!boxes.length) return null;
  const groups = [...boxes].filter((i) => i.checked).map((i) => i.value);
  if (!groups.length) throw new Error("Kies minstens één agent/infrastructuur");
  const on = box.querySelector("[data-tgmode].on");
  return { groups, mode: on ? on.dataset.tgmode : "failover" };
}

async function deployDialog(name, envPref, versionPref) {
  const [info, allGroups, curTargets] = await Promise.all([
    api(`/api/v1/integrations/${encodeURIComponent(name)}/versions`),
    api("/api/v1/agent-groups").catch(() => []),
    api(`/api/v1/integrations/${encodeURIComponent(name)}/targets`).catch(() => ({}))
  ]);
  const targets = ENVS.filter((e) => e.id !== "dev");
  const idx = (id) => ENVS.findIndex((e) => e.id === id);
  let env = targets.some((e) => e.id === envPref) ? envPref : targets.find((e) => (info.envs[ENVS[idx(e.id) - 1].id] ?? null) !== info.envs[e.id] && info.envs[ENVS[idx(e.id) - 1].id] != null)?.id || "test";
  const defaultV = (e) => versionPref ? Number(versionPref) : (info.envs[ENVS[idx(e) - 1].id] ?? info.envs.dev ?? info.latestVersion);
  let version = defaultV(env);
  const ranOn = (v) => new Set([...info.history.filter((h) => h.version === v).map((h) => h.env), ...ENVS.filter((e) => info.envs[e.id] === v).map((e) => e.id)]);
  openModal(`<div class="ch"><h3>Deploy ${esc(name)}</h3><button class="x" data-close aria-label="Sluiten">×</button></div>
    <div class="cb">
      <label class="xf-l">Naar omgeving</label>
      <div class="dp-envs" role="radiogroup" aria-label="Omgeving">${targets.map((e) => `<label class="dp-env"><input type="radio" name="dp-env" value="${e.id}" ${e.id === env ? "checked" : ""}><span class="env ${e.id}">${e.label}</span><span class="faint">nu ${info.envs[e.id] != null ? "v" + info.envs[e.id] : "—"}</span></label>`).join("")}</div>
      <label class="xf-l" for="dp-ver">Versie</label>
      <select class="f" id="dp-ver">${info.versions.map((x) => `<option value="${x.version}">v${x.version}${x.activeOn.length ? " — actief op " + x.activeOn.map((e) => e.toUpperCase()).join(", ") : ""}${x.note ? " — " + esc(x.note) : ""}${x.createdAt ? " · " + fmtDateTime(x.createdAt) : ""}</option>`).join("")}</select>
      <div id="dp-tg"></div>
      <div id="dp-info"></div>
    </div>
    <div class="cf"><button class="btn sec" data-close>Annuleren</button><button class="btn" id="dp-go">Deploy aanvragen</button></div>`);
  const sel = document.getElementById("dp-ver");
  const drawTargets = () => {
    const host = document.getElementById("dp-tg");
    host.innerHTML = targetsPickerHtml(allGroups.filter((g) => g.env === env), curTargets[env]);
    bindTargetsPicker(host);
  };
  drawTargets();
  const draw = () => {
    sel.value = String(version);
    const cur = info.envs[env], lab = env.toUpperCase();
    const ran = ranOn(version);
    const skipped = ENVS.filter((e) => e.id !== "dev" && idx(e.id) < idx(env) && !ran.has(e.id)).map((e) => e.label);
    const same = cur === version;
    const rollback = cur != null && version < cur;
    const msgs = [];
    if (same) msgs.push(`<div class="xf-note">v${version} staat al op ${lab}.</div>`);
    else if (rollback) msgs.push(`<div class="xf-note warn"><b>Terugzetten:</b> ${lab} gaat van v${cur} terug naar v${version}.</div>`);
    else msgs.push(`<div class="xf-note ok">${lab} ${cur != null ? `gaat van v${cur} naar` : "krijgt"} <b>v${version}</b>.</div>`);
    if (!same && !rollback && skipped.length) msgs.push(`<div class="xf-note warn"><b>${skipped.join(" en ")} ${skipped.length === 1 ? "wordt" : "worden"} overgeslagen.</b> v${version} heeft daar niet gedraaid; er is dus niet op ${skipped.length === 1 ? "die omgeving" : "die omgevingen"} getest.</div>`);
    if (!same) msgs.push(`<div class="hint">Dit wordt een goedkeuringsverzoek${env === "prod" ? (fourEyesOn() ? " (PROD: twee verschillende goedkeurders)" : " (PROD)") : ""}. Pas na goedkeuring staat de versie op ${lab}.</div>`);
    document.getElementById("dp-info").innerHTML = msgs.join("");
    document.getElementById("dp-go").disabled = same;
    document.getElementById("dp-go").textContent = rollback ? `Terugzetten aanvragen` : `Deploy v${version} naar ${lab} aanvragen`;
  };
  draw();
  document.querySelectorAll('input[name="dp-env"]').forEach((r) => r.addEventListener("change", () => { env = r.value; if (!versionPref) version = defaultV(env); drawTargets(); draw(); }));
  sel.addEventListener("change", () => { version = Number(sel.value); versionPref = version; draw(); });
  document.getElementById("dp-go").addEventListener("click", async () => {
    let targets;
    try { targets = readTargetsPicker(document.getElementById("dp-tg")); } catch (err) { toast(err.message, true); return; }
    closeModal();
    try { await deployTo(name, env, version, targets); } catch (err) { if (err.message !== "Deploy geannuleerd") toast(err.message, true); }
  });
}

// Meerdere processen in één keer naar TEST, ACC of PROD. Per proces wordt een deploy
// (goedkeuringsverzoek) aangevraagd; processen die al up-to-date zijn worden overgeslagen.
async function bulkDeployDialog(keys) {
  const [deps, allGroups] = await Promise.all([api("/api/v1/deployments"), api("/api/v1/agent-groups").catch(() => [])]);
  const targets = ENVS.filter((e) => e.id !== "dev");
  const idx = (id) => ENVS.findIndex((e) => e.id === id);
  let env = "test", source = "prev";
  const plan = () => keys.map((name) => {
    const d = deps.find((x) => x.integration === name) || { envs: {}, latestVersion: null };
    const prev = ENVS[idx(env) - 1].id;
    const v = source === "prev" ? d.envs[prev] : (d.envs.dev ?? d.latestVersion);
    const cur = d.envs[env];
    let skip = null;
    if (v == null) skip = source === "prev" ? `staat niet op ${prev.toUpperCase()}` : "geen versie";
    else if (cur === v) skip = `v${v} staat er al`;
    const skipped = ENVS.filter((e) => e.id !== "dev" && idx(e.id) < idx(env) && d.envs[e.id] !== v).map((e) => e.label);
    return { name, v, cur, skip, skipped: skip ? [] : skipped };
  });
  openModal(`<div class="ch"><h3>${ic("rocket")} Deploy · ${keys.length} proces${keys.length === 1 ? "" : "sen"}</h3><button class="x" data-close aria-label="Sluiten">×</button></div>
    <div class="cb" style="max-height:70vh;overflow:auto">
      <label class="xf-l">Naar omgeving</label>
      <div class="dp-envs" role="radiogroup" aria-label="Omgeving">${targets.map((e) => `<label class="dp-env"><input type="radio" name="bd-env" value="${e.id}" ${e.id === env ? "checked" : ""}><span class="env ${e.id}">${e.label}</span></label>`).join("")}</div>
      <label class="xf-l">Welke versie</label>
      <div class="seg ndv-seg" id="bd-src" role="radiogroup" aria-label="Versie">
        <button type="button" data-src="prev" class="on" title="Per proces de versie die op de vorige omgeving staat (DEV → TEST → ACC → PROD)">Van vorige omgeving</button>
        <button type="button" data-src="dev" title="Per proces de laatste versie op DEV; tussenliggende omgevingen worden overgeslagen">Laatste DEV-versie</button></div>
      <div id="bd-tg"></div>
      <div id="bd-plan"></div>
    </div>
    <div class="cf"><button class="btn sec" data-close>Annuleren</button><button class="btn" id="bd-go"></button></div>`);
  const box = document.getElementById("modal-box");
  const draw = () => {
    const p = plan(), go = p.filter((x) => !x.skip);
    const host = document.getElementById("bd-tg");
    host.innerHTML = targetsPickerHtml(allGroups.filter((g) => g.env === env), null);
    bindTargetsPicker(host);
    const skippedEnvs = [...new Set(go.flatMap((x) => x.skipped))];
    document.getElementById("bd-plan").innerHTML = `<table style="margin-top:12px"><thead><tr><th>Proces</th><th>Nu op ${env.toUpperCase()}</th><th>Wordt</th></tr></thead><tbody>
      ${p.map((x) => `<tr><td><b>${esc(x.name)}</b></td><td class="ver">${x.cur != null ? "v" + x.cur : '<span class="faint">—</span>'}</td><td>${x.skip ? `<span class="chip none">overgeslagen · ${esc(x.skip)}</span>` : `<span class="chip ${x.cur != null && x.v < x.cur ? "warn" : "ok"}">v${x.v}${x.cur != null && x.v < x.cur ? " (terugzetten)" : ""}</span>`}</td></tr>`).join("")}</tbody></table>
      ${skippedEnvs.length ? `<div class="xf-note warn"><b>${skippedEnvs.join(" en ")}</b> ${skippedEnvs.length === 1 ? "wordt" : "worden"} ${go.every((x) => skippedEnvs.every((e) => x.skipped.includes(e))) ? "overgeslagen; daar is niet getest." : "voor een deel van de processen overgeslagen."}</div>` : ""}
      ${go.length ? `<div class="hint">Per proces wordt een goedkeuringsverzoek gemaakt${env === "prod" ? (fourEyesOn() ? " (PROD: twee verschillende goedkeurders)" : " (PROD)") : ""}.</div>` : ""}`;
    const b = document.getElementById("bd-go");
    b.disabled = !go.length;
    b.innerHTML = `${ic("rocket")}<span>${go.length} naar ${env.toUpperCase()}</span>`;
  };
  draw();
  box.querySelectorAll('input[name="bd-env"]').forEach((r) => r.addEventListener("change", () => { env = r.value; draw(); }));
  box.querySelectorAll("[data-src]").forEach((b) => b.addEventListener("click", () => { source = b.dataset.src; box.querySelectorAll("[data-src]").forEach((x) => x.classList.toggle("on", x === b)); draw(); }));
  document.getElementById("bd-go").addEventListener("click", async (e) => {
    let tg;
    try { tg = readTargetsPicker(document.getElementById("bd-tg")); } catch (err) { toast(err.message, true); return; }
    e.currentTarget.disabled = true;
    const todo = plan().filter((x) => !x.skip);
    let pending = 0, done = 0;
    const errors = [];
    for (const x of todo) {
      try {
        const a = await api(`/api/v1/integrations/${encodeURIComponent(x.name)}/deploy`, { body: { toEnv: env, version: x.v, proposedBy: who(), reason: `Bulk-deploy (${todo.length} processen)`, ...(tg ? { targets: tg } : {}) } });
        if (a.status === "pending") pending++; else if (a.status === "executed") done++; else errors.push(`${x.name}: ${a.status}`);
      } catch (err) { errors.push(`${x.name}: ${err.message}`); }
    }
    closeModal();
    toast(`${env.toUpperCase()}: ${done ? `${done} gedeployed` : ""}${done && pending ? " · " : ""}${pending ? `${pending} wacht${pending === 1 ? "" : "en"} op goedkeuring` : ""}${errors.length ? ` · ${errors.length} mislukt (${errors[0]})` : ""}`, errors.length > 0 && !done && !pending);
    refreshStatus();
    render();
  });
}

function updateRunUI() {
  const run = S.editor.lastRun;
  const b = $("#ed-banner-host"), l = $("#ed-logs-host");
  if (!b || !l) return;
  if (!run) { b.innerHTML = ""; l.innerHTML = ""; return; }
  b.innerHTML = `<div class="ed-banner">${run.status === "success" ? '<span class="chip ok">geslaagd</span>' : '<span class="chip err">gefaald</span>'}
    <span class="mono faint">${fmtTime(run.finishedAt)} · ${run.durationMs} ms · ${verLabel(run)}</span><button class="btn sm sec" data-act="ed-clear">Resultaat wissen</button></div>`;
  l.innerHTML = `<details class="logs"><summary>Logs <span class="faint" style="font-weight:400">${run.steps.length} stappen · ${run.status === "success" ? "geslaagd" : "gefaald: " + esc(run.error || "")}</span></summary>
    <div class="tw"><table><thead><tr><th>Stap</th><th>Type</th><th>Status</th><th>Pad</th><th>Pogingen</th><th>Duur</th><th>Melding</th></tr></thead><tbody>
    ${run.steps.map((s) => `<tr><td><b>${esc(s.id)}</b></td><td>${esc((STEP_TYPES[s.type] || {}).label || s.type)}</td><td>${s.status === "ok" ? '<span class="chip ok">ok</span>' : '<span class="chip err">gefaald</span>'}</td><td class="mono">${s.port ? (s.port === "true" ? "ja" : "nee") : ""}</td><td class="mono">${s.attempts}</td><td class="mono">${s.ms} ms</td><td class="muted">${esc(s.error || "")}</td></tr>`).join("")}
    </tbody></table></div></details>`;
}

function markDirty() {
  if (!S.editor) return;
  S.editor.dirty = true;
  const d = $("#ed-dirty");
  if (d) d.classList.remove("hide");
  const n = $("#ed-name");
  if (n) n.textContent = S.editor.def.integration;
}

async function loadEditorCtx(current) {
  const [creds, ints, tables, queues] = await Promise.all([
    api("/api/v1/credentials").catch(() => ({ items: [] })),
    api("/api/v1/integrations").catch(() => []),
    api("/api/v1/datatables/dev").catch(() => []),
    api("/api/v1/queues?env=dev").catch(() => [])
  ]);
  return {
    credentials: creds.items.map((c) => ({ name: c.name, type: c.type, plugin: c.plugin, envs: c.envs })),
    processes: ints.map((i) => i.integration).filter((n) => n !== current),
    tables: tables.map((t) => ({ name: t.name, columns: t.columns })),
    queues: [...new Set(queues.filter((q) => !q.isDeadLetter).map((q) => q.queue))]
  };
}

async function openNode(id) {
  const E = S.editor;
  const ctx = await loadEditorCtx(E.def.integration);
  if (S.editor !== E) return;
  PC.openNodeDetail({
    def: E.def,
    id,
    run: E.lastRun,
    ctx,
    api,
    getTestInput: () => E.testInput,
    setTestInput: (v) => { E.testInput = v; localSet(`aip.test.${E.name}`, v); },
    onChange: () => { markDirty(); if (S.canvas) S.canvas.redraw(); refreshTriggerBtn(); },
    pushHistory: (snap) => { if (S.canvas) S.canvas.pushHistory(snap); },
    onDelete: () => { if (S.canvas) S.canvas.deleteNode(id); },
    // Proces met de testdata uitvoeren en het venster heropenen met de echte invoer van deze stap.
    onRunPrevious: async () => { PC.closeNodeDetail(); await executeEditor(); if (S.editor === E) openNode(id); }
  });
}

async function loadEditorRuns() {
  const runs = await api(`/api/v1/runs?integration=${encodeURIComponent(S.editor.def.integration)}&limit=100`);
  const host = $("#ed-runs");
  if (!host) return;
  host.innerHTML = runs.length
    ? `<table><thead><tr><th>Gestart</th><th>Omgeving</th><th>Versie</th><th>Status</th><th>Stappen</th><th>Duur</th><th></th></tr></thead><tbody>
      ${runs.map((x) => `<tr class="click" data-act="ed-openrun" data-id="${x.id}"><td class="mono">${fmtDateTime(x.startedAt)}</td><td><span class="env ${x.env}">${x.env}</span></td><td class="ver">${verLabel(x)}</td>
        <td>${x.status === "success" ? '<span class="chip ok">geslaagd</span>' : `<span class="chip err">gefaald${x.deadLettered ? " · DLQ" : ""}</span>`}</td>
        <td class="mono">${x.steps.filter((s) => s.status === "ok").length}/${x.steps.length}</td><td class="mono">${x.durationMs} ms</td><td class="faint">Bekijk op canvas →</td></tr>`).join("")}
      </tbody></table>`
    : `<div class="empty">Nog geen uitvoeringen van dit proces.</div>`;
}

function validateGraph(def) {
  const ids = new Set(def.steps.map((s) => s.id));
  const out = [];
  if (!def.steps.length) out.push("Een proces heeft minstens één stap nodig.");
  if (!def.connections.some((c) => c.from === "start")) out.push("Verbind het startevent met de eerste stap.");
  if (def.connections.some((c) => (c.from !== "start" && !ids.has(c.from)) || !ids.has(c.to))) out.push("Er is een verbinding naar een element dat niet meer bestaat.");
  return out;
}

async function executeEditor() {
  const E = S.editor;
  let input;
  try { input = JSON.parse(E.testInput || "{}"); } catch { return toast("Testdata is geen geldige JSON — pas het aan via ‘Testdata’.", true); }
  const problems = validateGraph(E.def);
  if (problems.length) return toast(problems[0], true);
  const run = await api("/api/v1/engine/test-run", { body: { definition: cleanDef(E.def), input } });
  E.lastRun = run;
  if (S.canvas) S.canvas.setRun(run);
  updateRunUI();
  toast(run.status === "success" ? `Proces geslaagd in ${run.durationMs} ms` : `Proces gefaald: ${run.error}`, run.status !== "success");
}

function testDataModal() {
  const E = S.editor;
  openModal(`<div class="ch"><h3>Testdata</h3><button class="x" data-close aria-label="Sluiten">×</button></div>
    <div class="cb"><label class="muted" for="td" style="font-size:.75rem;font-weight:600">BERICHT DAT HET PROCES IN GAAT (JSON)</label>
      <textarea class="f" id="td" style="min-height:240px">${esc(E.testInput)}</textarea>
      <div class="hint">Wordt gebruikt bij “Proces uitvoeren” en als invoer in het detailvenster zolang er nog geen uitvoering is.</div></div>
    <div class="cf"><button class="btn sec" data-close>Annuleren</button><button class="btn" id="td-save">Opslaan</button></div>`);
  $("#td-save").addEventListener("click", () => {
    const v = $("#td").value;
    try { JSON.parse(v || "{}"); } catch { return toast("Geen geldige JSON", true); }
    E.testInput = v;
    localSet(`aip.test.${E.name}`, v);
    closeModal();
    toast("Testdata opgeslagen");
  });
}

// ---------- stap omzetten naar een subproces (contextmenu) ----------
async function convertToSubprocess(idsOrId) {
  const E = S.editor;
  if (!E) return;
  const ids = (Array.isArray(idsOrId) ? idsOrId : [idsOrId]).filter((id) => id !== "start");
  const set = new Set(ids);
  const steps = E.def.steps.filter((x) => set.has(x.id));
  if (!steps.length) return;
  if (steps.some((x) => x.type === "end")) return toast("Een eindevent kan niet in een subproces; haal het uit de selectie.", true);
  const conns = E.def.connections;
  const incoming = conns.filter((c) => !set.has(c.from) && set.has(c.to));
  const outgoing = conns.filter((c) => set.has(c.from) && !set.has(c.to));
  const entries = [...new Set(incoming.map((c) => c.to))];
  const exits = [...new Set(outgoing.map((c) => c.from))];
  if (entries.length > 1) return toast("De selectie moet één ingang hebben: de flow mag maar bij één stap binnenkomen.", true);
  if (exits.length > 1) return toast("De selectie moet één uitgang hebben: de flow mag maar bij één stap verder gaan.", true);
  const byX = steps.slice().sort((a, b) => (a.position?.x ?? 0) - (b.position?.x ?? 0));
  const entry = entries[0] || byX[0].id;
  const exit = exits[0] || byX[byX.length - 1].id;
  const exitPorts = [...new Set(outgoing.map((c) => c.port || "out"))];
  if (exitPorts.length > 1) return toast("De uitgang van de selectie mag maar via één pad verder gaan (niet zowel ja als nee).", true);
  const title = steps.length === 1 ? (steps[0].name || steps[0].id) : `${steps.length} stappen`;
  const base = `${E.def.integration}_${steps.length === 1 ? String(title).replace(/[^A-Za-z0-9]+/g, "") : "Deel"}`.slice(0, 58);
  let subName = /^[A-Za-z]/.test(base) ? base : `Sub${base}`;
  const existing = (await api("/api/v1/integrations")).map((x) => x.integration);
  for (let n = 2; existing.includes(subName); n++) subName = `${base}${n}`;
  const inner = steps.map((x) => { const c = JSON.parse(JSON.stringify(x)); delete c.position; delete c.pinData; return c; });
  const internal = conns.filter((c) => set.has(c.from) && set.has(c.to)).map((c) => ({ ...c }));
  const exitConn = exitPorts[0] && exitPorts[0] !== "out" ? { from: exit, to: "einde", port: exitPorts[0] } : { from: exit, to: "einde" };
  const subDef = {
    integration: subName,
    description: `Subproces, gemaakt uit ${steps.length === 1 ? `"${title}"` : title} in ${E.def.integration}`,
    trigger: { type: "manual" },
    steps: [...inner, { id: "einde", type: "end", name: "Einde", config: {} }],
    connections: [{ from: "start", to: entry }, ...internal, exitConn],
    retry: E.def.retry
  };
  try {
    const saved = await api("/api/v1/integrations", { body: { ...subDef, owner: who() } });
    if (S.canvas) S.canvas.pushHistory();
    const entryStep = steps.find((x) => x.id === entry) || steps[0];
    let nid = "subproces", n = 1;
    while (E.def.steps.some((x) => x.id === nid && !set.has(x.id))) nid = `subproces${++n}`;
    const node = { id: nid, type: "subprocess", name: `Subproces: ${title}`, config: { process: saved.integration, merge: true, target: "subprocess" }, position: { ...(entryStep.position || { x: 200, y: 200 }) } };
    E.def.steps = E.def.steps.filter((x) => !set.has(x.id));
    E.def.steps.push(node);
    const rest = conns.filter((c) => !set.has(c.from) && !set.has(c.to));
    const added = [...incoming.map((c) => ({ ...c, to: nid })), ...outgoing.map((c) => ({ from: nid, to: c.to }))];
    const seen = new Set();
    E.def.connections = [...rest, ...added].filter((c) => { const k = `${c.from}>${c.to}>${c.port || ""}`; if (seen.has(k)) return false; seen.add(k); return true; });
    if (E.def.layout && E.def.layout.groups) {
      E.def.layout.groups = E.def.layout.groups.map((g) => ({ ...g, nodes: g.nodes.filter((x) => !set.has(x)).concat(g.nodes.some((x) => set.has(x)) ? [nid] : []) })).filter((g) => g.nodes.length);
    }
    markDirty();
    if (S.canvas) { S.canvas.select(nid); S.canvas.flash([nid]); }
    toast(`Subproces ${saved.integration} aangemaakt (v${saved.version} op DEV) met ${steps.length} stap(pen). Deploy het ook naar de omgevingen waar dit proces draait.`);
  } catch (err) { toast(err.message, true); }
}

// ---------- triggerkeuze: "Hoe start dit proces?" ----------
const TRIGGER_DEFAULTS = (name) => ({
  manual: { type: "manual" },
  schedule: { type: "schedule", cron: "*/5 * * * *" },
  webhook: { type: "webhook", method: "POST", path: name },
  api: { type: "api", method: "GET", path: `${String(name).toLowerCase()}/{id}` },
  queue: { type: "queue", queue: "orders" },
  file: { type: "file", dir: "inbox", pattern: "*", intervalSeconds: 30, format: "text", after: "move" },
  ftp: { type: "ftp", credential: "", dir: "/out", pattern: "*", intervalSeconds: 30, format: "text", after: "move" }
});
const TRIGGER_HELP = {
  manual: "Starten met een knop in de GUI, via de API of via MCP.",
  schedule: "Periodiek: elke N minuten, dagelijks om een tijdstip, cron.",
  webhook: "Een systeem stuurt berichten naar een URL (POST).",
  api: "Een REST-endpoint met padparameters, API-key en OpenAPI-specificatie.",
  queue: "Elk bericht op een queue start het proces; mislukt → dead-letter.",
  file: "Nieuwe bestanden in een map van de omgeving.",
  ftp: "Nieuwe bestanden op een FTP-, FTPS- of SFTP-server."
};
function refreshTriggerBtn() {
  const b = $("#ed-trigger-btn");
  if (b && S.editor) b.textContent = `⚡ ${(PC.TRIGGERS[S.editor.def.trigger?.type] || { label: "Trigger kiezen" }).label}`;
  if (S.editor && S.editor.sideOpen) renderSide();
}
// Trigger van het open proces instellen (gebruikt door de triggerkeuze en de AI-assistent).
function setProcessTrigger(type, openConfig = true) {
  const E = S.editor;
  if (!E) return;
  if (S.canvas) S.canvas.pushHistory();
  if (type !== (E.def.trigger?.type || "manual")) E.def.trigger = TRIGGER_DEFAULTS(E.def.integration)[type];
  markDirty();
  if (S.canvas) S.canvas.redraw();
  refreshTriggerBtn();
  toast(`Trigger: ${PC.TRIGGERS[type].label}`);
  if (openConfig && type !== "manual") openNode("start");
}

function triggerChooser() {
  const E = S.editor;
  if (!E) return;
  const cur = E.def.trigger?.type || "manual";
  openModal(`<div class="ch"><h3>Hoe start dit proces?</h3><button class="x" data-close aria-label="Sluiten">×</button></div>
    <div class="cb"><p class="muted" style="margin:0 0 12px">Kies de starttrigger. Details (pad, schema, queue, beveiliging) stel je daarna in bij het startevent. De trigger wordt actief op elke omgeving waar je het proces deployt.</p>
      <div class="trig-grid">${Object.entries(PC.TRIGGERS).map(([k, v]) => `<button type="button" class="trig-card ${k === cur ? "on" : ""}" data-trig="${k}">
        <span class="trig-ic"><svg viewBox="0 0 24 24" width="22" height="22">${PC.iconSvg(PC.ICONS["t-" + k] ? "t-" + k : "start", "currentColor", 24, 0, 0, 1.8)}</svg></span>
        <span><b>${esc(v.label)}</b><small>${esc(TRIGGER_HELP[k] || v.desc)}</small></span></button>`).join("")}</div></div>`);
  document.querySelectorAll("#modal-box [data-trig]").forEach((b) => b.addEventListener("click", () => {
    closeModal();
    setProcessTrigger(b.dataset.trig);
  }));
}

// ---------- procesinstellingen als paneel rechts ----------
function renderSide() {
  const E = S.editor, d = E.def, el = $("#ed-side");
  if (!el) return;
  const trig = d.trigger || { type: "manual" };
  el.innerHTML = `<div class="side-h"><b>Instellingen</b><button class="x" data-act="ed-side-close" aria-label="Sluiten">×</button></div>
    <div class="side-b ndv-cb">
      <label for="ps-name">Naam</label><input class="f" id="ps-name" value="${esc(d.integration)}" ${E.isNew ? "" : "disabled"}>
      <div class="hint">${E.isNew ? "Begin met een letter; 3–64 tekens, geen spaties." : "De naam ligt vast na de eerste versie."}</div>
      <label for="ps-desc">Beschrijving</label><textarea class="f" id="ps-desc" style="min-height:70px;font-family:var(--sans)">${esc(d.description || "")}</textarea>
      <label>Starttrigger</label>
      <div class="row" style="justify-content:space-between"><span><b>${esc((PC.TRIGGERS[trig.type] || { label: trig.type }).label)}</b><br><span class="faint mono" style="font-size:.75rem">${esc(PC.triggerSub ? PC.triggerSub(trig, d.integration) : "")}</span></span>
        <span class="row"><button class="btn sm sec" data-act="ed-trigger">Wijzigen</button><button class="btn sm sec" data-act="ed-trigger-cfg">Instellen</button></span></div>
      <label for="ps-att">Retry-pogingen (externe stappen)</label><input class="f" id="ps-att" type="number" min="0" max="10" value="${d.retry?.attempts ?? 0}">
      <label for="ps-back">Backoff</label><select class="f" id="ps-back">${["exponential", "fixed", "none"].map((t) => `<option ${d.retry?.backoff === t ? "selected" : ""}>${t}</option>`).join("")}</select>
      <label for="ps-exh">Na de laatste poging</label><select class="f" id="ps-exh">${[["dead-letter-queue", "naar dead-letter queue"], ["fail", "falen"]].map(([v, l]) => `<option value="${v}" ${d.retry?.onExhaust === v ? "selected" : ""}>${l}</option>`).join("")}</select>
      <label>Versies</label>
      <div>${E.state ? ENVS.map((e) => `<span class="env ${e.id}" style="opacity:${E.state.envs[e.id] != null ? 1 : 0.35}">${e.label} ${E.state.envs[e.id] != null ? "v" + E.state.envs[e.id] : "—"}</span>`).join(" ") + `<div class="hint">Laatste versie: v${E.state.latestVersion}</div>` : '<span class="faint">Nog niet opgeslagen</span>'}</div>
    </div>`;
  const apply = () => {
    if (E.isNew) { d.integration = $("#ps-name").value.trim(); $("#ed-name").textContent = d.integration; }
    d.description = $("#ps-desc").value;
    d.retry = { attempts: Math.max(0, Math.min(10, Number($("#ps-att").value) || 0)), backoff: $("#ps-back").value, onExhaust: $("#ps-exh").value };
    markDirty();
  };
  el.querySelectorAll("input, textarea, select").forEach((x) => x.addEventListener(x.tagName === "SELECT" ? "change" : "input", apply));
}
function settingsModal() {
  const E = S.editor;
  E.sideOpen = !E.sideOpen;
  $("#ed-side")?.classList.toggle("hide", !E.sideOpen);
  if (E.sideOpen) renderSide();
}

function cleanDef(def) {
  const allowed = ["integration", "version", "description", "owner", "trigger", "steps", "connections", "layout", "retry", "monitoring", "agents", "approval"];
  const out = {};
  for (const k of allowed) if (def[k] !== undefined) out[k] = def[k];
  if (out.version !== undefined) out.version = String(out.version);
  if (!out.description) delete out.description;
  return JSON.parse(JSON.stringify(out));
}

// Wijzigingsnotitie bij opslaan (optioneel). null = geannuleerd.
function askNote(isNew) {
  return new Promise((resolve) => {
    openModal(`<div class="ch"><h3>${ic("save")} Opslaan als nieuwe versie op DEV</h3><button class="x" data-close aria-label="Sluiten">×</button></div>
      <form class="cb" id="note-form"><label class="xf-l" for="note-in">Wat is er veranderd? <span class="faint">(optioneel)</span></label>
        <input class="f" id="note-in" maxlength="500" autocomplete="off" placeholder="${isNew ? "Eerste versie" : "Bijv. retry verhoogd naar 5, e-mailstap toegevoegd"}">
        <div class="hint">De notitie staat bij de versie en helpt bij terugzetten en vergelijken.</div></form>
      <div class="cf"><button class="btn sec" data-close>Annuleren</button><button class="btn" id="note-ok" data-ico-done>${ic("save")}<span>Opslaan</span></button></div>`);
    let done = false;
    const finish = (v) => { if (done) return; done = true; closeModal(); resolve(v); };
    const input = document.getElementById("note-in");
    setTimeout(() => input.focus(), 0);
    document.getElementById("note-form").addEventListener("submit", (e) => { e.preventDefault(); finish(input.value.trim()); });
    document.getElementById("note-ok").addEventListener("click", () => finish(input.value.trim()));
    document.querySelectorAll("#modal-box [data-close]").forEach((b) => b.addEventListener("click", () => finish(null)));
  });
}

async function saveEditor() {
  const E = S.editor;
  if (!/^[A-Za-z][A-Za-z0-9_-]{2,63}$/.test(E.def.integration)) { E.sideOpen = true; $("#ed-side")?.classList.remove("hide"); renderSide(); return toast("Geef het proces eerst een geldige naam (begin met een letter, 3–64 tekens, geen spaties).", true); }
  const problems = validateGraph(E.def);
  if (problems.length) return toast(problems[0], true);
  const note = await askNote(E.isNew);
  if (note === null) return;
  const qs = new URLSearchParams();
  if (note) qs.set("note", note);
  if (E.isNew) qs.set("create", "true");
  const saved = await api(`/api/v1/integrations${qs.toString() ? `?${qs}` : ""}`, { body: { ...cleanDef(E.def), owner: who() } });
  if (E.isNew) localSet(`aip.test.${saved.integration}`, E.testInput);
  toast(`Opgeslagen als v${saved.version} op DEV`);
  S.editor = null;
  go(`editor/${encodeURIComponent(saved.integration)}`);
}

// EXPORT / IMPORT — processen als bestand (Integration-as-Code + subprocessen + benodigdheden)
function downloadJson(obj, filename) {
  const blob = new Blob([JSON.stringify(obj, null, 2) + "\n"], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
const REQ_LABELS = [["credentials", "Koppelingen"], ["datatables", "Datatabellen"], ["queues", "Queues"], ["subprocesses", "Subprocessen"]];
const reqItems = (r) => REQ_LABELS.filter(([k]) => r && r[k] && r[k].length).map(([k, l]) => `<li>${l}: ${r[k].map((n) => `<code>${esc(n)}</code>`).join(", ")}</li>`).join("");
const fmtBytes = (n) => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} kB`);

// name: een opgeslagen proces (uit de lijst); zonder name: de huidige canvas in de editor.
async function exportModal(name) {
  const E = !name ? S.editor : null;
  if (!name && !E) return;
  const opts = { subs: true, test: false };
  const build = () => {
    if (E) {
      let testInput;
      try { testInput = opts.test ? JSON.parse(E.testInput || "{}") : undefined; } catch { testInput = undefined; }
      return api("/api/v1/integrations/export", { body: { definition: cleanDef(E.def), subprocesses: opts.subs, by: who(), ...(testInput !== undefined ? { testInput } : {}) } });
    }
    return api(`/api/v1/integrations/${encodeURIComponent(name)}/export?subprocesses=${opts.subs}&by=${encodeURIComponent(who())}`);
  };
  let bundle = await build();
  const title = bundle.process.integration;
  openModal(`<div class="ch"><h3>⇩ ${esc(title)} exporteren</h3><button class="x" data-close aria-label="Sluiten">×</button></div>
    <div class="cb xfer">
      <p class="muted" style="margin-top:0">Het proces als JSON-bestand (Integration-as-Code): om te importeren op een ander platform, te delen of in Git te bewaren. Wachtwoorden en sleutels van koppelingen zitten er nooit in.</p>
      ${E && E.dirty ? `<div class="xf-note warn">Dit is de huidige canvas, inclusief wijzigingen die nog niet zijn opgeslagen.</div>` : ""}
      <div class="row" style="gap:18px;margin:6px 0 10px"><label class="chk"><input type="checkbox" id="ex-subs" checked> Gebruikte subprocessen meenemen</label>
      ${E ? `<label class="chk"><input type="checkbox" id="ex-test"> Testdata meenemen</label>` : ""}</div>
      <div id="ex-req"></div>
      <label for="ex-code" class="xf-l">JSON</label>
      <textarea class="f mono" id="ex-code" readonly spellcheck="false"></textarea>
    </div>
    <div class="cf"><span class="faint" id="ex-size" style="margin-right:auto;align-self:center;font-size:.8rem"></span><button class="btn sec" id="ex-copy">Kopiëren</button><button class="btn" id="ex-dl">Downloaden</button></div>`);
  const fill = () => {
    const txt = JSON.stringify(bundle, null, 2);
    $("#ex-code").value = txt;
    const items = reqItems(bundle.requires);
    $("#ex-req").innerHTML = `<div class="xf-note">${bundle.subprocesses.length ? `Bevat ${bundle.subprocesses.length} subproces(sen): ${bundle.subprocesses.map((x) => `<b>${esc(x.integration)}</b>`).join(", ")}.<br>` : ""}
      ${items ? `Nodig op het doelplatform (alleen de naam wordt meegenomen):<ul>${items}</ul>` : "Gebruikt geen koppelingen, datatabellen of queues."}</div>`;
    $("#ex-size").textContent = `${bundle.process.integration}.aip.json · ${fmtBytes(new Blob([txt]).size)}`;
  };
  fill();
  const refresh = async () => { try { bundle = await build(); fill(); } catch (err) { toast(err.message, true); } };
  $("#ex-subs").addEventListener("change", (e) => { opts.subs = e.target.checked; refresh(); });
  $("#ex-test")?.addEventListener("change", (e) => { opts.test = e.target.checked; refresh(); });
  $("#ex-copy").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText($("#ex-code").value); toast("Export gekopieerd"); }
    catch { $("#ex-code").select(); toast("Kopiëren niet toegestaan — de tekst is geselecteerd (⌘C)", true); }
  });
  $("#ex-dl").addEventListener("click", () => { downloadJson(bundle, `${bundle.process.integration}.aip.json`); toast(`${bundle.process.integration}.aip.json gedownload`); });
}

function importModal() {
  const E = S.view === "editor" ? S.editor : null;
  let bundle = null, plan = null, seq = 0, timer = null;
  const state = { name: "", onConflict: "version", subprocesses: "missing" };
  openModal(`<div class="ch"><h3>⇧ Proces importeren</h3><button class="x" data-close aria-label="Sluiten">×</button></div>
    <div class="cb xfer">
      <div class="xf-drop" id="im-drop"><b>Sleep een exportbestand (.json) hierheen</b><br><span class="muted">of</span> <label class="lnk" for="im-file" tabindex="0">kies een bestand</label><input type="file" id="im-file" accept=".json,application/json" hidden></div>
      <label for="im-src" class="xf-l">…of plak de JSON</label>
      <textarea class="f mono" id="im-src" spellcheck="false" placeholder='Een AIP-export ({"format": "aip.process-export", …}) of een procesdefinitie ({"integration": …, "trigger": …, "steps": […]})'></textarea>
      <div id="im-plan"></div>
    </div>
    <div class="cf"><button class="btn sec" data-close>Annuleren</button><button class="btn sec" id="im-open" disabled>Openen in de editor</button><button class="btn" id="im-save" disabled>Opslaan op DEV</button></div>`);
  const planEl = $("#im-plan");
  const setBusy = (on) => { $("#im-open").disabled = on || !plan; $("#im-save").disabled = on || !plan; };
  const body = (extra = {}) => ({ bundle, ...(state.name ? { name: state.name } : {}), onConflict: state.onConflict, subprocesses: state.subprocesses, owner: who(), ...extra });
  async function analyze() {
    const my = ++seq;
    plan = null;
    setBusy(true);
    const txt = $("#im-src").value.trim();
    if (!txt) { planEl.innerHTML = ""; bundle = null; return; }
    try { bundle = JSON.parse(txt); } catch (err) { planEl.innerHTML = `<div class="xf-note err">Geen geldige JSON: ${esc(err.message)}</div>`; return; }
    const r = await fetch("/api/v1/integrations/import", { method: "POST", headers: { "content-type": "application/json", "x-aip-user": who() }, body: JSON.stringify(body({ dryRun: true })) });
    const res = await r.json().catch(() => ({}));
    if (my !== seq) return;
    if (!r.ok) {
      planEl.innerHTML = `<div class="xf-note err"><b>${esc(res.error || res.message || "Import niet mogelijk")}</b>${res.details ? `<ul>${res.details.map((d) => `<li>${esc(d)}</li>`).join("")}</ul>` : ""}</div>`;
      return;
    }
    plan = res;
    if (!state.name) state.name = res.process.name;
    drawPlan();
    setBusy(false);
  }
  function drawPlan() {
    const p = plan, m = p.meta || {}, src = m.source || {};
    const exists = p.process.action === "new-version";
    const envs = src.environments ? Object.entries(src.environments).filter(([, v]) => v != null).map(([e, v]) => `${e.toUpperCase()} v${v}`).join(" · ") : "";
    const miss = reqItems(p.missing);
    planEl.innerHTML = `
      ${m.exportedAt ? `<div class="faint" style="font-size:.78rem;margin:10px 0 2px">Export van <b>${esc(src.integration || p.process.originalName)}</b>${src.version ? ` v${esc(src.version)}` : ""}${envs ? ` (${esc(envs)})` : ""} · ${fmtDateTime(m.exportedAt)}${m.exportedBy ? ` door ${esc(m.exportedBy)}` : ""}</div>` : `<div class="faint" style="font-size:.78rem;margin:10px 0 2px">Kale procesdefinitie (Integration-as-Code)</div>`}
      <div class="xf-grid">
        <label for="im-name" class="xf-l">Naam</label>
        <div><input class="f mono" id="im-name" value="${esc(state.name)}" pattern="[A-Za-z][A-Za-z0-9_-]{2,63}">
          <div class="hint">${exists ? `Er bestaat al een proces <b>${esc(p.process.name)}</b>.` : `Wordt een nieuw proces <b>${esc(p.process.name)}</b> (v1 op DEV).`}</div></div>
        ${exists ? `<label for="im-conf" class="xf-l">Bestaat al</label>
        <div><select class="f" id="im-conf"><option value="version" ${state.onConflict === "version" ? "selected" : ""}>Nieuwe versie van ${esc(p.process.name)} maken</option><option value="rename">Als nieuw proces met een vrije naam</option></select></div>` : ""}
        ${p.subprocesses.length ? `<label for="im-subs" class="xf-l">Subprocessen</label>
        <div><select class="f" id="im-subs"><option value="missing" ${state.subprocesses === "missing" ? "selected" : ""}>Alleen ontbrekende importeren</option><option value="all" ${state.subprocesses === "all" ? "selected" : ""}>Alle importeren (bestaande krijgen een nieuwe versie)</option><option value="none" ${state.subprocesses === "none" ? "selected" : ""}>Niet importeren</option></select>
          <ul class="xf-subs">${p.subprocesses.map((x) => `<li><b>${esc(x.name)}</b> ${x.action === "create" ? '<span class="chip ok">nieuw</span>' : x.action === "new-version" ? '<span class="chip info">nieuwe versie</span>' : `<span class="chip none">${x.exists ? "bestaat al — overslaan" : "overslaan"}</span>`}</li>`).join("")}</ul></div>` : ""}
      </div>
      ${miss ? `<div class="xf-note warn"><b>Ontbreekt nog op DEV.</b> Het proces wordt wel geïmporteerd, maar maak deze eerst aan voordat je het uitvoert:<ul>${miss}</ul></div>` : `<div class="xf-note ok">Alle benodigde koppelingen, tabellen, queues en subprocessen zijn aanwezig.</div>`}
      ${E && E.dirty ? `<div class="xf-note warn">“Openen in de editor” vervangt de huidige canvas; niet-opgeslagen wijzigingen gaan verloren.</div>` : ""}`;
    $("#im-name").addEventListener("input", (e) => {
      const v = e.target.value.trim();
      e.target.classList.toggle("bad", !/^[A-Za-z][A-Za-z0-9_-]{2,63}$/.test(v));
      if (e.target.classList.contains("bad")) { setBusy(true); return; }
      state.name = v;
      state.onConflict = "version";
      clearTimeout(timer);
      timer = setTimeout(async () => { const pos = e.target.selectionStart; await analyze(); const n = $("#im-name"); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch { /* */ } } }, 350);
    });
    $("#im-conf")?.addEventListener("change", async (e) => {
      state.onConflict = e.target.value;
      if (state.onConflict === "rename") { const keep = state.name; state.name = ""; await analyze(); if (!plan) state.name = keep; else state.onConflict = "version"; }
      else analyze();
    });
    $("#im-subs")?.addEventListener("change", (e) => { state.subprocesses = e.target.value; analyze(); });
  }
  const load = (text) => { $("#im-src").value = text; state.name = ""; state.onConflict = "version"; analyze(); };
  $("#im-src").addEventListener("input", () => { clearTimeout(timer); state.name = ""; timer = setTimeout(analyze, 350); });
  $("#im-file").addEventListener("change", async (e) => { const f = e.target.files[0]; if (f) load(await f.text()); });
  const drop = $("#im-drop");
  drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("on"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("on"));
  drop.addEventListener("drop", async (e) => {
    e.preventDefault();
    drop.classList.remove("on");
    const f = e.dataTransfer.files[0];
    if (f) load(await f.text());
    else if (e.dataTransfer.getData("text/plain")) load(e.dataTransfer.getData("text/plain"));
  });
  $("#im-save").addEventListener("click", async () => {
    setBusy(true);
    try {
      const r = await api("/api/v1/integrations/import", { body: body() });
      closeModal();
      toast(`${r.saved.integration} geïmporteerd als v${r.saved.version} op DEV${r.savedSubprocesses.length ? ` (+${r.savedSubprocesses.length} subproces)` : ""}`);
      if (bundle.testInput !== undefined) localSet(`aip.test.${r.saved.integration}`, JSON.stringify(bundle.testInput, null, 2));
      S.editor = null;
      go(`editor/${encodeURIComponent(r.saved.integration)}`);
    } catch (err) { toast(err.message, true); setBusy(false); }
  });
  $("#im-open").addEventListener("click", async () => {
    setBusy(true);
    try {
      const r = await api("/api/v1/integrations/import", { body: body({ saveProcess: false }) });
      closeModal();
      const def = r.definition;
      PC.normalize(def);
      const NE = { name: "new", isNew: true, def, dirty: true, state: null, tab: "editor", lastRun: null, triggerAsked: true,
        testInput: bundle.testInput !== undefined ? JSON.stringify(bundle.testInput, null, 2) : DEFAULT_TEST_INPUT };
      S.editor = NE;
      toast(`${def.integration} geopend in de editor — nog niet opgeslagen${r.savedSubprocesses.length ? `; ${r.savedSubprocesses.length} subproces(sen) opgeslagen op DEV` : ""}`);
      if (location.hash === "#editor/new") { destroyCanvas(); renderEditor($("#main")); } else go("editor/new");
    } catch (err) { toast(err.message, true); setBusy(false); }
  });
  setTimeout(() => $("#im-src")?.focus(), 30);
}

// PROCESINSTANTIES
VIEWS.instances = async (main) => {
  const filter = S.param || S.env;
  const runs = await api(`/api/v1/runs?limit=200${filter !== "all" ? `&env=${filter}` : ""}`);
  main.innerHTML = `
  <div class="head"><div><h1>Procesinstanties</h1><p>Elke uitvoering van een proces, met het gevolgde pad en resultaat per stap.</p></div>
    <div class="row">${[["all", "Alle"], ...ENVS.map((e) => [e.id, e.label])].map(([id, l]) => `<button class="btn sm ${filter === id ? "" : "sec"}" data-go="instances/${id}">${l}</button>`).join("")}</div></div>
  <div class="card"><div class="tw">${runs.length ? `<table><thead><tr><th>Gestart</th><th>Proces</th><th>Omgeving</th><th>Versie</th><th>Gestart door</th><th>Status</th><th>Stappen</th><th>Duur</th></tr></thead><tbody>
    ${runs.map((x) => `<tr class="click" data-go="instance/${x.id}"><td class="mono">${fmtDateTime(x.startedAt)}</td><td><b>${esc(x.integration)}</b></td><td><span class="env ${x.env}">${x.env}</span></td><td class="ver">${verLabel(x)}</td><td><span class="chip none">${esc(x.triggeredBy || "—")}</span></td>
      <td>${x.status === "success" ? '<span class="chip ok">geslaagd</span>' : `<span class="chip err">gefaald${x.deadLettered ? " · DLQ" : ""}</span>`}</td>
      <td class="mono">${x.steps.filter((s) => s.status === "ok").length}/${x.steps.length}</td><td class="mono">${x.durationMs} ms</td></tr>`).join("")}
  </tbody></table>` : `<div class="empty">Geen instanties${filter !== "all" ? " op " + filter.toUpperCase() : ""}.</div>`}</div></div>`;
};

VIEWS.instance = async (main) => {
  const run = await api(`/api/v1/runs/${encodeURIComponent(S.param)}`);
  let def = null;
  if (run.version != null) def = await api(`/api/v1/integrations/${encodeURIComponent(run.integration)}/versions/${run.version}`).catch(() => null);
  if (!def && run.definition) def = run.definition;
  if (!def) def = { trigger: { type: "?" }, steps: run.steps.map((s) => ({ id: s.id, type: s.type })) };
  def = JSON.parse(JSON.stringify(def));
  const stepData = (id) => {
    const s = run.steps.filter((x) => x.id === id).pop();
    if (!s) return `<p class="muted">Deze stap is in deze uitvoering niet bereikt.</p>`;
    return `<div class="ndv-src"><b>${esc(s.id)}</b> · ${s.status === "ok" ? '<span class="chip ok">ok</span>' : '<span class="chip err">gefaald</span>'} · ${s.ms} ms${s.port ? ` · ${s.port === "true" ? "ja" : "nee"}-pad` : ""}</div>
      <div class="muted" style="font-size:.75rem;font-weight:600;margin:8px 0 4px">INPUT</div><pre class="code">${esc(JSON.stringify(s.input ?? null, null, 2))}</pre>
      <div class="muted" style="font-size:.75rem;font-weight:600;margin:10px 0 4px">${s.status === "ok" ? "OUTPUT" : "FOUT"}</div><pre class="code">${esc(JSON.stringify(s.status === "ok" ? s.output ?? null : s.error, null, 2))}</pre>`;
  };
  main.innerHTML = `
  <div class="crumbs"><a href="#instances">Procesinstanties</a> / ${esc(run.id.slice(0, 8))}</div>
  <div class="head"><div><h1>${esc(run.integration)} <span class="ver">${verLabel(run)}</span></h1>
    <div class="row" style="margin-top:6px"><span class="env ${run.env}">${run.env}</span>${run.status === "success" ? '<span class="chip ok">geslaagd</span>' : '<span class="chip err">gefaald</span>'}${run.deadLettered ? '<span class="chip warn">in dead-letter queue</span>' : ""}<span class="faint mono">${fmtDateTime(run.startedAt)} · ${run.durationMs} ms</span></div></div>
    <button class="btn sec" data-go="editor/${encodeURIComponent(run.integration)}">Open proces</button></div>
  <div class="card" style="margin-bottom:14px;overflow:hidden"><div class="ch"><h3>Uitgevoerd pad</h3><div class="legend"><span><i style="background:#1f9d55"></i>geslaagd</span><span><i style="background:#d64545"></i>gefaald</span><span><i style="background:#dde3ee"></i>niet bereikt</span><span>klik een element voor de data</span></div></div><div id="inst-canvas" style="height:340px"></div></div>
  <div class="g2">
    <div class="card"><div class="ch"><h3>Stappen</h3></div><div class="tw"><table><thead><tr><th>Stap</th><th>Type</th><th>Status</th><th>Pad</th><th>Pogingen</th><th>Duur</th><th>Melding</th></tr></thead><tbody>
      ${run.steps.map((s) => `<tr class="click" data-step="${esc(s.id)}"><td><b>${esc(s.id)}</b></td><td>${esc((STEP_TYPES[s.type] || {}).label || s.type)}</td><td>${s.status === "ok" ? '<span class="chip ok">ok</span>' : '<span class="chip err">gefaald</span>'}</td><td class="mono">${s.port ? (s.port === "true" ? "ja" : "nee") : ""}</td><td class="mono">${s.attempts}</td><td class="mono">${s.ms} ms</td><td class="muted">${esc(s.error || "")}</td></tr>`).join("")}
    </tbody></table></div></div>
    <div class="card"><div class="ch"><h3 id="inst-data-h">${run.status === "success" ? "Resultaat" : "Fout"}</h3></div><div class="cb" id="inst-data"><pre class="code">${esc(JSON.stringify(run.status === "success" ? run.output : { error: run.error }, null, 2))}</pre></div></div>
  </div>`;
  const showStep = (id) => {
    if (!id || id === "start") return;
    $("#inst-data-h").textContent = "Stapdata";
    $("#inst-data").innerHTML = stepData(id);
  };
  S.canvas = PC.mount($("#inst-canvas"), { def, run, readonly: true, onSelect: showStep });
  S.canvas.fit();
  main.querySelectorAll("tr[data-step]").forEach((tr) => tr.addEventListener("click", () => showStep(tr.dataset.step)));
};

// OMGEVINGEN / DEPLOYMENTS
// De oude pagina Omgevingen is vervangen door Infrastructuur (omgevingsvarianten).
VIEWS.deployments = async () => { location.replace("#infra"); };

// GOEDKEURINGEN
VIEWS.approvals = async (main) => {
  const all = await api("/api/v1/approvals");
  const pending = all.filter((a) => a.status === "pending");
  const done = all.filter((a) => a.status !== "pending").slice(0, 20);
  const card = (a, acts) => {
    const ok = a.approvals.filter((x) => x.decision === "approve");
    const env = a.action.target?.environment;
    return `<div class="ap"><div class="row"><span class="t">${esc(a.action.type)}</span><span class="risk ${a.riskLevel}">${a.riskLevel}</span>${env ? `<span class="env ${env}">${env}</span>` : ""}${a.action.target?.integration ? `<b>${esc(a.action.target.integration)}</b>` : ""}</div>
      <div class="m">${esc(a.action.reason || "")}</div>
      <div class="m mono" style="font-size:.74rem">door ${esc(a.action.proposedBy)} · ${fmtDateTime(a.createdAt)} · goedkeuringen ${ok.length}/${a.requiredApprovals}${ok.length ? " (" + ok.map((x) => esc(x.approver)).join(", ") + ")" : ""} · status <b>${a.status}</b>${a.status === "failed" ? " — " + esc(a.result?.error || "") : ""}</div>
      ${acts ? `<label class="ap-sel"><input type="checkbox" data-sel="${a.id}" aria-label="Selecteer ${esc(a.action.type)} ${esc(a.action.target?.integration || "")}"></label>` : ""}
      ${acts ? `<div class="acts"><button class="btn sm ok" data-act="approve" data-id="${a.id}">Goedkeuren</button><button class="btn sm no" data-act="reject" data-id="${a.id}">Afwijzen</button></div>` : ""}</div>`;
  };
  main.innerHTML = `
  <div class="head"><div><h1>Goedkeuringen</h1><p>Human-in-the-loop. Je keurt goed als <b>${esc(who())}</b>. Vier-ogenprincipe: ${fourEyesOn() ? '<span class="chip ok">aan</span> — de indiener mag niet zelf goedkeuren en PROD vraagt 2 personen; wissel rechtsboven van gebruiker' : '<span class="chip warn">uit</span> — één goedkeuring volstaat, ook door de indiener'} · <a href="#settings">wijzigen</a></p></div></div>
  <div class="card" style="margin-bottom:14px">${bulkBar("approvals", [["approve", "Goedkeuren", "ok"], ["reject", "Afwijzen", "no"]])}<div class="ch"><h3>${pending.length ? `<label class="chk" style="display:inline-flex;gap:8px"><input type="checkbox" data-selall aria-label="Alle openstaande selecteren"> Openstaand (${pending.length})</label>` : `Openstaand (0)`}</h3></div><div class="cb">${pending.length ? pending.map((a) => card(a, true)).join("") : '<div class="empty">Niets openstaand.</div>'}</div></div>
  <div class="card"><div class="ch"><h3>Afgehandeld</h3></div><div class="cb">${done.length ? done.map((a) => card(a, false)).join("") : '<div class="empty">—</div>'}</div></div>`;
};

BULK.approvals = {
  approve: (keys) => bulkDecide(keys, "approve"),
  reject: (keys) => bulkDecide(keys, "reject")
};
async function bulkDecide(keys, act) {
  let ok = 0, bad = 0, err = "";
  for (const id of keys) { // na elkaar: de volgorde van goedkeuren telt bij vier-ogen
    try { await api(`/api/v1/approvals/${id}/${act}`, { body: { approver: who() } }); ok++; }
    catch (e) { bad++; err = err || e.message; }
  }
  toast(`${ok} ${act === "approve" ? "goedgekeurd" : "afgewezen"} door ${who()}${bad ? ` · ${bad} niet (${err})` : ""}`, !ok && bad > 0);
  refreshStatus();
  render();
}

// AI-ASSISTENT
VIEWS.assistant = async (main) => {
  main.innerHTML = `
  <div class="head"><div><h1>AI-assistent</h1><p>Beschrijf een integratie in gewone taal. De Builder Agent maakt het proces; jij controleert het in de editor.</p></div></div>
  <div class="card"><div class="cb">
    <label for="ai-prompt" class="muted" style="font-size:.8rem;font-weight:600">OPDRACHT</label>
    <textarea class="f" id="ai-prompt" style="font-family:var(--sans);font-size:.92rem;min-height:110px">Maak een integratie die iedere nieuwe webshop-order naar het ERP stuurt. Controleer duplicaten op order-id en retry drie keer; daarna naar de dead-letter queue.</textarea>
    <div class="row" style="margin-top:12px"><button class="btn" data-act="ai-design">✦ Ontwerp proces</button><span class="faint" id="ai-by"></span></div>
    <div id="ai-out" style="margin-top:14px"></div>
  </div></div>`;
};

// INCIDENTEN
VIEWS.incidents = async (main) => {
  const [list, ints] = await Promise.all([api("/api/v1/incidents"), api("/api/v1/integrations")]);
  main.innerHTML = `
  <div class="head"><div><h1>Incidenten</h1><p>De Monitoring Agent meldt incidenten; de Recovery Agent stelt herstel voor dat via goedkeuring loopt.</p></div></div>
  <div class="card" style="margin-bottom:14px"><div class="ch"><h3>Incident simuleren</h3></div><div class="cb">
    <div class="g2" style="grid-template-columns:1fr 1fr">
      <div><label class="muted" for="inc-int" style="font-size:.75rem;font-weight:600">PROCES</label><select class="f" id="inc-int">${ints.map((i) => `<option>${esc(i.integration)}</option>`).join("") || "<option>WebshopToErp</option>"}</select></div>
      <div><label class="muted" for="inc-sym" style="font-size:.75rem;font-weight:600">SYMPTOOM</label><select class="f" id="inc-sym"><option value="latency_increase">Latency loopt op</option><option value="queue_depth">Queue loopt vol</option><option value="error_rate">Foutpercentage stijgt</option></select></div>
    </div>
    <div class="row" style="margin-top:12px"><button class="btn" data-act="incident">Meld incident</button><span class="faint" id="inc-by"></span></div></div></div>
  <div class="card"><div class="ch"><h3>Gemelde incidenten (${list.length})</h3></div><div class="tw">${list.length ? `<table><thead><tr><th>Proces</th><th>Ernst</th><th>Probleem</th><th>Symptoom</th></tr></thead><tbody>${list.slice().reverse().map((i) => `<tr><td><b>${esc(i.integration)}</b></td><td><span class="chip ${i.severity === "high" || i.severity === "critical" ? "err" : "warn"}">${esc(i.severity)}</span></td><td>${esc(i.problem)}</td><td class="mono">${esc(i.rootCause?.symptom || "")}</td></tr>`).join("")}</tbody></table>` : '<div class="empty">Geen incidenten.</div>'}</div></div>`;
};

// AUDIT
VIEWS.audit = async (main) => {
  const a = await api("/api/v1/audit?limit=150");
  main.innerHTML = `
  <div class="head"><div><h1>Audit log</h1><p>Append-only, met hash-keten. Elke wijziging is verifieerbaar.</p></div>
    <span class="chip ${a.integrity.valid ? "ok" : "err"}">${a.integrity.valid ? "✓ keten intact" : "✕ keten verbroken bij #" + a.integrity.brokenAt}</span></div>
  <div class="card"><div class="tw"><table><thead><tr><th>#</th><th>Tijd</th><th>Actor</th><th>Gebeurtenis</th><th>Onderwerp</th><th>Hash</th></tr></thead><tbody>
    ${a.entries.slice().reverse().map((e) => `<tr><td class="mono">${e.seq}</td><td class="mono">${fmtDateTime(e.at)}</td><td>${esc(e.actor)}</td><td class="mono">${esc(e.event)}</td><td class="mono faint">${esc((e.subject || "").slice(0, 24))}</td><td class="mono faint">${e.hash.slice(0, 12)}…</td></tr>`).join("")}
  </tbody></table></div></div>`;
};

// CATALOGUS & API
VIEWS.catalog = async (main) => {
  const c = await api("/api/v1/catalog");
  main.innerHTML = `
  <div class="head"><div><h1>Catalogus &amp; API</h1><p>Alles in deze GUI is ook machine-leesbaar en via de API aan te sturen.</p></div></div>
  <div class="g2" style="margin-bottom:14px">
    <div class="card"><div class="ch"><h3>Agents &amp; bevoegdheden</h3></div><div class="tw"><table><thead><tr><th>Agent</th><th>Rol</th><th>Acties (max. risico)</th></tr></thead><tbody>
      ${c.agents.map((a) => `<tr><td><b>${esc(a.name)}</b></td><td class="muted" style="font-size:.8rem">${esc(a.role)}</td><td>${a.capabilities.map((x) => `<span class="mono" style="font-size:.72rem">${esc(x.action)}</span> <span class="risk ${x.maxRisk}">${x.maxRisk}</span>`).join("<br>")}</td></tr>`).join("")}
    </tbody></table></div></div>
    <div class="card"><div class="ch"><h3>Machine-interfaces</h3></div><div class="cb stack" style="gap:8px">
      ${[["OpenAPI-specificatie", "/openapi.json"], ["Swagger UI", "/docs"], ["Catalogus (JSON)", "/api/v1/catalog"], ["MCP-manifest", "/api/v1/mcp/manifest"], ["Dashboard (JSON)", "/api/v1/dashboard"], ["Event-stream (SSE)", "/api/v1/events"]].map(([l, u]) => `<div class="row" style="justify-content:space-between"><span>${l}</span><a class="mono" href="${u}" target="_blank" rel="noopener">${u}</a></div>`).join("")}
    </div></div>
  </div>`;
};

// LIVE EVENTS
VIEWS.events = async (main) => {
  main.innerHTML = `
  <div class="head"><div><h1>Live events</h1><p>Elke statuswijziging in het platform, realtime.</p></div></div>
  <div class="card"><div class="cb" id="feed">${renderFeed()}</div></div>`;
};
function renderFeed() {
  return S.events.length ? S.events.map((e) => `<div class="ev"><span class="t">${fmtTime(e.at)}</span><span class="ty">${esc(e.type)}</span><span class="muted">${esc(JSON.stringify(e.data).slice(0, 140))}</span></div>`).join("") : '<div class="empty">Wachten op events…</div>';
}

// ---------- acties ----------
// Subprocessen die het proces aanroept maar die (nog) niet op de doelomgeving staan.
async function missingSubprocesses(name, env) {
  const [def, deps] = await Promise.all([api(`/api/v1/integrations/${encodeURIComponent(name)}`), api("/api/v1/deployments")]);
  const subs = [...new Set((def.steps || []).filter((x) => x.type === "subprocess" && x.config && x.config.process).map((x) => x.config.process))];
  return subs.filter((p) => { const d = deps.find((x) => x.integration === p); return !d || d.envs[env] == null; })
    .map((p) => { const d = deps.find((x) => x.integration === p); return { name: p, exists: Boolean(d), promotable: Boolean(d && (d.promotable || []).includes(env)) }; });
}

async function deployTo(name, env, version, chosenTargets) {
  let missing = [];
  try { missing = await missingSubprocesses(name, env); } catch { /* controle is best-effort */ }
  if (missing.length) {
    openModal(`<div class="ch"><h3>Subprocessen ontbreken op ${env.toUpperCase()}</h3><button class="x" data-close aria-label="Sluiten">×</button></div>
      <div class="cb"><p><b>${esc(name)}</b> roept subprocessen aan die nog niet op ${env.toUpperCase()} staan. Zonder die subprocessen faalt het proces daar.</p>
        <ul style="margin:8px 0 0;padding-left:18px">${missing.map((m) => `<li><b>${esc(m.name)}</b> — ${!m.exists ? '<span class="chip err">bestaat niet</span>' : m.promotable ? '<span class="chip ok">kan mee gedeployed worden</span>' : '<span class="chip warn">staat nog niet op de vorige omgeving</span>'}</li>`).join("")}</ul></div>
      <div class="cf"><button class="btn sec" data-close>Annuleren</button><button class="btn sec" id="dp-only">Alleen ${esc(name)}</button><button class="btn" id="dp-all" ${missing.some((m) => m.promotable) ? "" : "disabled"}>Subprocessen ook deployen</button></div>`);
    await new Promise((resolve) => {
      document.getElementById("dp-only").addEventListener("click", () => { closeModal(); resolve(); });
      document.getElementById("dp-all").addEventListener("click", async () => {
        closeModal();
        for (const m of missing.filter((x) => x.promotable)) {
          try {
            const r = await api(`/api/v1/integrations/${encodeURIComponent(m.name)}/deploy`, { body: { toEnv: env, proposedBy: who(), reason: `Subproces van ${name}` } });
            toast(`Subproces ${m.name}: ${r.status === "pending" ? "wacht op goedkeuring" : r.status}`);
          } catch (err) { toast(`${m.name}: ${err.message}`, true); }
        }
        resolve();
      });
      document.querySelectorAll("#modal-box [data-close]").forEach((b) => b.addEventListener("click", () => resolve("cancel")));
    }).then((r) => { if (r === "cancel") throw new Error("Deploy geannuleerd"); });
  }
  // Heeft de omgeving meerdere omgevingsvarianten (bijv. PROD op AWS en Azure)? Dan eerst kiezen.
  const targets = chosenTargets !== undefined ? chosenTargets : window.chooseTargets ? await window.chooseTargets(name, env, { deploy: true }) : null;
  if (targets === "cancel") throw new Error("Deploy geannuleerd");
  const a = await api(`/api/v1/integrations/${encodeURIComponent(name)}/deploy`, { body: { toEnv: env, proposedBy: who(), ...(version ? { version: Number(version) } : {}), ...(targets ? { targets } : {}) } });
  if (a.status === "pending") toast(`Deploy naar ${env.toUpperCase()} wacht op ${a.requiredApprovals} goedkeuring(en)`);
  else if (a.status === "executed") toast(`${name} gedeployed naar ${env.toUpperCase()}`);
  else toast(`Deploy: ${a.status}${a.result?.error ? " — " + a.result.error : ""}`, a.status === "failed");
  refreshStatus();
  render();
}
function runModal(name, envDefault) {
  openModal(`<div class="ch"><h3>▶ ${esc(name)} uitvoeren</h3><button class="x" data-close aria-label="Sluiten">×</button></div>
    <div class="cb"><label class="muted" for="run-env" style="font-size:.75rem;font-weight:600">OMGEVING</label>
      <select class="f" id="run-env">${ENVS.map((e) => `<option value="${e.id}" ${e.id === envDefault ? "selected" : ""}>${e.name}</option>`).join("")}</select>
      <label class="muted" for="run-input" style="font-size:.75rem;font-weight:600;display:block;margin-top:12px">INVOER (JSON)</label>
      <textarea class="f" id="run-input">${esc(JSON.stringify({ orderId: "TEST-ORDER-" + Math.floor(Math.random() * 90000 + 10000), customer: { email: "klant@example.nl" } }, null, 2))}</textarea>
      <div class="hint">Uitvoeren op PROD vraagt eerst goedkeuring.</div></div>
    <div class="cf"><button class="btn sec" data-close>Annuleren</button><button class="btn" id="run-go">Uitvoeren</button></div>`);
  $("#run-go").addEventListener("click", async () => {
    let input;
    try { input = JSON.parse($("#run-input").value || "{}"); } catch { return toast("Invoer is geen geldige JSON", true); }
    try {
      const a = await api(`/api/v1/integrations/${encodeURIComponent(name)}/run`, { body: { env: $("#run-env").value, input, proposedBy: who() } });
      closeModal();
      if (a.status === "pending") { toast("Uitvoering wacht op goedkeuring"); return; }
      const run = a.result?.run;
      if (run) { toast(run.status === "success" ? `Geslaagd in ${run.durationMs} ms` : `Gefaald: ${run.error}`, run.status !== "success"); go(`instance/${run.id}`); }
      else toast(a.result?.error || a.status, true);
    } catch (e) { toast(e.message, true); }
  });
}
async function demoTraffic() {
  const env = S.env;
  if (env === "prod") return toast("Testverkeer op PROD vraagt goedkeuring per uitvoering; kies DEV, TEST of ACC.", true);
  const deps = (await api("/api/v1/deployments")).filter((d) => d.envs[env] != null);
  if (!deps.length) return toast(`Er is nog geen proces gedeployed op ${env.toUpperCase()}.`, true);
  let n = 0;
  for (let i = 0; i < 12; i++) {
    const d = deps[i % deps.length];
    const bad = i % 5 === 3; // af en toe een foute invoer
    const input = bad ? { customer: {} } : { orderId: `ORD-${Date.now()}-${i}`, id: `ORD-${i}-${Date.now()}`, kvkNumber: String(10000000 + i), customer: { email: `klant${i}@example.nl` } };
    try { await api(`/api/v1/integrations/${encodeURIComponent(d.integration)}/run`, { body: { env, input, proposedBy: "load-generator" } }); n++; } catch {}
  }
  toast(`${n} testuitvoeringen op ${env.toUpperCase()}`);
  render();
}

document.addEventListener("click", async (e) => {
  const g = e.target.closest("[data-go]");
  if (g && !e.target.closest("[data-act], .selc, [data-sel], [data-selall]")) { go(g.dataset.go); return; }
  const pick = e.target.closest("[data-envpick]");
  if (pick) { const btn = document.querySelector(`#envs [data-env="${pick.dataset.envpick}"]`); if (btn) btn.click(); return; }
  const b = e.target.closest("[data-act]");
  if (!b) return;
  const act = b.dataset.act;
  try {
    if (act === "refresh") render();
    if (act === "deploy") await deployTo(b.dataset.name, b.dataset.env);
    if (act === "run") runModal(b.dataset.name, S.env);
    if (act === "demo-traffic") await demoTraffic();
    if (act === "approve" || act === "reject") {
      const a = await api(`/api/v1/approvals/${b.dataset.id}/${act}`, { body: { approver: who() } });
      toast(act === "approve" ? (a.status === "pending" ? `Goedgekeurd door ${who()} — nog ${a.requiredApprovals - a.approvals.filter((x) => x.decision === "approve").length} nodig` : `Goedgekeurd en uitgevoerd (${a.status})`) : "Afgewezen", a.status === "failed");
      refreshStatus(); render();
    }
    if (act === "ed-save") await saveEditor();
    if (act === "ed-execute") { b.disabled = true; try { await executeEditor(); } finally { b.disabled = false; } }
    if (act === "ed-testdata") testDataModal();
    if (act === "ed-settings") settingsModal();
    if (act === "ed-export") await exportModal();
    if (act === "export") await exportModal(b.dataset.name);
    if (act === "import") importModal();
    if (act === "ed-trigger") triggerChooser();
    if (act === "ed-trigger-cfg") openNode("start");
    if (act === "ed-side-close") { S.editor.sideOpen = false; $("#ed-side")?.classList.add("hide"); }
    if (act === "ed-clear") { S.editor.lastRun = null; if (S.canvas) S.canvas.setRun(null); updateRunUI(); }
    if (act === "ed-tab") { S.editor.tab = b.dataset.tab; renderEditor($("#main")); }
    if (act === "ev-tab") { S.envViewTab = b.dataset.tab; render(); }
    if (act === "to-dev") { S.env = "dev"; localSet("aip.env", "dev"); renderEnvs(); toast("Omgeving: Development — hier kun je bewerken"); render(); }
    if (act === "deploy-dialog") { if (!document.getElementById("modal").classList.contains("hide")) closeModal(); await deployDialog(b.dataset.name, b.dataset.env, b.dataset.v); }
    if (act === "ver-view") await viewVersion(b.dataset.name, b.dataset.v);
    if (act === "ver-restore") await restoreVersion(b.dataset.name, Number(b.dataset.v), b.dataset.dirty === "1");
    if (act === "ed-openrun") {
      S.editor.lastRun = await api(`/api/v1/runs/${b.dataset.id}`);
      S.editor.tab = "editor";
      renderEditor($("#main"));
    }
    if (act === "ai-design") {
      b.disabled = true;
      const res = await api("/api/v1/agents/builder/design", { body: { prompt: $("#ai-prompt").value, register: true } });
      $("#ai-by").textContent = `ontworpen door ${res.by === "claude" ? "Claude" : "heuristiek"} · opgeslagen op DEV`;
      $("#ai-out").innerHTML = `<div id="ai-canvas" style="height:300px;border:1px solid var(--border);border-radius:10px;overflow:hidden"></div>
        <div class="row" style="margin-top:12px"><button class="btn" data-go="editor/${encodeURIComponent(res.integration.integration)}">Openen in editor →</button><span class="muted">${esc(res.integration.integration)} · ${res.integration.steps.length} stappen</span></div>`;
      destroyCanvas();
      S.canvas = PC.mount($("#ai-canvas"), { def: JSON.parse(JSON.stringify(res.integration)), readonly: true });
      S.canvas.fit();
      S.editor = null; b.disabled = false; refreshStatus();
    }
    if (act === "incident") {
      const sym = $("#inc-sym").value;
      const res = await api("/api/v1/agents/monitoring/analyze", { body: { integration: $("#inc-int").value, severity: "high", problem: "37 berichten gefaald", failedRequests: 37, rootCause: { endpoint: "/orders", symptom: sym, fromMs: 220, toMs: 4800 } } });
      toast(`Recovery Agent stelt ${res.analysis.proposedAction.type} voor (${res.approval.riskLevel.toUpperCase()})`);
      refreshStatus(); render();
    }
  } catch (err) { toast(err.message, true); b.disabled = false; }
});

// ---------- live events ----------
let refreshTimer = null;
function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    refreshStatus();
    if (["dashboard", "approvals", "processes", "instances", "incidents", "infra"].includes(S.view)) render();
  }, 400);
}
function startEvents() {
  const es = new EventSource("/api/v1/events");
  const types = ["approval.created", "approval.approved", "approval.satisfied", "approval.rejected", "approval.expired", "action.executed", "action.failed", "integration.upserted", "incident.reported", "finding.reported", "run.finished", "version.created", "deployment.promoted"];
  types.forEach((ty) => es.addEventListener(ty, (e) => {
    const ev = JSON.parse(e.data);
    S.events.unshift(ev);
    S.events.length = Math.min(S.events.length, 200);
    if (S.view === "events") { const f = $("#feed"); if (f) f.innerHTML = renderFeed(); }
    else if (S.view !== "editor" && S.view !== "assistant") scheduleRefresh();
    else refreshStatus();
  }));
}

// ---------- start (na het laden van alle scripts, zodat admin.js views kan registreren) ----------
// Eerst inloggen (auth.js); daarna de app starten.
window.addEventListener("DOMContentLoaded", async () => {
if (window.AIP_AUTH) await window.AIP_AUTH.ready;
renderEnvs();
refreshStatus();
loadPluginList();
startEvents();
route();
setInterval(refreshStatus, 15000);
});

// Waarschuwen bij sluiten/verversen met niet-opgeslagen wijzigingen in de editor.
window.addEventListener("beforeunload", (e) => {
  if (S.editor && S.editor.dirty && S.view === "editor") { e.preventDefault(); e.returnValue = ""; }
});
