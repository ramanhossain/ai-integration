// ACCOUNTS — inloggen, aanmelden, wachtwoord vergeten/instellen en de eerste start
// (hoofdaccount). De app start pas als er iemand is ingelogd (window.AIP_AUTH.ready).
// Met AIP_AUTH=off op de server is er geen login (ontwikkeling) en blijft de oude
// gebruikerskeuze (alice/bob) beschikbaar om het vier-ogenprincipe te testen.
(function () {
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const screen = document.getElementById("auth-screen");
  let status = { authEnabled: true, signupOpen: true, setupRequired: false, passwordMin: 10 };
  let resolveReady;
  const ready = new Promise((r) => (resolveReady = r));

  async function call(path, body) {
    const r = await fetch(path, body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(data.error || r.statusText), { status: r.status });
    return data;
  }

  // ---------- schermen ----------
  const brand = `<div class="au-brand"><span class="mark">⇄</span><div><b>AIP</b><small>Integratieplatform</small></div></div>`;
  const field = (id, label, type = "text", attrs = "") => `<label for="${id}">${label}</label><input class="f" id="${id}" type="${type}" ${attrs}>`;
  function show(html) {
    screen.innerHTML = `<div class="au-card" role="dialog" aria-modal="true">${brand}${html}</div><div class="au-foot">AI-native integratieplatform · DEV → TEST → ACC → PROD</div>`;
    screen.classList.remove("hide");
    document.body.classList.add("auth-open");
    const first = screen.querySelector("input");
    if (first) setTimeout(() => first.focus(), 0);
  }
  const err = (msg) => { const el = screen.querySelector(".au-err"); if (el) { el.textContent = msg; el.classList.toggle("hide", !msg); } };
  function bind(formId, fn) {
    const f = document.getElementById(formId);
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = f.querySelector("button[type=submit]");
      btn.disabled = true;
      err("");
      try { await fn(); } catch (x) { err(x.message); } finally { btn.disabled = false; }
    });
  }
  const val = (id) => document.getElementById(id).value;
  const pwHint = () => `<div class="hint">Minstens ${status.passwordMin} tekens, met letters en cijfers.</div>`;
  const done = () => { location.hash = location.hash.startsWith("#reset") || location.hash.startsWith("#login") || location.hash.startsWith("#signup") ? "#dashboard" : location.hash; location.reload(); };

  function loginScreen(msg) {
    show(`<h1>Inloggen</h1>${msg ? `<div class="xf-note ok">${esc(msg)}</div>` : ""}
      <form id="au-login">${field("au-email", "E-mailadres", "email", 'autocomplete="username" required')}${field("au-pw", "Wachtwoord", "password", 'autocomplete="current-password" required')}
        <div class="au-err xf-note err hide" role="alert"></div>
        <button class="btn au-go" type="submit">Inloggen</button></form>
      <div class="au-links"><a href="#forgot">Wachtwoord vergeten?</a>${status.signupOpen ? `<a href="#signup">Nog geen account? Aanmelden</a>` : ""}</div>`);
    bind("au-login", async () => { await call("/api/v1/auth/login", { email: val("au-email"), password: val("au-pw") }); done(); });
  }
  function signupScreen() {
    if (!status.signupOpen) return loginScreen("Aanmelden is gesloten. Vraag de beheerder van het platform om een account.");
    show(`<h1>Aanmelden</h1><p class="muted">Maak een organisatie aan. Je wordt er beheerder van en kunt daarna collega's uitnodigen. Je krijgt een eigen, afgeschermde omgeving met DEV, TEST, ACC en PROD.</p>
      <form id="au-signup">${field("au-org", "Naam organisatie", "text", 'autocomplete="organization" required')}${field("au-name", "Je naam", "text", 'autocomplete="name" required')}${field("au-email", "E-mailadres", "email", 'autocomplete="email" required')}${field("au-pw", "Wachtwoord", "password", 'autocomplete="new-password" required')}${pwHint()}
        <div class="au-err xf-note err hide" role="alert"></div>
        <button class="btn au-go" type="submit">Organisatie aanmaken</button></form>
      <div class="au-links"><a href="#login">Ik heb al een account</a></div>`);
    bind("au-signup", async () => { await call("/api/v1/auth/signup", { orgName: val("au-org"), name: val("au-name"), email: val("au-email"), password: val("au-pw") }); location.hash = "#dashboard"; location.reload(); });
  }
  function forgotScreen() {
    show(`<h1>Wachtwoord vergeten</h1><p class="muted">Vul je e-mailadres in. Je krijgt een mail met een link om een nieuw wachtwoord te kiezen (1 uur geldig).</p>
      <form id="au-forgot">${field("au-email", "E-mailadres", "email", 'autocomplete="email" required')}
        <div class="au-err xf-note err hide" role="alert"></div>
        <button class="btn au-go" type="submit">Link versturen</button></form>
      <div class="au-links"><a href="#login">Terug naar inloggen</a></div>`);
    bind("au-forgot", async () => { const r = await call("/api/v1/auth/forgot", { email: val("au-email") }); loginScreen(r.message); });
  }
  async function resetScreen(token) {
    let info;
    try { info = await call(`/api/v1/auth/reset/${encodeURIComponent(token)}`); }
    catch { show(`<h1>Link verlopen</h1><p class="muted">Deze link is ongeldig of verlopen. Vraag een nieuwe aan.</p><div class="au-links"><a href="#forgot">Nieuwe link aanvragen</a><a href="#login">Inloggen</a></div>`); return; }
    const invite = info.kind === "invite";
    show(`<h1>${invite ? "Welkom!" : "Nieuw wachtwoord"}</h1><p class="muted">${invite ? `Je bent uitgenodigd voor <b>${esc(info.org)}</b>. Kies een wachtwoord om je account te activeren.` : "Kies een nieuw wachtwoord."}</p>
      <div class="au-who"><b>${esc(info.name)}</b><span>${esc(info.email)}</span></div>
      <form id="au-reset">${field("au-pw", "Nieuw wachtwoord", "password", 'autocomplete="new-password" required')}${field("au-pw2", "Herhaal wachtwoord", "password", 'autocomplete="new-password" required')}${pwHint()}
        <div class="au-err xf-note err hide" role="alert"></div>
        <button class="btn au-go" type="submit">${invite ? "Account activeren" : "Wachtwoord opslaan"}</button></form>`);
    bind("au-reset", async () => {
      if (val("au-pw") !== val("au-pw2")) throw new Error("De wachtwoorden zijn niet gelijk");
      await call("/api/v1/auth/reset", { token, password: val("au-pw") });
      location.hash = "#dashboard";
      location.reload();
    });
  }
  function setupScreen() {
    show(`<h1>Welkom bij AIP</h1><p class="muted">Maak het <b>hoofdaccount</b> aan. Daarmee beheer je het platform: alle organisaties en accounts. Bestaande processen en gegevens horen bij jouw (hoofd)organisatie.</p>
      <form id="au-setup">${field("au-org", "Naam organisatie", "text", 'value="Hoofdorganisatie" required')}${field("au-name", "Je naam", "text", 'autocomplete="name" required')}${field("au-email", "E-mailadres", "email", 'autocomplete="email" required')}${field("au-pw", "Wachtwoord", "password", 'autocomplete="new-password" required')}${pwHint()}
        <div class="au-err xf-note err hide" role="alert"></div>
        <button class="btn au-go" type="submit">Hoofdaccount aanmaken</button></form>`);
    bind("au-setup", async () => { await call("/api/v1/auth/setup", { orgName: val("au-org"), name: val("au-name"), email: val("au-email"), password: val("au-pw") }); location.hash = "#dashboard"; location.reload(); });
  }
  function authRoute() {
    const h = location.hash.replace(/^#/, "");
    if (status.setupRequired) return setupScreen();
    if (h.startsWith("reset/")) return resetScreen(decodeURIComponent(h.slice(6)));
    if (h === "signup") return signupScreen();
    if (h === "forgot") return forgotScreen();
    return loginScreen();
  }

  // ---------- ingelogd: gebruikersmenu en rechten ----------
  const initials = (n) => String(n || "?").split(/\s+/).filter(Boolean).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  function applyMe(me) {
    window.AIP_ME = me;
    const who = document.getElementById("who");
    const u = me.user;
    if (!me.authEnabled) {
      who.innerHTML = `<span>gebruiker</span><input id="approver" value="alice" aria-label="Gebruiker (goedkeurder)"><button data-who="alice">alice</button><button data-who="bob">bob</button>`;
      who.querySelectorAll("[data-who]").forEach((b) => b.addEventListener("click", () => (document.getElementById("approver").value = b.dataset.who)));
      return;
    }
    who.innerHTML = `<button class="um-btn" id="um-btn" aria-haspopup="menu" aria-expanded="false" title="${esc(u.email)}"><span class="um-av">${esc(initials(u.name))}</span><span class="um-t"><b>${esc(u.name)}</b><small>${esc(me.org?.name || "")}</small></span></button>
      <div class="um-menu hide" id="um-menu" role="menu">
        <div class="um-h"><b>${esc(u.name)}</b><span>${esc(u.email)}</span><span>${esc(me.org?.name || "")} · ${u.role === "beheerder" ? "beheerder" : "gebruiker"}${u.superAdmin ? " · hoofdaccount" : ""}</span></div>
        <a href="#account" role="menuitem">Mijn account</a>
        ${u.role === "beheerder" ? `<a href="#users" role="menuitem">Gebruikers en API-sleutels</a>` : ""}
        ${u.superAdmin ? `<a href="#platform" role="menuitem">Platformbeheer</a>` : ""}
        <button type="button" id="um-logout" role="menuitem">Uitloggen</button>
      </div>`;
    const btn = document.getElementById("um-btn"), menu = document.getElementById("um-menu");
    btn.addEventListener("click", () => { const open = menu.classList.toggle("hide") === false; btn.setAttribute("aria-expanded", String(open)); });
    document.addEventListener("pointerdown", (e) => { if (!menu.classList.contains("hide") && !who.contains(e.target)) { menu.classList.add("hide"); btn.setAttribute("aria-expanded", "false"); } });
    menu.addEventListener("click", (e) => { if (e.target.closest("a")) menu.classList.add("hide"); });
    document.getElementById("um-logout").addEventListener("click", async () => { await fetch("/api/v1/auth/logout", { method: "POST" }); location.hash = "#login"; location.reload(); });
    document.querySelectorAll("[data-role='admin']").forEach((el) => el.classList.toggle("hide", u.role !== "beheerder"));
    document.querySelectorAll("[data-role='super']").forEach((el) => el.classList.toggle("hide", !u.superAdmin));
  }

  async function start() {
    try { status = await call("/api/v1/auth/status"); } catch { /* server niet bereikbaar: login tonen */ }
    const h = location.hash.replace(/^#/, "");
    if (!status.setupRequired && !h.startsWith("reset/")) {
      try { const me = await call("/api/v1/auth/me"); applyMe(me); resolveReady(me); return; } catch { /* niet ingelogd */ }
    }
    window.addEventListener("hashchange", () => { if (!window.AIP_ME) authRoute(); });
    authRoute();
  }

  window.AIP_AUTH = {
    ready,
    access(env) { const me = window.AIP_ME; if (!me || !me.authEnabled || !me.user) return "edit"; return me.user.role === "beheerder" ? "edit" : (me.user.envAccess || {})[env] || "none"; },
    isAdmin() { const me = window.AIP_ME; return !me || !me.authEnabled || me.user?.role === "beheerder"; },
    isSuper() { const me = window.AIP_ME; return !me || !me.authEnabled || Boolean(me.user?.superAdmin); },
    expired() {
      if (!window.AIP_ME || !window.AIP_ME.authEnabled) return; // nog niet ingelogd: het inlogscherm staat al
      window.AIP_ME = null;
      status.setupRequired = false;
      window.addEventListener("hashchange", () => { if (!window.AIP_ME) authRoute(); });
      loginScreen("Je sessie is verlopen. Log opnieuw in.");
    }
  };
  start();
})();
