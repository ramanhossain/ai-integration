// Iconen (lijnstijl, 24×24, currentColor). ic("naam") geeft inline SVG terug;
// iconBtn() maakt een knop met alleen een icoon (tekst als tooltip en aria-label).
// Daarnaast zet een automatische stap veelvoorkomende knopteksten (Bewerken, Verwijderen,
// Testen, Wissen, …) om in iconen, overal in de GUI, ook in dialogen.
(function () {
  const P = {
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
    rocket: '<path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
    upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/>',
    play: '<path d="M6 4v16l14-8z"/>',
    pause: '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',
    power: '<path d="M12 2v10"/><path d="M18.4 6.6a9 9 0 1 1-12.8 0"/>',
    trash: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M10 11v6"/><path d="M14 11v6"/>',
    x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
    copy: '<rect x="8" y="8" width="14" height="14" rx="2"/><path d="M4 16a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    flask: '<path d="M9 3h6"/><path d="M10 3v6L4.5 19A1.5 1.5 0 0 0 5.8 21h12.4a1.5 1.5 0 0 0 1.3-2L14 9V3"/><path d="M7 15h10"/>',
    restore: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
    history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>',
    chatPlus: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M12 7v6"/><path d="M9 10h6"/>',
    chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
    sparkles: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 16v5"/><path d="M16.5 18.5h5"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
    search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    refresh: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
    eraser: '<path d="m7 21-4.3-4.3a1 1 0 0 1 0-1.4l9.6-9.6a1 1 0 0 1 1.4 0l5.6 5.6a1 1 0 0 1 0 1.4L13 21"/><path d="M22 21H7"/><path d="m5 11 9 9"/>',
    save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8"/><path d="M7 3v5h8"/>',
    left: '<path d="m15 18-6-6 6-6"/>',
    right: '<path d="m9 18 6-6-6-6"/>',
    server: '<rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><path d="M6 6h.01"/><path d="M6 18h.01"/>',
    send2: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
    list: '<path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/>'
  };
  const ic = (name, size = 16) => `<svg class="ico" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${P[name] || ""}</svg>`;
  const escA = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  // iconBtn("edit", "Bewerken", 'data-act="x"', "sm sec") → knop met alleen icoon.
  const iconBtn = (name, label, attrs = "", cls = "sm sec") => `<button type="button" class="btn ${cls} icon" title="${escA(label)}" aria-label="${escA(label)}" data-ico-done ${attrs}>${ic(name)}</button>`;
  window.ic = ic;
  window.iconBtn = iconBtn;

  // Automatisch: knoptekst → icoon. [naam, alleen icoon?]. Nederlandse bron; Engelse
  // varianten komen uit het woordenboek (de vertaallaag kan eerder hebben vertaald).
  const AUTO = {
    "Bewerken": ["edit", 1], "Bekijken": ["eye", 1], "Verwijderen": ["trash", 1], "Kopiëren": ["copy", 1],
    "Deploy…": ["rocket", 1], "Testen": ["flask", 1], "Resultaat wissen": ["eraser", 1], "Leegmaken": ["eraser", 1],
    "Wissen": ["eraser", 1], "Selectie opheffen": ["x", 1], "Opnieuw aanbieden": ["refresh", 1], "Ophalen": ["refresh", 1],
    "Proberen": ["play", 1], "Terugzetten op DEV": ["restore", 1], "Element verwijderen": ["trash", 1], "Wijzigen": ["edit", 1],
    "Zoeken": ["search", 1], "Instellen": ["settings", 1],
    "Goedkeuren": ["check", 0], "Afwijzen": ["x", 0], "▶ Uitvoeren": ["play", 0], "▶ Stap uitvoeren": ["play", 0],
    "Opslaan": ["save", 0], "⇩ Export": ["download", 0], "⇧ Import": ["upload", 0], "⇧ Importeren": ["upload", 0],
    "← Vorige": ["left", 1], "Volgende →": ["right", 1], "Laatste run": ["history", 0], "Agent installeren": ["download", 0]
  };
  const MAP = new Map();
  const en = (window.I18N_EN && window.I18N_EN.phrases) || {};
  const enWords = (window.I18N_EN && window.I18N_EN.words) || {};
  for (const [nl, v] of Object.entries(AUTO)) {
    MAP.set(nl, v);
    const e = en[nl] || enWords[nl];
    if (e) MAP.set(e, v);
  }
  function iconize(root) {
    if (!root || root.nodeType !== 1) return;
    const list = root.matches && root.matches("button.btn, button.lnk") ? [root] : root.querySelectorAll("button.btn:not([data-ico-done]), button.lnk:not([data-ico-done])");
    for (const b of list) {
      if (b.hasAttribute("data-ico-done") || b.children.length) continue;
      const label = b.textContent.trim();
      const hit = MAP.get(label);
      if (!hit) continue;
      b.setAttribute("data-ico-done", "");
      const [name, only] = hit;
      const clean = label.replace(/^[▶⇩⇧←]\s*|\s*[→…]$/g, "");
      if (only && (b.classList.contains("sm") || b.classList.contains("lnk"))) {
        b.innerHTML = ic(name);
        b.classList.add("icon");
        if (!b.title) b.title = clean;
        if (!b.getAttribute("aria-label")) b.setAttribute("aria-label", clean);
      } else {
        b.innerHTML = `${ic(name)}<span>${escA(clean)}</span>`;
      }
    }
  }
  window.iconize = iconize;
  const obs = new MutationObserver((ms) => { for (const m of ms) m.addedNodes.forEach(iconize); });
  const start = () => { iconize(document.body); obs.observe(document.body, { subtree: true, childList: true }); };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
