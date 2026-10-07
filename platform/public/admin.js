// Beheerschermen: triggers, koppelingen, queues, datatabellen, bestanden en MCP.
// Alle schermen volgen de omgevingskeuze bovenin (S.env).
/* global VIEWS, S, api, esc, toast, openModal, closeModal, render, go, fmtDateTime, fmtTime, ENVS, envOf, refreshStatus, who */

const MASK = "••••••";
const envBadge = (e) => `<span class="env ${e}">${e}</span>`;
const envHead = (title, sub, right = "") => `
  <div class="head"><div><h1>${title} <span class="env ${S.env}" style="vertical-align:middle;font-size:.72rem">${S.env}</span></h1><p>${sub}</p></div><div class="row">${right}</div></div>`;
function copyBtn(text) {
  return `<button class="btn sm sec" data-copy="${esc(text)}">Kopiëren</button>`;
}
document.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-copy]");
  if (!b) return;
  try { await navigator.clipboard.writeText(b.dataset.copy); toast("Gekopieerd"); }
  catch { toast("Kopiëren niet toegestaan — selecteer de tekst handmatig", true); }
});

// ============================================================ TRIGGERS
VIEWS.triggers = async (main) => {
  const all = await api("/api/v1/triggers");
  const list = all.filter((t) => t.env === S.env);
  const detail = (t) => {
    const c = t.config || {};
    if (t.type === "webhook") return `<code>${esc(t.url)}</code> ${copyBtn(t.url)}<div class="faint" style="font-size:.75rem">${esc(c.method || "POST")}${c.auth === "apikey" ? " · API-key: " + esc(c.credential || "?") : " · geen beveiliging"}</div>`;
    if (t.type === "api") return `<code>${esc(t.url)}</code><div class="faint" style="font-size:.75rem">${c.auth === "apikey" ? "API-key: " + esc(c.credential || "?") : "geen beveiliging"} · in de OpenAPI-catalogus</div>`;
    if (t.type === "schedule") return c.everySeconds ? `elke ${esc(c.everySeconds)} s` : `<code>${esc(c.cron || "")}</code>`;
    if (t.type === "queue") return `queue <b>${esc(c.queue)}</b>`;
    if (t.type === "file") return `map <code>${esc(c.dir || "inbox")}/${esc(c.pattern || "*")}</code>`;
    if (t.type === "ftp") return `${esc(c.credential)}: <code>${esc(c.dir || "/")}/${esc(c.pattern || "*")}</code>`;
    return `<span class="faint">start via GUI, API of MCP</span>`;
  };
  const tl = window.ProcessCanvas.TRIGGERS;
  main.innerHTML = envHead("Actieve triggers", "Overzicht van hoe processen op deze omgeving starten. Je kiest en stelt een trigger in <b>in het proces zelf</b>: open het proces en klik op ⚡ Trigger of dubbelklik op het startevent. Een trigger wordt actief zodra het proces op deze omgeving gedeployed is.", `<a class="btn sec" href="/apis/${S.env}/openapi.json" target="_blank" rel="noopener">API-catalogus (OpenAPI)</a>`) + `
  <div class="card">${bulkBar("triggers", [["resume", "Activeren"], ["pause", "Deactiveren"]])}<div class="tw">${list.length ? `<table><thead><tr>${selHead()}<th>Proces</th><th>Versie</th><th>Trigger</th><th>Details</th><th>Status</th><th>Volgende</th><th>Laatst</th><th>Runs / fouten</th><th></th></tr></thead><tbody>
    ${list.map((t) => `<tr>${t.type === "manual" ? "<td class=\"selc\"></td>" : selCell(t.integration)}
      <td><a href="#editor/${encodeURIComponent(t.integration)}"><b>${esc(t.integration)}</b></a></td>
      <td class="ver">v${t.version}</td>
      <td><span class="chip info">${esc((tl[t.type] || { label: t.type }).label)}</span></td>
      <td style="max-width:360px">${detail(t)}</td>
      <td>${t.type === "manual" ? '<span class="chip none">handmatig</span>' : t.paused ? '<span class="chip warn">gepauzeerd</span>' : '<span class="chip ok">actief</span>'}</td>
      <td class="mono">${t.nextAt && !t.paused ? fmtTime(t.nextAt) : "—"}</td>
      <td class="mono">${t.lastFiredAt ? fmtTime(t.lastFiredAt) : "—"} ${t.lastStatus ? (t.lastStatus === "success" ? '<span class="chip ok">ok</span>' : `<span class="chip err" title="${esc(t.lastError || "")}">fout</span>`) : ""}</td>
      <td class="mono">${t.fires} / ${t.errors}</td>
      <td><div class="row" style="justify-content:flex-end">
        <button class="btn sm sec" data-go="editor/${encodeURIComponent(t.integration)}">Wijzigen in proces</button>
        ${t.lastRunId ? `<button class="btn sm sec" data-go="instance/${t.lastRunId}">Laatste run</button>` : ""}
        ${t.type === "manual" ? `<button class="btn sm sec" data-act="run" data-name="${esc(t.integration)}">▶ Uitvoeren</button>` : `<button class="btn sm ${t.paused ? "" : "sec"}" data-act="trig-${t.paused ? "resume" : "pause"}" data-name="${esc(t.integration)}">${t.paused ? "Hervatten" : "Pauzeren"}</button>`}
      </div></td></tr>`).join("")}
  </tbody></table>` : `<div class="empty">Geen processen gedeployed op ${S.env.toUpperCase()}. Deploy een proces via Processen.</div>`}</div></div>`;
};

// ============================================================ KOPPELINGEN
let CRED_TYPES_CACHE = null;
async function credTypes() {
  if (!CRED_TYPES_CACHE) CRED_TYPES_CACHE = await api("/api/v1/credential-types");
  return CRED_TYPES_CACHE;
}
VIEWS.credentials = async (main) => {
  const [{ items, defaultKey }, types] = await Promise.all([api("/api/v1/credentials"), credTypes()]);
  const label = (t) => (types.find((x) => x.type === t) || { label: t }).label;
  main.innerHTML = `
  <div class="head"><div><h1>Koppelingen</h1><p>Gegevens voor servers en API's, met per omgeving andere waarden. Geheimen worden versleuteld opgeslagen en nooit getoond.</p></div>
    <button class="btn" data-act="cred-new">+ Nieuwe koppeling</button></div>
  ${defaultKey ? `<div class="card" style="margin-bottom:14px;border-color:var(--amber)"><div class="cb"><b>Let op:</b> geheimen worden versleuteld met de standaardsleutel. Zet <code>AIP_SECRET_KEY</code> voor productiegebruik.</div></div>` : ""}
  <div class="card">${bulkBar("credentials", [["delete", "Verwijderen", "no"]])}<div class="tw">${items.length ? `<table><thead><tr>${selHead()}<th>Naam</th><th>Type</th><th>Omschrijving</th><th>Omgevingen</th><th>Gewijzigd</th><th></th></tr></thead><tbody>
    ${items.map((c) => `<tr>${selCell(c.name)}<td><b>${esc(c.name)}</b></td><td>${esc(label(c.type))}</td><td class="muted">${esc(c.description || "")}</td>
      <td>${ENVS.map((e) => `<span class="env ${e.id}" style="opacity:${c.envs.includes(e.id) ? 1 : 0.25}">${e.label}</span>`).join(" ")}</td>
      <td class="mono">${fmtDateTime(c.updatedAt)}</td>
      <td><div class="row" style="justify-content:flex-end"><button class="btn sm sec" data-act="cred-test" data-name="${esc(c.name)}">Testen</button><button class="btn sm sec" data-act="cred-edit" data-name="${esc(c.name)}" data-plugin="${esc(c.plugin || "")}">Bewerken</button><button class="btn sm no" data-act="cred-del" data-name="${esc(c.name)}">Verwijderen</button></div></td></tr>`).join("")}
  </tbody></table>` : `<div class="empty">Nog geen koppelingen. Maak er een aan voor FTP/SFTP, SMTP, PostgreSQL, HTTP-authenticatie, API-keys, MCP-servers of Teams/Slack.</div>`}</div></div>`;
};

async function credModal(name) {
  const types = await credTypes();
  const existing = name ? await api(`/api/v1/credentials/${encodeURIComponent(name)}`) : null;
  let type = existing ? existing.type : "sftp";
  let envTab = S.env;
  const values = JSON.parse(JSON.stringify(existing ? existing.values : {}));
  let nm = existing ? existing.name : "", ds = existing ? existing.description || "" : "";
  const fieldsHtml = () => {
    const t = types.find((x) => x.type === type);
    const v = values[envTab] || {};
    if (!t.fields.length) {
      const entries = Object.entries(v);
      return `<div class="rows" id="cm-generic">${(entries.length ? entries : [["", ""]]).map(([k, val]) => `<div class="kvr"><input class="f" placeholder="sleutel" value="${esc(k)}"><span class="kva">=</span><input class="f" placeholder="waarde" value="${esc(val)}"><button class="x" data-cm-delrow aria-label="Verwijderen">×</button></div>`).join("")}</div>
        <button class="btn sm sec" data-cm-addrow>+ Rij</button><div class="hint">Namen met pass/secret/token/key worden versleuteld. Voor HTTP: <code>header.X-Naam</code> wordt een header.</div>`;
    }
    return t.fields.map((f) => `<label for="cm-${f.key}">${esc(f.label)}</label>${f.key === "privateKey" ? `<textarea class="f" id="cm-${f.key}" data-field="${f.key}" placeholder="${v[f.key] === MASK ? "•••••• (ongewijzigd)" : ""}">${v[f.key] && v[f.key] !== MASK ? esc(v[f.key]) : ""}</textarea>` : `<input class="f" id="cm-${f.key}" data-field="${f.key}" ${f.secret ? 'type="password" autocomplete="new-password"' : ""} value="${f.secret ? (v[f.key] && v[f.key] !== MASK ? esc(v[f.key]) : "") : esc(v[f.key] || "")}" placeholder="${f.secret && v[f.key] === MASK ? "•••••• (ongewijzigd)" : esc(f.placeholder || "")}">`}${f.secret && v[f.key] === MASK ? `<button type="button" class="lnk" data-cm-clear="${f.key}" style="font-size:.78rem">Opgeslagen waarde wissen</button>` : ""}`).join("");
  };
  const readEnv = () => {
    const nameEl = document.getElementById("cm-name"), descEl = document.getElementById("cm-desc");
    if (nameEl && !existing) nm = nameEl.value;
    if (descEl) ds = descEl.value;
    const box = document.getElementById("cm-fields");
    if (!box) return;
    const t = types.find((x) => x.type === type);
    const v = {};
    if (!t.fields.length) {
      box.querySelectorAll(".kvr").forEach((r) => { const [a, b] = r.querySelectorAll("input"); if (a.value.trim()) v[a.value.trim()] = b.value; });
    } else {
      const prev = values[envTab] || {};
      box.querySelectorAll("[data-field]").forEach((el) => {
        const f = t.fields.find((x) => x.key === el.dataset.field);
        if (el.dataset.cleared && el.value === "") return; // bewust gewist
        if (f.secret && el.value === "" && prev[f.key] === MASK) v[f.key] = MASK; // ongewijzigd
        else if (el.value !== "") v[f.key] = el.value;
      });
    }
    values[envTab] = v;
  };
  const draw = () => {
    openModal(`<div class="ch"><h3>${existing ? "Koppeling bewerken" : "Nieuwe koppeling"}</h3><button class="x" data-close aria-label="Sluiten">×</button></div>
      <div class="cb ndv-cb" style="max-height:68vh;overflow:auto">
        <label for="cm-name">Naam</label><input class="f" id="cm-name" value="${esc(nm)}" ${existing ? "disabled" : ""} placeholder="partner-sftp">
        <label for="cm-type">Type</label><select class="f" id="cm-type" ${existing ? "disabled" : ""}>${types.map((t) => `<option value="${t.type}" ${t.type === type ? "selected" : ""}>${esc(t.label)}</option>`).join("")}</select>
        <label for="cm-desc">Omschrijving</label><input class="f" id="cm-desc" value="${esc(ds)}">
        <label>Waarden per omgeving</label>
        <div class="ed-tabs" style="margin:0 0 6px">${ENVS.map((e) => `<button data-cm-env="${e.id}" class="${e.id === envTab ? "on" : ""}">${e.label}${values[e.id] && Object.keys(values[e.id]).length ? " ●" : ""}</button>`).join("")}</div>
        <div id="cm-fields">${fieldsHtml()}</div>
      </div>
      <div class="cf"><button class="btn sec" data-close>Annuleren</button><button class="btn" id="cm-save">Opslaan</button></div>`);
    const box = document.getElementById("modal-box");
    box.querySelector("#cm-type").addEventListener("change", (ev) => { readEnv(); type = ev.target.value; for (const k of Object.keys(values)) delete values[k]; draw(); });
    box.querySelectorAll("[data-cm-clear]").forEach((b) => b.addEventListener("click", () => {
      const el = box.querySelector(`[data-field="${CSS.escape(b.dataset.cmClear)}"]`);
      el.value = ""; el.dataset.cleared = "1"; el.placeholder = "(wordt gewist bij opslaan)"; b.remove(); el.focus();
    }));
    box.querySelectorAll("[data-cm-env]").forEach((b) => b.addEventListener("click", () => { readEnv(); envTab = b.dataset.cmEnv; draw(); }));
    box.addEventListener("click", (ev) => {
      if (ev.target.closest("[data-cm-addrow]")) document.getElementById("cm-generic").insertAdjacentHTML("beforeend", `<div class="kvr"><input class="f" placeholder="sleutel"><span class="kva">=</span><input class="f" placeholder="waarde"><button class="x" data-cm-delrow aria-label="Verwijderen">×</button></div>`);
      if (ev.target.closest("[data-cm-delrow]")) ev.target.closest(".kvr").remove();
    });
    box.querySelector("#cm-save").addEventListener("click", async () => {
      readEnv();
      const n = existing ? existing.name : box.querySelector("#cm-name").value.trim();
      const body = { type, description: box.querySelector("#cm-desc").value, values: Object.fromEntries(Object.entries(values).filter(([, v]) => v && Object.keys(v).length)) };
      try {
        await api(`/api/v1/credentials/${encodeURIComponent(n)}`, { method: "PUT", body, headers: { "x-aip-user": who() } });
        closeModal();
        toast(`Koppeling ${n} opgeslagen`);
        render();
      } catch (err) { toast(err.message, true); }
    });
  };
  draw();
}
function credTestModal(name) {
  openModal(`<div class="ch"><h3>Koppeling testen: ${esc(name)}</h3><button class="x" data-close aria-label="Sluiten">×</button></div>
    <div class="cb"><label class="muted" for="ct-env" style="font-size:.75rem;font-weight:600">OMGEVING</label>
      <select class="f" id="ct-env">${ENVS.map((e) => `<option value="${e.id}" ${e.id === S.env ? "selected" : ""}>${e.name}</option>`).join("")}</select>
      <div id="ct-out" style="margin-top:12px" class="muted">Test de verbinding met de waarden van de gekozen omgeving.</div></div>
    <div class="cf"><button class="btn sec" data-close>Sluiten</button><button class="btn" id="ct-go">Testen</button></div>`);
  document.getElementById("ct-go").addEventListener("click", async () => {
    const out = document.getElementById("ct-out");
    out.innerHTML = "Bezig…";
    try {
      const r = await api(`/api/v1/credentials/${encodeURIComponent(name)}/test`, { body: { env: document.getElementById("ct-env").value } });
      out.innerHTML = r.ok ? `<span class="chip ok">verbonden</span> <span class="mono">${r.ms} ms</span><pre class="code" style="margin-top:8px">${esc(typeof r.detail === "string" ? r.detail : JSON.stringify(r.detail, null, 2))}</pre>` : `<div class="ndv-err">✕ ${esc(r.error)}</div>`;
    } catch (err) { out.innerHTML = `<div class="ndv-err">✕ ${esc(err.message)}</div>`; }
  });
}
function confirmModal(title, text, onYes, yesLabel = "Verwijderen") {
  openModal(`<div class="ch"><h3>${esc(title)}</h3><button class="x" data-close aria-label="Sluiten">×</button></div>
    <div class="cb"><p>${text}</p></div>
    <div class="cf"><button class="btn sec" data-close>Annuleren</button><button class="btn no" id="cf-yes">${esc(yesLabel)}</button></div>`);
  document.getElementById("cf-yes").addEventListener("click", async () => {
    try { await onYes(); closeModal(); } catch (err) { toast(err.message, true); }
  });
}

// ============================================================ QUEUES
VIEWS.queues = async (main) => {
  const list = await api(`/api/v1/queues?env=${S.env}`);
  main.innerHTML = envHead("Queues", "Berichtenqueues per omgeving: om processen te ontkoppelen, als tijdelijke buffer (stap “Queue: ophalen”), of om processen te starten (queue-trigger). Na 3 mislukte pogingen gaat een bericht naar de dead-letter queue (.dlq). Een queue bestaat op alle omgevingen (DEV, TEST, ACC, PROD) met dezelfde naam; de berichten zijn per omgeving gescheiden.", `<button class="btn" data-act="q-new">+ Nieuwe queue</button>`) + `
  <div class="card">${bulkBar("queues", [["purge", "Leegmaken"], ["delete", "Verwijderen", "no"]])}<div class="tw">${list.length ? `<table><thead><tr>${selHead()}<th>Queue</th><th>Omschrijving</th><th>Berichten</th><th>In behandeling</th><th>Trigger</th><th>Gepubliceerd</th><th>Verwerkt</th><th>Mislukt</th><th></th></tr></thead><tbody>
    ${list.map((q) => `<tr>${selCell(q.queue)}
      <td><b>${esc(q.queue)}</b> ${q.isDeadLetter ? '<span class="chip err">dead-letter</span>' : ""}</td>
      <td class="muted">${esc(q.description || "")}</td>
      <td class="mono"><b>${q.depth}</b></td><td class="mono">${q.inFlight}</td>
      <td>${q.consumers ? '<span class="chip ok">actief</span>' : '<span class="faint">—</span>'}</td>
      <td class="mono">${q.published}</td><td class="mono">${q.processed}</td><td class="mono">${q.failed}</td>
      <td><div class="row" style="justify-content:flex-end;flex-wrap:nowrap">
        <button class="btn sm sec" data-act="q-pub" data-q="${esc(q.queue)}">Bericht plaatsen</button>
        <button class="btn sm sec" data-act="q-peek" data-q="${esc(q.queue)}" ${q.depth ? "" : "disabled"}>Bekijken</button>
        <button class="btn sm sec" data-act="q-take" data-q="${esc(q.queue)}" ${q.depth ? "" : "disabled"}>Ophalen</button>
        ${q.isDeadLetter ? `<button class="btn sm" data-act="q-redrive" data-q="${esc(q.queue)}" ${q.depth ? "" : "disabled"}>Opnieuw aanbieden</button>` : ""}
        <button class="btn sm sec" data-act="q-purge" data-q="${esc(q.queue)}" ${q.depth ? "" : "disabled"}>Leegmaken</button>
        <button class="btn sm no" data-act="q-del" data-q="${esc(q.queue)}">Verwijderen</button>
      </div></td></tr>`).join("")}
  </tbody></table>` : `<div class="empty">Nog geen queues op ${S.env.toUpperCase()}. Maak er een aan, of laat een proces met de stap “Queue: publiceren” er een aanmaken.</div>`}</div></div>`;
};

// ============================================================ DATATABELLEN
const DT_TYPES = [["string", "tekst"], ["number", "getal"], ["boolean", "ja/nee"], ["date", "datum"], ["json", "JSON"]];
const DT_PAGE = 50;
VIEWS.datatables = async (main) => {
  if (S.param) return datatableDetail(main, S.param);
  const list = await api(`/api/v1/datatables/${S.env}`);
  main.innerHTML = envHead("Datatabellen", "Ingebouwde tabellen om gegevens tussen uitvoeringen op te slaan. Gebruik ze in een proces met de stap “Datatabel”. Een tabel bestaat op alle omgevingen (DEV, TEST, ACC, PROD) met dezelfde kolommen; de rijen zijn per omgeving gescheiden.", `<button class="btn" data-act="dt-new">+ Nieuwe tabel</button>`) + `
  <div class="card">${bulkBar("datatables", [["clear", "Leegmaken"], ["delete", "Verwijderen", "no"]])}<div class="tw">${list.length ? `<table><thead><tr>${selHead()}<th>Tabel</th><th>Kolommen</th><th>Rijen</th><th>Aangemaakt</th><th></th></tr></thead><tbody>
    ${list.map((t) => `<tr class="click" data-go="datatables/${encodeURIComponent(t.name)}">${selCell(t.name)}<td><b>${esc(t.name)}</b><div class="faint" style="font-size:.78rem">${esc(t.description || "")}</div></td>
      <td>${t.columns.map((c) => `<span class="chip none">${esc(c.name)} <span class="faint">${esc(c.type)}</span></span>`).join(" ")}</td>
      <td class="mono">${t.rowCount}</td><td class="mono">${fmtDateTime(t.createdAt)}</td><td class="faint">Openen →</td></tr>`).join("")}
  </tbody></table>` : `<div class="empty">Nog geen datatabellen op ${S.env.toUpperCase()}.</div>`}</div></div>`;
};

const DT = { offset: 0, q: "", qcol: "" };
async function datatableDetail(main, name) {
  let t;
  try { t = await api(`/api/v1/datatables/${S.env}/${encodeURIComponent(name)}`); }
  catch { main.innerHTML = `<div class="crumbs"><a href="#datatables">Datatabellen</a> / ${esc(name)}</div><div class="card"><div class="cb">Tabel <b>${esc(name)}</b> bestaat niet op ${S.env.toUpperCase()}. <a href="#datatables">Terug naar de lijst</a></div></div>`; return; }
  const q = DT.q && DT.qcol ? `&q=${encodeURIComponent(DT.qcol + ":" + DT.q)}` : "";
  const res = await api(`/api/v1/datatables/${S.env}/${encodeURIComponent(name)}/rows?limit=${DT_PAGE}&offset=${DT.offset}${q}`);
  const cell = (c, v) => v === null || v === undefined ? '<span class="faint">—</span>' : c.type === "boolean" ? (v ? "✓" : "✗") : c.type === "json" ? `<code>${esc(JSON.stringify(v)).slice(0, 80)}</code>` : c.type === "date" ? fmtDateTime(v) : esc(v);
  const inputFor = (c, v, id) => c.type === "boolean" ? `<select class="f" id="${id}"><option value="">—</option><option value="true" ${v === true ? "selected" : ""}>ja</option><option value="false" ${v === false ? "selected" : ""}>nee</option></select>`
    : `<input class="f" id="${id}" ${c.type === "number" ? 'type="number" step="any"' : ""} value="${esc(v === null || v === undefined ? "" : c.type === "json" ? JSON.stringify(v) : c.type === "date" ? String(v).slice(0, 16) : v)}" ${c.type === "date" ? 'type="datetime-local"' : ""} placeholder="${esc(c.type)}">`;
  main.innerHTML = `
  <div class="crumbs"><a href="#datatables">Datatabellen</a> / ${esc(name)}</div>
  ${envHead(esc(name), esc(t.description || `${t.rowCount} ${t.rowCount === 1 ? "rij" : "rijen"} · ${t.columns.length} ${t.columns.length === 1 ? "kolom" : "kolommen"}`), `
    <button class="btn sec" data-act="dt-cols" data-t="${esc(name)}">Kolommen bewerken</button>
    <button class="btn sec" data-act="dt-clear" data-t="${esc(name)}" ${t.rowCount ? "" : "disabled"}>Leegmaken</button>
    <button class="btn no" data-act="dt-drop" data-t="${esc(name)}">Tabel verwijderen</button>`)}
  ${t.columns.length ? `<div class="card" style="margin-bottom:14px"><div class="ch"><h3>Rij toevoegen</h3></div><div class="cb"><div class="dt-form">
    ${t.columns.map((c) => `<div><label class="muted" for="dt-new-${esc(c.name)}" style="font-size:.74rem;font-weight:600">${esc(c.name)}</label>${inputFor(c, null, `dt-new-${c.name}`)}</div>`).join("")}
    <div style="align-self:end"><button class="btn" data-act="dt-add" data-t="${esc(name)}">Toevoegen</button></div></div></div></div>` : `<div class="card" style="margin-bottom:14px"><div class="cb">Deze tabel heeft nog geen kolommen. <button class="btn sm" data-act="dt-cols" data-t="${esc(name)}">Kolommen toevoegen</button></div></div>`}
  <div class="card"><div class="ch"><h3>Rijen <span class="faint" style="font-weight:400">(${res.total})</span></h3>
    <div class="row"><select class="f" id="dt-qcol" style="width:auto">${t.columns.map((c) => `<option ${DT.qcol === c.name ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select><input class="f" id="dt-q" style="width:180px" placeholder="zoeken…" value="${esc(DT.q)}"><button class="btn sm sec" data-act="dt-search" data-t="${esc(name)}">Zoeken</button></div></div>
    <div class="tw">${res.rows.length ? `<table><thead><tr><th>id</th>${t.columns.map((c) => `<th>${esc(c.name)}</th>`).join("")}<th>Gewijzigd</th><th></th></tr></thead><tbody>
      ${res.rows.map((r) => `<tr><td class="mono">${r.id}</td>${t.columns.map((c) => `<td>${cell(c, r[c.name])}</td>`).join("")}<td class="mono">${fmtDateTime(r.updatedAt)}</td>
        <td><div class="row" style="justify-content:flex-end"><button class="btn sm sec" data-act="dt-edit" data-t="${esc(name)}" data-id="${r.id}">Bewerken</button><button class="btn sm no" data-act="dt-delrow" data-t="${esc(name)}" data-id="${r.id}">×</button></div></td></tr>`).join("")}
    </tbody></table>` : `<div class="empty">${DT.q ? "Geen rijen gevonden." : "Nog geen rijen."}</div>`}</div>
    ${res.total > DT_PAGE ? `<div class="cb row" style="justify-content:space-between"><span class="faint">${DT.offset + 1}–${Math.min(DT.offset + DT_PAGE, res.total)} van ${res.total}</span><div class="row"><button class="btn sm sec" data-act="dt-page" data-d="-1" data-t="${esc(name)}" ${DT.offset ? "" : "disabled"}>← Vorige</button><button class="btn sm sec" data-act="dt-page" data-d="1" data-t="${esc(name)}" ${DT.offset + DT_PAGE < res.total ? "" : "disabled"}>Volgende →</button></div></div>` : ""}
  </div>`;
  main._dt = { t, rows: res.rows, inputFor };
}
function readRowInputs(t, prefix) {
  const out = {};
  for (const c of t.columns) {
    const el = document.getElementById(`${prefix}${c.name}`);
    if (!el) continue;
    const v = el.value;
    if (v === "") { out[c.name] = null; continue; }
    out[c.name] = c.type === "boolean" ? v === "true" : c.type === "number" ? Number(v) : c.type === "json" ? (() => { try { return JSON.parse(v); } catch { return v; } })() : c.type === "date" ? new Date(v).toISOString() : v;
  }
  return out;
}
function columnsModal(name, columns, isNew) {
  let cols = JSON.parse(JSON.stringify(columns || [{ name: "", type: "string" }]));
  let nm = name || "", ds = "";
  const draw = () => {
    openModal(`<div class="ch"><h3>${isNew ? "Nieuwe datatabel" : "Kolommen van " + esc(name)}</h3><button class="x" data-close aria-label="Sluiten">×</button></div>
      <div class="cb ndv-cb" style="max-height:66vh;overflow:auto">
        ${isNew ? `<label for="dtn-name">Naam</label><input class="f" id="dtn-name" placeholder="klanten" value="${esc(nm)}"><div class="hint">Letters, cijfers en _; begin met een letter.</div>
        <label for="dtn-desc">Omschrijving</label><input class="f" id="dtn-desc" value="${esc(ds)}">
        <div class="xf-note" style="margin-top:12px">Wordt aangemaakt op DEV, TEST, ACC en PROD met dezelfde kolommen. De rijen blijven per omgeving gescheiden.</div>` : `<div class="hint" style="margin-bottom:8px">Kolomwijzigingen gelden voor de tabel op alle omgevingen (DEV, TEST, ACC, PROD). Een kolom verwijderen wist die waarden in alle rijen, op elke omgeving.</div>`}
        <label>Kolommen</label>
        <div id="dtn-cols">${cols.map((c, i) => `<div class="kvr" data-i="${i}"><input class="f" placeholder="kolomnaam" value="${esc(c.name)}"><span></span><select class="f">${DT_TYPES.map(([v, l]) => `<option value="${v}" ${c.type === v ? "selected" : ""}>${l}</option>`).join("")}</select><button class="x" data-dtn-del aria-label="Kolom verwijderen">×</button></div>`).join("")}</div>
        <button class="btn sm sec" data-dtn-add>+ Kolom</button>
        <div class="hint">Elke rij krijgt automatisch <code>id</code>, <code>createdAt</code> en <code>updatedAt</code>.</div>
      </div>
      <div class="cf"><button class="btn sec" data-close>Annuleren</button><button class="btn" id="dtn-save">${isNew ? "Aanmaken" : "Opslaan"}</button></div>`);
    const box = document.getElementById("modal-box");
    // Alles uitlezen vóór het opnieuw tekenen, zodat naam en omschrijving bewaard blijven.
    const readCols = () => {
      cols = [...box.querySelectorAll("#dtn-cols .kvr")].map((r) => ({ name: r.querySelector("input").value.trim(), type: r.querySelector("select").value }));
      if (isNew) { nm = box.querySelector("#dtn-name").value; ds = box.querySelector("#dtn-desc").value; }
    };
    box.querySelector("[data-dtn-add]").addEventListener("click", () => {
      readCols(); cols.push({ name: "", type: "string" }); draw();
      const inputs = document.querySelectorAll("#dtn-cols .kvr input");
      inputs[inputs.length - 1]?.focus();
    });
    box.querySelectorAll("[data-dtn-del]").forEach((b) => b.addEventListener("click", () => { readCols(); cols.splice(Number(b.closest(".kvr").dataset.i), 1); draw(); }));
    box.querySelector("#dtn-save").addEventListener("click", async () => {
      readCols();
      const columns = cols.filter((c) => c.name);
      try {
        if (isNew) {
          const n = box.querySelector("#dtn-name").value.trim();
          const created = await api(`/api/v1/datatables/${S.env}`, { body: { name: n, description: box.querySelector("#dtn-desc").value || undefined, columns }, headers: { "x-aip-user": who() } });
          closeModal(); toast(`Tabel ${created.name} aangemaakt op ${(created.envs || []).map((e) => e.toUpperCase()).join(", ")}`); go(`datatables/${encodeURIComponent(n)}`);
        } else {
          await api(`/api/v1/datatables/${S.env}/${encodeURIComponent(name)}/columns`, { method: "PUT", body: { columns }, headers: { "x-aip-user": who() } });
          closeModal(); toast("Kolommen opgeslagen op alle omgevingen"); render();
        }
      } catch (err) { toast(err.message, true); }
    });
  };
  draw();
}

// ============================================================ BESTANDEN
VIEWS.files = async (main) => {
  const dir = S.param || "/";
  const r = await api(`/api/v1/files/${S.env}?dir=${encodeURIComponent(dir)}`);
  const parts = dir.split("/").filter(Boolean);
  const crumbs = [`<a href="#files">${S.env}</a>`, ...parts.map((p, i) => `<a href="#files/${encodeURIComponent("/" + parts.slice(0, i + 1).join("/"))}">${esc(p)}</a>`)].join(" / ");
  const items = r.items.sort((a, b) => (b.isDir - a.isDir) || a.name.localeCompare(b.name));
  main.innerHTML = envHead("Bestanden", `Bestandsmap van de omgeving, gebruikt door de stap “Bestand” en de map-trigger. Locatie op de server: <code>${esc(r.root)}</code>`, `<button class="btn" data-act="f-upload" data-dir="${esc(dir)}">+ Bestand plaatsen</button>`) + `
  <div class="card"><div class="ch"><h3 class="mono" style="font-weight:500">${crumbs}</h3></div><div class="tw">${items.length ? `<table><thead><tr><th>Naam</th><th>Grootte</th><th>Gewijzigd</th><th></th></tr></thead><tbody>
    ${items.map((f) => f.isDir
      ? `<tr class="click" data-go="files/${encodeURIComponent(f.path)}"><td>📁 <b>${esc(f.name)}</b></td><td></td><td class="mono">${fmtDateTime(f.modifiedAt)}</td><td class="faint">Openen →</td></tr>`
      : `<tr><td>${esc(f.name)}</td><td class="mono">${f.size} B</td><td class="mono">${fmtDateTime(f.modifiedAt)}</td><td><div class="row" style="justify-content:flex-end"><button class="btn sm sec" data-act="f-view" data-path="${esc(f.path)}">Bekijken</button><button class="btn sm no" data-act="f-del" data-path="${esc(f.path)}">×</button></div></td></tr>`).join("")}
  </tbody></table>` : `<div class="empty">Deze map is leeg.</div>`}</div></div>`;
};

// ============================================================ MCP
VIEWS.mcp = async (main) => {
  const info = await api("/api/v1/mcp/info");
  const desktop = JSON.stringify({ mcpServers: { aip: { command: info.stdio.command, args: info.stdio.args, env: info.stdio.env } } }, null, 2);
  const claudeCode = `claude mcp add --transport http aip ${info.httpUrl}${info.tokenRequired ? ' --header "Authorization: Bearer <AIP_MCP_TOKEN>"' : ""}`;
  const inspector = `npx @modelcontextprotocol/inspector`;
  main.innerHTML = `
  <div class="head"><div><h1>MCP-server</h1><p>Koppel een MCP-client (Claude Code, Claude Desktop, Cursor, eigen agents) aan het platform. Via MCP kan een AI processen ontwerpen, testen, opslaan, uitvoeren en deploys voorstellen. Deploys en PROD-uitvoeringen blijven menselijke goedkeuring vereisen.</p></div>
    <button class="btn" data-act="mcp-test">Verbinding testen</button></div>
  <div class="g2" style="margin-bottom:14px">
    <div class="card"><div class="ch"><h3>Streamable HTTP</h3>${info.tokenRequired ? '<span class="chip ok">token vereist</span>' : '<span class="chip warn">zonder token</span>'}</div><div class="cb stack" style="gap:10px">
      <div><div class="muted" style="font-size:.75rem;font-weight:600">URL</div><div class="row"><code>${esc(info.httpUrl)}</code>${copyBtn(info.httpUrl)}</div></div>
      <div><div class="muted" style="font-size:.75rem;font-weight:600">CLAUDE CODE</div><div class="row"><code style="word-break:break-all">${esc(claudeCode)}</code>${copyBtn(claudeCode)}</div></div>
      <div><div class="muted" style="font-size:.75rem;font-weight:600">MCP INSPECTOR</div><div class="row"><code>${esc(inspector)}</code>${copyBtn(inspector)}</div><div class="hint">Kies transport “Streamable HTTP” en vul de URL in.</div></div>
      ${info.tokenRequired ? "" : `<div class="hint">Zet <code>AIP_MCP_TOKEN</code> om een Bearer-token te vereisen (aanbevolen buiten je eigen machine).</div>`}
      <div class="hint">Goedkeuren via MCP: ${info.allowApprovals ? '<b>aan</b> (AIP_MCP_ALLOW_APPROVALS=true)' : "<b>uit</b> — een AI kan voorstellen, een mens beslist."}</div>
      <div id="mcp-test-out"></div>
    </div></div>
    <div class="card"><div class="ch"><h3>Claude Desktop (stdio)</h3>${copyBtn(desktop)}</div><div class="cb">
      <div class="hint" style="margin-bottom:6px">Zet dit in <code>claude_desktop_config.json</code> en herstart Claude Desktop. Het platform moet draaien.</div>
      <pre class="code">${esc(desktop)}</pre>
      <div class="hint">Of vanuit de projectmap: <code>npm run mcp</code> (met <code>AIP_URL</code>).</div>
    </div></div>
  </div>
  <div class="card"><div class="ch"><h3>Beschikbaar via MCP</h3></div><div class="cb">
    <div class="muted" style="font-size:.75rem;font-weight:600;margin-bottom:6px">TOOLS (${info.tools.length})</div>
    <div class="row" style="gap:6px">${info.tools.map((t) => `<span class="chip info mono">${esc(t)}</span>`).join("")}</div>
    <div class="muted" style="font-size:.75rem;font-weight:600;margin:14px 0 6px">RESOURCES</div>
    <div class="row" style="gap:6px">${info.resources.map((t) => `<span class="chip none mono">${esc(t)}</span>`).join("")}</div>
    <div class="muted" style="font-size:.75rem;font-weight:600;margin:14px 0 6px">PROMPTS</div>
    <div class="row" style="gap:6px">${info.prompts.map((t) => `<span class="chip none mono">${esc(t)}</span>`).join("")}</div>
    <div class="hint" style="margin-top:14px">Omgekeerd kan een proces zelf een externe MCP-server aanroepen met de stap “MCP-tool” en een koppeling van type MCP-server.</div>
  </div></div>`;
};
async function mcpSelfTest() {
  const out = document.getElementById("mcp-test-out");
  out.innerHTML = "Bezig…";
  const call = (id, method, params) => fetch("/mcp", { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id, method, params }) }).then((r) => r.json());
  try {
    const t0 = performance.now();
    const init = await call(1, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "aip-gui", version: "1" } });
    const tools = await call(2, "tools/list", {});
    const dash = await call(3, "tools/call", { name: "get_dashboard", arguments: {} });
    const d = JSON.parse(dash.result.content[0].text);
    out.innerHTML = `<span class="chip ok">verbonden</span> <span class="mono">${Math.round(performance.now() - t0)} ms</span> · server <b>${esc(init.result.serverInfo.name)}</b> · ${tools.result.tools.length} tools · get_dashboard: ${d.runs.totalRuns} uitvoeringen`;
  } catch (err) {
    out.innerHTML = `<div class="ndv-err">✕ ${esc(err.message)}${location.hostname === "localhost" ? "" : " (token vereist?)"}</div>`;
  }
}

// ============================================================ INSTELLINGEN
VIEWS.settings = async (main) => {
  const [st, vs] = await Promise.all([api("/api/v1/settings"), api("/api/v1/versions/stats").catch(() => null)]);
  S.settings = st;
  main.innerHTML = `
  <div class="head"><div><h1>Instellingen</h1><p>Platformbrede instellingen. Elke wijziging komt in het audit log, met wie het deed.</p></div></div>
  <div class="card" style="max-width:820px;margin-bottom:14px"><div class="ch"><h3>Taal</h3></div><div class="cb">
    <div class="setting">
      <div>
        <div class="setting-t">Taal van de gebruikersinterface</div>
        <div class="muted" style="font-size:.86rem;margin-top:4px">Alle schermen, meldingen en de AI-assistent. Geldt voor deze browser.</div>
      </div>
      <select class="f" id="set-lang" style="width:auto" aria-label="Taal" data-noi18n>${Object.entries(window.I18N.langs).map(([k, l]) => `<option value="${k}" ${window.I18N.lang === k ? "selected" : ""}>${l}</option>`).join("")}</select>
    </div>
  </div></div>
  <div class="card" style="max-width:820px"><div class="ch"><h3>Goedkeuringen</h3></div><div class="cb">
    <div class="setting">
      <div>
        <div class="setting-t">Vier-ogenprincipe</div>
        <div class="muted" style="font-size:.86rem;margin-top:4px">Aan: de indiener mag een eigen verzoek niet goedkeuren, en acties met risico RED (o.a. deploy naar PROD) vragen twee verschillende goedkeurders binnen 30 minuten.<br>Uit: één goedkeuring volstaat, ook voor PROD, en de indiener mag zelf goedkeuren.</div>
        <div class="hint" style="margin-top:8px">Openstaande verzoeken waar nog niemand over besliste volgen de nieuwe instelling; verzoeken met al een goedkeuring houden hun oorspronkelijke eis. Wijzigen kan alleen hier (niet via MCP).</div>
      </div>
      <label class="switch"><input type="checkbox" id="set-foureyes" ${st.fourEyes ? "checked" : ""} aria-label="Vier-ogenprincipe"><span></span></label>
    </div>
    <div class="row" style="margin-top:14px">Nu: ${st.fourEyes ? '<span class="chip ok">aan — TEST/ACC 1 goedkeuring (niet door indiener), PROD 2 personen</span>' : '<span class="chip warn">uit — alles 1 goedkeuring, indiener mag zelf goedkeuren</span>'}</div>
  </div></div>
  <div class="card" style="max-width:820px;margin-top:14px"><div class="ch"><h3>Versies</h3>${vs ? `<span class="faint" style="font-size:.8rem">${vs.versions} versie${vs.versions === 1 ? "" : "s"} van ${vs.processes} proces${vs.processes === 1 ? "" : "sen"}</span>` : ""}</div><div class="cb">
    <div class="setting">
      <div>
        <div class="setting-t">Aantal versies bewaren per proces</div>
        <div class="muted" style="font-size:.86rem;margin-top:4px">Zo ver kun je terug bij terugzetten en vergelijken (maximaal ${vs ? vs.max : 100}). Oudere versies worden automatisch opgeruimd. Versies die op een omgeving draaien of in een openstaand goedkeuringsverzoek staan, blijven altijd bewaard.</div>
      </div>
      <div class="row" style="flex-wrap:nowrap"><input class="f" type="number" id="set-ret" min="1" max="${vs ? vs.max : 100}" value="${st.versionRetention ?? 50}" style="width:90px" aria-label="Aantal versies"><button class="btn sec" id="set-ret-save" data-ico-done>${ic("save")}<span>Opslaan</span></button></div>
    </div>
    <div class="setting" style="margin-top:14px;border-top:1px solid var(--border);padding-top:14px">
      <div>
        <div class="setting-t">Opschonen: oude versies van alle processen verwijderen</div>
        <div class="muted" style="font-size:.86rem;margin-top:4px">Verwijdert alle oude versies van alle processen. Per proces blijven alleen de nieuwste versie en de versies die op DEV, TEST, ACC of PROD draaien. Dit kan niet ongedaan worden gemaakt.</div>
        ${vs ? `<div class="hint" style="margin-top:6px">${vs.removableCleanup ? `<b>${vs.removableCleanup}</b> van de ${vs.versions} versies kunnen weg.` : "Er valt niets op te schonen."}</div>` : ""}
      </div>
      <button class="btn no" id="set-cleanup" data-ico-done ${vs && !vs.removableCleanup ? "disabled" : ""}>${ic("trash")}<span>Opschonen</span></button>
    </div>
  </div></div>`;
  document.getElementById("set-ret-save").addEventListener("click", async () => {
    const n = Number(document.getElementById("set-ret").value);
    const max = vs ? vs.max : 100;
    if (!Number.isInteger(n) || n < 1 || n > max) return toast(`Kies een aantal tussen 1 en ${max}`, true);
    const lower = n < (st.versionRetention ?? 50);
    const go = async () => { await api("/api/v1/settings", { method: "PUT", body: { versionRetention: n } }); toast(`Er worden nu ${n} versies per proces bewaard`); render(); };
    if (!lower) return go().catch((err) => toast(err.message, true));
    confirmModal("Minder versies bewaren", `Vanaf nu blijven per proces de nieuwste ${n} versies bewaard. Oudere versies worden meteen verwijderd (versies die op een omgeving draaien blijven staan).`, () => go().catch((err) => toast(err.message, true)), "Opslaan en opruimen");
  });
  document.getElementById("set-cleanup").addEventListener("click", () => {
    confirmModal("Alle oude versies verwijderen?", `${vs ? `<b>${vs.removableCleanup}</b> versie${vs.removableCleanup === 1 ? "" : "s"} van ${vs.processes} proces${vs.processes === 1 ? "" : "sen"} ${vs.removableCleanup === 1 ? "wordt" : "worden"} definitief verwijderd. ` : ""}Per proces blijven alleen de nieuwste versie en de versies die op een omgeving draaien. Dit kan niet ongedaan worden gemaakt.`, async () => {
      try {
        const r = await api("/api/v1/versions/cleanup", { body: { confirm: true } });
        toast(`${r.removed} versie${r.removed === 1 ? "" : "s"} verwijderd uit ${r.processes} proces${r.processes === 1 ? "" : "sen"}`);
        render();
      } catch (err) { toast(err.message, true); }
    }, "Definitief verwijderen");
  });
  document.getElementById("set-lang").addEventListener("change", (e) => window.I18N.set(e.target.value));
  document.getElementById("set-foureyes").addEventListener("change", (e) => {
    const on = e.target.checked;
    e.target.checked = !on; // pas na bevestiging
    confirmModal(on ? "Vier-ogenprincipe aanzetten" : "Vier-ogenprincipe uitzetten",
      on ? "Vanaf nu mag de indiener niet zelf goedkeuren en vraagt PROD twee goedkeurders." : "Vanaf nu volstaat één goedkeuring, ook voor PROD, en mag de indiener zelf goedkeuren. Weet je het zeker?",
      async () => {
        await api("/api/v1/settings", { method: "PUT", body: { fourEyes: on } });
        toast(`Vier-ogenprincipe ${on ? "aan" : "uit"}`);
        refreshStatus();
        render();
      }, on ? "Aanzetten" : "Uitzetten");
  });
};

// ============================================================ acties
document.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-act]");
  if (!b) return;
  const act = b.dataset.act;
  const env = S.env;
  try {
    if (act === "trig-pause" || act === "trig-resume") {
      await api(`/api/v1/triggers/${env}/${encodeURIComponent(b.dataset.name)}/${act === "trig-pause" ? "pause" : "resume"}`, { method: "POST", headers: { "x-aip-user": who() } });
      toast(`${b.dataset.name} op ${env.toUpperCase()} ${act === "trig-pause" ? "gepauzeerd" : "hervat"}`);
      render();
    }
    if (act === "cred-new") await credModal(null);
    if (act === "cred-edit") { if (b.dataset.plugin && window.pluginCredModal) await window.pluginCredModal(b.dataset.plugin, b.dataset.name); else await credModal(b.dataset.name); }
    if (act === "cred-test") credTestModal(b.dataset.name);
    if (act === "cred-del") confirmModal("Koppeling verwijderen", `Weet je zeker dat je <b>${esc(b.dataset.name)}</b> wilt verwijderen? Processen die deze koppeling gebruiken falen daarna.`, async () => { await api(`/api/v1/credentials/${encodeURIComponent(b.dataset.name)}`, { method: "DELETE", headers: { "x-aip-user": who() } }); toast("Koppeling verwijderd"); render(); });

    if (act === "q-new") {
      openModal(`<div class="ch"><h3>Nieuwe queue</h3><button class="x" data-close aria-label="Sluiten">×</button></div>
        <div class="cb ndv-cb"><label for="qn-name">Naam</label><input class="f" id="qn-name" placeholder="orders"><div class="hint">Letters, cijfers, punt, - en _.</div><label for="qn-desc">Omschrijving</label><input class="f" id="qn-desc">
        <div class="xf-note" style="margin-top:12px">Wordt aangemaakt op DEV, TEST, ACC en PROD met dezelfde naam. De berichten blijven per omgeving gescheiden.</div></div>
        <div class="cf"><button class="btn sec" data-close>Annuleren</button><button class="btn" id="qn-ok">Aanmaken</button></div>`);
      document.getElementById("qn-ok").addEventListener("click", async () => {
        try { const q = await api(`/api/v1/queues/${env}`, { body: { queue: document.getElementById("qn-name").value.trim(), description: document.getElementById("qn-desc").value || undefined } }); closeModal(); toast(`Queue ${q.queue} aangemaakt op ${(q.envs || []).map((e) => e.toUpperCase()).join(", ")}`); render(); }
        catch (err) { toast(err.message, true); }
      });
      setTimeout(() => document.getElementById("qn-name")?.focus(), 0);
    }
    if (act === "q-pub") {
      openModal(`<div class="ch"><h3>Bericht op ${esc(b.dataset.q)} (${env.toUpperCase()})</h3><button class="x" data-close aria-label="Sluiten">×</button></div>
        <div class="cb"><label class="muted" for="qp-body" style="font-size:.75rem;font-weight:600">BERICHT (JSON)</label><textarea class="f" id="qp-body" style="min-height:200px">${esc(JSON.stringify({ orderId: "ORD-" + Math.floor(Math.random() * 9000 + 1000), bedrag: 49.95 }, null, 2))}</textarea></div>
        <div class="cf"><button class="btn sec" data-close>Annuleren</button><button class="btn" id="qp-ok">Plaatsen</button></div>`);
      document.getElementById("qp-ok").addEventListener("click", async () => {
        let body;
        try { body = JSON.parse(document.getElementById("qp-body").value); } catch { return toast("Geen geldige JSON", true); }
        try { await api(`/api/v1/queues/${env}/${encodeURIComponent(b.dataset.q)}/messages`, { body: { body } }); closeModal(); toast("Bericht geplaatst"); render(); }
        catch (err) { toast(err.message, true); }
      });
    }
    if (act === "q-peek") {
      const msgs = await api(`/api/v1/queues/${env}/${encodeURIComponent(b.dataset.q)}/messages`);
      openModal(`<div class="ch"><h3>Berichten in ${esc(b.dataset.q)}</h3><button class="x" data-close aria-label="Sluiten">×</button></div>
        <div class="cb" style="max-height:66vh;overflow:auto">${msgs.map((m) => `<div style="margin-bottom:12px"><div class="faint mono" style="font-size:.74rem">${esc(m.id.slice(0, 8))} · ${fmtDateTime(m.enqueuedAt)} · pogingen ${m.attempts}${m.lastError ? ` · <span style="color:var(--red)">${esc(m.lastError)}</span>` : ""}</div><pre class="code">${esc(JSON.stringify(m.body, null, 2))}</pre></div>`).join("") || '<div class="empty">Leeg</div>'}</div>`);
    }
    if (act === "q-take") {
      const msgs = await api(`/api/v1/queues/${env}/${encodeURIComponent(b.dataset.q)}/take`, { body: { max: 1 } });
      openModal(`<div class="ch"><h3>Opgehaald uit ${esc(b.dataset.q)}</h3><button class="x" data-close aria-label="Sluiten">×</button></div><div class="cb">${msgs.length ? `<pre class="code">${esc(JSON.stringify(msgs[0].body, null, 2))}</pre><div class="hint">Het bericht is van de queue gehaald.</div>` : '<div class="empty">De queue was leeg.</div>'}</div>`);
      render();
    }
    if (act === "q-redrive") { const r = await api(`/api/v1/queues/${env}/${encodeURIComponent(b.dataset.q)}/redrive`, { method: "POST" }); toast(`${r.moved} bericht(en) opnieuw aangeboden`); render(); }
    if (act === "q-purge") confirmModal("Queue leegmaken", `Alle berichten in <b>${esc(b.dataset.q)}</b> op ${env.toUpperCase()} worden verwijderd.`, async () => { const r = await api(`/api/v1/queues/${env}/${encodeURIComponent(b.dataset.q)}/purge`, { method: "POST" }); toast(`${r.purged} bericht(en) verwijderd`); render(); }, "Leegmaken");
    if (act === "q-del") {
      const all = await api("/api/v1/queues");
      const per = ENVS.map((e) => `${e.label}: ${all.find((q) => q.env === e.id && q.queue === b.dataset.q)?.depth ?? 0}`).join(" · ");
      confirmModal("Queue verwijderen", `Queue <b>${esc(b.dataset.q)}</b> wordt verwijderd op <b>alle omgevingen</b> (DEV, TEST, ACC, PROD), met de berichten die erin staan.<br><span class="muted">Berichten per omgeving: ${esc(per)}</span>`, async () => { await api(`/api/v1/queues/${env}/${encodeURIComponent(b.dataset.q)}`, { method: "DELETE" }); toast("Queue verwijderd op alle omgevingen"); render(); });
    }

    if (act === "dt-new") columnsModal("", [{ name: "", type: "string" }], true);
    if (act === "dt-cols") { const t = await api(`/api/v1/datatables/${env}/${encodeURIComponent(b.dataset.t)}`); columnsModal(b.dataset.t, t.columns, false); }
    if (act === "dt-add") {
      const main = document.getElementById("main");
      const vals = readRowInputs(main._dt.t, "dt-new-");
      await api(`/api/v1/datatables/${env}/${encodeURIComponent(b.dataset.t)}/rows`, { body: vals });
      toast("Rij toegevoegd"); render();
    }
    if (act === "dt-edit") {
      const main = document.getElementById("main");
      const { t, rows, inputFor } = main._dt;
      const r = rows.find((x) => String(x.id) === b.dataset.id);
      openModal(`<div class="ch"><h3>Rij ${r.id} bewerken</h3><button class="x" data-close aria-label="Sluiten">×</button></div>
        <div class="cb ndv-cb">${t.columns.map((c) => `<label for="dt-e-${esc(c.name)}">${esc(c.name)} <span class="faint">${esc(c.type)}</span></label>${inputFor(c, r[c.name], `dt-e-${c.name}`)}`).join("")}</div>
        <div class="cf"><button class="btn sec" data-close>Annuleren</button><button class="btn" id="dte-ok">Opslaan</button></div>`);
      document.getElementById("dte-ok").addEventListener("click", async () => {
        try { await api(`/api/v1/datatables/${env}/${encodeURIComponent(b.dataset.t)}/rows/${r.id}`, { method: "PATCH", body: readRowInputs(t, "dt-e-") }); closeModal(); toast("Rij opgeslagen"); render(); }
        catch (err) { toast(err.message, true); }
      });
    }
    if (act === "dt-delrow") { await api(`/api/v1/datatables/${env}/${encodeURIComponent(b.dataset.t)}/rows/${b.dataset.id}`, { method: "DELETE" }); toast("Rij verwijderd"); render(); }
    if (act === "dt-search") { DT.q = document.getElementById("dt-q").value; DT.qcol = document.getElementById("dt-qcol").value; DT.offset = 0; render(); }
    if (act === "dt-page") { DT.offset = Math.max(0, DT.offset + Number(b.dataset.d) * DT_PAGE); render(); }
    if (act === "dt-clear") confirmModal("Tabel leegmaken", `Alle rijen van <b>${esc(b.dataset.t)}</b> op ${env.toUpperCase()} worden verwijderd.`, async () => { const r = await api(`/api/v1/datatables/${env}/${encodeURIComponent(b.dataset.t)}/clear`, { method: "POST", headers: { "x-aip-user": who() } }); toast(`${r.cleared} rij(en) verwijderd`); render(); }, "Leegmaken");
    if (act === "dt-drop") {
      const info = await api(`/api/v1/datatables/${env}/${encodeURIComponent(b.dataset.t)}`);
      const per = ENVS.map((e) => `${e.label}: ${info.rowCounts?.[e.id] ?? 0}`).join(" · ");
      confirmModal("Tabel verwijderen", `Tabel <b>${esc(b.dataset.t)}</b> wordt verwijderd op <b>alle omgevingen</b> (DEV, TEST, ACC, PROD), met alle rijen. Processen die de tabel gebruiken falen daarna.<br><span class="muted">Rijen per omgeving: ${esc(per)}</span>`, async () => { await api(`/api/v1/datatables/${env}/${encodeURIComponent(b.dataset.t)}`, { method: "DELETE", headers: { "x-aip-user": who() } }); toast("Tabel verwijderd op alle omgevingen"); go("datatables"); });
    }

    if (act === "f-upload") {
      const dir = b.dataset.dir === "/" ? "" : b.dataset.dir.replace(/^\//, "") + "/";
      openModal(`<div class="ch"><h3>Bestand plaatsen op ${env.toUpperCase()}</h3><button class="x" data-close aria-label="Sluiten">×</button></div>
        <div class="cb ndv-cb"><label for="fu-path">Pad</label><input class="f" id="fu-path" value="${esc(dir)}bestand.csv">
        <label for="fu-file">Of kies een bestand</label><input type="file" id="fu-file" class="f">
        <label for="fu-content">Inhoud</label><textarea class="f" id="fu-content" style="min-height:180px">id,naam\n1,Jansen\n2,De Vries\n</textarea>
        <div class="hint">Een map-trigger die op deze map let, pakt het bestand binnen enkele seconden op.</div></div>
        <div class="cf"><button class="btn sec" data-close>Annuleren</button><button class="btn" id="fu-ok">Plaatsen</button></div>`);
      document.getElementById("fu-file").addEventListener("change", async (ev) => {
        const f = ev.target.files[0];
        if (!f) return;
        document.getElementById("fu-content").value = await f.text();
        document.getElementById("fu-path").value = dir + f.name;
      });
      document.getElementById("fu-ok").addEventListener("click", async () => {
        try { await api(`/api/v1/files/${env}`, { body: { path: document.getElementById("fu-path").value.trim(), content: document.getElementById("fu-content").value } }); closeModal(); toast("Bestand geplaatst"); render(); }
        catch (err) { toast(err.message, true); }
      });
    }
    if (act === "f-view") {
      const r = await api(`/api/v1/files/${env}/content?path=${encodeURIComponent(b.dataset.path)}`);
      openModal(`<div class="ch"><h3 class="mono">${esc(b.dataset.path)}</h3><button class="x" data-close aria-label="Sluiten">×</button></div><div class="cb"><pre class="code" style="max-height:60vh">${esc(r.content)}</pre></div>`);
    }
    if (act === "f-del") confirmModal("Bestand verwijderen", `<code>${esc(b.dataset.path)}</code> wordt verwijderd van ${env.toUpperCase()}.`, async () => { await api(`/api/v1/files/${env}?path=${encodeURIComponent(b.dataset.path)}`, { method: "DELETE" }); toast("Bestand verwijderd"); render(); });

    if (act === "mcp-test") await mcpSelfTest();
  } catch (err) { toast(err.message, true); }
});

// ============================================================ BULKACTIES (meerdere tegelijk)
async function eachDo(keys, fn) {
  const res = await Promise.allSettled(keys.map(fn));
  const bad = res.filter((r) => r.status === "rejected");
  return { ok: res.length - bad.length, bad: bad.length, err: bad[0] && bad[0].reason && bad[0].reason.message };
}
function bulkToast(r, done) { toast(`${r.ok} ${done}${r.bad ? ` · ${r.bad} mislukt${r.err ? ` (${r.err})` : ""}` : ""}`, r.bad > 0 && !r.ok); render(); }
BULK.triggers = {
  resume: (keys) => bulkTriggers(keys, "resume"),
  pause: (keys) => bulkTriggers(keys, "pause")
};
BULK.credentials = {
  delete: async (keys) => {
    if (!(await askConfirm(`${keys.length} koppeling${keys.length === 1 ? "" : "en"} verwijderen?`, `${nameList(keys)}<p class="muted" style="font-size:.85rem">Processen die deze koppelingen gebruiken falen daarna op die stap. Dit kan niet ongedaan worden gemaakt.</p>`, "Verwijderen", true))) return;
    bulkToast(await eachDo(keys, (k) => api(`/api/v1/credentials/${encodeURIComponent(k)}`, { method: "DELETE" })), "verwijderd");
  }
};
BULK.queues = {
  purge: async (keys) => {
    if (!(await askConfirm(`${keys.length} queue${keys.length === 1 ? "" : "s"} leegmaken op ${S.env.toUpperCase()}?`, `${nameList(keys)}<p class="muted" style="font-size:.85rem">Alle wachtende berichten worden verwijderd.</p>`, "Leegmaken", true))) return;
    bulkToast(await eachDo(keys, (k) => api(`/api/v1/queues/${S.env}/${encodeURIComponent(k)}/purge`, { body: {} })), "leeggemaakt");
  },
  delete: async (keys) => {
    if (!(await askConfirm(`${keys.length} queue${keys.length === 1 ? "" : "s"} verwijderen?`, `${nameList(keys)}<p class="muted" style="font-size:.85rem">Een queue bestaat op alle omgevingen; hij wordt verwijderd op DEV, TEST, ACC én PROD, met de berichten die erin staan.</p>`, "Verwijderen", true))) return;
    bulkToast(await eachDo(keys, (k) => api(`/api/v1/queues/${S.env}/${encodeURIComponent(k)}`, { method: "DELETE" })), "verwijderd op alle omgevingen");
  }
};
BULK.datatables = {
  clear: async (keys) => {
    if (!(await askConfirm(`${keys.length} tabel${keys.length === 1 ? "" : "len"} leegmaken op ${S.env.toUpperCase()}?`, `${nameList(keys)}<p class="muted" style="font-size:.85rem">Alle rijen worden verwijderd; de kolommen blijven.</p>`, "Leegmaken", true))) return;
    bulkToast(await eachDo(keys, (k) => api(`/api/v1/datatables/${S.env}/${encodeURIComponent(k)}/clear`, { body: {} })), "leeggemaakt");
  },
  delete: async (keys) => {
    if (!(await askConfirm(`${keys.length} tabel${keys.length === 1 ? "" : "len"} verwijderen?`, `${nameList(keys)}<p class="muted" style="font-size:.85rem">Een tabel bestaat op alle omgevingen; hij wordt verwijderd op DEV, TEST, ACC én PROD, met alle rijen.</p>`, "Verwijderen", true))) return;
    bulkToast(await eachDo(keys, (k) => api(`/api/v1/datatables/${S.env}/${encodeURIComponent(k)}`, { method: "DELETE" })), "verwijderd op alle omgevingen");
  }
};
