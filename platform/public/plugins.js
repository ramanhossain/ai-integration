// PLUGINS — alle connectors (Google, Microsoft, Slack, Salesforce, Stripe, …): overzicht,
// details per connector, koppelingen per omgeving (met OAuth-verbinden) en operaties proberen.
/* global VIEWS, S, api, esc, toast, openModal, closeModal, ENVS, go, who, render, MASK */

const PL = { q: "", cat: "", status: "" };
const initials = (n) => n.replace(/\(.*?\)/g, "").split(/[\s.-]+/).filter(Boolean).map((w) => w[0]).join("").slice(0, 2).toUpperCase() || n.slice(0, 2);
// Logo van de organisatie; lukt dat niet, dan de initialen in de merkkleur.
const plIcon = (p, size = 40) => `<span class="pl-ic logo" style="--c:${esc(p.color || "#64748b")};width:${size}px;height:${size}px;font-size:${Math.round(size / 2.9)}px" aria-hidden="true" data-initials="${esc(initials(p.name))}"><img src="/api/v1/plugins/${encodeURIComponent(p.id)}/logo" alt="" loading="lazy" decoding="async"></span>`;
document.addEventListener("error", (e) => {
  const img = e.target;
  if (!(img instanceof HTMLImageElement)) return;
  const box = img.closest(".pl-ic.logo");
  if (!box) return;
  box.classList.remove("logo");
  box.textContent = box.dataset.initials || "";
}, true);
const AUTH_LABEL = { none: "Geen", bearer: "Token", basic: "Gebruiker + wachtwoord/token", apiKey: "API-key", headers: "Sleutels", query: "Sleutels", oauth2: "OAuth 2.0 (inloggen)", "oauth2-client": "OAuth 2.0 (client credentials)", aws: "AWS-sleutels (Signature V4)", custom: "Verbindingsgegevens" };

VIEWS.plugins = async (main) => {
  if (S.param) return pluginDetail(main, S.param);
  const r = await api("/api/v1/plugins");
  const creds = await api("/api/v1/credentials").catch(() => ({ items: [] }));
  const credCount = (id) => creds.items.filter((c) => c.plugin === id).length;
  const q = PL.q.toLowerCase();
  const items = r.items.filter((p) => (!q || `${p.name} ${p.description} ${p.category}`.toLowerCase().includes(q)) && (!PL.cat || p.category === PL.cat) && (!PL.status || p.status === PL.status));
  main.innerHTML = `
  <div class="head"><div><h1>Plugins</h1><p>Connectors naar externe diensten, te gebruiken als stap <b>Connector</b> in elk proces. <b>${r.stats.available}</b> beschikbaar met ${r.stats.operations} operaties · ${r.stats.planned} gepland · ${r.stats.total} in totaal. Eigen implementatie op de publieke API's van de diensten.</p></div></div>
  <div class="pl-bar">
    <input class="f" id="pl-q" type="search" placeholder="Zoek een connector, bv. Google Sheets, Slack, Salesforce…" value="${esc(PL.q)}" aria-label="Zoeken">
    <select class="f" id="pl-cat" aria-label="Categorie"><option value="">Alle categorieën</option>${r.categories.map((c) => `<option ${c === PL.cat ? "selected" : ""}>${esc(c)}</option>`).join("")}</select>
    <div class="seg ndv-seg" role="tablist" aria-label="Status">${[["", "Alle"], ["beschikbaar", "Beschikbaar"], ["gepland", "Gepland"]].map(([k, l]) => `<button type="button" data-pl-status="${k}" class="${PL.status === k ? "on" : ""}">${l}</button>`).join("")}</div>
  </div>
  <div class="pl-count faint">${items.length} connector${items.length === 1 ? "" : "s"}</div>
  <div class="pl-grid">${items.map((p) => `<a class="pl-card ${p.status === "gepland" ? "planned" : ""}" href="#plugins/${encodeURIComponent(p.id)}">
      ${plIcon(p)}<div class="pl-b"><div class="pl-t"><b>${esc(p.name)}</b>${p.status === "beschikbaar" ? `<span class="chip ok">${p.operations} operatie${p.operations === 1 ? "" : "s"}</span>` : `<span class="chip none">gepland</span>`}</div>
      <div class="pl-d">${esc(p.description)}</div>
      <div class="pl-m faint">${esc(p.category)}${p.auth ? ` · ${esc(AUTH_LABEL[p.auth] || p.auth)}` : ""}${credCount(p.id) ? ` · <span class="chip info">${credCount(p.id)} koppeling${credCount(p.id) === 1 ? "" : "en"}</span>` : ""}</div></div></a>`).join("") || `<div class="empty">Geen connectors gevonden.</div>`}</div>`;
  const qEl = document.getElementById("pl-q");
  let t;
  qEl.addEventListener("input", () => { clearTimeout(t); t = setTimeout(() => { PL.q = qEl.value; render().then(() => { const e = document.getElementById("pl-q"); if (e) { e.focus(); e.setSelectionRange(e.value.length, e.value.length); } }); }, 200); });
  document.getElementById("pl-cat").addEventListener("change", (e) => { PL.cat = e.target.value; render(); });
  main.querySelectorAll("[data-pl-status]").forEach((b) => b.addEventListener("click", () => { PL.status = b.dataset.plStatus; render(); }));
};

async function pluginDetail(main, id) {
  const d = await api(`/api/v1/plugins/${encodeURIComponent(id)}`);
  const head = `<div class="crumbs"><a href="#plugins">Plugins</a> / ${esc(d.name)}</div>
    <div class="pl-head">${plIcon(d, 56)}<div><h1 style="margin:0">${esc(d.name)}</h1><div class="muted">${esc(d.description)}</div>
      <div class="row" style="margin-top:6px">${d.status === "beschikbaar" ? '<span class="chip ok">beschikbaar</span>' : '<span class="chip none">gepland</span>'}<span class="chip info">${esc(d.category)}</span>${d.website ? `<a href="${esc(d.website)}" target="_blank" rel="noopener">Website ↗</a>` : ""}${d.docs ? `<a href="${esc(d.docs)}" target="_blank" rel="noopener">API-documentatie ↗</a>` : ""}</div></div></div>`;
  if (d.status !== "beschikbaar") {
    main.innerHTML = head + `<div class="card"><div class="cb"><p>Deze connector staat in het overzicht maar is nog niet uitgewerkt. Tot dan kun je de dienst aanroepen met de stap <b>HTTP-aanroep</b> en een koppeling (bearer, basic of API-key).</p></div></div>`;
    return;
  }
  const groups = [...new Set(d.operations.map((o) => o.resource))];
  const connected = (c, e) => (c.connected || []).includes(e);
  main.innerHTML = head + `
  <div class="pl-cols">
    <div class="card"><div class="ch"><h3>Koppelingen</h3><button class="btn sm" data-pl-act="cred-new">+ Koppeling</button></div><div class="cb">
      <div class="muted" style="font-size:.85rem;margin-bottom:10px">Authenticatie: <b>${esc(AUTH_LABEL[d.auth.type] || d.auth.type)}</b>. ${esc(d.auth.help || "")}</div>
      ${d.oauthRedirectUri ? `<div class="xf-note">Redirect-URI voor de OAuth-app: <code>${esc(d.oauthRedirectUri)}</code> <button class="lnk" data-copy-text="${esc(d.oauthRedirectUri)}">Kopiëren</button></div>` : ""}
      ${d.credentials.length ? `<table><thead><tr><th>Naam</th>${ENVS.map((e) => `<th><span class="env ${e.id}">${e.label}</span></th>`).join("")}<th></th></tr></thead><tbody>
        ${d.credentials.map((c) => `<tr><td><b>${esc(c.name)}</b><div class="faint" style="font-size:.76rem">${esc(c.description || "")}</div></td>
          ${ENVS.map((e) => `<td>${!c.envs.includes(e.id) ? '<span class="faint">—</span>' : d.auth.type === "oauth2" ? (connected(c, e.id) ? '<span class="chip ok">verbonden</span>' : `<button class="btn sm" data-pl-act="connect" data-cred="${esc(c.name)}" data-env="${e.id}">Verbinden</button>`) : '<span class="chip ok">ingevuld</span>'}${d.auth.type === "oauth2" && connected(c, e.id) ? ` <button class="lnk" data-pl-act="connect" data-cred="${esc(c.name)}" data-env="${e.id}">opnieuw</button>` : ""}</td>`).join("")}
          <td><div class="row" style="justify-content:flex-end;flex-wrap:nowrap"><button class="btn sm sec" data-pl-act="cred-test" data-cred="${esc(c.name)}">Testen</button><button class="btn sm sec" data-pl-act="cred-edit" data-cred="${esc(c.name)}">Bewerken</button></div></td></tr>`).join("")}
      </tbody></table>` : `<div class="empty">Nog geen koppeling. Maak er een om ${esc(d.name)} in processen te gebruiken.</div>`}
    </div></div>
    <div class="card"><div class="ch"><h3>Gebruiken in een proces</h3></div><div class="cb muted" style="font-size:.88rem">
      Open een proces op DEV, klik op <b>+</b> en typ <b>${esc(d.name)}</b>, of kies de stap <b>Connector</b>. Kies dan de operatie en de koppeling; parameters mogen <code>{{veld}}</code>-verwijzingen naar het bericht bevatten. De uitkomst komt in het doelveld van het bericht.
      <div class="xf-note" style="margin-top:10px">Machine-leesbaar: <code>GET /api/v1/plugins/${esc(d.id)}</code> · MCP-tool <code>get_plugin</code></div></div></div>
  </div>
  <div class="card" style="margin-top:14px"><div class="ch"><h3>Operaties (${d.operations.length})</h3></div><div class="tw"><table><thead><tr><th>Operatie</th><th>Aanroep</th><th>Parameters</th><th></th></tr></thead><tbody>
    ${groups.map((g) => `<tr class="pl-grp"><td colspan="4">${esc(g)}</td></tr>` + d.operations.filter((o) => o.resource === g).map((o) => `<tr><td><b>${esc(o.label)}</b>${o.description ? `<div class="faint" style="font-size:.76rem">${esc(o.description)}</div>` : ""}</td>
      <td class="mono" style="font-size:.74rem">${esc(o.method)} ${esc(o.path || "/")}</td>
      <td style="font-size:.8rem">${(o.params || []).map((p) => `<span class="${p.required ? "" : "faint"}">${esc(p.label)}${p.required ? "*" : ""}</span>`).join(", ") || '<span class="faint">—</span>'}</td>
      <td><button class="btn sm sec" data-pl-act="try" data-op="${esc(o.id)}">Proberen</button></td></tr>`).join("")).join("")}
  </tbody></table></div></div>`;
  main._plugin = d;
}

// Velden van de koppeling volgens de authenticatie van de plugin.
function pluginCredFields(d) {
  const a = d.auth, f = [];
  if (a.type === "bearer") f.push({ key: "token", label: a.label || "Token", secret: true });
  if (a.type === "basic") f.push({ key: "user", label: a.userLabel || "Gebruiker" }, { key: "password", label: a.passLabel || "Wachtwoord / token", secret: true });
  if (a.type === "apiKey") f.push({ key: "apiKey", label: a.label || "API-key", secret: true });
  if (a.type === "headers" || a.type === "query" || a.type === "custom") f.push(...a.fields);
  if (a.type === "oauth2" || a.type === "oauth2-client") f.push({ key: "clientId", label: "Client ID" }, { key: "clientSecret", label: "Client secret", secret: true });
  if (a.type === "oauth2") f.push({ key: "scopes", label: "Scopes (optioneel)", placeholder: (a.scopes || []).join(" ") || "standaard" });
  return [...f, ...(d.fields || [])];
}

async function plCredModal(d, name) {
  const existing = name ? await api(`/api/v1/credentials/${encodeURIComponent(name)}`) : null;
  const fields = pluginCredFields(d);
  let envTab = S.env;
  const values = JSON.parse(JSON.stringify(existing ? existing.values : {}));
  let nm = existing ? existing.name : `${d.id}-koppeling`, ds = existing ? existing.description || "" : "";
  const readEnv = () => {
    const nameEl = document.getElementById("pc-name"), descEl = document.getElementById("pc-desc");
    if (nameEl && !existing) nm = nameEl.value;
    if (descEl) ds = descEl.value;
    const prev = values[envTab] || {};
    const v = {};
    document.querySelectorAll("#pc-fields [data-field]").forEach((el) => {
      const f = fields.find((x) => x.key === el.dataset.field);
      if (el.value === "" && prev[f.key] === MASK) v[f.key] = MASK;
      else if (el.value !== "") v[f.key] = el.value;
    });
    values[envTab] = v;
  };
  const draw = () => {
    const v = values[envTab] || {};
    openModal(`<div class="ch"><h3>${existing ? "Koppeling bewerken" : "Nieuwe koppeling"} · ${esc(d.name)}</h3><button class="x" data-close aria-label="Sluiten">×</button></div>
      <div class="cb ndv-cb" style="max-height:70vh;overflow:auto">
        <label for="pc-name">Naam</label><input class="f" id="pc-name" value="${esc(nm)}" ${existing ? "disabled" : ""}>
        <label for="pc-desc">Omschrijving</label><input class="f" id="pc-desc" value="${esc(ds)}">
        ${d.auth.help ? `<div class="xf-note">${esc(d.auth.help)}</div>` : ""}
        ${d.oauthRedirectUri ? `<div class="xf-note">Redirect-URI: <code>${esc(d.oauthRedirectUri)}</code></div>` : ""}
        <label>Waarden per omgeving</label>
        <div class="ed-tabs" style="margin:0 0 6px">${ENVS.map((e) => `<button data-pc-env="${e.id}" class="${e.id === envTab ? "on" : ""}">${e.label}${values[e.id] && Object.keys(values[e.id]).length ? " ●" : ""}</button>`).join("")}</div>
        <div id="pc-fields">${fields.map((f) => `<label for="pc-f-${esc(f.key)}">${esc(f.label)}</label><input class="f" id="pc-f-${esc(f.key)}" data-field="${esc(f.key)}" ${f.secret ? 'type="password" autocomplete="new-password"' : ""} value="${v[f.key] && v[f.key] !== MASK ? esc(v[f.key]) : ""}" placeholder="${v[f.key] === MASK ? "•••••• (ongewijzigd)" : esc(f.placeholder || f.default || "")}">${f.help ? `<div class="hint">${esc(f.help)}</div>` : ""}`).join("") || '<div class="muted">Geen gegevens nodig.</div>'}</div>
        ${d.auth.type === "oauth2" ? `<div class="hint" style="margin-top:10px">Na opslaan klik je per omgeving op <b>Verbinden</b> om in te loggen bij ${esc(d.name)}.</div>` : ""}
      </div>
      <div class="cf"><button class="btn sec" data-close>Annuleren</button><button class="btn" id="pc-save">Opslaan</button></div>`);
    const box = document.getElementById("modal-box");
    box.querySelectorAll("[data-pc-env]").forEach((b) => b.addEventListener("click", () => { readEnv(); envTab = b.dataset.pcEnv; draw(); }));
    box.querySelector("#pc-save").addEventListener("click", async () => {
      readEnv();
      const n = existing ? existing.name : nm.trim();
      try {
        await api(`/api/v1/credentials/${encodeURIComponent(n)}`, { method: "PUT", body: { type: "plugin", plugin: d.id, description: ds, values: Object.fromEntries(Object.entries(values).filter(([, x]) => x && Object.keys(x).length)) } });
        closeModal();
        toast(`Koppeling ${n} opgeslagen`);
        render();
      } catch (err) { toast(err.message, true); }
    });
  };
  draw();
}
window.pluginCredModal = async (pluginId, name) => plCredModal(await api(`/api/v1/plugins/${encodeURIComponent(pluginId)}`), name);

async function tryOperation(d, opId) {
  const op = d.operations.find((o) => o.id === opId);
  const creds = d.credentials || [];
  let env = S.env === "prod" ? "dev" : S.env;
  openModal(`<div class="ch"><h3>Proberen · ${esc(d.name)} · ${esc(op.label)}</h3><button class="x" data-close aria-label="Sluiten">×</button></div>
    <div class="cb ndv-cb xfer">
      <div class="row" style="gap:12px">
        ${d.auth.type !== "none" ? `<div style="flex:1"><label for="tr-cred">Koppeling</label><select class="f" id="tr-cred">${creds.map((c) => `<option>${esc(c.name)}</option>`).join("") || "<option value=''>— geen koppeling —</option>"}</select></div>` : ""}
        <div><label for="tr-env">Omgeving</label><select class="f" id="tr-env">${ENVS.filter((e) => e.id !== "prod").map((e) => `<option value="${e.id}" ${e.id === env ? "selected" : ""}>${e.label}</option>`).join("")}</select></div>
      </div>
      <div class="muted mono" style="font-size:.76rem;margin:8px 0">${esc(op.method)} ${esc(op.path || "/")}</div>
      ${(op.params || []).map((p) => `<label for="tr-${esc(p.name)}">${esc(p.label)}${p.required ? " *" : ""}</label>${p.type === "json" || p.type === "text" ? `<textarea class="f mono" id="tr-${esc(p.name)}" data-p="${esc(p.name)}" style="min-height:70px" placeholder="${esc(p.placeholder || (p.default !== undefined ? JSON.stringify(p.default) : ""))}"></textarea>` : p.options ? `<select class="f" id="tr-${esc(p.name)}" data-p="${esc(p.name)}"><option value="">${p.default !== undefined ? `(standaard: ${esc(String(p.default))})` : "—"}</option>${p.options.map((o) => `<option>${esc(o)}</option>`).join("")}</select>` : `<input class="f" id="tr-${esc(p.name)}" data-p="${esc(p.name)}" placeholder="${esc(p.placeholder || (p.default !== undefined ? String(p.default) : ""))}">`}${p.help ? `<div class="hint">${esc(p.help)}</div>` : ""}`).join("") || '<div class="muted">Geen parameters.</div>'}
      <div id="tr-out" style="margin-top:12px"></div>
    </div>
    <div class="cf"><span class="faint" style="margin-right:auto;align-self:center;font-size:.8rem">Voert de operatie echt uit bij ${esc(d.name)} (niet op PROD).</span><button class="btn sec" data-close>Sluiten</button><button class="btn" id="tr-go">▶ Uitvoeren</button></div>`);
  document.getElementById("tr-go").addEventListener("click", async (e) => {
    const params = {};
    document.querySelectorAll("#modal-box [data-p]").forEach((el) => { if (el.value !== "") params[el.dataset.p] = el.value; });
    e.target.disabled = true;
    const out = document.getElementById("tr-out");
    out.innerHTML = '<div class="faint">Bezig…</div>';
    try {
      const r = await api(`/api/v1/plugins/${encodeURIComponent(d.id)}/execute`, { body: { operation: op.id, credential: document.getElementById("tr-cred")?.value || undefined, env: document.getElementById("tr-env").value, params } });
      out.innerHTML = r.ok ? `<div class="xf-note ok">✓ ${r.status} in ${r.ms} ms · <span class="mono" style="font-size:.74rem">${esc(r.request.method)} ${esc(r.request.url)}</span></div><pre class="code">${esc(JSON.stringify(r.output, null, 2).slice(0, 20000))}</pre>` : `<div class="xf-note err">✕ ${esc(r.error)}</div>`;
    } catch (err) { out.innerHTML = `<div class="xf-note err">✕ ${esc(err.message)}</div>`; }
    e.target.disabled = false;
  });
}

document.addEventListener("click", async (e) => {
  const cp = e.target.closest("[data-copy-text]");
  if (cp) { try { await navigator.clipboard.writeText(cp.dataset.copyText); toast("Gekopieerd"); } catch { toast("Kopiëren niet toegestaan", true); } return; }
  const b = e.target.closest("[data-pl-act]");
  if (!b) return;
  const d = document.getElementById("main")._plugin;
  if (!d) return;
  const act = b.dataset.plAct;
  try {
    if (act === "cred-new") await plCredModal(d);
    if (act === "cred-edit") await plCredModal(d, b.dataset.cred);
    if (act === "try") await tryOperation(d, b.dataset.op);
    if (act === "cred-test") {
      const r = await api(`/api/v1/plugins/${encodeURIComponent(d.id)}/test`, { body: { credential: b.dataset.cred, env: S.env } });
      toast(r.ok ? `✓ Koppeling werkt op ${S.env.toUpperCase()} (${r.operation})` : `✕ ${r.error}`, !r.ok);
    }
    if (act === "connect") {
      const w = window.open(`/api/v1/oauth/start?credential=${encodeURIComponent(b.dataset.cred)}&env=${b.dataset.env}`, "aip-oauth", "width=560,height=720");
      if (!w) toast("Pop-up geblokkeerd — sta pop-ups toe voor dit portaal", true);
    }
  } catch (err) { toast(err.message, true); }
});
window.addEventListener("message", (e) => { if (e.origin === location.origin && e.data && e.data.type === "aip-oauth") { toast(e.data.ok ? "Verbonden ✓" : "Verbinden mislukt", !e.data.ok); if (S.view === "plugins") render(); } });
