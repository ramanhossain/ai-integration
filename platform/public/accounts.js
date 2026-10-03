// ACCOUNTBEHEER
// - Mijn account: naam, wachtwoord wijzigen, rechten.
// - Gebruikers (beheerder van de organisatie): accounts uitnodigen, rol en toegang per
//   omgeving (geen / lezen / bewerken), wachtwoordmail, uitschakelen; API-sleutels.
// - Platformbeheer (hoofdaccount): alle organisaties en accounts met aantal processen,
//   laatst ingelogd en laatst actief; wachtwoordmail sturen; aanmelden open/dicht; outbox.
/* global VIEWS, api, esc, toast, openModal, closeModal, ic, iconBtn, fmtDateTime, render, ENVS, confirmModal */

const ACC_LABEL = { none: "geen", view: "lezen", edit: "bewerken" };
function accAgo(iso) {
  if (!iso) return '<span class="faint">nooit</span>';
  const s = (Date.now() - Date.parse(iso)) / 1000;
  const t = s < 60 ? "zojuist" : s < 3600 ? `${Math.floor(s / 60)} min geleden` : s < 86400 ? `${Math.floor(s / 3600)} uur geleden` : s < 86400 * 30 ? `${Math.floor(s / 86400)} dag${Math.floor(s / 86400) === 1 ? "" : "en"} geleden` : fmtDateTime(iso);
  return `<span title="${esc(fmtDateTime(iso))}">${t}</span>`;
}
const statusOf = (u) => (u.disabled ? '<span class="st-dot off"></span>uitgeschakeld' : !u.hasPassword ? '<span class="st-dot inv"></span>uitgenodigd' : '<span class="st-dot on"></span>actief');
const accessChips = (u) => u.role === "beheerder" ? '<span class="chip info">alles</span>' : ENVS.map((e) => { const a = (u.envAccess || {})[e.id] || "none"; return `<span class="env ${e.id}" style="${a === "none" ? "opacity:.3;text-decoration:line-through" : ""}" title="${e.label}: ${ACC_LABEL[a]}">${e.label}${a === "view" ? " 👁" : ""}</span>`; }).join(" ");
const mailNote = (m) => m && m.smtp ? (m.delivered ? "Mail verstuurd." : "Mail kon niet worden verstuurd.") : "Geen mailserver ingesteld: de mail staat in de outbox (Platformbeheer).";

// ---------------------------------------------------------------- mijn account
VIEWS.account = async (main) => {
  const me = await api("/api/v1/auth/me");
  if (!me.user || me.authEnabled === false) { main.innerHTML = `<div class="head"><div><h1>Mijn account</h1><p>Accounts staan uit op deze server (AIP_AUTH=off).</p></div></div>`; return; }
  const u = me.user;
  main.innerHTML = `<div class="head"><div><h1>Mijn account</h1><p>${esc(me.org?.name || "")} · ${u.role === "beheerder" ? "beheerder" : "gebruiker"}${u.superAdmin ? " · hoofdaccount" : ""}</p></div></div>
    <div class="card" style="max-width:720px"><div class="ch"><h3>Gegevens</h3></div><div class="cb">
      <label class="xf-l" for="ac-name">Naam</label><div class="row" style="flex-wrap:nowrap"><input class="f" id="ac-name" value="${esc(u.name)}"><button class="btn sec" id="ac-name-save" data-ico-done>${ic("save")}<span>Opslaan</span></button></div>
      <label class="xf-l">E-mailadres</label><div>${esc(u.email)}</div>
      <label class="xf-l">Toegang per omgeving</label><div>${accessChips(u)}</div>
      <label class="xf-l">Laatst ingelogd</label><div>${accAgo(u.lastLoginAt)} <span class="faint">· ${u.loginCount || 0}× ingelogd · account sinds ${esc(fmtDateTime(u.createdAt))}</span></div>
    </div></div>
    <div class="card" style="max-width:720px;margin-top:14px"><div class="ch"><h3>Wachtwoord wijzigen</h3></div><form class="cb" id="ac-pw">
      <label class="xf-l" for="ac-cur">Huidig wachtwoord</label><input class="f" type="password" id="ac-cur" autocomplete="current-password" required>
      <label class="xf-l" for="ac-new">Nieuw wachtwoord</label><input class="f" type="password" id="ac-new" autocomplete="new-password" required>
      <label class="xf-l" for="ac-new2">Herhaal nieuw wachtwoord</label><input class="f" type="password" id="ac-new2" autocomplete="new-password" required>
      <div class="hint">Minstens 10 tekens, met letters en cijfers. Andere sessies worden uitgelogd.</div>
      <div class="row" style="margin-top:10px"><button class="btn" type="submit" data-ico-done>${ic("save")}<span>Wachtwoord wijzigen</span></button></div></form></div>`;
  document.getElementById("ac-name-save").addEventListener("click", async () => {
    try { await api("/api/v1/auth/me", { method: "PUT", body: { name: document.getElementById("ac-name").value } }); toast("Naam opgeslagen"); setTimeout(() => location.reload(), 600); } catch (err) { toast(err.message, true); }
  });
  document.getElementById("ac-pw").addEventListener("submit", async (e) => {
    e.preventDefault();
    const n = document.getElementById("ac-new").value;
    if (n !== document.getElementById("ac-new2").value) return toast("De nieuwe wachtwoorden zijn niet gelijk", true);
    try { await api("/api/v1/auth/password", { body: { current: document.getElementById("ac-cur").value, password: n } }); toast("Wachtwoord gewijzigd"); e.target.reset(); } catch (err) { toast(err.message, true); }
  });
};

// ---------------------------------------------------------------- gebruikers (beheerder)
function accessSelects(u, attrs = "") {
  return `<div class="acc-grid">${ENVS.map((e) => { const a = (u.envAccess || {})[e.id] || "none"; return `<label class="acc-cell a-${u.role === "beheerder" ? "edit" : a}"><span class="env ${e.id}">${e.label}</span><select class="acc-sel2" data-acc-env="${e.id}" ${attrs} ${u.role === "beheerder" ? "disabled title=\"Beheerders hebben overal toegang\"" : ""} aria-label="Toegang ${e.label}">
    ${["none", "view", "edit"].map((x) => `<option value="${x}" ${(u.role === "beheerder" ? "edit" : a) === x ? "selected" : ""}>${ACC_LABEL[x]}</option>`).join("")}</select></label>`; }).join("")}</div>`;
}
VIEWS.users = async (main) => {
  const d = await api("/api/v1/org");
  const meId = window.AIP_ME?.user?.id;
  main.innerHTML = `<div class="head"><div><h1>Gebruikers</h1><p>Accounts van <b>${esc(d.org?.name || "")}</b>. Elk account kan per omgeving geen, lees- of bewerkrechten krijgen; beheerders mogen alles en beheren accounts en instellingen.</p></div>
      <div class="row"><button class="btn" id="us-add" data-ico-done>${ic("plus")}<span>Account toevoegen</span></button></div></div>
    <div class="kpis-4"><div class="kpi"><div class="l">Accounts</div><div class="v">${d.users.length}</div></div><div class="kpi"><div class="l">Processen</div><div class="v">${d.processes}</div></div><div class="kpi"><div class="l">API-sleutels</div><div class="v">${d.apiKeys.length}</div></div></div>
    <div class="card"><div class="ch"><h3>Accounts</h3><div class="row"><label class="xf-l" for="org-name" style="margin:0">Organisatie</label><input class="f" id="org-name" value="${esc(d.org?.name || "")}" style="width:220px">${iconBtn("save", "Naam organisatie opslaan", 'id="org-save"')}</div></div><div class="tw"><table><thead><tr><th>Naam</th><th>Rol</th><th>Toegang per omgeving</th><th>Processen</th><th>Laatst ingelogd</th><th>Status</th><th></th></tr></thead><tbody>
      ${d.users.map((u) => `<tr data-uid="${esc(u.id)}"><td><b>${esc(u.name)}</b>${u.id === meId ? ' <span class="chip info">jij</span>' : ""}${u.superAdmin ? ' <span class="chip warn">hoofdaccount</span>' : ""}<div class="faint" style="font-size:.78rem">${esc(u.email)}</div></td>
        <td><select class="f acc-sel" data-role-sel aria-label="Rol" style="min-width:110px" ${u.id === meId ? "disabled" : ""}><option value="gebruiker" ${u.role === "gebruiker" ? "selected" : ""}>gebruiker</option><option value="beheerder" ${u.role === "beheerder" ? "selected" : ""}>beheerder</option></select></td>
        <td>${accessSelects(u)}</td><td class="mono">${u.processes}</td><td>${accAgo(u.lastLoginAt)}</td><td style="white-space:nowrap">${statusOf(u)}</td>
        <td><div class="row icons" style="justify-content:flex-end;flex-wrap:nowrap">${iconBtn("send", u.hasPassword ? "Mail sturen om wachtwoord opnieuw in te stellen" : "Uitnodiging opnieuw sturen", 'data-us="reset"')}${u.id !== meId ? iconBtn(u.disabled ? "play" : "power", u.disabled ? "Weer inschakelen" : "Uitschakelen (kan niet meer inloggen)", `data-us="${u.disabled ? "enable" : "disable"}"`) + iconBtn("trash", "Account verwijderen", 'data-us="delete"', "sm no") : ""}</div></td></tr>`).join("")}
    </tbody></table></div></div>
    <div class="card" style="margin-top:14px"><div class="ch"><h3>API-sleutels</h3><button class="btn sm sec" id="key-add" data-ico-done>${ic("plus", 14)}<span>Sleutel maken</span></button></div><div class="cb">
      <p class="muted" style="margin-top:0;font-size:.86rem">Voor MCP-clients, scripts en CI: <code>Authorization: Bearer &lt;sleutel&gt;</code>. Voor MCP via stdio zet je de sleutel in <code>AIP_API_KEY</code>. Een sleutel heeft de rechten van een beheerder binnen deze organisatie.</p>
      ${d.apiKeys.length ? `<table><thead><tr><th>Naam</th><th>Eindigt op</th><th>Gemaakt</th><th>Laatst gebruikt</th><th></th></tr></thead><tbody>${d.apiKeys.map((k) => `<tr><td><b>${esc(k.name)}</b><div class="faint" style="font-size:.76rem">door ${esc(k.createdBy)}</div></td><td class="mono">…${esc(k.hint)}</td><td>${esc(fmtDateTime(k.createdAt))}</td><td>${accAgo(k.lastUsedAt)}</td><td>${iconBtn("trash", "Sleutel intrekken", `data-key-del="${esc(k.id)}"`, "sm no")}</td></tr>`).join("")}</tbody></table>` : '<div class="empty">Nog geen API-sleutels.</div>'}
    </div></div>`;

  const upd = async (id, body, msg) => { try { await api(`/api/v1/org/users/${id}`, { method: "PUT", body }); toast(msg); render(); } catch (err) { toast(err.message, true); render(); } };
  main.querySelectorAll("tr[data-uid]").forEach((tr) => {
    const id = tr.dataset.uid;
    tr.querySelector("[data-role-sel]").addEventListener("change", (e) => upd(id, { role: e.target.value }, "Rol gewijzigd"));
    tr.querySelectorAll("[data-acc-env]").forEach((sel) => sel.addEventListener("change", () => {
      const envAccess = {};
      tr.querySelectorAll("[data-acc-env]").forEach((x) => (envAccess[x.dataset.accEnv] = x.value));
      upd(id, { envAccess }, "Toegang gewijzigd");
    }));
    tr.querySelectorAll("[data-us]").forEach((b) => b.addEventListener("click", async () => {
      const act = b.dataset.us, name = tr.querySelector("b").textContent;
      if (act === "reset") { try { const r = await api(`/api/v1/org/users/${id}/reset`, { body: {} }); toast(mailNote(r.mail)); } catch (err) { toast(err.message, true); } }
      if (act === "disable") confirmModal("Account uitschakelen?", `<b>${esc(name)}</b> kan daarna niet meer inloggen; open sessies worden beëindigd.`, () => upd(id, { disabled: true }, "Account uitgeschakeld"), "Uitschakelen");
      if (act === "enable") upd(id, { disabled: false }, "Account ingeschakeld");
      if (act === "delete") confirmModal("Account verwijderen?", `<b>${esc(name)}</b> wordt definitief verwijderd. Processen en historie blijven bewaard.`, async () => { await api(`/api/v1/org/users/${id}`, { method: "DELETE" }); toast("Account verwijderd"); render(); }, "Verwijderen");
    }));
  });
  document.getElementById("org-save").addEventListener("click", async () => { try { await api("/api/v1/org", { method: "PUT", body: { name: document.getElementById("org-name").value } }); toast("Naam opgeslagen"); setTimeout(() => location.reload(), 500); } catch (err) { toast(err.message, true); } });
  document.getElementById("us-add").addEventListener("click", () => addUserModal());
  document.getElementById("key-add").addEventListener("click", () => {
    openModal(`<div class="ch"><h3>${ic("plus")} API-sleutel maken</h3><button class="x" data-close aria-label="Sluiten">×</button></div>
      <form class="cb" id="key-form"><label class="xf-l" for="key-name">Naam</label><input class="f" id="key-name" placeholder="bijv. Claude Desktop, CI-pijplijn" required></form>
      <div class="cf"><button class="btn sec" data-close>Annuleren</button><button class="btn" id="key-go">Maken</button></div>`);
    const go = async () => {
      try {
        const r = await api("/api/v1/org/api-keys", { body: { name: document.getElementById("key-name").value } });
        openModal(`<div class="ch"><h3>API-sleutel “${esc(r.info.name)}”</h3><button class="x" data-close aria-label="Sluiten">×</button></div>
          <div class="cb"><div class="xf-note warn">Kopieer de sleutel nu. Hij wordt maar één keer getoond.</div><div class="key-once" id="key-val">${esc(r.key)}</div></div>
          <div class="cf"><button class="btn sec" id="key-copy" data-ico-done>${ic("copy")}<span>Kopiëren</span></button><button class="btn" data-close>Klaar</button></div>`);
        document.getElementById("key-copy").addEventListener("click", async () => { try { await navigator.clipboard.writeText(r.key); toast("Gekopieerd"); } catch { toast("Kopiëren niet toegestaan", true); } });
        document.querySelectorAll("#modal-box [data-close]").forEach((b) => b.addEventListener("click", () => render()));
      } catch (err) { toast(err.message, true); }
    };
    document.getElementById("key-go").addEventListener("click", go);
    document.getElementById("key-form").addEventListener("submit", (e) => { e.preventDefault(); go(); });
  });
  main.querySelectorAll("[data-key-del]").forEach((b) => b.addEventListener("click", () => confirmModal("Sleutel intrekken?", "Clients die deze sleutel gebruiken hebben daarna geen toegang meer.", async () => { await api(`/api/v1/org/api-keys/${b.dataset.keyDel}`, { method: "DELETE" }); toast("Sleutel ingetrokken"); render(); }, "Intrekken")));
};

function addUserModal() {
  const draft = { id: "new", role: "gebruiker", envAccess: { dev: "edit", test: "view", acc: "view", prod: "view" } };
  openModal(`<div class="ch"><h3>${ic("plus")} Account toevoegen</h3><button class="x" data-close aria-label="Sluiten">×</button></div>
    <form class="cb" id="nu-form">
      <label class="xf-l" for="nu-name">Naam</label><input class="f" id="nu-name" required>
      <label class="xf-l" for="nu-email">E-mailadres</label><input class="f" id="nu-email" type="email" required>
      <label class="xf-l" for="nu-role">Rol</label><select class="f" id="nu-role"><option value="gebruiker">Gebruiker — toegang per omgeving</option><option value="beheerder">Beheerder — alles, ook accounts en instellingen</option></select>
      <label class="xf-l">Toegang per omgeving</label><div id="nu-acc">${accessSelects(draft)}</div>
      <div class="hint">Er kunnen meerdere accounts per omgeving zijn. Het account krijgt een mail met een link om een wachtwoord te kiezen (72 uur geldig).</div>
    </form>
    <div class="cf"><button class="btn sec" data-close>Annuleren</button><button class="btn" id="nu-go" data-ico-done>${ic("send")}<span>Uitnodigen</span></button></div>`);
  document.getElementById("nu-role").addEventListener("change", (e) => { draft.role = e.target.value; document.getElementById("nu-acc").innerHTML = accessSelects(draft); });
  const go = async () => {
    const envAccess = {};
    document.querySelectorAll("#nu-acc [data-acc-env]").forEach((x) => (envAccess[x.dataset.accEnv] = x.value));
    try {
      const r = await api("/api/v1/org/users", { body: { name: document.getElementById("nu-name").value, email: document.getElementById("nu-email").value, role: document.getElementById("nu-role").value, envAccess } });
      closeModal();
      toast(`${r.user.name} uitgenodigd. ${mailNote(r.mail)}`);
      render();
    } catch (err) { toast(err.message, true); }
  };
  document.getElementById("nu-go").addEventListener("click", go);
  document.getElementById("nu-form").addEventListener("submit", (e) => { e.preventDefault(); go(); });
}

// ---------------------------------------------------------------- platformbeheer (hoofdaccount)
const PF = { q: "", org: "" };
VIEWS.platform = async (main) => {
  const [d, mail] = await Promise.all([api("/api/v1/admin/overview"), api("/api/v1/admin/mail").catch(() => ({ items: [] }))]);
  const meId = window.AIP_ME?.user?.id;
  const q = PF.q.toLowerCase();
  const users = d.users.filter((u) => (!PF.org || u.orgId === PF.org) && (!q || `${u.name} ${u.email} ${u.orgName}`.toLowerCase().includes(q)));
  const totalProc = d.orgs.reduce((n, o) => n + o.processes, 0);
  const activeWeek = d.users.filter((u) => u.lastSeenAt && Date.now() - Date.parse(u.lastSeenAt) < 7 * 86400000).length;
  main.innerHTML = `<div class="head"><div><h1>Platformbeheer</h1><p>Alle organisaties en accounts van het platform. Alleen zichtbaar voor het hoofdaccount.</p></div>
      <div class="row"><button class="btn" id="pf-org-add" data-ico-done>${ic("plus")}<span>Organisatie</span></button></div></div>
    <div class="kpis-4">
      <div class="kpi"><div class="l">Organisaties</div><div class="v">${d.orgs.length}</div></div>
      <div class="kpi"><div class="l">Accounts</div><div class="v">${d.users.length}</div></div>
      <div class="kpi"><div class="l">Actief (7 dagen)</div><div class="v">${activeWeek}</div></div>
      <div class="kpi"><div class="l">Processen</div><div class="v">${totalProc}</div></div>
    </div>
    <div class="card"><div class="cb" style="display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap">
      <div><b>Zelf aanmelden</b><div class="muted" style="font-size:.84rem">Open: iedereen kan een organisatie aanmaken (iPaaS). Dicht: alleen via een uitnodiging.</div></div>
      <label class="switch"><input type="checkbox" id="pf-signup" ${d.settings.signupOpen ? "checked" : ""} aria-label="Zelf aanmelden"><span></span></label>
      <div style="flex-basis:100%;font-size:.84rem">${d.smtp ? '<span class="chip ok">mailserver ingesteld</span>' : '<span class="chip warn">geen mailserver</span> <span class="muted">Zet <code>AIP_SMTP_URL</code> en <code>AIP_MAIL_FROM</code> om mail echt te versturen; tot dan staan mails (met link) in de outbox hieronder.</span>'}</div>
    </div></div>
    <div class="card" style="margin-top:14px"><div class="ch"><h3>Organisaties</h3></div><div class="tw"><table><thead><tr><th>Organisatie</th><th>Accounts</th><th>Processen</th><th>Uitvoeringen</th><th>Laatst actief</th><th>Aangemaakt</th><th>Status</th><th></th></tr></thead><tbody>
      ${d.orgs.map((o) => `<tr><td><b>${esc(o.name)}</b><div class="faint mono" style="font-size:.74rem">${esc(o.id)}</div></td><td class="mono"><button class="lnk" data-pf-filter="${esc(o.id)}">${o.users}</button></td><td class="mono">${o.processes}</td><td class="mono">${o.runs}</td><td>${accAgo(o.lastActive)}</td><td>${esc(fmtDateTime(o.createdAt))}</td>
        <td>${o.disabled ? '<span class="st-dot off"></span>uitgeschakeld' : '<span class="st-dot on"></span>actief'}</td>
        <td>${o.id !== "default" ? iconBtn(o.disabled ? "play" : "power", o.disabled ? "Organisatie inschakelen" : "Organisatie uitschakelen (niemand kan inloggen, webhooks stoppen)", `data-pf-org="${esc(o.id)}" data-dis="${o.disabled ? "0" : "1"}"`) : ""}</td></tr>`).join("")}
    </tbody></table></div></div>
    <div class="card" style="margin-top:14px"><div class="ch"><h3>Accounts</h3><div class="row" style="flex-wrap:nowrap"><select class="f acc-sel" id="pf-org" aria-label="Organisatie" style="width:auto"><option value="">Alle organisaties</option>${d.orgs.map((o) => `<option value="${esc(o.id)}" ${PF.org === o.id ? "selected" : ""}>${esc(o.name)}</option>`).join("")}</select><input class="f" id="pf-q" type="search" placeholder="Zoek naam of e-mail" value="${esc(PF.q)}" style="width:200px"></div></div><div class="tw"><table><thead><tr><th>Account</th><th>Organisatie</th><th>Rol</th><th>Toegang</th><th>Processen</th><th>Laatst ingelogd</th><th>Laatst actief</th><th>Status</th><th></th></tr></thead><tbody>
      ${users.map((u) => `<tr data-pfu="${esc(u.id)}"><td><b>${esc(u.name)}</b>${u.superAdmin ? ' <span class="chip warn">hoofdaccount</span>' : ""}${u.id === meId ? ' <span class="chip info">jij</span>' : ""}<div class="faint" style="font-size:.78rem">${esc(u.email)}</div></td><td>${esc(u.orgName || u.orgId)}</td><td>${u.role}</td><td style="white-space:nowrap">${accessChips(u)}</td><td class="mono">${u.processes}</td><td>${accAgo(u.lastLoginAt)}<div class="faint" style="font-size:.72rem">${u.loginCount || 0}× ingelogd</div></td><td>${accAgo(u.lastSeenAt)}</td><td style="white-space:nowrap">${statusOf(u)}</td>
        <td><div class="row icons" style="justify-content:flex-end;flex-wrap:nowrap">${iconBtn("send", u.hasPassword ? "Wachtwoord-vergeten-mail sturen" : "Uitnodiging opnieuw sturen", 'data-pfa="reset"')}${u.id !== meId ? iconBtn(u.disabled ? "play" : "power", u.disabled ? "Inschakelen" : "Uitschakelen", `data-pfa="${u.disabled ? "enable" : "disable"}"`) + iconBtn("settings", u.superAdmin ? "Geen hoofdaccount meer" : "Hoofdaccount maken", `data-pfa="${u.superAdmin ? "unsuper" : "super"}"`) + iconBtn("trash", "Account verwijderen", 'data-pfa="delete"', "sm no") : ""}</div></td></tr>`).join("") || '<tr><td colspan="9" class="empty">Geen accounts gevonden.</td></tr>'}
    </tbody></table></div></div>
    <div class="card" style="margin-top:14px"><div class="ch"><h3>Verstuurde systeemmails</h3><span class="faint" style="font-size:.8rem">${mail.smtp ? "via mailserver" : "outbox (geen mailserver)"}</span></div><div class="tw">${(mail.items || []).length ? `<table><thead><tr><th>Aan</th><th>Onderwerp</th><th>Tijd</th><th>Status</th><th></th></tr></thead><tbody>${mail.items.slice(0, 30).map((m) => `<tr><td>${esc(m.to)}</td><td>${esc(m.subject)}</td><td>${accAgo(m.at)}</td><td>${m.delivered ? '<span class="chip ok">verstuurd</span>' : m.error ? `<span class="chip err" title="${esc(m.error)}">mislukt</span>` : '<span class="chip none">outbox</span>'}</td><td>${m.text ? iconBtn("eye", "Mail bekijken", `data-mail="${esc(m.id)}"`) : ""}</td></tr>`).join("")}</tbody></table>` : '<div class="empty">Nog geen mails.</div>'}</div></div>`;

  const q2 = document.getElementById("pf-q");
  let t;
  q2.addEventListener("input", () => { clearTimeout(t); t = setTimeout(() => { PF.q = q2.value; render().then(() => { const e = document.getElementById("pf-q"); if (e) { e.focus(); e.setSelectionRange(e.value.length, e.value.length); } }); }, 250); });
  document.getElementById("pf-org").addEventListener("change", (e) => { PF.org = e.target.value; render(); });
  main.querySelectorAll("[data-pf-filter]").forEach((b) => b.addEventListener("click", () => { PF.org = b.dataset.pfFilter; render(); }));
  document.getElementById("pf-signup").addEventListener("change", async (e) => { try { await api("/api/v1/admin/settings", { method: "PUT", body: { signupOpen: e.target.checked } }); toast(e.target.checked ? "Aanmelden staat open" : "Aanmelden is gesloten"); } catch (err) { toast(err.message, true); render(); } });
  main.querySelectorAll("[data-pf-org]").forEach((b) => b.addEventListener("click", () => {
    const dis = b.dataset.dis === "1";
    const go = async () => { await api(`/api/v1/admin/orgs/${b.dataset.pfOrg}`, { method: "PUT", body: { disabled: dis } }); toast(dis ? "Organisatie uitgeschakeld" : "Organisatie ingeschakeld"); render(); };
    if (dis) confirmModal("Organisatie uitschakelen?", "Niemand van deze organisatie kan nog inloggen en hun webhooks en API-endpoints reageren niet meer. Gegevens blijven bewaard.", go, "Uitschakelen"); else go().catch((err) => toast(err.message, true));
  }));
  const updU = async (id, body, msg) => { try { await api(`/api/v1/admin/users/${id}`, { method: "PUT", body }); toast(msg); render(); } catch (err) { toast(err.message, true); } };
  main.querySelectorAll("tr[data-pfu]").forEach((tr) => tr.querySelectorAll("[data-pfa]").forEach((b) => b.addEventListener("click", async () => {
    const id = tr.dataset.pfu, act = b.dataset.pfa, name = tr.querySelector("b").textContent;
    if (act === "reset") { try { const r = await api(`/api/v1/admin/users/${id}/reset`, { body: {} }); toast(mailNote(r.mail)); render(); } catch (err) { toast(err.message, true); } }
    if (act === "disable") confirmModal("Account uitschakelen?", `<b>${esc(name)}</b> kan daarna niet meer inloggen.`, () => updU(id, { disabled: true }, "Account uitgeschakeld"), "Uitschakelen");
    if (act === "enable") updU(id, { disabled: false }, "Account ingeschakeld");
    if (act === "super") confirmModal("Hoofdaccount maken?", `<b>${esc(name)}</b> kan dan alle organisaties en accounts zien en beheren.`, () => updU(id, { superAdmin: true }, "Is nu hoofdaccount"), "Hoofdaccount maken");
    if (act === "unsuper") updU(id, { superAdmin: false }, "Geen hoofdaccount meer");
    if (act === "delete") confirmModal("Account verwijderen?", `<b>${esc(name)}</b> wordt definitief verwijderd.`, async () => { await api(`/api/v1/admin/users/${id}`, { method: "DELETE" }); toast("Account verwijderd"); render(); }, "Verwijderen");
  })));
  main.querySelectorAll("[data-mail]").forEach((b) => b.addEventListener("click", () => {
    const m = mail.items.find((x) => x.id === b.dataset.mail);
    openModal(`<div class="ch"><h3>${esc(m.subject)}</h3><button class="x" data-close aria-label="Sluiten">×</button></div>
      <div class="cb"><div class="faint" style="font-size:.82rem;margin-bottom:8px">Aan ${esc(m.to)} · ${esc(fmtDateTime(m.at))}</div><pre class="code" style="white-space:pre-wrap">${esc(m.text)}</pre></div>
      <div class="cf"><button class="btn" data-close>Sluiten</button></div>`);
  }));
  document.getElementById("pf-org-add").addEventListener("click", () => {
    openModal(`<div class="ch"><h3>${ic("plus")} Organisatie aanmaken</h3><button class="x" data-close aria-label="Sluiten">×</button></div>
      <form class="cb" id="po-form"><label class="xf-l" for="po-name">Naam organisatie</label><input class="f" id="po-name" required>
        <label class="xf-l" for="po-owner">Naam beheerder</label><input class="f" id="po-owner" required>
        <label class="xf-l" for="po-email">E-mailadres beheerder</label><input class="f" id="po-email" type="email" required>
        <div class="hint">De beheerder krijgt een uitnodiging om een wachtwoord te kiezen en kan daarna zelf collega's toevoegen.</div></form>
      <div class="cf"><button class="btn sec" data-close>Annuleren</button><button class="btn" id="po-go" data-ico-done>${ic("send")}<span>Aanmaken en uitnodigen</span></button></div>`);
    const go = async () => {
      try {
        const r = await api("/api/v1/admin/orgs", { body: { name: document.getElementById("po-name").value, ownerName: document.getElementById("po-owner").value, ownerEmail: document.getElementById("po-email").value } });
        closeModal(); toast(`${r.org.name} aangemaakt. ${mailNote(r.mail)}`); render();
      } catch (err) { toast(err.message, true); }
    };
    document.getElementById("po-go").addEventListener("click", go);
    document.getElementById("po-form").addEventListener("submit", (e) => { e.preventDefault(); go(); });
  });
};

// Kleur van een toegangskeuze meteen bijwerken.
document.addEventListener("change", (e) => {
  const s = e.target.closest && e.target.closest(".acc-sel2");
  if (s) s.parentElement.className = `acc-cell a-${s.value}`;
});
