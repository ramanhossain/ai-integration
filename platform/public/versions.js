// VERSIES per proces (vanaf de processenpagina): een eerdere versie terugzetten op een
// omgeving en twee versies met elkaar vergelijken.
// - Terugzetten op DEV maakt een kopie als nieuwste versie (historie blijft bewaard).
// - Terugzetten op TEST/ACC/PROD is een deploy van de oudere versie (via goedkeuring).
/* global api, esc, openModal, closeModal, ENVS, S, ic, toast, fmtDateTime, who, render, deployTo, askConfirm, PC */

const vmLabel = (x) => `v${x.version}${x.createdAt ? " · " + fmtDateTime(x.createdAt) : ""}${x.createdBy ? " · " + x.createdBy : ""}${x.note ? " · “" + x.note + "”" : ""}${x.activeOn && x.activeOn.length ? " · actief op " + x.activeOn.map((e) => e.toUpperCase()).join(", ") : ""}`;
const vmOptions = (versions, sel) => versions.map((x) => `<option value="${x.version}" ${x.version === sel ? "selected" : ""}>${esc(vmLabel(x))}</option>`).join("");

async function versionsModal(name, tab = "restore", pick = {}) {
  const info = await api(`/api/v1/integrations/${encodeURIComponent(name)}/versions`);
  const versions = info.versions; // nieuwste eerst
  const defs = new Map();
  const getDef = async (v) => {
    if (!defs.has(v)) defs.set(v, await api(`/api/v1/integrations/${encodeURIComponent(name)}/versions/${v}`));
    return defs.get(v);
  };
  // Standaard: de versie vóór die op de gekozen omgeving draait.
  const prevOf = (env) => {
    const cur = info.envs[env];
    const older = versions.filter((x) => cur == null || x.version < cur);
    return (older[0] || versions[versions.length - 1] || {}).version;
  };
  let env = S.env;
  let restoreV = pick.restore ?? prevOf(env);
  let cmpA = pick.a ?? (versions[1] ? versions[1].version : versions[0].version);
  let cmpB = pick.b ?? versions[0].version;

  openModal(`<div class="ch"><h3>${ic("history")} Versies · ${esc(name)}</h3><button class="x" data-close aria-label="Sluiten">×</button></div>
    <div class="cb vm-cb">
      <div class="vm-envs">${ENVS.map((e) => `<span class="vm-env"><span class="env ${e.id}">${e.label}</span> <b class="ver">${info.envs[e.id] != null ? "v" + info.envs[e.id] : "—"}</b></span>`).join("")}</div>
      <div class="seg ndv-seg vm-tabs" role="tablist">
        <button type="button" data-vm-tab="restore" role="tab">${ic("restore", 14)} Terugzetten</button>
        <button type="button" data-vm-tab="compare" role="tab">${ic("list", 14)} Vergelijken</button>
        <button type="button" data-vm-tab="list" role="tab">${ic("history", 14)} Alle versies (${versions.length})</button>
      </div>
      <div id="vm-body"></div>
    </div>
    <div class="cf" id="vm-foot"></div>`);
  const box = document.getElementById("modal-box");
  box.classList.add("wide");
  const body = document.getElementById("vm-body"), foot = document.getElementById("vm-foot");

  const drawRestore = () => {
    const cur = info.envs[env];
    const target = versions.find((x) => x.version === restoreV);
    const same = cur === restoreV;
    body.innerHTML = `
      <label class="xf-l">Omgeving</label>
      <div class="dp-envs" role="radiogroup" aria-label="Omgeving">${ENVS.map((e) => `<label class="dp-env"><input type="radio" name="vm-env" value="${e.id}" ${e.id === env ? "checked" : ""}><span class="env ${e.id}">${e.label}</span><span class="faint">nu ${info.envs[e.id] != null ? "v" + info.envs[e.id] : "—"}</span></label>`).join("")}</div>
      <label class="xf-l" for="vm-ver">Terugzetten naar versie</label>
      <select class="f" id="vm-ver">${vmOptions(versions, restoreV)}</select>
      ${target && target.note ? `<div class="vm-note">${ic("chat", 14)} ${esc(target.note)}</div>` : ""}
      <div id="vm-info">${same ? `<div class="xf-note">v${restoreV} staat al op ${env.toUpperCase()}.</div>`
        : env === "dev" ? `<div class="xf-note ok">De inhoud van <b>v${restoreV}</b> wordt de nieuwste versie op DEV (als kopie; de historie blijft bewaard). TEST, ACC en PROD veranderen niet.</div>`
        : `<div class="xf-note ${cur != null && restoreV < cur ? "warn" : "ok"}">${env.toUpperCase()} gaat van ${cur != null ? "v" + cur : "—"} naar <b>v${restoreV}</b>. Dit wordt een goedkeuringsverzoek${env === "prod" ? " (PROD: vier-ogen)" : ""}.</div>`}</div>
      <div class="row" style="margin-top:8px"><button type="button" class="lnk" data-vm-cmp="${restoreV}">${ic("list", 14)} Vergelijk v${restoreV} met ${cur != null ? "v" + cur + " (nu op " + env.toUpperCase() + ")" : "de nieuwste versie"}</button></div>`;
    foot.innerHTML = `<button class="btn sec" data-close>Sluiten</button><button class="btn" id="vm-go" data-ico-done ${same ? "disabled" : ""}>${ic("restore")}<span>v${restoreV} terugzetten op ${env.toUpperCase()}</span></button>`;
    body.querySelectorAll('input[name="vm-env"]').forEach((r) => r.addEventListener("change", () => { env = r.value; restoreV = prevOf(env); drawRestore(); }));
    body.querySelector("#vm-ver").addEventListener("change", (e) => { restoreV = Number(e.target.value); drawRestore(); });
    body.querySelector("[data-vm-cmp]").addEventListener("click", () => { cmpA = restoreV; cmpB = cur != null ? cur : versions[0].version; show("compare"); });
    foot.querySelector("#vm-go").addEventListener("click", async () => {
      if (env === "dev") {
        try {
          const r = await api(`/api/v1/integrations/${encodeURIComponent(name)}/versions/${restoreV}/restore`, { body: { owner: who() } });
          closeModal();
          toast(`v${restoreV} teruggezet op DEV als v${r.version}`);
          render();
        } catch (err) { toast(err.message, true); }
      } else {
        closeModal();
        try { await deployTo(name, env, restoreV); } catch (err) { if (err.message !== "Deploy geannuleerd") toast(err.message, true); }
      }
    });
  };

  // Vergelijken in BPMN: oud en nieuw naast elkaar, gekleurd per stap (nieuw, verwijderd,
  // gewijzigd). Klik op een stap om te zien wat er is aangepast.
  let canvases = [];
  const destroyCanvases = () => { for (const c of canvases) c.destroy(); canvases = []; };
  const drawCompare = async () => {
    destroyCanvases();
    body.innerHTML = `<div class="vm-cmp-sel">
        <div><label class="xf-l" for="vm-a">Oud</label><select class="f" id="vm-a">${vmOptions(versions, cmpA)}</select></div>
        <button type="button" class="btn sm sec icon" id="vm-swap" title="Omwisselen" aria-label="Omwisselen" data-ico-done>⇄</button>
        <div><label class="xf-l" for="vm-b">Nieuw</label><select class="f" id="vm-b">${vmOptions(versions, cmpB)}</select></div>
      </div><div id="vm-diff"><div class="faint">Vergelijken…</div></div>`;
    foot.innerHTML = `<button class="btn sec" data-close>Sluiten</button>`;
    body.querySelector("#vm-a").addEventListener("change", (e) => { cmpA = Number(e.target.value); drawCompare(); });
    body.querySelector("#vm-b").addEventListener("change", (e) => { cmpB = Number(e.target.value); drawCompare(); });
    body.querySelector("#vm-swap").addEventListener("click", () => { [cmpA, cmpB] = [cmpB, cmpA]; drawCompare(); });
    const host = document.getElementById("vm-diff");
    if (cmpA === cmpB) { host.innerHTML = `<div class="xf-note">Kies twee verschillende versies.</div>`; return; }
    let a, b;
    try { [a, b] = await Promise.all([getDef(cmpA), getDef(cmpB)]); } catch (err) { host.innerHTML = `<div class="xf-note err">${esc(err.message)}</div>`; return; }
    const va = versions.find((x) => x.version === cmpA), vb = versions.find((x) => x.version === cmpB);
    const d = vmCompare(a, b);
    host.innerHTML = `${vmHeadHtml(va, vb, d)}
      <div class="vm-legend"><span class="lg add">nieuw</span><span class="lg del">verwijderd</span><span class="lg chg">gewijzigd</span><span class="faint">Klik op een stap om te zien wat er is aangepast.</span></div>
      <div class="vm-bpmn">
        <div class="vm-pane"><div class="vm-pane-h">v${cmpA} <span class="faint">oud</span></div><div class="vm-canvas" id="vm-cv-a"></div></div>
        <div class="vm-pane"><div class="vm-pane-h">v${cmpB} <span class="faint">nieuw</span></div><div class="vm-canvas" id="vm-cv-b"></div></div>
      </div>
      <div class="vm-detail" id="vm-detail" aria-live="polite"></div>
      ${d.raw ? `<div class="vm-sec"><button type="button" class="lnk" data-vm-raw>${ic("list", 14)} JSON-verschillen tonen/verbergen</button><div id="vm-raw" class="vm-raw hide">${d.raw}</div></div>` : ""}`;
    host.querySelector("[data-vm-raw]")?.addEventListener("click", () => document.getElementById("vm-raw").classList.toggle("hide"));
    const detail = document.getElementById("vm-detail");
    const showDetail = (id) => {
      detail.innerHTML = id ? vmStepDetail(id, d) : vmOverview(d);
      detail.querySelectorAll("[data-vm-step]").forEach((x) => x.addEventListener("click", () => select(x.dataset.vmStep)));
    };
    const select = (id) => { for (const c of canvases) c.select(id); showDetail(id); };
    const mk = (el, def, side) => {
      const c = PC.mount(el, {
        def: JSON.parse(JSON.stringify(def)),
        readonly: true,
        nodeClass: (id) => { const st = d.status.get(id); return st === "add" && side === "b" ? "vm-add" : st === "del" && side === "a" ? "vm-del" : st === "chg" ? "vm-chg" : ""; },
        onSelect: (id) => { for (const o of canvases) if (o !== c) o.select(id); showDetail(id); }
      });
      canvases.push(c);
      // Pas passend maken als het venster zijn definitieve maat heeft.
      requestAnimationFrame(() => requestAnimationFrame(() => c.fit()));
      setTimeout(() => c.fit(), 250);
    };
    mk(document.getElementById("vm-cv-a"), a, "a");
    mk(document.getElementById("vm-cv-b"), b, "b");
    showDetail(null);
  };
  const drawList = () => {
    body.innerHTML = `<div class="tw"><table><thead><tr><th>Versie</th><th>Datum</th><th>Door</th><th>Notitie</th><th>Actief op</th><th></th></tr></thead><tbody>
      ${versions.map((x, i) => `<tr><td class="ver"><b>v${x.version}</b></td><td class="faint" style="white-space:nowrap">${x.createdAt ? esc(fmtDateTime(x.createdAt)) : "—"}</td><td>${esc(x.createdBy || "")}</td>
        <td>${x.note ? esc(x.note) : x.restoredFrom ? `<span class="faint">teruggezet van v${x.restoredFrom}</span>` : '<span class="faint">—</span>'}</td>
        <td>${x.activeOn.map((e) => `<span class="env ${e}">${e}</span>`).join(" ")}</td>
        <td><div class="row icons" style="justify-content:flex-end;flex-wrap:nowrap">${versions[i + 1] ? `<button class="btn sm sec icon" data-vm-pair="${versions[i + 1].version}:${x.version}" title="Vergelijk met v${versions[i + 1].version}" aria-label="Vergelijk met v${versions[i + 1].version}" data-ico-done>${ic("list", 14)}</button>` : ""}<button class="btn sm sec icon" data-vm-restore="${x.version}" title="Deze versie terugzetten" aria-label="v${x.version} terugzetten" data-ico-done>${ic("restore", 14)}</button></div></td></tr>`).join("")}
    </tbody></table></div>`;
    foot.innerHTML = `<button class="btn sec" data-close>Sluiten</button>`;
    body.querySelectorAll("[data-vm-pair]").forEach((b) => b.addEventListener("click", () => { [cmpA, cmpB] = b.dataset.vmPair.split(":").map(Number); show("compare"); }));
    body.querySelectorAll("[data-vm-restore]").forEach((b) => b.addEventListener("click", () => { restoreV = Number(b.dataset.vmRestore); show("restore"); }));
  };

  const show = (t) => {
    tab = t;
    destroyCanvases();
    box.querySelectorAll("[data-vm-tab]").forEach((b) => { b.classList.toggle("on", b.dataset.vmTab === t); b.setAttribute("aria-selected", String(b.dataset.vmTab === t)); });
    if (t === "restore") drawRestore();
    else if (t === "compare") drawCompare();
    else drawList();
  };
  box.querySelectorAll("[data-vm-tab]").forEach((b) => b.addEventListener("click", () => show(b.dataset.vmTab)));
  box.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", destroyCanvases));
  show(tab);
}
window.versionsModal = versionsModal;

// ---------- vergelijken ----------
// Platte lijst pad → waarde (voor configuratie en eigenschappen).
function vmFlatten(o, pre = "", out = {}) {
  if (o && typeof o === "object" && !Array.isArray(o)) {
    const keys = Object.keys(o);
    if (!keys.length && pre) out[pre] = "{}";
    for (const k of keys) vmFlatten(o[k], pre ? `${pre}.${k}` : k, out);
  } else if (Array.isArray(o) && o.some((x) => x && typeof x === "object")) {
    if (!o.length && pre) out[pre] = "[]";
    o.forEach((x, i) => vmFlatten(x, `${pre}[${i}]`, out));
  } else if (pre) out[pre] = JSON.stringify(o);
  return out;
}
function vmPropDiff(a, b) {
  const fa = vmFlatten(a || {}), fb = vmFlatten(b || {});
  const keys = [...new Set([...Object.keys(fa), ...Object.keys(fb)])].sort();
  return keys.filter((k) => fa[k] !== fb[k]).map((k) => ({ key: k, from: fa[k], to: fb[k] }));
}
const vmShort = (v) => (v === undefined ? "—" : v.length > 120 ? v.slice(0, 117) + "…" : v);
const vmPropRows = (rows) => `<table class="vm-props"><tbody>${rows.map((r) => `<tr><td class="mono">${esc(r.key)}</td><td class="vm-old mono">${esc(vmShort(r.from))}</td><td class="vm-arrow">→</td><td class="vm-new mono">${esc(vmShort(r.to))}</td></tr>`).join("")}</tbody></table>`;

// Regel-diff (LCS) op de JSON van beide versies.
function vmLineDiff(aText, bText) {
  const a = aText.split("\n"), b = bText.split("\n");
  const n = a.length, m = b.length;
  if (n * m > 4_000_000) return null;
  const L = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push([" ", a[i]]); i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) out.push(["-", a[i++]]);
    else out.push(["+", b[j++]]);
  }
  while (i < n) out.push(["-", a[i++]]);
  while (j < m) out.push(["+", b[j++]]);
  return out;
}

// Verschillen per stap (op id), trigger (startevent) en procesinstellingen.
function vmCompare(a, b) {
  const strip = (x) => { const c = JSON.parse(JSON.stringify(x)); delete c.version; delete c.owner; return c; };
  const A = strip(a), B = strip(b);
  const na = PC.normalize(JSON.parse(JSON.stringify(A))), nb = PC.normalize(JSON.parse(JSON.stringify(B)));
  const edges = (def, id) => (def.connections || []).filter((c) => c.from === id).map((c) => `${c.port && c.port !== "out" ? c.port + " → " : ""}${c.to}`).sort().join(", ");
  const clean = (st) => { const c = JSON.parse(JSON.stringify(st || {})); delete c.position; delete c.next; return c; };
  const stepsA = new Map((A.steps || []).map((x) => [x.id, x])), stepsB = new Map((B.steps || []).map((x) => [x.id, x]));
  const status = new Map(), rows = new Map(), names = new Map(), types = new Map();
  for (const id of new Set([...stepsA.keys(), ...stepsB.keys()])) {
    const sa = stepsA.get(id), sb = stepsB.get(id);
    names.set(id, (sb || sa).name || id);
    types.set(id, (sb || sa).type);
    const r = vmPropDiff(sa ? clean(sa) : {}, sb ? clean(sb) : {});
    const ea = sa ? edges(na, id) : "", eb = sb ? edges(nb, id) : "";
    if (ea !== eb) r.push({ key: "verbindingen", from: ea ? JSON.stringify(ea) : undefined, to: eb ? JSON.stringify(eb) : undefined });
    rows.set(id, r);
    status.set(id, !sa ? "add" : !sb ? "del" : r.length ? "chg" : "same");
  }
  // Startevent = trigger.
  const trig = vmPropDiff({ trigger: A.trigger || {} }, { trigger: B.trigger || {} });
  const eStart = edges(na, "start") !== edges(nb, "start") ? [{ key: "verbindingen", from: JSON.stringify(edges(na, "start")), to: JSON.stringify(edges(nb, "start")) }] : [];
  rows.set("start", [...trig, ...eStart]);
  names.set("start", "Startevent (trigger)");
  types.set("start", B.trigger?.type || "trigger");
  status.set("start", trig.length || eStart.length ? "chg" : "same");
  const restA = { ...A }, restB = { ...B };
  delete restA.steps; delete restB.steps; delete restA.trigger; delete restB.trigger; delete restA.connections; delete restB.connections; delete restA.layout; delete restB.layout;
  const general = vmPropDiff(restA, restB);
  // Regel-diff voor wie het technisch wil zien.
  let raw = "";
  const ld = vmLineDiff(JSON.stringify(A, null, 2), JSON.stringify(B, null, 2));
  if (ld && ld.some(([t]) => t !== " ")) {
    const keep = new Set();
    ld.forEach(([t], i) => { if (t !== " ") for (let k = i - 2; k <= i + 2; k++) keep.add(k); });
    let last = -1;
    const lines = [];
    ld.forEach(([t, l], i) => { if (!keep.has(i)) return; if (last >= 0 && i > last + 1) lines.push(`<div class="dl gap">⋯</div>`); lines.push(`<div class="dl ${t === "+" ? "add" : t === "-" ? "del" : ""}"><span>${t}</span>${esc(l)}</div>`); last = i; });
    raw = lines.join("");
  }
  return { status, rows, names, types, general, raw, stepsA, stepsB };
}
const VM_ST = { add: ["ok", "nieuw"], del: ["err", "verwijderd"], chg: ["warn", "gewijzigd"], same: ["none", "ongewijzigd"] };
function vmHeadHtml(va, vb, d) {
  const count = (k) => [...d.status.values()].filter((x) => x === k).length;
  const n = { add: count("add"), del: count("del"), chg: count("chg") };
  const none = !n.add && !n.del && !n.chg && !d.general.length;
  return `<div class="vm-sum"><span><b>v${va.version}</b> <span class="faint">${esc(va.createdAt ? fmtDateTime(va.createdAt) : "")}${va.createdBy ? " · " + esc(va.createdBy) : ""}${va.note ? " · “" + esc(va.note) + "”" : ""}</span></span><span class="vm-arrow">→</span><span><b>v${vb.version}</b> <span class="faint">${esc(vb.createdAt ? fmtDateTime(vb.createdAt) : "")}${vb.createdBy ? " · " + esc(vb.createdBy) : ""}${vb.note ? " · “" + esc(vb.note) + "”" : ""}</span></span></div>
    <div class="vm-chips">${n.add ? `<span class="chip ok">+${n.add} nieuw</span>` : ""}${n.del ? `<span class="chip err">−${n.del} verwijderd</span>` : ""}${n.chg ? `<span class="chip warn">${n.chg} gewijzigd</span>` : ""}${d.general.length ? `<span class="chip info">${d.general.length} procesinstelling${d.general.length === 1 ? "" : "en"}</span>` : ""}${none ? '<span class="chip none">geen verschillen</span>' : ""}</div>`;
}
// Standaard (niets geselecteerd): lijst van gewijzigde stappen + procesinstellingen.
function vmOverview(d) {
  const changed = [...d.status.entries()].filter(([, st]) => st !== "same");
  return `<div class="vm-sec"><h4>Wijzigingen</h4>${changed.length ? `<ul class="vm-steps">${changed.map(([id, st]) => `<li class="${st}"><button type="button" class="vm-step-btn" data-vm-step="${esc(id)}"><span class="chip ${VM_ST[st][0]}">${VM_ST[st][1]}</span> <b>${esc(d.names.get(id))}</b> <span class="faint">${esc(d.types.get(id) || "")}${st === "chg" ? ` · ${d.rows.get(id).length} veld${d.rows.get(id).length === 1 ? "" : "en"}` : ""}</span></button></li>`).join("")}</ul>` : '<div class="faint">Geen stappen gewijzigd.</div>'}</div>
    ${d.general.length ? `<div class="vm-sec"><h4>Procesinstellingen</h4>${vmPropRows(d.general)}</div>` : ""}`;
}
function vmStepDetail(id, d) {
  const st = d.status.get(id);
  if (!st) return vmOverview(d);
  const rows = d.rows.get(id) || [];
  return `<div class="vm-sec"><h4><span>${esc(d.names.get(id))}</span> <span class="chip ${VM_ST[st][0]}">${VM_ST[st][1]}</span> <span class="faint" style="text-transform:none;letter-spacing:0">${esc(d.types.get(id) || "")} · ${esc(id)}</span>
      <button type="button" class="lnk" data-vm-step="" style="margin-left:auto">Alle wijzigingen</button></h4>
    ${st === "same" ? '<div class="faint">Deze stap is niet aangepast.</div>' : rows.length ? `<table class="vm-props"><thead><tr><th>Veld</th><th>Oud</th><th></th><th>Nieuw</th></tr></thead><tbody>${rows.map((r) => `<tr><td class="mono">${esc(r.key)}</td><td class="vm-old mono">${esc(vmShort(r.from))}</td><td class="vm-arrow">→</td><td class="vm-new mono">${esc(vmShort(r.to))}</td></tr>`).join("")}</tbody></table>` : ""}</div>`;
}

// Versiekeuzelijst in de processenlijst: klik op het versienummer.
let vmMenu = null;
function closeVersionMenu() { if (vmMenu) { vmMenu.remove(); vmMenu = null; } }
async function versionMenu(anchor, name) {
  closeVersionMenu();
  const m = document.createElement("div");
  m.className = "vm-menu";
  m.setAttribute("role", "menu");
  m.innerHTML = '<div class="faint" style="padding:10px 12px">Versies laden…</div>';
  document.body.appendChild(m);
  vmMenu = m;
  const place = () => {
    const r = anchor.getBoundingClientRect();
    m.style.top = `${Math.min(r.bottom + 4, window.innerHeight - m.offsetHeight - 8)}px`;
    m.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - m.offsetWidth - 8))}px`;
  };
  place();
  let info;
  try { info = await api(`/api/v1/integrations/${encodeURIComponent(name)}/versions`); } catch (err) { m.innerHTML = `<div class="xf-note err">${esc(err.message)}</div>`; return; }
  if (vmMenu !== m) return;
  const cur = info.envs.dev ?? info.latestVersion;
  m.innerHTML = `<div class="vm-menu-h"><b>${esc(name)}</b><span class="faint">${info.versions.length} versie${info.versions.length === 1 ? "" : "s"}</span></div>
    <div class="vm-menu-list">${info.versions.map((x) => `<div class="vm-mi" role="menuitem">
      <button type="button" class="vm-mi-main" data-vmm="${x.version === cur ? "list" : "cmp"}" data-v="${x.version}" title="${x.version === cur ? "Alle versies" : `Vergelijk v${x.version} met v${cur}`}">
        <b class="ver">v${x.version}</b><span class="vm-mi-t"><span>${esc(x.createdAt ? fmtDateTime(x.createdAt) : "")}${x.createdBy ? " · " + esc(x.createdBy) : ""}</span>${x.note ? `<span class="vm-mi-n">${esc(x.note)}</span>` : x.restoredFrom ? `<span class="vm-mi-n faint">teruggezet van v${x.restoredFrom}</span>` : ""}</span>
        <span class="vm-mi-e">${x.activeOn.map((e) => `<span class="env ${e}">${e}</span>`).join("")}</span></button>
      ${x.version !== cur ? `<button type="button" class="btn sm sec icon" data-vmm="cmp" data-v="${x.version}" title="Vergelijk met v${cur}" aria-label="Vergelijk v${x.version} met v${cur}" data-ico-done>${ic("list", 14)}</button><button type="button" class="btn sm sec icon" data-vmm="restore" data-v="${x.version}" title="v${x.version} terugzetten" aria-label="v${x.version} terugzetten" data-ico-done>${ic("restore", 14)}</button>` : '<span class="chip info" style="margin:0 6px">huidig</span>'}
    </div>`).join("")}</div>`;
  place();
  m.addEventListener("click", (e) => {
    const b = e.target.closest("[data-vmm]");
    if (!b) return;
    const v = Number(b.dataset.v);
    closeVersionMenu();
    const act = b.dataset.vmm;
    if (act === "cmp") versionsModal(name, "compare", { a: v, b: cur });
    else if (act === "restore") versionsModal(name, "restore", { restore: v });
    else versionsModal(name, "list");
  });
}
document.addEventListener("pointerdown", (e) => { if (vmMenu && !vmMenu.contains(e.target) && !e.target.closest("[data-act='version-menu']")) closeVersionMenu(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeVersionMenu(); });
window.addEventListener("hashchange", closeVersionMenu);

// Knop op de processenpagina.
document.addEventListener("click", (e) => {
  const m = e.target.closest("[data-act='version-menu']");
  if (m) { e.preventDefault(); if (vmMenu) closeVersionMenu(); else versionMenu(m, m.dataset.name); return; }
  const b = e.target.closest("[data-act='versions']");
  if (!b) return;
  e.preventDefault();
  versionsModal(b.dataset.name).catch((err) => toast(err.message, true));
});
