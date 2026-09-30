// Taal van de gebruikersinterface (Nederlands of Engels).
// De GUI is in het Nederlands geschreven; bij Engels vertaalt deze laag alles wat op het
// scherm komt: teksten, placeholders, tooltips, aria-labels, meldingen en dialogen.
// Keuze: Instellingen → Taal (per browser, localStorage "aip.lang") of ?lang=en in de URL.
(function () {
  const LANGS = { nl: "Nederlands", en: "English" };
  let lang = "nl";
  try {
    const q = new URLSearchParams(location.search).get("lang");
    if (q && LANGS[q]) localStorage.setItem("aip.lang", q);
    lang = localStorage.getItem("aip.lang") || "nl";
  } catch { /* geen opslag: Nederlands */ }
  if (!LANGS[lang]) lang = "nl";
  document.documentElement.lang = lang;

  const api = {
    lang,
    langs: LANGS,
    set(l) { try { localStorage.setItem("aip.lang", l); } catch { /* */ } location.reload(); },
    t: (s) => s
  };
  window.I18N = api;
  if (lang === "nl" || !window.I18N_EN) return;

  const DICT = window.I18N_EN.phrases;
  const WORDS = window.I18N_EN.words;
  const isWordChar = (c) => /[\p{L}\p{N}]/u.test(c);
  const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Zinsdelen: langste eerst; woordgrenzen alleen waar het zinsdeel met een letter/cijfer begint of eindigt.
  const keys = Object.keys(DICT).filter((k) => k.length > 1).sort((a, b) => b.length - a.length);
  const phraseRe = new RegExp(keys.map((k) => `${isWordChar(k[0]) ? "(?<![\\p{L}\\p{N}])" : ""}${escRe(k)}${isWordChar(k[k.length - 1]) ? "(?![\\p{L}\\p{N}])" : ""}`).join("|"), "gu");
  const lower = new Map(Object.entries(WORDS).map(([k, v]) => [k.toLowerCase(), v]));
  const wordRe = new RegExp(`(?<![\\p{L}\\p{N}_-])(?:${Object.keys(WORDS).sort((a, b) => b.length - a.length).map(escRe).join("|")})(?![\\p{L}\\p{N}_-])`, "giu");
  const cap = (src, t) => (src[0] && src[0] === src[0].toUpperCase() && src[0] !== src[0].toLowerCase() ? t[0].toUpperCase() + t.slice(1) : t);

  const cache = new Map();
  const produced = new Set(); // al vertaalde uitvoer nooit opnieuw vertalen
  function tr(s) {
    if (!s || !/[A-Za-zÀ-ÿ]/.test(s) || produced.has(s)) return s;
    const hit = cache.get(s);
    if (hit !== undefined) return hit;
    const m = s.match(/^(\s*)([\s\S]*?)(\s*)$/);
    let out;
    if (Object.prototype.hasOwnProperty.call(DICT, m[2])) out = m[1] + DICT[m[2]] + m[3];
    else {
      const marked = m[2].replace(phraseRe, (k) => `\u0001${DICT[k] ?? k}\u0002`);
      out = m[1] + marked.split(/(\u0001[^\u0002]*\u0002)/).map((part) => part.startsWith("\u0001") ? part.slice(1, -1) : part.replace(wordRe, (w) => cap(w, lower.get(w.toLowerCase()) ?? w))).join("") + m[3];
    }
    if (cache.size > 20000) cache.clear();
    cache.set(s, out);
    produced.add(out);
    return out;
  }
  api.t = tr;

  // Niet vertalen: code, data en invoer van de gebruiker.
  const SKIP = "script,style,textarea,pre,code,kbd,[contenteditable],[data-noi18n],.dj,.sch-v,.dt td,.xp,.keyrow,#ag-key";
  const ATTRS = ["placeholder", "title", "aria-label", "alt"];
  const skipEl = (el) => !el || (el.closest && el.closest(SKIP));
  function tText(n) {
    const p = n.parentElement;
    if (!p || skipEl(p)) return;
    const v = n.nodeValue;
    const t = tr(v);
    if (t !== v) n.nodeValue = t;
  }
  function tAttrs(el) {
    for (const a of ATTRS) {
      const v = el.getAttribute(a);
      if (v) { const t = tr(v); if (t !== v) el.setAttribute(a, t); }
    }
    if (el.tagName === "INPUT" && (el.type === "button" || el.type === "submit") && el.value) { const t = tr(el.value); if (t !== el.value) el.value = t; }
  }
  function walk(root) {
    if (root.nodeType === 3) { tText(root); return; }
    if (root.nodeType !== 1 || skipEl(root)) return;
    tAttrs(root);
    const w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.nodeType === 1 && n.matches(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT)
    });
    let n;
    while ((n = w.nextNode())) { if (n.nodeType === 3) tText(n); else tAttrs(n); }
  }
  const obs = new MutationObserver((list) => {
    for (const m of list) {
      if (m.type === "childList") m.addedNodes.forEach(walk);
      else if (m.type === "characterData") tText(m.target);
      else if (m.type === "attributes" && !skipEl(m.target)) { const v = m.target.getAttribute(m.attributeName); if (v) { const t = tr(v); if (t !== v) m.target.setAttribute(m.attributeName, t); } }
    }
  });
  function start() {
    document.title = tr(document.title);
    walk(document.body);
    obs.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();

  // Dialogen van de browser
  for (const f of ["alert", "confirm", "prompt"]) {
    const orig = window[f].bind(window);
    window[f] = (msg, ...rest) => orig(tr(String(msg ?? "")), ...rest);
  }
})();
