// API-BEHEER — API's publiceren op basis van OpenAPI, operaties koppelen aan processen of
// doorsturen (passthrough), toegang regelen met API-beleid (API-sleutels, OAuth/JWT,
// publiek, throttling, logging, CORS, IP-beperking) en alle aanroepen volgen in API-monitoring.
/* global VIEWS, S, api, esc, toast, openModal, closeModal, ic, iconBtn, fmtDateTime, render, ENVS, go, confirmModal, askConfirm */

const AM = { mon: { env: "", apiId: "", method: "", status: "", minMs: "", from: "", to: "", path: "", query: "", ip: "", identity: "" }, more: false };
const amPrefix = () => (window.AIP_ME && window.AIP_ME.org && window.AIP_ME.org.pathPrefix) || "";
const amEnvChip = (e, v) => `<span class="am-envv ${v ? "" : "off"}"><span class="env ${e}">${e}</span>${v ? `<b class="mono">${esc(v)}</b>` : '<span class="faint">—</span>'}</span>`;
const amMethod = (m) => `<span class="am-m m-${esc(String(m).toLowerCase())}">${esc(m)}</span>`;
const amStatus = (s) => `<span class="chip ${s < 300 ? "ok" : s < 400 ? "info" : s < 500 ? "warn" : "err"} mono">${s}</span>`;
const AM_TABS = [["", "API's", "list"], ["policies", "Beleid", "settings"], ["keys", "API-sleutels", "copy"], ["issuers", "OAuth-uitgevers", "check"], ["monitoring", "Monitoring", "history"]];
const AM_EXAMPLE = `openapi: 3.0.1
info:
  title: Orders API
  version: 1.0.0
  description: Orders van de webshop opvragen en aanmaken
servers:
  - url: /orders/v1
paths:
  /orders:
    get:
      operationId: listOrders
      summary: Orders zoeken
      parameters:
        - { name: status, in: query, schema: { type: string } }
    post:
      operationId: createOrder
      summary: Order aanmaken
      requestBody:
        content:
          application/json:
            schema: { type: object }
  /orders/{id}:
    get:
      operationId: getOrder
      summary: Order ophalen
      parameters:
        - { name: id, in: path, required: true, schema: { type: string } }
`;

function amHeader(tab) {
  return `<div class="head"><div><h1>API-beheer</h1><p>Publiceer API's op basis van een OpenAPI-specificatie, koppel operaties aan processen of stuur ze door, en bepaal met API-beleid wie erbij mag. Zonder beleid is een endpoint niet bereikbaar.</p></div></div>
    <div class="ed-tabs am-tabs" role="tablist">${AM_TABS.map(([k, l, i]) => `<button role="tab" class="${tab === k ? "on" : ""}" data-go="apis${k ? "/" + k : ""}" data-ico-done>${ic(i, 14)}<span>${l}</span></button>`).join("")}</div>`;
}

VIEWS.apis = async (main) => {
  const p = String(S.param || "");
  if (p.startsWith("api/")) return amDetail(main, decodeURIComponent(p.slice(4)));
  if (p === "policies") return amPolicies(main);
  if (p === "keys") return amKeys(main);
  if (p === "issuers") return amIssuers(main);
  if (p === "monitoring") return amMonitoring(main);
  return amList(main);
};

// ---------------------------------------------------------------- API's
async function amList(main) {
  const list = await api("/api/v1/apim/apis");
  main.innerHTML = amHeader("") + `
    <div class="card"><div class="ch"><h3>API's (${list.length})</h3><button class="btn" id="am-new" data-ico-done>${ic("plus")}<span>Nieuwe API</span></button></div><div class="tw">
    ${list.length ? `<table><thead><tr><th>API</th><th>Basispad</th><th>Operaties</th>${ENVS.map((e) => `<th><span class="env ${e.id}">${e.label}</span></th>`).join("")}<th></th></tr></thead><tbody>
      ${list.map((a) => `<tr class="click" data-go="apis/api/${encodeURIComponent(a.id)}"><td><b>${esc(a.title)}</b><div class="faint" style="font-size:.78rem;max-width:360px">${esc(a.description || "")}</div></td><td class="mono">${esc(a.basePath)}</td>
        <td><span class="chip ${a.linked >= a.operations && a.operations ? "ok" : a.linked ? "warn" : "none"}">${a.linked}/${a.operations} gekoppeld</span></td>
        ${ENVS.map((e) => `<td class="mono">${a.deployed[e.id] ? esc(a.deployed[e.id].version) : '<span class="faint">—</span>'}</td>`).join("")}
        <td>${iconBtn("right", "Openen", `data-go="apis/api/${encodeURIComponent(a.id)}"`)}</td></tr>`).join("")}</tbody></table>`
      : `<div class="empty">Nog geen API's. Maak er een met een OpenAPI-specificatie (JSON of YAML).</div>`}</div></div>
    <div class="xf-note" style="margin-top:14px">Aanroepen: <code>${esc(location.origin + amPrefix())}/apis/&lt;omgeving&gt;/&lt;basispad&gt;/&lt;operatie&gt;</code>. De specificatie voor afnemers staat op <code>…/&lt;basispad&gt;/openapi.json</code>.</div>`;
  document.getElementById("am-new").addEventListener("click", () => amNewApi());
}

function amNewApi() {
  openModal(`<div class="ch"><h3>${ic("plus")} Nieuwe API</h3><button class="x" data-close aria-label="Sluiten">×</button></div>
    <div class="cb" style="max-height:72vh;overflow:auto">
      <div class="row" style="justify-content:space-between"><label class="xf-l" for="am-spec" style="margin:0">OpenAPI-specificatie (3.x of 2.0, JSON of YAML)</label>
        <div class="row"><label class="btn sm sec" data-ico-done>${ic("upload", 14)}<span>Bestand</span><input type="file" id="am-file" accept=".json,.yaml,.yml" hidden></label><button type="button" class="btn sm sec" id="am-ex">Voorbeeld</button></div></div>
      <textarea class="f mono am-code" id="am-spec" spellcheck="false" placeholder="Plak hier de specificatie…"></textarea>
      <div class="row" style="gap:12px;margin-top:8px"><div style="flex:1"><label class="xf-l" for="am-base">Basispad <span class="faint">(leeg = servers[0].url uit de specificatie)</span></label><input class="f mono" id="am-base" placeholder="/orders/v1"></div>
        <div style="flex:1"><label class="xf-l" for="am-title">Titel <span class="faint">(leeg = info.title)</span></label><input class="f" id="am-title"></div></div>
    </div>
    <div class="cf"><button class="btn sec" data-close>Annuleren</button><button class="btn" id="am-create" data-ico-done>${ic("save")}<span>Aanmaken op DEV</span></button></div>`);
  document.getElementById("modal-box").classList.add("wide");
  document.getElementById("am-ex").addEventListener("click", () => { document.getElementById("am-spec").value = AM_EXAMPLE; });
  document.getElementById("am-file").addEventListener("change", async (e) => { const f = e.target.files[0]; if (f) document.getElementById("am-spec").value = await f.text(); });
  document.getElementById("am-create").addEventListener("click", async () => {
    try {
      const r = await api("/api/v1/apim/apis", { body: { specText: document.getElementById("am-spec").value, basePath: document.getElementById("am-base").value || undefined, title: document.getElementById("am-title").value || undefined } });
      closeModal(); toast(`API ${r.title} aangemaakt (${r.version})`); go(`apis/api/${encodeURIComponent(r.id)}`);
    } catch (err) { toast(err.message, true); }
  });
}

let amDetailTab = "ops";
async function amDetail(main, id) {
  const [d, procs] = await Promise.all([api(`/api/v1/apim/apis/${encodeURIComponent(id)}`), api("/api/v1/integrations").catch(() => [])]);
  const links = JSON.parse(JSON.stringify(d.links || {}));
  const envVersions = ENVS.map((e) => amEnvChip(e.id, d.deployed[e.id] && d.deployed[e.id].version)).join("");
  main.innerHTML = amHeader("") + `
    <div class="crumbs"><a href="#apis">API's</a> / ${esc(d.title)}</div>
    <div class="am-head"><div><h2 style="margin:0">${esc(d.title)} <span class="faint mono" style="font-size:.9rem">${esc(d.basePath)}</span></h2><div class="muted" style="font-size:.86rem">${esc(d.description || "")}</div></div>
      <div class="am-envs">${envVersions}</div>
      <div class="row">${iconBtn("rocket", "Deployen naar TEST, ACC of PROD", 'id="am-deploy"', "sec")}${iconBtn("download", "OpenAPI-specificatie downloaden", 'id="am-dl"', "sec")}${iconBtn("trash", "API verwijderen", 'id="am-del"', "sec")}</div></div>
    ${d.specError ? `<div class="xf-note err">${esc(d.specError)}</div>` : ""}
    <div class="seg ndv-seg am-sub" role="tablist">${[["ops", "Operaties"], ["spec", "Specificatie"], ["pass", "Passthrough"], ["versions", "Versies"]].map(([k, l]) => `<button type="button" data-am-sub="${k}" class="${amDetailTab === k ? "on" : ""}">${l}</button>`).join("")}</div>
    <div id="am-body"></div>`;
  const body = document.getElementById("am-body");
  const save = async (patch, msg, note) => { try { await api(`/api/v1/apim/apis/${encodeURIComponent(id)}`, { method: "PUT", body: { ...patch, note } }); toast(msg); render(); } catch (err) { toast(err.message, true); } };

  const drawOps = () => {
    body.innerHTML = `<div class="card"><div class="ch"><h3>Operaties (${d.operations.length})</h3><button class="btn" id="am-save-links" data-ico-done>${ic("save")}<span>Koppelingen opslaan</span></button></div><div class="tw"><table class="am-ops"><thead><tr><th>Operatie</th><th>Koppeling</th><th>Beleid per omgeving</th><th></th></tr></thead><tbody>
      ${d.operations.map((o, i) => { const l = links[o.key] || { mode: "none" }; return `<tr data-op="${i}"><td>${amMethod(o.method)} <span class="mono">${esc(o.path)}</span><div class="faint" style="font-size:.78rem">${esc(o.summary || "")}${o.operationId ? ` · <span class="mono">${esc(o.operationId)}</span>` : ""}</div></td>
        <td style="min-width:300px"><select class="f am-mode" aria-label="Soort koppeling"><option value="none" ${l.mode === "none" ? "selected" : ""}>${d.passthroughAll && d.passthroughAll.target ? "Passthrough (alle endpoints)" : "Niet gekoppeld"}</option><option value="process" ${l.mode === "process" ? "selected" : ""}>Proces</option><option value="passthrough" ${l.mode === "passthrough" ? "selected" : ""}>Passthrough</option></select>
          <div class="am-link"></div></td>
        <td style="white-space:nowrap">${ENVS.map((e) => `<span class="env ${e.id} ${o.policies[e.id] ? "" : "am-nopol"}" title="${o.policies[e.id] ? "Beleid: " + esc(o.policies[e.id]) : "Geen beleid: niet bereikbaar"}">${e.label}</span>`).join(" ")}</td>
        <td>${iconBtn("play", "Proberen", 'data-am-try')}</td></tr>`; }).join("") || '<tr><td colspan="4" class="empty">De specificatie bevat geen operaties.</td></tr>'}
    </tbody></table></div></div>`;
    const drawLink = (tr) => {
      const o = d.operations[Number(tr.dataset.op)];
      const l = links[o.key] || { mode: "none" };
      const host = tr.querySelector(".am-link");
      if (l.mode === "process") {
        const on = l.process && d.operations[Number(tr.dataset.op)].link.process === l.process ? d.operations[Number(tr.dataset.op)].processOn : null;
        host.innerHTML = `<div class="row" style="flex-wrap:nowrap;margin-top:6px"><select class="f am-proc" aria-label="Proces"><option value="">— kies een proces —</option>${procs.map((p) => `<option ${p.integration === l.process ? "selected" : ""}>${esc(p.integration)}</option>`).join("")}</select>${iconBtn("plus", "Nieuw proces voor deze operatie", "data-am-newproc")}${l.process ? iconBtn("edit", "Proces openen in de editor", `data-go="editor/${encodeURIComponent(l.process)}"`) : ""}</div>
          ${on ? `<div class="am-on">${ENVS.map((e) => `<span class="env ${e.id}" style="opacity:${on[e.id] != null ? 1 : 0.3}" title="${on[e.id] != null ? "v" + on[e.id] + " staat op " + e.label : "staat niet op " + e.label}">${e.label}${on[e.id] != null ? " v" + on[e.id] : ""}</span>`).join(" ")}</div>` : ""}`;
        host.querySelector(".am-proc").addEventListener("change", (e) => { links[o.key] = { mode: "process", process: e.target.value }; });
        host.querySelector("[data-am-newproc]").addEventListener("click", async () => {
          try { const r = await api(`/api/v1/apim/apis/${encodeURIComponent(id)}/link-new-process`, { body: { operation: o.key } }); toast(`Proces ${r.process} aangemaakt en gekoppeld`); render(); } catch (err) { toast(err.message, true); }
        });
      } else if (l.mode === "passthrough") {
        host.innerHTML = amPassFields(l, `op${tr.dataset.op}`);
        amBindPass(host, (v) => { links[o.key] = { mode: "passthrough", ...v }; });
      } else host.innerHTML = "";
    };
    body.querySelectorAll("tr[data-op]").forEach((tr) => {
      drawLink(tr);
      tr.querySelector(".am-mode").addEventListener("change", (e) => {
        const o = d.operations[Number(tr.dataset.op)];
        links[o.key] = e.target.value === "none" ? { mode: "none" } : e.target.value === "process" ? { mode: "process", process: (links[o.key] && links[o.key].process) || "" } : { mode: "passthrough", target: "", forwardPath: true, forwardQuery: true };
        drawLink(tr);
      });
      tr.querySelector("[data-am-try]").addEventListener("click", () => amTry(d, d.operations[Number(tr.dataset.op)]));
    });
    document.getElementById("am-save-links").addEventListener("click", () => {
      for (const [k, v] of Object.entries(links)) if (v.mode === "process" && !v.process) return toast(`Kies een proces voor ${k}`, true);
      save({ links }, "Koppelingen opgeslagen", "Koppelingen gewijzigd");
    });
  };
  const drawSpec = () => {
    body.innerHTML = `<div class="card"><div class="ch"><h3>Specificatie</h3><button class="btn" id="am-spec-save" data-ico-done>${ic("save")}<span>Opslaan (nieuwe versie)</span></button></div><div class="cb">
      <div class="row" style="gap:12px"><div style="flex:1"><label class="xf-l" for="am-t">Titel</label><input class="f" id="am-t" value="${esc(d.title)}"></div><div style="flex:1"><label class="xf-l" for="am-b">Basispad</label><input class="f mono" id="am-b" value="${esc(d.basePath)}"></div></div>
      <label class="xf-l" for="am-desc">Omschrijving</label><input class="f" id="am-desc" value="${esc(d.description || "")}">
      <label class="xf-l" for="am-s">OpenAPI (JSON of YAML)</label><textarea class="f mono am-code" id="am-s" spellcheck="false">${esc(d.specText)}</textarea>
      <label class="xf-l" for="am-note">Wat is er veranderd? <span class="faint">(optioneel)</span></label><input class="f" id="am-note" placeholder="bijv. veld status toegevoegd">
      <div class="hint">Opslaan maakt een nieuwe patchversie op DEV. TEST, ACC en PROD veranderen pas na een deploy.</div></div></div>`;
    document.getElementById("am-spec-save").addEventListener("click", () => save({ specText: document.getElementById("am-s").value, title: document.getElementById("am-t").value, basePath: document.getElementById("am-b").value, description: document.getElementById("am-desc").value }, "Specificatie opgeslagen", document.getElementById("am-note").value || undefined));
  };
  const drawPass = () => {
    const pa = d.passthroughAll || { target: "", forwardPath: true, forwardQuery: true };
    let cur = { ...pa };
    body.innerHTML = `<div class="card"><div class="ch"><h3>Passthrough voor alle endpoints</h3><button class="btn" id="am-pass-save" data-ico-done>${ic("save")}<span>Opslaan</span></button></div><div class="cb">
      <p class="muted" style="margin-top:0;font-size:.88rem">Stuur aanroepen zonder eigen koppeling ongewijzigd door naar een achterliggende API (bijv. om alles onder één domein aan te bieden). Het resterende pad en de querystring worden doorgegeven. Operaties met een eigen koppeling gaan voor. Beleid, throttling en monitoring blijven gelden.</p>
      <div id="am-pass">${amPassFields(pa, "all")}</div></div></div>`;
    amBindPass(document.getElementById("am-pass"), (v) => { cur = v; });
    document.getElementById("am-pass-save").addEventListener("click", () => save({ passthroughAll: cur.target ? { mode: "passthrough", ...cur } : { mode: "none" } }, cur.target ? "Passthrough opgeslagen" : "Passthrough uitgezet", "Passthrough gewijzigd"));
  };
  const drawVersions = () => {
    body.innerHTML = `<div class="card"><div class="ch"><h3>Versies</h3></div><div class="tw"><table><thead><tr><th>Versie</th><th>Datum</th><th>Door</th><th>Notitie</th><th>Actief op</th><th></th></tr></thead><tbody>
      ${d.versions.map((v) => { const on = ENVS.filter((e) => d.deployed[e.id] && d.deployed[e.id].version === v.version); return `<tr><td class="mono"><b>${esc(v.version)}</b>${v.published ? ' <span class="chip info" title="Gepubliceerd: onveranderlijk">gepubliceerd</span>' : ""}</td><td class="faint">${esc(fmtDateTime(v.at))}</td><td>${esc(v.by)}</td><td>${esc(v.note || "")}</td><td>${on.map((e) => `<span class="env ${e.id}">${e.label}</span>`).join(" ")}</td>
        <td><div class="row icons" style="justify-content:flex-end;flex-wrap:nowrap">${iconBtn("eye", "Specificatie bekijken", `data-am-view="${esc(v.version)}"`)}${v.version !== d.version ? iconBtn("restore", "Terugzetten als werkversie op DEV", `data-am-restore="${esc(v.version)}"`) : ""}${iconBtn("rocket", "Deze versie deployen", `data-am-dv="${esc(v.version)}"`)}</div></td></tr>`; }).join("")}
    </tbody></table></div></div>`;
    body.querySelectorAll("[data-am-view]").forEach((b) => b.addEventListener("click", async () => {
      const v = await api(`/api/v1/apim/apis/${encodeURIComponent(id)}/versions/${encodeURIComponent(b.dataset.amView)}`);
      openModal(`<div class="ch"><h3>${esc(d.title)} · ${esc(v.version)}</h3><button class="x" data-close aria-label="Sluiten">×</button></div><div class="cb"><pre class="code" style="max-height:60vh">${esc(v.doc.specText)}</pre></div><div class="cf"><button class="btn" data-close>Sluiten</button></div>`);
      document.getElementById("modal-box").classList.add("wide");
    }));
    body.querySelectorAll("[data-am-restore]").forEach((b) => b.addEventListener("click", async () => {
      try { await api(`/api/v1/apim/apis/${encodeURIComponent(id)}/versions/${encodeURIComponent(b.dataset.amRestore)}/restore`, { body: {} }); toast(`${b.dataset.amRestore} teruggezet op DEV`); render(); } catch (err) { toast(err.message, true); }
    }));
    body.querySelectorAll("[data-am-dv]").forEach((b) => b.addEventListener("click", () => amDeploy(d, b.dataset.amDv)));
  };
  const show = (t) => { amDetailTab = t; main.querySelectorAll("[data-am-sub]").forEach((b) => b.classList.toggle("on", b.dataset.amSub === t)); ({ ops: drawOps, spec: drawSpec, pass: drawPass, versions: drawVersions })[t](); };
  main.querySelectorAll("[data-am-sub]").forEach((b) => b.addEventListener("click", () => show(b.dataset.amSub)));
  show(amDetailTab);
  document.getElementById("am-deploy").addEventListener("click", () => amDeploy(d));
  // Download: de spec zoals afnemers hem zien (met server-URL van de omgeving), voor de hoogste omgeving waar hij staat.
  document.getElementById("am-dl").addEventListener("click", async () => {
    const env = ["prod", "acc", "test"].find((e) => d.deployed[e]) || "dev";
    let text = d.specText, ext = d.specText.trim().startsWith("{") ? "json" : "yaml";
    try { text = JSON.stringify(await api(`/api/v1/apim/apis/${encodeURIComponent(id)}/spec?env=${env}`), null, 2); ext = "json"; } catch { /* ruwe spec */ }
    const blob = new Blob([text], { type: ext === "json" ? "application/json" : "text/plain" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `${d.id}-${env}.${ext}`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  document.getElementById("am-del").addEventListener("click", () => confirmModal("API verwijderen?", `<b>${esc(d.title)}</b> wordt verwijderd. Dat kan alleen als hij nergens meer gedeployed is; gekoppelde processen blijven bestaan.`, async () => { await api(`/api/v1/apim/apis/${encodeURIComponent(id)}`, { method: "DELETE" }); toast("API verwijderd"); go("apis"); }, "Verwijderen"));
}

function amPassFields(l, uid) {
  const set = Object.entries(l.setHeaders || {}).map(([k, v]) => `${k}: ${v}`).join("\n");
  return `<div class="am-pass"><label class="xf-l" for="pt-${uid}">Doel-URL</label><input class="f mono" id="pt-${uid}" data-pt="target" placeholder="https://erp.bedrijf.nl/api" value="${esc(l.target || "")}">
    <div class="row" style="gap:14px;margin-top:6px"><label class="chk"><input type="checkbox" data-pt="forwardPath" ${l.forwardPath !== false ? "checked" : ""}> Resterend pad doorgeven</label><label class="chk"><input type="checkbox" data-pt="forwardQuery" ${l.forwardQuery !== false ? "checked" : ""}> Querystring doorgeven</label></div>
    <div class="row" style="gap:10px;margin-top:6px;align-items:flex-start"><div style="flex:1"><label class="xf-l" for="ph-${uid}">Headers toevoegen <span class="faint">(Naam: waarde, één per regel)</span></label><textarea class="f mono" id="ph-${uid}" data-pt="set" rows="2" placeholder="Authorization: Bearer …">${esc(set)}</textarea></div>
      <div style="flex:1"><label class="xf-l" for="pr-${uid}">Headers weghalen <span class="faint">(komma-gescheiden)</span></label><input class="f mono" id="pr-${uid}" data-pt="remove" value="${esc((l.removeHeaders || []).join(", "))}"></div></div></div>`;
}
function amBindPass(host, onChange) {
  const read = () => {
    const setHeaders = {};
    for (const line of host.querySelector('[data-pt="set"]').value.split("\n")) { const i = line.indexOf(":"); if (i > 0) setHeaders[line.slice(0, i).trim()] = line.slice(i + 1).trim(); }
    onChange({ target: host.querySelector('[data-pt="target"]').value.trim(), forwardPath: host.querySelector('[data-pt="forwardPath"]').checked, forwardQuery: host.querySelector('[data-pt="forwardQuery"]').checked, setHeaders, removeHeaders: host.querySelector('[data-pt="remove"]').value.split(",").map((x) => x.trim()).filter(Boolean) });
  };
  host.addEventListener("input", read);
  host.addEventListener("change", read);
  read();
}

function amDeploy(d, versionPref) {
  const targets = ENVS.filter((e) => e.id !== "dev");
  let env = targets.find((e) => !d.deployed[e.id])?.id || "test";
  openModal(`<div class="ch"><h3>${ic("rocket")} ${esc(d.title)} deployen</h3><button class="x" data-close aria-label="Sluiten">×</button></div>
    <div class="cb"><label class="xf-l">Naar omgeving</label>
      <div class="dp-envs" role="radiogroup">${targets.map((e) => `<label class="dp-env"><input type="radio" name="amd-env" value="${e.id}" ${e.id === env ? "checked" : ""}><span class="env ${e.id}">${e.label}</span><span class="faint">nu ${d.deployed[e.id] ? esc(d.deployed[e.id].version) : "—"}</span></label>`).join("")}</div>
      <label class="xf-l" for="amd-v">Versie</label><select class="f" id="amd-v">${d.versions.map((v) => `<option value="${esc(v.version)}" ${v.version === (versionPref || d.version) ? "selected" : ""}>${esc(v.version)}${v.published ? " (gepubliceerd)" : ""}${v.note ? " — " + esc(v.note) : ""}</option>`).join("")}</select>
      ${targets.some((e) => d.deployed[e.id]) ? `<div class="am-undeploy"><span class="faint">Van een omgeving halen:</span> ${targets.filter((e) => d.deployed[e.id]).map((e) => `<button type="button" class="btn sm sec" data-am-undeploy="${e.id}" data-ico-done>${ic("x", 12)}<span>${e.label}</span></button>`).join(" ")}</div>` : ""}
      <div class="hint" style="margin-top:8px">Een werkversie wordt bij de deploy gepubliceerd als nieuwe majorversie en is daarna onveranderlijk. Dit wordt een goedkeuringsverzoek (PROD: vier-ogen). Gekoppelde processen moeten ook op die omgeving staan, en er moet beleid zijn voor de omgeving.</div></div>
    <div class="cf"><button class="btn sec" data-close>Annuleren</button><button class="btn" id="amd-go" data-ico-done>${ic("rocket")}<span>Deploy aanvragen</span></button></div>`);
  document.querySelectorAll('input[name="amd-env"]').forEach((r) => r.addEventListener("change", () => { env = r.value; }));
  document.querySelectorAll("[data-am-undeploy]").forEach((b) => b.addEventListener("click", () => {
    const e = b.dataset.amUndeploy;
    confirmModal(`API van ${e.toUpperCase()} halen?`, `<b>${esc(d.title)}</b> is daarna niet meer bereikbaar op ${e.toUpperCase()}. De versies blijven bewaard; je kunt later opnieuw deployen.`, async () => { await api(`/api/v1/apim/apis/${encodeURIComponent(d.id)}/deploy/${e}`, { method: "DELETE" }); toast(`API van ${e.toUpperCase()} gehaald`); render(); }, "Van omgeving halen");
  }));
  document.getElementById("amd-go").addEventListener("click", async () => {
    try {
      const a = await api(`/api/v1/apim/apis/${encodeURIComponent(d.id)}/deploy`, { body: { env, version: document.getElementById("amd-v").value } });
      closeModal();
      toast(a.status === "executed" ? `Gedeployed naar ${env.toUpperCase()}` : `Deploy naar ${env.toUpperCase()} wacht op ${a.requiredApprovals} goedkeuring(en)`);
      if (a.warnings?.length) setTimeout(() => toast(`Let op: ${a.warnings.join("; ")}`, true), 600);
      render();
    } catch (err) { toast(err.message, true); }
  });
}

// Proberen: echte aanroep via de gateway (met beleid, throttling en monitoring).
function amTry(d, o) {
  const envs = ENVS.filter((e) => d.deployed[e.id]);
  const pathParams = o.params.filter((p) => p.in === "path"), queryParams = o.params.filter((p) => p.in === "query"), headerParams = o.params.filter((p) => p.in === "header");
  const withBody = !["GET", "HEAD", "DELETE"].includes(o.method);
  openModal(`<div class="ch"><h3>${ic("play")} Proberen · ${amMethod(o.method)} <span class="mono">${esc(d.basePath + o.path)}</span></h3><button class="x" data-close aria-label="Sluiten">×</button></div>
    <div class="cb" style="max-height:74vh;overflow:auto">
      <div class="row" style="gap:12px"><div><label class="xf-l" for="tr-env">Omgeving</label><select class="f" id="tr-env">${envs.map((e) => `<option value="${e.id}">${e.label} (${esc(d.deployed[e.id].version)})</option>`).join("")}</select></div>
        <div style="flex:1"><label class="xf-l" for="tr-auth">Authenticatie</label><select class="f" id="tr-auth"><option value="none">Geen (publiek)</option><option value="header" selected>API-sleutel in header</option><option value="query">API-sleutel in query</option><option value="bearer">Bearer-token (OAuth)</option></select></div></div>
      <div class="row" style="gap:12px"><div style="flex:1"><label class="xf-l" for="tr-kn">Naam header/parameter</label><input class="f mono" id="tr-kn" value="x-api-key"></div><div style="flex:2"><label class="xf-l" for="tr-kv">Sleutel of token</label><input class="f mono" id="tr-kv" autocomplete="off"></div></div>
      ${pathParams.map((p) => `<label class="xf-l" for="tp-${esc(p.name)}">{${esc(p.name)}} <span class="faint">pad</span></label><input class="f" id="tp-${esc(p.name)}" data-tp="${esc(p.name)}">`).join("")}
      ${queryParams.map((p) => `<label class="xf-l" for="tq-${esc(p.name)}">${esc(p.name)} <span class="faint">query</span></label><input class="f" id="tq-${esc(p.name)}" data-tq="${esc(p.name)}">`).join("")}
      ${headerParams.map((p) => `<label class="xf-l" for="th-${esc(p.name)}">${esc(p.name)} <span class="faint">header${p.required ? " · verplicht" : ""}</span></label><input class="f mono" id="th-${esc(p.name)}" data-th="${esc(p.name)}">`).join("")}
      ${withBody ? `<label class="xf-l" for="tr-body">Body (JSON)</label><textarea class="f mono" id="tr-body" rows="5">{}</textarea>` : ""}
      <div id="tr-out" style="margin-top:12px"></div>
    </div>
    <div class="cf"><span class="faint" style="margin-right:auto;align-self:center;font-size:.8rem">Gaat via het API-beleid en verschijnt in de monitoring.</span><button class="btn sec" data-close>Sluiten</button><button class="btn" id="tr-go" data-ico-done ${envs.length ? "" : "disabled"}>${ic("play")}<span>Versturen</span></button></div>`);
  document.getElementById("modal-box").classList.add("wide");
  document.getElementById("tr-go").addEventListener("click", async () => {
    let path = o.path;
    document.querySelectorAll("[data-tp]").forEach((x) => { path = path.replace(`{${x.dataset.tp}}`, encodeURIComponent(x.value || "x")); });
    const qs = new URLSearchParams();
    document.querySelectorAll("[data-tq]").forEach((x) => { if (x.value) qs.set(x.dataset.tq, x.value); });
    const mode = document.getElementById("tr-auth").value, kn = document.getElementById("tr-kn").value.trim(), kv = document.getElementById("tr-kv").value.trim();
    const headers = {};
    document.querySelectorAll("[data-th]").forEach((x) => { if (x.value) headers[x.dataset.th] = x.value; });
    if (mode === "header" && kv) headers[kn] = kv;
    if (mode === "query" && kv) qs.set(kn, kv);
    if (mode === "bearer" && kv) headers.authorization = `Bearer ${kv}`;
    let body;
    if (withBody) { body = document.getElementById("tr-body").value; headers["content-type"] = "application/json"; }
    const url = `${amPrefix()}/apis/${document.getElementById("tr-env").value}${d.basePath}${path}${qs.toString() ? "?" + qs : ""}`;
    const out = document.getElementById("tr-out");
    out.innerHTML = '<div class="faint">Bezig…</div>';
    const t0 = performance.now();
    try {
      const r = await fetch(url, { method: o.method, headers, body, credentials: "omit" });
      const text = await r.text();
      let pretty = text; try { pretty = JSON.stringify(JSON.parse(text), null, 2); } catch { /* tekst */ }
      const hs = [...r.headers.entries()].map(([k, v]) => `${k}: ${v}`).join("\n");
      out.innerHTML = `<div class="row" style="gap:8px">${amStatus(r.status)}<span class="mono faint">${Math.round(performance.now() - t0)} ms · ${esc(o.method)} ${esc(url)}</span></div>
        <details style="margin-top:6px"><summary class="faint">Response-headers</summary><pre class="code">${esc(hs)}</pre></details><pre class="code" style="margin-top:6px">${esc(pretty.slice(0, 20000))}</pre>`;
    } catch (err) { out.innerHTML = `<div class="xf-note err">${esc(err.message)}</div>`; }
  });
}

// ---------------------------------------------------------------- beleid
async function amPolicies(main) {
  const list = await api("/api/v1/apim/policies");
  const idLabel = (i) => i.type === "public" ? '<span class="chip warn">publiek</span>' : i.type === "apikey" ? `<span class="chip info">API-sleutel · ${i.keys.length}</span>` : `<span class="chip info">OAuth${i.rules && i.rules.length ? ` · ${i.rules.length} regel(s)` : ""}</span>`;
  main.innerHTML = amHeader("policies") + `
    <div class="card"><div class="ch"><h3>API-beleid (${list.length})</h3><button class="btn" id="ap-new" data-ico-done>${ic("plus")}<span>Nieuw beleid</span></button></div><div class="tw">
    ${list.length ? `<table><thead><tr><th>Beleid</th><th>Omgevingen</th><th>Endpoints</th><th>Identiteiten</th><th>Logging</th><th></th></tr></thead><tbody>
      ${list.map((p) => `<tr><td><b>${esc(p.name)}</b>${p.enabled ? "" : ' <span class="chip none">uit</span>'}<div class="faint" style="font-size:.78rem">${esc(p.description || "")}${(p.tags || []).map((t) => ` <span class="chip none">${esc(t)}</span>`).join("")}</div></td>
        <td>${p.envs.map((e) => `<span class="env ${e}">${e}</span>`).join(" ")}</td>
        <td style="font-size:.8rem">${p.endpoints.map((e) => `<div>${amMethod(e.method)} <span class="mono">${esc(e.path)}</span>${e.throttle ? ` <span class="faint">≤${e.throttle.limit}/${e.throttle.windowSec}s</span>` : ""}</div>`).join("")}</td>
        <td>${p.identities.map(idLabel).join(" ")}</td><td class="faint" style="font-size:.78rem">${p.logging.fields.length} veld(en)${p.cors ? " · CORS" : ""}${p.ipAllow && p.ipAllow.length ? " · IP-lijst" : ""}</td>
        <td><div class="row icons" style="justify-content:flex-end;flex-wrap:nowrap">${iconBtn("edit", "Bewerken", `data-ap-edit="${esc(p.id)}"`)}${iconBtn("trash", "Verwijderen", `data-ap-del="${esc(p.id)}"`, "sm no")}</div></td></tr>`).join("")}</tbody></table>`
      : `<div class="empty">Nog geen beleid. Zonder beleid zijn API-endpoints niet bereikbaar.</div>`}</div></div>`;
  document.getElementById("ap-new").addEventListener("click", () => amPolicyModal(null));
  main.querySelectorAll("[data-ap-edit]").forEach((b) => b.addEventListener("click", () => amPolicyModal(list.find((p) => p.id === b.dataset.apEdit))));
  main.querySelectorAll("[data-ap-del]").forEach((b) => b.addEventListener("click", () => confirmModal("Beleid verwijderen?", "De endpoints van dit beleid zijn daarna niet meer bereikbaar (tenzij een ander beleid ze dekt).", async () => { await api(`/api/v1/apim/policies/${b.dataset.apDel}`, { method: "DELETE" }); toast("Beleid verwijderd"); render(); }, "Verwijderen")));
}

async function amPolicyModal(p) {
  const [keys, issuers, endpoints] = await Promise.all([api("/api/v1/apim/keys"), api("/api/v1/apim/issuers"), api("/api/v1/apim/endpoints")]);
  const st = p ? JSON.parse(JSON.stringify(p)) : { name: "", description: "", tags: [], enabled: true, envs: ["dev"], endpoints: [{ method: "ALL", path: endpoints[0] ? endpoints[0].basePath || endpoints[0].path : "/" }], identities: [{ type: "apikey", name: "API-sleutel", keyName: "x-api-key", location: "header", keys: [] }], logging: { fields: ["identity"], bodyMaxKb: 1, ip: "client" }, cors: { origins: [], credentials: false }, ipAllow: [] };
  st.cors = st.cors || { origins: [], credentials: false };
  const FIELDS = [["identity", "Identiteit"], ["query", "Queryparameters"], ["requestHeaders", "Request-headers"], ["responseHeaders", "Response-headers"], ["errorBody", "Body bij fout"], ["requestBody", "Request-body"], ["responseBody", "Response-body"]];
  const thr = (t, a) => `<span class="am-thr"><input class="f" type="number" min="0" ${a}="limit" value="${t ? t.limit : ""}" placeholder="max" aria-label="Maximum aantal aanroepen"> / <input class="f" type="number" min="1" ${a}="window" value="${t ? t.windowSec : 60}" aria-label="Venster in seconden"> s</span>`;
  const draw = () => {
    openModal(`<div class="ch"><h3>${ic("settings")} ${p ? "Beleid bewerken" : "Nieuw API-beleid"}</h3><button class="x" data-close aria-label="Sluiten">×</button></div>
      <div class="cb am-pol" style="max-height:74vh;overflow:auto">
        <div class="row" style="gap:12px"><div style="flex:2"><label class="xf-l" for="pp-name">Naam</label><input class="f" id="pp-name" value="${esc(st.name)}"></div><div style="flex:1"><label class="xf-l" for="pp-tags">Tags</label><input class="f" id="pp-tags" value="${esc((st.tags || []).join(", "))}" placeholder="extern, partners"></div><label class="chk" style="align-self:flex-end;margin-bottom:8px"><input type="checkbox" id="pp-on" ${st.enabled ? "checked" : ""}> Actief</label></div>
        <label class="xf-l" for="pp-desc">Omschrijving</label><input class="f" id="pp-desc" value="${esc(st.description || "")}">
        <label class="xf-l">Omgevingen</label><div class="row">${ENVS.map((e) => `<label class="chk"><input type="checkbox" data-pp-env="${e.id}" ${st.envs.includes(e.id) ? "checked" : ""}> <span class="env ${e.id}">${e.label}</span></label>`).join("")}</div>
        <h4 class="am-h4">Endpoints <span class="faint">(pad = prefix, {var} = één segment)</span></h4>
        <datalist id="pp-paths">${endpoints.map((e) => `<option value="${esc(e.path)}">${esc(e.api)} · ${esc(e.method)}</option>`).join("")}</datalist>
        ${st.endpoints.map((e, i) => `<div class="am-row" data-ep="${i}"><select class="f" data-ep-m aria-label="Methode">${["ALL", "GET", "POST", "PUT", "PATCH", "DELETE"].map((m) => `<option ${m === e.method ? "selected" : ""}>${m}</option>`).join("")}</select><input class="f mono" data-ep-p list="pp-paths" value="${esc(e.path)}" placeholder="/orders/v1" aria-label="Pad"><span class="faint" style="font-size:.76rem">throttle</span>${thr(e.throttle, "data-ep-t")}${iconBtn("x", "Endpoint weghalen", `data-ep-del="${i}"`)}</div>`).join("")}
        <button type="button" class="lnk" id="pp-ep-add">${ic("plus", 14)} Endpoint</button>
        <h4 class="am-h4">Identiteiten <span class="faint">(volgorde: OAuth → API-sleutel → publiek)</span></h4>
        ${st.identities.map((it, i) => `<div class="am-id" data-id="${i}"><div class="row" style="justify-content:space-between"><b>${it.type === "apikey" ? "API-sleutel" : it.type === "oauth" ? "OAuth / JWT" : "Publieke toegang"}</b>${iconBtn("x", "Identiteit weghalen", `data-id-del="${i}"`)}</div>
          ${it.type === "apikey" ? `<div class="row" style="gap:10px"><input class="f" data-f="name" value="${esc(it.name)}" placeholder="Naam" aria-label="Naam"><input class="f mono" data-f="keyName" value="${esc(it.keyName)}" aria-label="Naam header/parameter"><select class="f" data-f="location" aria-label="Locatie"><option value="header" ${it.location === "header" ? "selected" : ""}>header</option><option value="query" ${it.location === "query" ? "selected" : ""}>query</option></select><span class="faint" style="font-size:.76rem">throttle per sleutel</span>${thr(it.throttle, "data-it")}</div>
            <div class="am-keys">${keys.length ? keys.map((k) => `<label class="chk"><input type="checkbox" data-key="${esc(k.id)}" ${it.keys.includes(k.id) ? "checked" : ""}> <span class="env ${k.env}">${k.env}</span> ${esc(k.name)} <span class="faint mono">…${esc(k.hint)}</span></label>`).join("") : '<span class="faint">Nog geen API-sleutels — maak ze aan op het tabblad API-sleutels.</span>'}</div>`
          : it.type === "oauth" ? `<div class="row" style="gap:10px"><input class="f" data-f="name" value="${esc(it.name)}" placeholder="Naam" aria-label="Naam"><input class="f mono" data-f="throttleClaim" value="${esc(it.throttleClaim || "")}" placeholder="claim voor throttle (bijv. sub, azp)" aria-label="Throttle per claim"><span class="faint" style="font-size:.76rem">throttle</span>${thr(it.throttle, "data-it")}</div>
            <div class="am-keys">${issuers.length ? issuers.map((x) => `<label class="chk"><input type="checkbox" data-iss="${esc(x.id)}" ${it.issuers.includes(x.id) ? "checked" : ""}> ${esc(x.name)} <span class="faint">${esc(x.issuer)}</span></label>`).join("") : '<span class="faint">Nog geen OAuth-uitgevers — voeg ze toe op het tabblad OAuth-uitgevers.</span>'}</div>
            <div class="faint" style="font-size:.78rem;margin-top:6px">Claim-regels (allemaal moeten kloppen)</div>
            ${(it.rules || []).map((r, j) => `<div class="am-row" data-rule="${j}"><input class="f mono" data-r="claim" value="${esc(r.claim)}" placeholder="claim, bijv. roles" aria-label="Claim"><select class="f" data-r="op" aria-label="Regel">${[["exists", "bestaat"], ["exact", "is precies"], ["regex", "regex"]].map(([v, l]) => `<option value="${v}" ${r.op === v ? "selected" : ""}>${l}</option>`).join("")}</select><input class="f mono" data-r="value" value="${esc(r.value || "")}" placeholder="waarde" aria-label="Waarde">${iconBtn("x", "Regel weghalen", `data-rule-del="${j}"`)}</div>`).join("")}
            <button type="button" class="lnk" data-rule-add>${ic("plus", 14)} Regel</button>`
          : `<div class="faint" style="font-size:.84rem">Iedereen mag deze endpoints aanroepen zonder sleutel of token. Throttling per endpoint blijft gelden.</div>`}</div>`).join("")}
        <div class="row"><button type="button" class="btn sm sec" data-id-add="apikey">${ic("plus", 14)} API-sleutel</button><button type="button" class="btn sm sec" data-id-add="oauth">${ic("plus", 14)} OAuth / JWT</button><button type="button" class="btn sm sec" data-id-add="public">${ic("plus", 14)} Publiek</button></div>
        <h4 class="am-h4">Logging <span class="faint">(wat in de API-monitoring komt)</span></h4>
        <div class="row">${FIELDS.map(([k, l]) => `<label class="chk"><input type="checkbox" data-log="${k}" ${st.logging.fields.includes(k) ? "checked" : ""}> ${l}</label>`).join("")}</div>
        <div class="row" style="gap:12px;margin-top:6px"><label class="chk">Max. body <select class="f" id="pp-kb" style="width:auto">${[1, 10, 100].map((n) => `<option ${st.logging.bodyMaxKb === n ? "selected" : ""}>${n}</option>`).join("")}</select> KB</label>
          <label class="chk">IP-adres <select class="f" id="pp-ip" style="width:auto">${[["client", "Client-IP"], ["xff-first", "X-Forwarded-For (eerste)"], ["xff-all", "X-Forwarded-For (alle)"], ["disable", "Niet loggen"]].map(([v, l]) => `<option value="${v}" ${st.logging.ip === v ? "selected" : ""}>${l}</option>`).join("")}</select></label></div>
        <h4 class="am-h4">CORS en IP-beperking</h4>
        <div class="row" style="gap:12px;align-items:flex-start"><div style="flex:1"><label class="xf-l" for="pp-cors">Toegestane origins <span class="faint">(één per regel, * = alles)</span></label><textarea class="f mono" id="pp-cors" rows="2" placeholder="https://shop.voorbeeld.nl">${esc((st.cors.origins || []).join("\n"))}</textarea><label class="chk"><input type="checkbox" id="pp-cred" ${st.cors.credentials ? "checked" : ""}> Credentials toestaan</label></div>
          <div style="flex:1"><label class="xf-l" for="pp-ips">Alleen deze IP-adressen <span class="faint">(IP of CIDR, één per regel; leeg = alle)</span></label><textarea class="f mono" id="pp-ips" rows="2" placeholder="203.0.113.0/24">${esc((st.ipAllow || []).join("\n"))}</textarea></div></div>
      </div>
      <div class="cf"><button class="btn sec" data-close>Annuleren</button><button class="btn" id="pp-save" data-ico-done>${ic("save")}<span>Opslaan</span></button></div>`);
    document.getElementById("modal-box").classList.add("wide");
    const box = document.getElementById("modal-box");
    box.querySelector("#pp-ep-add").addEventListener("click", () => { read(); st.endpoints.push({ method: "ALL", path: "" }); draw(); });
    box.querySelectorAll("[data-ep-del]").forEach((b) => b.addEventListener("click", () => { read(); st.endpoints.splice(Number(b.dataset.epDel), 1); draw(); }));
    box.querySelectorAll("[data-id-add]").forEach((b) => b.addEventListener("click", () => { read(); const t = b.dataset.idAdd; st.identities.push(t === "apikey" ? { type: "apikey", name: "API-sleutel", keyName: "x-api-key", location: "header", keys: [] } : t === "oauth" ? { type: "oauth", name: "OAuth", issuers: [], rules: [] } : { type: "public" }); draw(); }));
    box.querySelectorAll("[data-id-del]").forEach((b) => b.addEventListener("click", () => { read(); st.identities.splice(Number(b.dataset.idDel), 1); draw(); }));
    box.querySelectorAll("[data-rule-add]").forEach((b) => b.addEventListener("click", () => { read(); const i = Number(b.closest("[data-id]").dataset.id); st.identities[i].rules = [...(st.identities[i].rules || []), { claim: "", op: "exists" }]; draw(); }));
    box.querySelectorAll("[data-rule-del]").forEach((b) => b.addEventListener("click", () => { read(); const i = Number(b.closest("[data-id]").dataset.id); st.identities[i].rules.splice(Number(b.dataset.ruleDel), 1); draw(); }));
    box.querySelector("#pp-save").addEventListener("click", async () => {
      read();
      try {
        await api(p ? `/api/v1/apim/policies/${p.id}` : "/api/v1/apim/policies", { method: p ? "PUT" : "POST", body: st });
        closeModal(); toast("Beleid opgeslagen"); render();
      } catch (err) { toast(err.message, true); }
    });
  };
  const num = (el) => (el && el.value !== "" ? Number(el.value) : undefined);
  const read = () => {
    const box = document.getElementById("modal-box");
    st.name = box.querySelector("#pp-name").value;
    st.description = box.querySelector("#pp-desc").value;
    st.tags = box.querySelector("#pp-tags").value.split(",").map((x) => x.trim()).filter(Boolean);
    st.enabled = box.querySelector("#pp-on").checked;
    st.envs = [...box.querySelectorAll("[data-pp-env]")].filter((x) => x.checked).map((x) => x.dataset.ppEnv);
    st.endpoints = [...box.querySelectorAll("[data-ep]")].map((row) => { const l = num(row.querySelector('[data-ep-t="limit"]')); return { method: row.querySelector("[data-ep-m]").value, path: row.querySelector("[data-ep-p]").value, throttle: l ? { limit: l, windowSec: num(row.querySelector('[data-ep-t="window"]')) || 60 } : undefined }; });
    box.querySelectorAll("[data-id]").forEach((el) => {
      const it = st.identities[Number(el.dataset.id)];
      el.querySelectorAll("[data-f]").forEach((f) => { it[f.dataset.f] = f.value; });
      const l = num(el.querySelector('[data-it="limit"]'));
      if (it.type !== "public") it.throttle = l ? { limit: l, windowSec: num(el.querySelector('[data-it="window"]')) || 60 } : undefined;
      if (it.type === "apikey") it.keys = [...el.querySelectorAll("[data-key]")].filter((x) => x.checked).map((x) => x.dataset.key);
      if (it.type === "oauth") { it.issuers = [...el.querySelectorAll("[data-iss]")].filter((x) => x.checked).map((x) => x.dataset.iss); it.rules = [...el.querySelectorAll("[data-rule]")].map((r) => ({ claim: r.querySelector('[data-r="claim"]').value, op: r.querySelector('[data-r="op"]').value, value: r.querySelector('[data-r="value"]').value })); }
    });
    st.logging = { fields: [...box.querySelectorAll("[data-log]")].filter((x) => x.checked).map((x) => x.dataset.log), bodyMaxKb: Number(box.querySelector("#pp-kb").value), ip: box.querySelector("#pp-ip").value };
    st.cors = { ...(st.cors || {}), origins: box.querySelector("#pp-cors").value.split("\n").map((x) => x.trim()).filter(Boolean), credentials: box.querySelector("#pp-cred").checked };
    st.ipAllow = box.querySelector("#pp-ips").value.split("\n").map((x) => x.trim()).filter(Boolean);
  };
  draw();
}

// ---------------------------------------------------------------- API-sleutels
async function amKeys(main) {
  const list = await api("/api/v1/apim/keys");
  main.innerHTML = amHeader("keys") + `
    <div class="card"><div class="ch"><h3>API-sleutels voor afnemers (${list.length})</h3><button class="btn" id="ak-new" data-ico-done>${ic("plus")}<span>Sleutel maken</span></button></div><div class="tw">
    ${list.length ? `<table><thead><tr><th>Omgeving</th><th>Naam</th><th>Eindigt op</th><th>Aangemaakt</th><th>Laatst gebruikt</th><th>Status</th><th></th></tr></thead><tbody>
      ${list.map((k) => `<tr><td><span class="env ${k.env}">${k.env}</span></td><td><b>${esc(k.name)}</b><div class="faint" style="font-size:.76rem">${esc(k.description || "")}</div></td><td class="mono">…${esc(k.hint)}</td><td class="faint">${esc(fmtDateTime(k.createdAt))}<div style="font-size:.74rem">${esc(k.createdBy)}</div></td><td class="faint">${k.lastUsedAt ? esc(fmtDateTime(k.lastUsedAt)) : "nooit"}</td>
        <td>${k.enabled ? '<span class="chip ok">actief</span>' : '<span class="chip none">uit</span>'}</td>
        <td><div class="row icons" style="justify-content:flex-end;flex-wrap:nowrap">${iconBtn(k.enabled ? "pause" : "play", k.enabled ? "Uitzetten" : "Aanzetten", `data-ak-tog="${esc(k.id)}" data-on="${k.enabled ? 1 : 0}"`)}${iconBtn("trash", "Verwijderen", `data-ak-del="${esc(k.id)}"`, "sm no")}</div></td></tr>`).join("")}</tbody></table>`
      : `<div class="empty">Nog geen sleutels. Een sleutel geldt voor één omgeving; koppel hem in een API-beleid.</div>`}</div></div>
    <div class="hint" style="margin-top:10px">Dit zijn sleutels voor afnemers van je API's. Voor toegang tot het platform zelf (MCP, scripts) gebruik je de API-sleutels onder Gebruikers.</div>`;
  document.getElementById("ak-new").addEventListener("click", () => {
    openModal(`<div class="ch"><h3>${ic("plus")} API-sleutel maken</h3><button class="x" data-close aria-label="Sluiten">×</button></div>
      <div class="cb"><label class="xf-l" for="ak-name">Naam (afnemer)</label><input class="f" id="ak-name" placeholder="bijv. Webshop, Partner X">
        <label class="xf-l" for="ak-env">Omgeving</label><select class="f" id="ak-env">${ENVS.map((e) => `<option value="${e.id}" ${e.id === S.env ? "selected" : ""}>${e.name}</option>`).join("")}</select>
        <label class="xf-l" for="ak-desc">Omschrijving</label><input class="f" id="ak-desc"></div>
      <div class="cf"><button class="btn sec" data-close>Annuleren</button><button class="btn" id="ak-go">Maken</button></div>`);
    document.getElementById("ak-go").addEventListener("click", async () => {
      try {
        const r = await api("/api/v1/apim/keys", { body: { name: document.getElementById("ak-name").value, env: document.getElementById("ak-env").value, description: document.getElementById("ak-desc").value } });
        openModal(`<div class="ch"><h3>API-sleutel “${esc(r.info.name)}” (${esc(r.info.env.toUpperCase())})</h3><button class="x" data-close aria-label="Sluiten">×</button></div>
          <div class="cb"><div class="xf-note warn">Kopieer de sleutel nu en geef hem veilig aan de afnemer. Hij wordt maar één keer getoond.</div><div class="key-once">${esc(r.key)}</div><div class="hint">Vergeet niet de sleutel toe te voegen aan een API-beleid.</div></div>
          <div class="cf"><button class="btn sec" id="ak-copy" data-ico-done>${ic("copy")}<span>Kopiëren</span></button><button class="btn" data-close>Klaar</button></div>`);
        document.getElementById("ak-copy").addEventListener("click", async () => { try { await navigator.clipboard.writeText(r.key); toast("Gekopieerd"); } catch { toast("Kopiëren niet toegestaan", true); } });
        document.querySelectorAll("#modal-box [data-close]").forEach((b) => b.addEventListener("click", () => render()));
      } catch (err) { toast(err.message, true); }
    });
  });
  main.querySelectorAll("[data-ak-tog]").forEach((b) => b.addEventListener("click", async () => { try { await api(`/api/v1/apim/keys/${b.dataset.akTog}`, { method: "PUT", body: { enabled: b.dataset.on !== "1" } }); render(); } catch (err) { toast(err.message, true); } }));
  main.querySelectorAll("[data-ak-del]").forEach((b) => b.addEventListener("click", () => confirmModal("Sleutel verwijderen?", "Afnemers met deze sleutel hebben daarna geen toegang meer. De sleutel wordt ook uit het beleid gehaald.", async () => { await api(`/api/v1/apim/keys/${b.dataset.akDel}`, { method: "DELETE" }); toast("Sleutel verwijderd"); render(); }, "Verwijderen")));
}

// ---------------------------------------------------------------- OAuth-uitgevers
async function amIssuers(main) {
  const list = await api("/api/v1/apim/issuers");
  main.innerHTML = amHeader("issuers") + `
    <div class="card"><div class="ch"><h3>OAuth-uitgevers (${list.length})</h3><button class="btn" id="ai-new" data-ico-done>${ic("plus")}<span>Uitgever</span></button></div><div class="tw">
    ${list.length ? `<table><thead><tr><th>Naam</th><th>Issuer (iss)</th><th>Audience (aud)</th><th>Sleutels</th><th></th></tr></thead><tbody>
      ${list.map((x) => `<tr><td><b>${esc(x.name)}</b></td><td class="mono" style="font-size:.78rem">${esc(x.issuer)}</td><td class="mono" style="font-size:.78rem">${esc(x.audience || "—")}</td><td style="font-size:.78rem">${x.jwksUri ? `JWKS <span class="faint mono">${esc(x.jwksUri)}</span>` : ""}${x.hasSecret ? ' <span class="chip info">gedeeld geheim (HS)</span>' : ""}</td>
        <td><div class="row icons" style="justify-content:flex-end;flex-wrap:nowrap">${iconBtn("edit", "Bewerken", `data-ai-edit="${esc(x.id)}"`)}${iconBtn("trash", "Verwijderen", `data-ai-del="${esc(x.id)}"`, "sm no")}</div></td></tr>`).join("")}</tbody></table>`
      : `<div class="empty">Nog geen uitgevers. Voeg je identity provider toe (bijv. Microsoft Entra ID, Auth0, Keycloak, Okta) om bearer tokens (JWT) te accepteren.</div>`}</div></div>`;
  const modal = (x) => {
    openModal(`<div class="ch"><h3>${x ? "Uitgever bewerken" : "OAuth-uitgever toevoegen"}</h3><button class="x" data-close aria-label="Sluiten">×</button></div>
      <div class="cb"><label class="xf-l" for="ai-name">Naam</label><input class="f" id="ai-name" value="${esc(x ? x.name : "")}" placeholder="bijv. Entra ID productie">
        <label class="xf-l" for="ai-iss">Issuer (iss)</label><input class="f mono" id="ai-iss" value="${esc(x ? x.issuer : "")}" placeholder="https://login.microsoftonline.com/<tenant>/v2.0">
        <label class="xf-l" for="ai-aud">Audience (aud) <span class="faint">(aanbevolen)</span></label><input class="f mono" id="ai-aud" value="${esc(x ? x.audience || "" : "")}" placeholder="api://orders">
        <label class="xf-l" for="ai-jwks">JWKS-URI</label><input class="f mono" id="ai-jwks" value="${esc(x ? x.jwksUri || "" : "")}" placeholder="https://login.microsoftonline.com/<tenant>/discovery/v2.0/keys">
        <label class="xf-l" for="ai-sec">Gedeeld geheim voor HS256 <span class="faint">(alleen als de provider HS-tokens uitgeeft${x && x.hasSecret ? "; leeg = ongewijzigd" : ""})</span></label><input class="f mono" id="ai-sec" type="password" autocomplete="new-password">
        <div class="hint">Tokens worden gecontroleerd op handtekening, uitgever, audience en geldigheid (exp/nbf). Claim-regels stel je in het beleid in.</div></div>
      <div class="cf"><button class="btn sec" data-close>Annuleren</button><button class="btn" id="ai-go">Opslaan</button></div>`);
    document.getElementById("ai-go").addEventListener("click", async () => {
      const body = { name: document.getElementById("ai-name").value, issuer: document.getElementById("ai-iss").value, audience: document.getElementById("ai-aud").value || undefined, jwksUri: document.getElementById("ai-jwks").value || undefined, hsSecret: document.getElementById("ai-sec").value || undefined };
      try { await api(x ? `/api/v1/apim/issuers/${x.id}` : "/api/v1/apim/issuers", { method: x ? "PUT" : "POST", body }); closeModal(); toast("Uitgever opgeslagen"); render(); } catch (err) { toast(err.message, true); }
    });
  };
  document.getElementById("ai-new").addEventListener("click", () => modal(null));
  main.querySelectorAll("[data-ai-edit]").forEach((b) => b.addEventListener("click", () => modal(list.find((x) => x.id === b.dataset.aiEdit))));
  main.querySelectorAll("[data-ai-del]").forEach((b) => b.addEventListener("click", () => confirmModal("Uitgever verwijderen?", "Tokens van deze uitgever worden daarna niet meer geaccepteerd.", async () => { await api(`/api/v1/apim/issuers/${b.dataset.aiDel}`, { method: "DELETE" }); toast("Uitgever verwijderd"); render(); }, "Verwijderen")));
}

// ---------------------------------------------------------------- monitoring
async function amMonitoring(main) {
  const f = AM.mon;
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v !== "" && v != null).map(([k, v]) => [k, k === "from" || k === "to" ? new Date(v).toISOString() : v]));
  const [r, apis] = await Promise.all([api(`/api/v1/apim/logs?limit=300&${qs}`), api("/api/v1/apim/apis")]);
  const st = r.stats, maxH = Math.max(1, ...st.perHour.map((h) => h.ok + h.err));
  main.innerHTML = amHeader("monitoring") + `
    <div class="card"><div class="cb am-filters">
      <select class="f" data-mf="env" aria-label="Omgeving"><option value="">Alle omgevingen</option>${ENVS.map((e) => `<option value="${e.id}" ${f.env === e.id ? "selected" : ""}>${e.label}</option>`).join("")}</select>
      <select class="f" data-mf="apiId" aria-label="API"><option value="">Alle API's</option>${apis.map((a) => `<option value="${esc(a.id)}" ${f.apiId === a.id ? "selected" : ""}>${esc(a.title)}</option>`).join("")}<option value="_none" ${f.apiId === "_none" ? "selected" : ""}>Geen API (ongevraagd)</option></select>
      <select class="f" data-mf="method" aria-label="Methode"><option value="">Alle methodes</option>${["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"].map((m) => `<option ${f.method === m ? "selected" : ""}>${m}</option>`).join("")}</select>
      <select class="f" data-mf="status" aria-label="Statuscode"><option value="">Alle codes</option>${["2xx", "3xx", "4xx", "5xx", "401", "403", "404", "429", "500", "502"].map((c) => `<option ${f.status === c ? "selected" : ""}>${c}</option>`).join("")}</select>
      <input class="f" data-mf="minMs" type="number" min="0" placeholder="duur ≥ ms" value="${esc(f.minMs)}" aria-label="Minimale duur">
      <input class="f" data-mf="from" type="datetime-local" value="${esc(f.from)}" aria-label="Vanaf"><input class="f" data-mf="to" type="datetime-local" value="${esc(f.to)}" aria-label="Tot">
      <button type="button" class="lnk" id="am-more">${AM.more ? "Minder filters" : "Meer filters"}</button>${iconBtn("refresh", "Vernieuwen", 'id="am-refresh"', "sec")}
      ${AM.more ? `<div class="am-filters" style="flex-basis:100%"><input class="f" data-mf="path" placeholder="pad bevat…" value="${esc(f.path)}"><input class="f" data-mf="query" placeholder="querystring bevat…" value="${esc(f.query)}"><input class="f" data-mf="ip" placeholder="IP-adres" value="${esc(f.ip)}"><input class="f" data-mf="identity" placeholder="identiteit" value="${esc(f.identity)}"></div>` : ""}
    </div></div>
    <div class="kpis-4" style="margin-top:14px">
      <div class="kpi"><div class="l">Aanroepen</div><div class="v">${st.total}</div></div>
      <div class="kpi ${st.errors ? "bad" : ""}"><div class="l">Fouten (4xx/5xx)</div><div class="v">${st.errors}</div><div class="s">${st.errorRate}%</div></div>
      <div class="kpi"><div class="l">Gem. duur</div><div class="v">${st.avgMs}<span style="font-size:.9rem;font-weight:500"> ms</span></div></div>
      <div class="kpi"><div class="l">Per uur</div><div class="am-bars">${st.perHour.map((h) => `<span title="${esc(h.hour.replace("T", " "))}:00 — ${h.ok} ok, ${h.err} fout"><i class="ok" style="height:${(h.ok / maxH) * 100}%"></i><i class="err" style="height:${(h.err / maxH) * 100}%"></i></span>`).join("") || '<span class="faint">—</span>'}</div></div>
    </div>
    <div class="card" style="margin-top:14px"><div class="ch"><h3>Aanroepen</h3><span class="faint" style="font-size:.8rem">${r.items.length} van ${r.total}</span></div><div class="tw">
      ${r.items.length ? `<table><thead><tr><th>Tijd</th><th>Code</th><th>Methode</th><th>Pad</th><th>API / operatie</th><th>Identiteit</th><th>Duur</th><th>Doel</th></tr></thead><tbody>
        ${r.items.map((l) => `<tr class="click" data-log="${esc(l.id)}"><td class="faint" style="white-space:nowrap">${esc(fmtDateTime(l.at))}</td><td>${amStatus(l.status)}</td><td>${amMethod(l.method)}</td><td class="mono" style="font-size:.78rem"><span class="env ${l.env}">${l.env}</span> ${esc(l.path)}</td><td style="font-size:.8rem">${esc(l.api || "—")}<div class="faint">${esc(l.operation || l.outcome)}</div></td><td style="font-size:.8rem">${esc(l.identity || "")}</td><td class="mono">${l.durationMs} ms</td><td class="mono" style="font-size:.74rem">${esc(l.target || "")}</td></tr>`).join("")}</tbody></table>`
      : '<div class="empty">Geen aanroepen gevonden.</div>'}</div></div>`;
  main.querySelectorAll("[data-mf]").forEach((el) => el.addEventListener("change", () => { f[el.dataset.mf] = el.value; render(); }));
  document.getElementById("am-more").addEventListener("click", () => { AM.more = !AM.more; render(); });
  document.getElementById("am-refresh").addEventListener("click", () => render());
  main.querySelectorAll("[data-log]").forEach((tr) => tr.addEventListener("click", async () => {
    const l = await api(`/api/v1/apim/logs/${tr.dataset.log}`);
    const row = (k, v) => (v === undefined || v === null || v === "" ? "" : `<tr><td class="faint" style="white-space:nowrap">${k}</td><td class="mono" style="word-break:break-all">${v}</td></tr>`);
    const pre = (t, v) => (v ? `<h4 class="am-h4">${t}</h4><pre class="code">${esc(typeof v === "string" ? v : Object.entries(v).map(([a, b]) => `${a}: ${b}`).join("\n"))}</pre>` : "");
    openModal(`<div class="ch"><h3>${amMethod(l.method)} <span class="mono">${esc(l.path)}</span> ${amStatus(l.status)}</h3><button class="x" data-close aria-label="Sluiten">×</button></div>
      <div class="cb" style="max-height:72vh;overflow:auto"><table class="am-kv"><tbody>
        ${row("Tijd", esc(fmtDateTime(l.at)))}${row("Omgeving", `<span class="env ${l.env}">${l.env}</span>`)}${row("API", esc(l.api || ""))}${row("Operatie", esc(l.operation || ""))}${row("Uitkomst", esc(l.outcome))}${row("Beleid", esc(l.policy || ""))}${row("Identiteit", esc(l.identity || ""))}
        ${row("Duur", `${l.durationMs} ms`)}${row("Doel", esc(l.target || ""))}${row("Run", l.runId ? `<a href="#instance/${esc(l.runId)}">${esc(l.runId)}</a>` : "")}${row("Procesversie", l.processVersion ? "v" + l.processVersion : "")}${row("IP-adres", esc(l.ip || ""))}${row("Origin", esc(l.origin || ""))}${row("Querystring", esc(l.query || ""))}${row("Fout", esc(l.error || ""))}
      </tbody></table>${pre("Request-headers", l.reqHeaders)}${pre("Request-body", l.reqBody)}${pre("Response-headers", l.resHeaders)}${pre("Response-body", l.resBody)}</div>
      <div class="cf"><button class="btn" data-close>Sluiten</button></div>`);
    document.getElementById("modal-box").classList.add("wide");
  }));
}
