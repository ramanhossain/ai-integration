// Procesontwerper: BPMN-canvas.
// - Elementen vrij verschuifbaar (slepen), canvas pannen (slepen op achtergrond / scrollen)
//   en zoomen (ctrl/cmd + scroll, knoppen).
// - Verbinden door te slepen van een uitgang naar een ingang; "+" op een losse uitgang
//   opent het keuzepaneel "Wat gebeurt er hierna?".
// - Dubbelklik op een element opent het detailvenster (Input | Parameters | Output).
// - Undo/redo (ctrl/cmd+Z, shift+ctrl/cmd+Z), Delete verwijdert selectie.
(function () {
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const SNAP = 10;
  const snap = (v) => Math.round(v / SNAP) * SNAP;
  let uidSeq = 0;

  const ICONS = {
    connector: '<path d="M9 7V3M15 7V3"/><path d="M6 7h12v4a6 6 0 0 1-12 0z"/><path d="M12 17v4"/>',
    start: '<path d="M13 2L4 14h7l-1 8 9-12h-7z" fill="currentColor" stroke="none"/>',
    validate: '<path d="M12 3l7 3v5c0 5-3.5 8.5-7 10-3.5-1.5-7-5-7-10V6z"/><path d="M8.5 12l2.5 2.5 4.5-5"/>',
    transform: '<path d="M4 8h14l-3.5-3.5M20 16H6l3.5 3.5"/>',
    "duplicate-check": '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
    enrich: '<path d="M4 7h10M4 12h7M4 17h10"/><path d="M17 10v8M13 14h8"/>',
    csv: '<rect x="4" y="5" width="16" height="14" rx="2"/><path d="M4 10h16M4 15h16M10 5v14"/>',
    xml: '<path d="M8 8l-4 4 4 4M16 8l4 4-4 4M13 6l-2 12"/>',
    call: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.2 3 14.8 0 18M12 3c-3 3.2-3 14.8 0 18"/>',
    code: '<path d="M9 7l-5 5 5 5M15 7l5 5-5 5"/>',
    delay: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>',
    subprocess: '<rect x="3" y="6" width="18" height="12" rx="3"/><path d="M12 9v6M9 12h6"/>',
    file: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/>',
    ftp: '<path d="M6 18a4 4 0 0 1-.5-8A6 6 0 0 1 17 8.5 4.5 4.5 0 0 1 18 18"/><path d="M12 12v8M9 15l3-3 3 3"/>',
    "queue-publish": '<rect x="3" y="8" width="4" height="8" rx="1"/><rect x="9" y="8" width="4" height="8" rx="1"/><path d="M15 12h6M18 9l3 3-3 3"/>',
    "queue-get": '<rect x="11" y="8" width="4" height="8" rx="1"/><rect x="17" y="8" width="4" height="8" rx="1"/><path d="M9 12H3M6 9l-3 3 3 3"/>',
    datatable: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M3 14h18M9 9v11M15 9v11"/>',
    sql: '<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3"/>',
    email: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M3 7l9 6 9-6"/>',
    notify: '<path d="M4 5h16v11H9l-5 4z"/><path d="M8 9h8M8 12h5"/>',
    "mcp-tool": '<path d="M9 3v5M15 3v5M7 8h10v3a5 5 0 0 1-10 0zM12 16v5"/>',
    custom: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    branch: '<path d="M7 7l10 10M17 7L7 17"/>',
    end: '<rect x="8" y="8" width="8" height="8" rx="1" fill="currentColor" stroke="none"/>',
    // BPMN-taakmarkeringen
    "m-service": '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.8v3M12 18.2v3M2.8 12h3M18.2 12h3M5.5 5.5l2.1 2.1M16.4 16.4l2.1 2.1M5.5 18.5l2.1-2.1M16.4 7.6l2.1-2.1"/>',
    "m-script": '<path d="M7 4h11c-2 2-2 4 0 8s2 6 0 8H6c2-2 2-4 0-8s-2-6 1-8z"/><path d="M9.5 8h5.5M9.5 12h6M9.5 16h5"/>',
    "m-send": '<rect x="3" y="6" width="18" height="12" rx="1.5" fill="currentColor"/><path d="M3.5 7l8.5 6 8.5-6" stroke="#fff"/>',
    "m-receive": '<rect x="3" y="6" width="18" height="12" rx="1.5"/><path d="M3.5 7l8.5 6 8.5-6"/>',
    "m-rule": '<rect x="4" y="5" width="16" height="14" rx="1"/><path d="M4 9h16M9 9v10"/>',
    // triggericonen (startevent)
    "t-api": '<path d="M8 8l-4 4 4 4M16 8l4 4-4 4"/><path d="M13.5 6l-3 12"/>',
    "t-manual": '<path d="M8 5v14l11-7z" fill="currentColor" stroke="none"/>',
    "t-webhook": '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.2 3 14.8 0 18M12 3c-3 3.2-3 14.8 0 18"/>',
    "t-schedule": '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>',
    "t-queue": '<rect x="3" y="8" width="4" height="8" rx="1"/><rect x="10" y="8" width="4" height="8" rx="1"/><rect x="17" y="8" width="4" height="8" rx="1"/>',
    "t-file": '<path d="M3 7h6l2 2h10v10H3z"/>',
    "t-ftp": '<path d="M6 18a4 4 0 0 1-.5-8A6 6 0 0 1 17 8.5 4.5 4.5 0 0 1 18 18"/><path d="M12 20v-8M9 17l3 3 3-3"/>'
  };

  // Elementcatalogus (palet) met taken en stappen.
  // shape: task (taak), gateway (ruit), end (eindevent).
  const TYPES = {
    validate: { label: "Validatie", group: "Data", color: "#1f9d55", desc: "Controleer of verplichte velden aanwezig zijn", def: { required: [] } },
    transform: { label: "Transformatie", group: "Data", color: "#2d6cdf", desc: "Velden mappen naar een nieuw formaat", def: { mapping: {} } },
    enrich: { label: "Velden instellen", group: "Data", color: "#0e8f8a", desc: "Velden toevoegen of overschrijven (met {{templates}})", def: { set: {} } },
    "duplicate-check": { label: "Duplicaatcheck", group: "Data", color: "#8b5cf6", desc: "Dubbele berichten tegenhouden op een sleutelveld", def: { key: "id" } },
    csv: { label: "CSV", group: "Data", color: "#15803d", desc: "CSV lezen of maken", def: { mode: "parse", field: "content", target: "records", delimiter: ",", header: true } },
    xml: { label: "XML", group: "Data", color: "#b45309", desc: "XML lezen of maken", def: { mode: "parse", field: "content", target: "data" } },
    call: { label: "HTTP-aanroep", group: "Kern", color: "#e07a1f", desc: "Een REST-API aanroepen, met authenticatie via een koppeling", def: { method: "GET", url: "", credential: "", headers: {}, query: {}, body: "payload", target: "response" } },
    code: { label: "Code", group: "Kern", color: "#475569", desc: "Eigen JavaScript: `input` is het bericht", def: { code: "// input bevat het bericht; geef het nieuwe bericht terug\nreturn { ...input, verwerkt: true };" } },
    delay: { label: "Wachten", group: "Kern", color: "#64748b", desc: "Pauzeer het proces een aantal milliseconden", def: { ms: 1000 }, shape: "timer" },
    subprocess: { label: "Subproces", group: "Kern", color: "#7c3aed", desc: "Een ander proces aanroepen op dezelfde omgeving", def: { process: "", target: "subprocess" } },
    custom: { label: "Doorgeven", group: "Kern", color: "#94a3b8", desc: "Geeft het bericht ongewijzigd door", def: {} },
    file: { label: "Bestand", group: "Bestanden", color: "#0369a1", desc: "Lokaal bestand lezen, schrijven, lijsten, verplaatsen of verwijderen", def: { operation: "write", path: "uit/{{id}}.json", format: "json", target: "file" } },
    ftp: { label: "FTP / SFTP", group: "Bestanden", color: "#0e7490", desc: "Bestanden op een FTP-, FTPS- of SFTP-server", def: { credential: "", operation: "upload", path: "/in/{{id}}.json", format: "json", target: "file" } },
    "queue-publish": { label: "Queue: publiceren", group: "Opslag & berichten", color: "#be185d", desc: "Bericht op een queue zetten", def: { queue: "orders" } },
    "queue-get": { label: "Queue: ophalen", group: "Opslag & berichten", color: "#9d174d", desc: "Berichten van een queue halen (tijdelijke opslag)", def: { queue: "orders", max: 1, target: "messages" } },
    datatable: { label: "Datatabel", group: "Opslag & berichten", color: "#0f766e", desc: "Rijen opslaan, zoeken, bijwerken of verwijderen in een ingebouwde tabel", def: { table: "", operation: "insert", conditions: [], values: {}, target: "row" } },
    sql: { label: "SQL (PostgreSQL)", group: "Opslag & berichten", color: "#1d4ed8", desc: "Query op een externe PostgreSQL-database", def: { credential: "", query: "select * from orders where id = $1", params: ["{{id}}"], target: "rows" } },
    email: { label: "E-mail", group: "Communicatie", color: "#dc2626", desc: "E-mail versturen via SMTP (zonder koppeling gesimuleerd)", def: { credential: "", to: "", subject: "", text: "" } },
    notify: { label: "Teams / Slack", group: "Communicatie", color: "#4f46e5", desc: "Bericht naar een Teams- of Slack-kanaal", def: { kind: "teams", credential: "", title: "", text: "" } },
    connector: { label: "Connector", group: "Plugins", color: "#0e7490", desc: "Actie in een externe dienst: Google, Microsoft, Slack, Salesforce, Stripe, …", def: { plugin: "", operation: "", credential: "", params: {}, target: "" } },
    "mcp-tool": { label: "MCP-tool", group: "AI & MCP", color: "#a21caf", desc: "Tool aanroepen op een externe MCP-server", def: { credential: "", url: "", tool: "", arguments: {}, target: "mcp" } },
    branch: { label: "Beslissing", group: "Flow", color: "#c07a00", desc: "Exclusieve gateway: ja- of nee-pad", def: { when: "", op: "truthy", value: "" }, shape: "gateway" },
    end: { label: "Einde", group: "Flow", color: "#1b2536", desc: "Eindevent: dit pad stopt hier", def: {}, shape: "end" }
  };
  const GROUPS = ["Data", "Kern", "Plugins", "Bestanden", "Opslag & berichten", "Communicatie", "AI & MCP", "Flow"];
  // Beschikbare plugins (gevuld door de app: window.AIP_PLUGINS = [{id,name,category,description,color}])
  const pluginList = () => window.AIP_PLUGINS || [];
  const pluginInfo = (id) => pluginList().find((p) => p.id === id);

  // Triggers (startevent).
  const TRIGGERS = {
    manual: { label: "Handmatig", desc: "Starten vanuit de GUI, API of MCP" },
    webhook: { label: "Webhook / HTTP", desc: "HTTP-endpoint per omgeving (ontvangt berichten)" },
    api: { label: "API-endpoint", desc: "REST-endpoint met padparameters en OpenAPI-specificatie" },
    schedule: { label: "Schema (cron)", desc: "Periodiek starten" },
    queue: { label: "Queue", desc: "Start per bericht op een queue" },
    file: { label: "Map (lokaal)", desc: "Nieuwe bestanden in een map" },
    ftp: { label: "FTP / SFTP", desc: "Nieuwe bestanden op een FTP/SFTP-server" }
  };
  function triggerSub(t, name) {
    t = t || {};
    if (t.type === "webhook") return "/" + String(t.path || name || "").replace(/^\//, "");
    if (t.type === "api") return `${String(t.method || "GET").toUpperCase()} /${String(t.path || name || "").replace(/^\//, "")}`;
    if (t.type === "schedule") return t.everySeconds ? `elke ${t.everySeconds}s` : t.cron || "";
    if (t.type === "queue") return t.queue || "";
    if (t.type === "file" || t.type === "ftp") return t.dir || "";
    return t.source || "";
  }

  // BPMN-geometrie: events 40×40, gateway 52×52, taken 130×76.
  function geom(n) {
    const shape = n.type === "start" ? "start" : (TYPES[n.type] || {}).shape || "task";
    if (shape === "start") return { shape, w: 40, h: 40, in: null, outs: [{ port: "out", x: 40, y: 20, dir: "right" }] };
    if (shape === "end") return { shape, w: 40, h: 40, in: { x: 0, y: 20 }, outs: [] };
    if (shape === "timer") return { shape, w: 40, h: 40, in: { x: 0, y: 20 }, outs: [{ port: "out", x: 40, y: 20, dir: "right" }] };
    if (shape === "gateway")
      return { shape, w: 52, h: 52, in: { x: 0, y: 26 }, outs: [{ port: "true", x: 52, y: 26, dir: "right", label: "ja" }, { port: "false", x: 26, y: 52, dir: "down", label: "nee" }] };
    return { shape, w: 130, h: 76, in: { x: 0, y: 38 }, outs: [{ port: "out", x: 130, y: 38, dir: "right" }] };
  }

  // BPMN-taakmarkering per staptype, en welke data-artefacten erbij horen.
  const MARKER = { call: "m-service", "mcp-tool": "m-service", sql: "m-service", ftp: "m-service", file: "m-service", datatable: "m-service",
    code: "m-script", transform: "m-script", enrich: "m-script", validate: "m-rule", "duplicate-check": "m-rule", csv: "m-script", xml: "m-script",
    email: "m-send", notify: "m-send", "queue-publish": "m-send", "queue-get": "m-receive", connector: "m-service" };
  const ARTIFACT = { datatable: "store", sql: "store", file: "object", ftp: "object" };

  function wrapText(txt, max = 17, lines = 3) {
    const words = String(txt).split(/\s+/);
    const out = [];
    let cur = "";
    for (const w of words) {
      if ((cur + " " + w).trim().length <= max) cur = (cur + " " + w).trim();
      else { if (cur) out.push(cur); cur = w.length > max ? w.slice(0, max - 1) + "…" : w; }
      if (out.length === lines) break;
    }
    if (out.length < lines && cur) out.push(cur);
    if (out.length === lines && words.join(" ").length > out.join(" ").length) out[lines - 1] = out[lines - 1].replace(/.?$/, "…");
    return out;
  }
  const portOf = (c, fromNode) => c.port ?? (fromNode && fromNode.type === "branch" ? "true" : "out");

  // Haakse (orthogonale) sequence flow met afgeronde hoeken, zoals in BPMN-editors.
  function edgePath(p1, dir, p2) {
    let pts;
    if (dir === "down") {
      if (p2.x > p1.x + 20) pts = [p1, { x: p1.x, y: p2.y }, p2];
      else pts = [p1, { x: p1.x, y: p1.y + 26 }, { x: p2.x - 26, y: p1.y + 26 }, { x: p2.x - 26, y: p2.y }, p2];
    } else if (p2.x >= p1.x + 24) {
      const mx = Math.round(p1.x + (p2.x - p1.x) / 2);
      pts = Math.abs(p2.y - p1.y) < 1 ? [p1, p2] : [p1, { x: mx, y: p1.y }, { x: mx, y: p2.y }, p2];
    } else {
      const ly = Math.max(p1.y, p2.y) + 90;
      pts = [p1, { x: p1.x + 22, y: p1.y }, { x: p1.x + 22, y: ly }, { x: p2.x - 22, y: ly }, { x: p2.x - 22, y: p2.y }, p2];
    }
    pts = pts.filter((p, i) => i === 0 || p.x !== pts[i - 1].x || p.y !== pts[i - 1].y);
    let d = `M${pts[0].x},${pts[0].y}`;
    for (let i = 1; i < pts.length - 1; i++) {
      const a = pts[i - 1], b = pts[i], c = pts[i + 1];
      const d1 = Math.hypot(b.x - a.x, b.y - a.y), d2 = Math.hypot(c.x - b.x, c.y - b.y);
      const r = Math.min(9, d1 / 2, d2 / 2);
      const pa = { x: b.x - ((b.x - a.x) / d1) * r, y: b.y - ((b.y - a.y) / d1) * r };
      const pb = { x: b.x + ((c.x - b.x) / d2) * r, y: b.y + ((c.y - b.y) / d2) * r };
      d += ` L${pa.x},${pa.y} Q${b.x},${b.y} ${pb.x},${pb.y}`;
    }
    const last = pts[pts.length - 1];
    d += ` L${last.x},${last.y}`;
    let best = -1, mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
    for (let i = 0; i < pts.length - 1; i++) {
      const L = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
      if (L > best) { best = L; mid = { x: (pts[i].x + pts[i + 1].x) / 2, y: (pts[i].y + pts[i + 1].y) / 2 }; }
    }
    return { d, mid };
  }

  // Automatische layout (links -> rechts in lagen).
  function tidy(def) {
    def.layout = def.layout || {};
    const conns = def.connections || [];
    const depth = { start: 0 }, order = ["start"], q = ["start"];
    while (q.length) {
      const id = q.shift();
      for (const c of conns.filter((c) => c.from === id)) {
        if (depth[c.to] === undefined) { depth[c.to] = depth[id] + 1; order.push(c.to); q.push(c.to); }
      }
    }
    let maxD = Math.max(0, ...Object.values(depth));
    for (const s of def.steps) if (depth[s.id] === undefined) { depth[s.id] = ++maxD; order.push(s.id); }
    const layers = {};
    for (const id of order) (layers[depth[id]] = layers[depth[id]] || []).push(id);
    for (const [d, ids] of Object.entries(layers)) {
      ids.forEach((id, i) => {
        const cy = 240 + (i - (ids.length - 1) / 2) * 170;
        const cx = 80 + Number(d) * 210;
        if (id === "start") { const gs = geom({ type: "start" }); def.layout.start = { x: snap(cx - gs.w / 2), y: snap(cy - gs.h / 2) }; }
        else {
          const s = def.steps.find((x) => x.id === id);
          if (!s) return;
          const g = geom(s);
          s.position = { x: snap(cx - g.w / 2), y: snap(cy - g.h / 2) };
        }
      });
    }
  }

  // Oudere/AI-gegenereerde processen zonder connections of posities omzetten naar het BPMN-model.
  function normalize(def) {
    def.steps = def.steps || [];
    if (!def.connections || !def.connections.length) {
      def.connections = def.steps.map((s, i) => ({ from: i === 0 ? "start" : def.steps[i - 1].id, to: s.id }));
    }
    def.layout = def.layout || {};
    if (!def.layout.start || def.steps.some((s) => !s.position)) tidy(def);
    return def;
  }

  function computeRunState(run) {
    if (!run) return null;
    const ok = new Set(), failed = new Set(), ports = {};
    for (const s of run.steps || []) {
      if (s.status === "ok") ok.add(s.id); else if (s.status === "failed") failed.add(s.id);
      if (s.port) ports[s.id] = s.port;
    }
    return { ok, failed, ports };
  }

  function iconSvg(type, color, size = 36, x = 0, y = 0, strokeW = 1.7) {
    const k = size / 24;
    return `<g style="color:${color}" transform="translate(${x},${y}) scale(${k})" fill="none" stroke="currentColor" stroke-width="${strokeW}" stroke-linecap="round" stroke-linejoin="round">${ICONS[type] || ICONS.custom}</g>`;
  }

  // Klembord voor kopiëren/plakken van stappen (gedeeld tussen editors in deze tab).
  let CLIP = null;
  const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  const KEY = { mod: IS_MAC ? "⌘" : "Ctrl", alt: IS_MAC ? "⌥" : "Alt", shift: "⇧" };

  // BPMN-gereedschapsbalk: [type, titel, svg]. "task" opent de keuzelijst met alle taken.
  const S_ = 'fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"';
  const TOOLS = [
    ["task", "Taak (kies het type)", `<rect x="4" y="7" width="20" height="14" rx="3" ${S_}/>`],
    ["subprocess", "Subproces", `<rect x="4" y="7" width="20" height="14" rx="3" ${S_} stroke-width="2.6"/><path d="M14 15v4M12 17h4" ${S_}/>`],
    ["branch", "Beslissing (exclusieve gateway)", `<path d="M14 3l11 11-11 11L3 14z" ${S_}/><path d="M10 10l8 8M18 10l-8 8" ${S_} stroke-width="2"/>`],
    ["end", "Eindevent", `<circle cx="14" cy="14" r="9" ${S_} stroke-width="3.2"/>`],
    ["delay", "Wachten (timer)", `<circle cx="14" cy="14" r="10" ${S_}/><circle cx="14" cy="14" r="7.5" ${S_}/><path d="M14 10v4l2.5 1.5" ${S_}/>`],
    ["code", "Scripttaak (code)", `<rect x="4" y="7" width="20" height="14" rx="3" ${S_}/><path d="M9 11h7M9 14h8M9 17h6" ${S_}/>`],
    "|",
    ["call", "Servicetaak (HTTP-aanroep)", `<rect x="4" y="7" width="20" height="14" rx="3" ${S_}/><circle cx="10" cy="12" r="2" ${S_}/>`],
    ["email", "Verzendtaak (e-mail)", `<rect x="5" y="8" width="18" height="12" rx="1.5" fill="currentColor"/><path d="M5.5 9l8.5 6 8.5-6" stroke="#fff" stroke-width="1.4" fill="none"/>`],
    ["queue-get", "Ontvangsttaak (queue ophalen)", `<rect x="5" y="8" width="18" height="12" rx="1.5" ${S_}/><path d="M5.5 9l8.5 6 8.5-6" ${S_}/>`],
    ["transform", "Transformatie", `<path d="M6 10h14l-3-3M22 18H8l3 3" ${S_}/>`],
    "|",
    ["datatable", "Datastore (datatabel)", `<ellipse cx="14" cy="7" rx="8" ry="3" ${S_}/><path d="M6 7v14c0 1.7 3.6 3 8 3s8-1.3 8-3V7M6 12c0 1.7 3.6 3 8 3s8-1.3 8-3" ${S_}/>`],
    ["file", "Data-object (bestand)", `<path d="M8 4h9l5 5v15H8z" ${S_}/><path d="M17 4v5h5" ${S_}/>`]
  ];

  // ---------------------------------------------------------------- canvas
  function mount(container, opts) {
    const def = normalize(opts.def);
    const readonly = Boolean(opts.readonly);
    const uid = `pc${++uidSeq}`;
    let view = { x: 40, y: 20, k: 1 };
    let selected = null; // { kind: 'node', id } | { kind: 'edge', index }
    let runState = computeRunState(opts.run);
    let lastRun = opts.run || null;
    let drag = null;
    let lastDown = null; // { id, t } voor dubbelklik-herkenning
    let flashIds = new Set(); // elementen die net gewijzigd zijn (lichten kort op)
    let multi = new Set(); // meervoudige selectie (shift/⌘-klik, selectiekader, ⌘A)
    let selGroup = null; // geselecteerde groep (id)
    let pickerCtx = null;
    const undo = [], redo = [];

    container.innerHTML = `
      <div class="pc ${readonly ? "ro" : ""}">
        <svg class="pc-svg" tabindex="-1" aria-label="Procesontwerp">
          <defs>
            <pattern id="${uid}-grid" width="20" height="20" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="0.9" fill="#dfe5ee"/></pattern>
            <marker id="${uid}-ah" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="10" markerHeight="10" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#3d4a5c"/></marker>
            <marker id="${uid}-ah-run" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="11" markerHeight="11" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#1f9d55"/></marker>
            <marker id="${uid}-ah-sel" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="11" markerHeight="11" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#2d6cdf"/></marker>
          </defs>
          <rect class="pc-bg" width="100%" height="100%" fill="url(#${uid}-grid)"/>
          <g class="pc-vp"><g class="pc-groups"></g><g class="pc-edges"></g><g class="pc-nodes"></g><path class="pc-temp" d="" style="display:none"/><rect class="pc-lasso" style="display:none"/></g>
        </svg>
        <div class="pc-controls">
          <button data-pc="fit" title="Passend maken" aria-label="Passend maken"><svg viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg></button>
          <button data-pc="in" title="Inzoomen" aria-label="Inzoomen"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6"/><path d="M11 8v6M8 11h6M16 16l4 4"/></svg></button>
          <button data-pc="out" title="Uitzoomen" aria-label="Uitzoomen"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6"/><path d="M8 11h6M16 16l4 4"/></svg></button>
          ${readonly ? "" : `<button data-pc="tidy" title="Opruimen (automatische layout)" aria-label="Opruimen"><svg viewBox="0 0 24 24"><path d="M4 6h7M4 12h7M4 18h7M15 6h5M15 12h5M15 18h5"/></svg></button>
          <button data-pc="undo" title="Ongedaan maken (Ctrl/Cmd+Z)" aria-label="Ongedaan maken"><svg viewBox="0 0 24 24"><path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/></svg></button>`}
        </div>
        ${readonly ? "" : `<div class="pc-tools" role="toolbar" aria-label="BPMN-elementen">${TOOLS.map((t) => t === "|" ? '<span class="sep"></span>' : `<button type="button" draggable="true" data-tool="${t[0]}" title="${esc(t[1])} — klik of sleep naar het canvas" aria-label="${esc(t[1])}"><svg viewBox="0 0 28 28">${t[2]}</svg></button>`).join("")}</div>
        <div class="pc-hint ${def.steps.length > 3 ? "hide" : ""}">Sleep een element uit de balk links · sleep van een uitgang (●) naar een ingang om te verbinden · dubbelklik om te openen · Delete verwijdert</div>
        <aside class="pc-picker hide" aria-label="Element kiezen">
          <div class="pk-h"><b>Wat gebeurt er hierna?</b><button class="x" data-pc="pk-close" aria-label="Sluiten">×</button></div>
          <div class="pk-s"><input class="f pk-q" placeholder="Zoek een element…" aria-label="Zoek een element"></div>
          <div class="pk-list"></div>
        </aside>`}
      </div>`;

    const root = container.querySelector(".pc");
    const svg = root.querySelector(".pc-svg");
    const vp = root.querySelector(".pc-vp");
    const edgesG = root.querySelector(".pc-edges");
    const nodesG = root.querySelector(".pc-nodes");
    const temp = root.querySelector(".pc-temp");
    const groupsG = root.querySelector(".pc-groups");
    const lasso = root.querySelector(".pc-lasso");
    const pattern = root.querySelector(`#${uid}-grid`);
    const picker = root.querySelector(".pc-picker");

    const allNodes = () => [{ id: "start", type: "start", position: def.layout.start }, ...def.steps];
    const nodeById = (id) => allNodes().find((n) => n.id === id);
    const changed = () => opts.onChange && opts.onChange(def);

    function applyView() {
      vp.setAttribute("transform", `translate(${view.x},${view.y}) scale(${view.k})`);
      pattern.setAttribute("patternTransform", `translate(${view.x},${view.y}) scale(${view.k})`);
    }
    function toWorld(e) {
      const r = svg.getBoundingClientRect();
      return { x: (e.clientX - r.left - view.x) / view.k, y: (e.clientY - r.top - view.y) / view.k };
    }
    function outPoint(n, port) {
      const g = geom(n);
      const o = g.outs.find((p) => p.port === port) || g.outs[0];
      return o ? { x: n.position.x + o.x, y: n.position.y + o.y, dir: o.dir } : null;
    }

    // ------------------------------------------------------------ tekenen
    function edgeSvg(c, i, byId) {
      const a = byId.get(c.from), b = byId.get(c.to);
      if (!a || !b || !a.position || !b.position) return "";
      const gb = geom(b);
      if (!gb.in) return "";
      const port = portOf(c, a);
      const o = geom(a).outs.find((p) => p.port === port);
      if (!o) return "";
      const p1 = { x: a.position.x + o.x, y: a.position.y + o.y };
      const p2 = { x: b.position.x + gb.in.x - 1, y: b.position.y + gb.in.y };
      const { d, mid } = edgePath(p1, o.dir, p2);
      const isSel = selected && selected.kind === "edge" && selected.index === i;
      let ran = false;
      if (runState) {
        const fromOk = c.from === "start" || runState.ok.has(c.from);
        const toHit = runState.ok.has(c.to) || runState.failed.has(c.to);
        const portOk = !runState.ports[c.from] || runState.ports[c.from] === port;
        ran = fromOk && toHit && portOk;
      }
      const cls = isSel ? "sel" : ran ? "run" : "";
      const marker = isSel ? `${uid}-ah-sel` : ran ? `${uid}-ah-run` : `${uid}-ah`;
      const lbl = o.label ? `<text class="elbl" x="${p1.x + (o.dir === "down" ? 7 : 8)}" y="${p1.y + (o.dir === "down" ? 16 : -7)}">${o.label}</text>` : "";
      const del = isSel && !readonly ? `<g class="edel" data-edge="${i}" transform="translate(${mid.x},${mid.y})"><circle r="11"/><path d="M-4,-4 L4,4 M4,-4 L-4,4"/></g>` : "";
      return `<g data-edge="${i}"><path class="edge-hit" d="${d}"/><path class="edge ${cls}" d="${d}" marker-end="url(#${marker})"/>${lbl}${del}</g>`;
    }

    function nodeSvg(n) {
      const g = geom(n);
      const t = n.type === "start" ? null : TYPES[n.type] || TYPES.custom;
      let st = null;
      if (runState) st = n.id === "start" ? "ok" : runState.failed.has(n.id) ? "failed" : runState.ok.has(n.id) ? "ok" : "skipped";
      const isSel = multi.has(n.id) || (selected && selected.kind === "node" && selected.id === n.id);
      const call = n.type === "subprocess";
      const cls = ["nd", `nd-${g.shape}`, call ? "nd-call" : "", n.disabled ? "off" : "", flashIds.has(n.id) ? "flash" : "", isSel ? "sel" : "", st === "ok" ? "ok" : "", st === "failed" ? "fail" : "", st === "skipped" ? "dim" : "", opts.nodeClass ? opts.nodeClass(n.id) || "" : ""].join(" ");
      const name = n.type === "start" ? (TRIGGERS[def.trigger?.type] || { label: def.trigger?.type || "trigger" }).label : n.name || n.id;
      let body = "", inner = "", labels = "", art = "";
      if (g.shape === "start" || g.shape === "end" || g.shape === "timer") {
        body = `<circle class="body" cx="20" cy="20" r="${g.shape === "end" ? 17.5 : 19}"/>`;
        if (g.shape === "timer") body += `<circle class="body2" cx="20" cy="20" r="15"/>`;
        const key = g.shape === "start" ? `t-${def.trigger?.type || "manual"}` : g.shape === "timer" ? "delay" : null;
        if (key && ICONS[key] && !(g.shape === "start" && (def.trigger?.type || "manual") === "manual")) inner = iconSvg(key, "#3d4a5c", 18, 11, 11, 2);
        const sub = g.shape === "start" ? triggerSub(def.trigger, def.integration) : g.shape === "timer" ? `${Math.round(Number(n.config?.ms ?? 1000) / 100) / 10} s` : "";
        labels = `<text class="lbl" x="20" y="58">${esc(name.length > 22 ? name.slice(0, 21) + "…" : name)}</text>${sub ? `<text class="sub" x="20" y="72">${esc(sub.length > 26 ? sub.slice(0, 25) + "…" : sub)}</text>` : ""}`;
      } else if (g.shape === "gateway") {
        body = `<polygon class="body" points="26,1 51,26 26,51 1,26"/>`;
        inner = `<path class="gwx" d="M18,18 L34,34 M34,18 L18,34"/>`;
        labels = `<text class="lbl" x="26" y="-10">${esc(name.length > 24 ? name.slice(0, 23) + "…" : name)}</text>`;
      } else {
        body = `<rect class="body" width="130" height="76" rx="10"/>`;
        const mk = MARKER[n.type];
        if (mk) inner += iconSvg(mk, "#3d4a5c", 15, 7, 7, 1.8);
        const lines = wrapText(name);
        const y0 = 38 - ((lines.length - 1) * 15) / 2 + 4;
        inner += lines.map((l, k) => `<text class="tlbl" x="65" y="${y0 + k * 15}">${esc(l)}</text>`).join("");
        if (call) inner += `<rect class="cmark" x="58" y="61" width="14" height="12" rx="1"/><path class="cmark" d="M65,64 v6 M62,67 h6"/>`;
        const subLabel = n.type === "connector" ? (pluginInfo(n.config?.plugin)?.name || "Connector") : t.label;
        labels = `<text class="sub" x="65" y="90">${esc(subLabel)}</text>`;
        const a = ARTIFACT[n.type];
        if (a === "store") {
          const lbl = n.type === "datatable" ? n.config?.table : "database";
          art = `<g class="art"><line class="assoc" x1="65" y1="-4" x2="65" y2="-26"/>
            <path class="dstore" d="M49,-58 v24 a16,5 0 0 0 32,0 v-24"/><ellipse class="dstore" cx="65" cy="-58" rx="16" ry="5"/><path class="dstore-l" d="M49,-50 a16,5 0 0 0 32,0 M49,-43 a16,5 0 0 0 32,0"/>
            ${lbl ? `<text class="alb" x="86" y="-42">${esc(String(lbl).slice(0, 18))}</text>` : ""}</g>`;
        } else if (a === "object") {
          art = `<g class="art"><line class="assoc" x1="65" y1="-4" x2="65" y2="-24"/><path class="dstore" d="M54,-60 h15 l7,7 v29 h-22 z"/><path class="dstore-l" d="M69,-60 v7 h7"/>
            ${n.config?.path ? `<text class="alb" x="81" y="-40">${esc(String(n.config.path).slice(0, 20))}</text>` : ""}</g>`;
        }
      }
      let handles = "";
      if (!readonly) {
        if (g.in) handles += `<circle class="hd in" cx="${g.in.x}" cy="${g.in.y}" r="5"/>`;
        for (const o of g.outs) {
          handles += `<circle class="hd out" data-port="${o.port}" cx="${o.x}" cy="${o.y}" r="6"/>`;
          const used = def.connections.some((c) => c.from === n.id && portOf(c, n) === o.port);
          if (!used) {
            if (o.dir === "down") {
              handles += `<g class="plus" data-from="${esc(n.id)}" data-port="${o.port}"><line x1="${o.x}" y1="${o.y + 6}" x2="${o.x}" y2="${o.y + 24}"/><rect x="${o.x - 10}" y="${o.y + 24}" width="20" height="20" rx="5"/><path d="M${o.x - 5},${o.y + 34} h10 M${o.x},${o.y + 29} v10"/></g>`;
            } else {
              handles += `<g class="plus" data-from="${esc(n.id)}" data-port="${o.port}"><line x1="${o.x + 6}" y1="${o.y}" x2="${o.x + 24}" y2="${o.y}"/><rect x="${o.x + 24}" y="${o.y - 10}" width="20" height="20" rx="5"/><path d="M${o.x + 29},${o.y} h10 M${o.x + 34},${o.y - 5} v10"/></g>`;
            }
          }
          if (o.label && !used) handles += `<text class="plbl" x="${o.dir === "down" ? o.x + 9 : o.x + 4}" y="${o.dir === "down" ? o.y + 4 : o.y - 9}">${o.label}</text>`;
        }
      }
      let badge = "";
      if (st === "ok") badge = `<g class="badge" transform="translate(${g.w - 4},2)"><circle r="9" fill="#1f9d55"/><path d="M-4,0 L-1.3,2.7 L4,-2.7" stroke="#fff" stroke-width="2" fill="none"/></g>`;
      if (st === "failed") badge = `<g class="badge" transform="translate(${g.w - 4},2)"><circle r="9" fill="#d64545"/><path d="M-3,-3 L3,3 M3,-3 L-3,3" stroke="#fff" stroke-width="2"/></g>`;
      if (n.disabled) badge += `<text class="offlbl" x="${g.w / 2}" y="${g.h + (g.shape === "task" ? 26 : 30)}">uitgeschakeld</text>`;
      if (n.pinData) badge += `<g class="pinb" transform="translate(${g.w - 6},${g.h - 6})"><title>Output vastgezet (voor test-runs)</title><circle r="9"/><path d="M-3,-4 h6 M-2,-4 v4 l-2,2 h8 l-2,-2 v-4 M0,2 v4"/></g>`;
      return `<g class="${cls}" data-node="${esc(n.id)}" transform="translate(${n.position.x},${n.position.y})">${art}${body}${inner}${labels}${handles}${badge}</g>`;
    }

    // BPMN-groep: gestippeld kader rond de leden, met naam linksboven.
    function groupBox(gr) {
      const ns = gr.nodes.map((id) => nodeById(id)).filter((n) => n && n.position);
      if (!ns.length) return null;
      let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
      for (const n of ns) {
        const g = geom(n);
        const top = ARTIFACT[n.type] ? 64 : g.shape === "gateway" ? 20 : 0;
        x1 = Math.min(x1, n.position.x); y1 = Math.min(y1, n.position.y - top);
        x2 = Math.max(x2, n.position.x + g.w); y2 = Math.max(y2, n.position.y + g.h + (g.shape === "task" ? 20 : 36));
      }
      return { x: x1 - 24, y: y1 - 36, w: x2 - x1 + 48, h: y2 - y1 + 56 };
    }
    function drawGroups() {
      const groups = (def.layout && def.layout.groups) || [];
      groupsG.innerHTML = groups.map((gr) => {
        const b = groupBox(gr);
        if (!b) return "";
        const lw = Math.max(64, String(gr.label).length * 7 + 22);
        return `<g class="grp ${selGroup === gr.id ? "sel" : ""}"><rect class="grp-r" x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="14"/>
          <g class="grp-l" data-group="${esc(gr.id)}"><rect class="grp-lb" x="${b.x + 12}" y="${b.y - 12}" width="${lw}" height="24" rx="7"/><text x="${b.x + 22}" y="${b.y + 4}">${esc(gr.label)}</text></g></g>`;
      }).join("");
    }
    function cleanupGroups() {
      if (!def.layout || !def.layout.groups) return;
      const ids = new Set(["start", ...def.steps.map((x) => x.id)]);
      def.layout.groups = def.layout.groups.map((g) => ({ ...g, nodes: g.nodes.filter((id) => ids.has(id)) })).filter((g) => g.nodes.length);
      if (!def.layout.groups.length) delete def.layout.groups;
    }

    function draw() {
      const nodes = allNodes();
      const byId = new Map(nodes.map((n) => [n.id, n]));
      drawGroups();
      edgesG.innerHTML = def.connections.map((c, i) => edgeSvg(c, i, byId)).join("");
      nodesG.innerHTML = nodes.filter((n) => n.position).map(nodeSvg).join("");
    }

    // ------------------------------------------------------------ mutaties
    function pushHistory(snapStr) {
      undo.push(snapStr || JSON.stringify(def));
      if (undo.length > 80) undo.shift();
      redo.length = 0;
    }
    function restore(json) {
      const d = JSON.parse(json);
      for (const k of Object.keys(def)) delete def[k];
      Object.assign(def, d);
      selected = null;
      multi = new Set();
      selGroup = null;
      draw();
      changed();
    }
    function doUndo() { if (!undo.length) return; redo.push(JSON.stringify(def)); restore(undo.pop()); }
    function doRedo() { if (!redo.length) return; undo.push(JSON.stringify(def)); restore(redo.pop()); }

    function uniqueId(type) {
      const base = type === "duplicate-check" ? "dedupe" : type;
      let id = base, n = 1;
      while (def.steps.some((s) => s.id === id)) id = `${base}${++n}`;
      return id;
    }
    function freeSpot(x, y) {
      let yy = y;
      for (let i = 0; i < 30; i++) {
        if (!allNodes().some((n) => n.position && Math.abs(n.position.x - x) < 90 && Math.abs(n.position.y - yy) < 90)) return { x, y: yy };
        yy += 150;
      }
      return { x, y: yy };
    }
    function addNode(type, ctx, plugin) {
      pushHistory();
      const t = TYPES[type];
      const pl = plugin ? pluginInfo(plugin) : null;
      const id = uniqueId(pl ? pl.id.replace(/-/g, "_") : type);
      const baseName = pl ? pl.name : t.label;
      const count = def.steps.filter((s) => (s.name || "").startsWith(baseName)).length;
      const node = { id, type, name: count ? `${baseName} ${count + 1}` : baseName, config: clone(t.def) };
      if (pl) { node.config.plugin = pl.id; node.config.target = pl.id.replace(/-/g, "_"); }
      const g = geom(node);
      let pos;
      if (ctx && ctx.at) pos = { x: ctx.at.x - g.w / 2, y: ctx.at.y - g.h / 2 };
      else if (ctx && ctx.from) {
        const p = outPoint(nodeById(ctx.from), ctx.port);
        pos = p.dir === "down" ? { x: p.x - g.w / 2, y: p.y + 90 } : { x: p.x + 110, y: p.y - g.h / 2 };
        pos = freeSpot(snap(pos.x), snap(pos.y));
      } else {
        const r = svg.getBoundingClientRect();
        pos = freeSpot(snap((r.width / 2 - view.x) / view.k - g.w / 2), snap((r.height / 2 - view.y) / view.k - g.h / 2));
      }
      node.position = { x: snap(pos.x), y: snap(pos.y) };
      def.steps.push(node);
      if (ctx && ctx.from) def.connections.push(ctx.port && ctx.port !== "out" ? { from: ctx.from, to: id, port: ctx.port } : { from: ctx.from, to: id });
      selected = { kind: "node", id };
      draw();
      ensureVisible(node);
      changed();
      // Detailvenster opent niet automatisch; alleen bij dubbelklik (of Enter op een geselecteerd element).
    }
    function addConnection(from, to, port) {
      if (from === to) return;
      const fromNode = nodeById(from);
      if (def.connections.some((c) => c.from === from && c.to === to && portOf(c, fromNode) === port)) return;
      pushHistory();
      def.connections.push(port && port !== "out" ? { from, to, port } : { from, to });
      draw();
      changed();
    }
    function deleteNode(id) { deleteMany([id]); }
    function deleteMany(ids) {
      const set = new Set(ids.filter((id) => id !== "start"));
      if (!set.size) return;
      pushHistory();
      def.steps = def.steps.filter((s) => !set.has(s.id));
      def.connections = def.connections.filter((c) => !set.has(c.from) && !set.has(c.to));
      cleanupGroups();
      selected = null;
      multi = new Set();
      selGroup = null;
      draw();
      changed();
    }
    // Hulpfuncties voor de selectie
    const selIds = () => (multi.size ? [...multi] : selected && selected.kind === "node" ? [selected.id] : []);
    const selSteps = () => selIds().filter((id) => id !== "start");
    function removeEdge(i) {
      pushHistory();
      def.connections.splice(i, 1);
      selected = null;
      draw();
      changed();
    }
    function deleteSelected() {
      if (multi.size || selGroup) return deleteMany(selSteps());
      if (!selected) return;
      if (selected.kind === "node") deleteNode(selected.id);
      else removeEdge(selected.index);
    }

    // ------------------------------------------------------------ view
    function fit() {
      const nodes = allNodes().filter((n) => n.position);
      const r = svg.getBoundingClientRect();
      if (!nodes.length || !r.width) return;
      let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
      for (const n of nodes) {
        const g = geom(n);
        x1 = Math.min(x1, n.position.x); y1 = Math.min(y1, n.position.y);
        x2 = Math.max(x2, n.position.x + g.w + 60); y2 = Math.max(y2, n.position.y + g.h + 45);
      }
      // Links ruimte houden voor de gereedschapsbalk; boven voor datastores/labels.
      const padL = readonly ? 40 : 110, padR = 40, padY = 50;
      x1 -= 10; y1 -= 70;
      const availW = r.width - padL - padR, availH = r.height - padY * 2;
      const k = Math.max(0.3, Math.min(1.1, availW / (x2 - x1), availH / (y2 - y1)));
      view = { k, x: padL + (availW - (x2 - x1) * k) / 2 - x1 * k, y: padY + (availH - (y2 - y1) * k) / 2 - y1 * k };
      applyView();
    }
    function zoomAt(cx, cy, factor) {
      const k2 = Math.max(0.25, Math.min(2, view.k * factor));
      view.x = cx - (cx - view.x) * (k2 / view.k);
      view.y = cy - (cy - view.y) * (k2 / view.k);
      view.k = k2;
      applyView();
    }
    // Schuif het canvas zodat een element (met label) volledig in beeld staat.
    function ensureVisible(n) {
      const r = svg.getBoundingClientRect();
      const g = geom(n), m = 50;
      const sx1 = view.x + (n.position.x - 20) * view.k, sy1 = view.y + (n.position.y - 30) * view.k;
      const sx2 = view.x + (n.position.x + g.w + 70) * view.k, sy2 = view.y + (n.position.y + g.h + 60) * view.k;
      if (sx2 > r.width - m) view.x -= sx2 - (r.width - m);
      if (sx1 < m) view.x += m - sx1;
      if (sy2 > r.height - m) view.y -= sy2 - (r.height - m);
      if (sy1 < m) view.y += m - sy1;
      applyView();
    }
    function zoomCenter(f) { const r = svg.getBoundingClientRect(); zoomAt(r.width / 2, r.height / 2, f); }

    // ------------------------------------------------------------ keuzepaneel
    function renderPicker(q) {
      const list = picker.querySelector(".pk-list");
      const query = (q || "").toLowerCase();
      const plugItems = pluginList().filter((p) => query && (p.name.toLowerCase().includes(query) || p.category.toLowerCase().includes(query) || p.description.toLowerCase().includes(query))).slice(0, 25);
      list.innerHTML = GROUPS.map((grp) => {
        const items = Object.entries(TYPES).filter(([k, t]) => t.group === grp && (!query || t.label.toLowerCase().includes(query) || t.desc.toLowerCase().includes(query) || k.includes(query)));
        const extra = grp === "Plugins" ? plugItems.map((p) => `<button class="pk-it" data-type="connector" data-plugin="${esc(p.id)}"><span class="pk-ic plug" style="border-color:${esc(p.color || "#0e7490")};color:${esc(p.color || "#0e7490")}">${esc(p.name.replace(/[^A-Za-z0-9]/g, "").slice(0, 2))}</span><span><b>${esc(p.name)}</b><small>${esc(p.description)}</small></span></button>`).join("") : "";
        if (!items.length && !extra) return "";
        return `<div class="pk-g">${grp}${grp === "Plugins" && !query ? ` <span class="faint" style="font-weight:400">· typ een naam, bv. Slack of Google Sheets</span>` : ""}</div>` + items.map(([k, t]) => `<button class="pk-it" data-type="${k}"><span class="pk-ic" style="border-color:${t.color}"><svg viewBox="0 0 24 24" width="22" height="22">${iconSvg(k, t.color, 24, 0, 0, 1.8)}</svg></span><span><b>${t.label}</b><small>${t.desc}</small></span></button>`).join("") + extra;
      }).join("") || `<div class="empty">Geen elementen gevonden.</div>`;
    }
    function openPicker(ctx) {
      if (readonly) return;
      pickerCtx = ctx || null;
      picker.querySelector(".pk-h b").textContent = ctx && ctx.replace ? "Vervangen door…" : "Wat gebeurt er hierna?";
      picker.classList.remove("hide");
      const q = picker.querySelector(".pk-q");
      q.value = "";
      renderPicker("");
      setTimeout(() => q.focus(), 0);
    }
    function closePicker() { if (picker) picker.classList.add("hide"); pickerCtx = null; }
    if (picker) {
      picker.querySelector(".pk-q").addEventListener("input", (e) => renderPicker(e.target.value));
      picker.querySelector(".pk-q").addEventListener("keydown", (e) => {
        if (e.key === "Escape") closePicker();
        if (e.key === "Enter") { const first = picker.querySelector(".pk-it"); if (first) first.click(); }
      });
      picker.addEventListener("click", (e) => {
        const it = e.target.closest(".pk-it");
        if (it) {
          const ctx = pickerCtx;
          closePicker();
          if (ctx && ctx.replace) replaceNode(ctx.replace, it.dataset.type, it.dataset.plugin);
          else addNode(it.dataset.type, ctx, it.dataset.plugin);
        }
      });
    }

    // ------------------------------------------------------------ interactie
    root.querySelector(".pc-controls").addEventListener("click", (e) => {
      const b = e.target.closest("[data-pc]");
      if (!b) return;
      const a = b.dataset.pc;
      if (a === "fit") fit();
      if (a === "in") zoomCenter(1.2);
      if (a === "out") zoomCenter(1 / 1.2);
      if (a === "tidy") { pushHistory(); tidy(def); draw(); fit(); changed(); }
      if (a === "undo") doUndo();
    });
    const tools = root.querySelector(".pc-tools");
    if (tools) {
      tools.addEventListener("click", (e) => {
        const b = e.target.closest("[data-tool]");
        if (!b) return;
        if (b.dataset.tool === "task") openPicker(null);
        else addNode(b.dataset.tool, null);
      });
      tools.addEventListener("dragstart", (e) => {
        const b = e.target.closest("[data-tool]");
        if (b) { e.dataTransfer.setData("text/aip-tool", b.dataset.tool); e.dataTransfer.effectAllowed = "copy"; }
      });
      svg.addEventListener("dragover", (e) => { if ([...e.dataTransfer.types].includes("text/aip-tool")) { e.preventDefault(); root.classList.add("drop"); } });
      svg.addEventListener("dragleave", () => root.classList.remove("drop"));
      svg.addEventListener("drop", (e) => {
        root.classList.remove("drop");
        const tool = e.dataTransfer.getData("text/aip-tool");
        if (!tool) return;
        e.preventDefault();
        const at = toWorld(e);
        if (tool === "task") openPicker({ at });
        else addNode(tool, { at });
      });
    }
    root.addEventListener("click", (e) => {
      const b = e.target.closest("[data-pc]");
      if (!b || b.closest(".pc-controls")) return;
      if (b.dataset.pc === "add") openPicker(null);
      if (b.dataset.pc === "pk-close") closePicker();
    });

    svg.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      svg.focus({ preventScroll: true });
      const plus = e.target.closest(".plus");
      if (plus && !readonly) { openPicker({ from: plus.dataset.from, port: plus.dataset.port }); return; }
      const del = e.target.closest(".edel");
      if (del && !readonly) { removeEdge(Number(del.dataset.edge)); return; }
      const hd = e.target.closest(".hd.out");
      if (hd && !readonly) {
        drag = { kind: "connect", from: hd.closest("[data-node]").dataset.node, port: hd.dataset.port };
        svg.setPointerCapture(e.pointerId);
        return;
      }
      const gl = e.target.closest(".grp-l");
      if (gl && !readonly) {
        const gid = gl.dataset.group;
        const gr = (def.layout.groups || []).find((x) => x.id === gid);
        if (!gr) return;
        const now = Date.now();
        if (lastDown && lastDown.id === `g:${gid}` && now - lastDown.t < 400) { lastDown = null; drag = null; e.preventDefault(); setTimeout(() => startGroupRename(gid), 0); return; }
        lastDown = { id: `g:${gid}`, t: now };
        multi = new Set(gr.nodes);
        selGroup = gid;
        selected = { kind: "node", id: gr.nodes[0] };
        const w = toWorld(e);
        drag = { kind: "node", members: gr.nodes.slice(), starts: gr.nodes.map((m) => ({ id: m, ...(nodeById(m) ? nodeById(m).position : { x: 0, y: 0 }) })), wx: w.x, wy: w.y, sx: e.clientX, sy: e.clientY, moved: false, snap: JSON.stringify(def) };
        svg.setPointerCapture(e.pointerId);
        draw();
        return;
      }
      const nodeEl = e.target.closest("[data-node]");
      if (nodeEl && (e.shiftKey || e.metaKey || e.ctrlKey) && !readonly) {
        // Toevoegen aan / halen uit de selectie
        const id = nodeEl.dataset.node;
        if (!multi.size && selected && selected.kind === "node") multi.add(selected.id);
        if (multi.has(id)) multi.delete(id); else multi.add(id);
        selGroup = null;
        selected = multi.size ? { kind: "node", id: [...multi].pop() } : null;
        lastDown = null;
        draw();
        return;
      }
      if (nodeEl) {
        const id = nodeEl.dataset.node;
        // Dubbelklik zelf herkennen: draw() vervangt de DOM-elementen bij elke klik,
        // waardoor het native dblclick-event het element niet meer terugvindt.
        const now = Date.now();
        if (lastDown && lastDown.id === id && now - lastDown.t < 400) {
          lastDown = null;
          drag = null;
          if (opts.onOpenNode) opts.onOpenNode(id);
          return;
        }
        lastDown = { id, t: now };
        const w = toWorld(e);
        if (!multi.has(id)) { multi = new Set(); selGroup = null; }
        selected = { kind: "node", id };
        if (opts.onSelect) opts.onSelect(id);
        const members = multi.has(id) && multi.size > 1 ? [...multi] : [id];
        if (!readonly) drag = { kind: "node", members, starts: members.map((m) => ({ id: m, ...nodeById(m).position })), wx: w.x, wy: w.y, sx: e.clientX, sy: e.clientY, moved: false, snap: JSON.stringify(def) };
        svg.setPointerCapture(e.pointerId);
        draw();
        return;
      }
      const edgeEl = e.target.closest("[data-edge]");
      if (edgeEl && !readonly) { selected = { kind: "edge", index: Number(edgeEl.dataset.edge) }; draw(); return; }
      if (e.shiftKey && !readonly) {
        // Selectiekader
        drag = { kind: "lasso", w0: toWorld(e), sx: e.clientX, sy: e.clientY, moved: false };
        svg.setPointerCapture(e.pointerId);
        return;
      }
      drag = { kind: "pan", sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y, moved: false };
      svg.classList.add("panning");
      svg.setPointerCapture(e.pointerId);
    });
    svg.addEventListener("pointermove", (e) => {
      if (!drag) return;
      if (drag.kind === "pan" && !drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 4) return;
      if (drag.kind === "pan") {
        const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
        if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
        view.x = drag.vx + dx; view.y = drag.vy + dy;
        applyView();
      } else if (drag.kind === "node") {
        // Pas slepen na echte beweging (>4px), anders wordt een (dubbel)klik als slepen gezien.
        if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 4) return;
        const w = toWorld(e);
        const dx = snap(w.x - drag.wx), dy = snap(w.y - drag.wy);
        if (dx !== drag.ldx || dy !== drag.ldy) {
          drag.ldx = dx; drag.ldy = dy;
          drag.moved = true;
          for (const st of drag.starts) {
            const pos = { x: st.x + dx, y: st.y + dy };
            if (st.id === "start") def.layout.start = pos;
            else { const n = nodeById(st.id); if (n) n.position = pos; }
          }
          draw();
        }
      } else if (drag.kind === "lasso") {
        const w = toWorld(e);
        drag.moved = true;
        const x = Math.min(w.x, drag.w0.x), y = Math.min(w.y, drag.w0.y);
        lasso.setAttribute("x", x); lasso.setAttribute("y", y);
        lasso.setAttribute("width", Math.abs(w.x - drag.w0.x)); lasso.setAttribute("height", Math.abs(w.y - drag.w0.y));
        lasso.style.display = "";
        drag.box = { x, y, w: Math.abs(w.x - drag.w0.x), h: Math.abs(w.y - drag.w0.y) };
      } else if (drag.kind === "connect") {
        const p = outPoint(nodeById(drag.from), drag.port);
        const w = toWorld(e);
        temp.setAttribute("d", edgePath(p, p.dir, w).d);
        temp.style.display = "";
      }
    });
    function endDrag(e) {
      if (!drag) return;
      const d = drag;
      drag = null;
      svg.classList.remove("panning");
      if (d.kind === "node" && d.moved) { pushHistory(d.snap); changed(); lastDown = null; }
      if (d.kind === "lasso") {
        lasso.style.display = "none";
        if (d.box) {
          const hits = allNodes().filter((n) => {
            if (!n.position) return false;
            const g = geom(n);
            return n.position.x < d.box.x + d.box.w && n.position.x + g.w > d.box.x && n.position.y < d.box.y + d.box.h && n.position.y + g.h > d.box.y;
          }).map((n) => n.id);
          multi = new Set([...multi, ...hits]);
          selGroup = null;
          selected = multi.size ? { kind: "node", id: [...multi].pop() } : null;
          draw();
        }
      }
      if (d.kind === "pan" && !d.moved) {
        selected = null;
        multi = new Set();
        selGroup = null;
        closePicker();
        if (opts.onSelect) opts.onSelect(null);
        draw();
      }
      if (d.kind === "connect") {
        temp.style.display = "none";
        const el = document.elementFromPoint(e.clientX, e.clientY);
        const target = el && el.closest ? el.closest("[data-node]") : null;
        if (target && root.contains(target)) {
          const to = target.dataset.node;
          const tn = nodeById(to);
          if (to !== d.from && tn && geom(tn).in) addConnection(d.from, to, d.port);
        } else if (el && root.contains(el) && !el.closest(".pc-picker, .pc-controls")) {
          openPicker({ from: d.from, port: d.port, at: toWorld(e) });
        }
      }
    }
    svg.addEventListener("pointerup", endDrag);
    svg.addEventListener("pointercancel", endDrag);
    svg.addEventListener("wheel", (e) => {
      e.preventDefault();
      const r = svg.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.01));
      else { view.x -= e.deltaX; view.y -= e.deltaY; applyView(); }
    }, { passive: false });

    // ------------------------------------------------------------ acties (contextmenu + sneltoetsen)
    const stepById = (id) => def.steps.find((x) => x.id === id);
    const lastOutput = (id) => {
      const st = lastRun && lastRun.steps ? lastRun.steps.filter((x) => x.id === id && x.status === "ok").pop() : null;
      return st && st.output && typeof st.output === "object" && !st.output._truncated ? st.output : undefined;
    };
    function replaceNode(id, type, plugin) {
      const st = stepById(id);
      if (!st || !TYPES[type]) return;
      pushHistory();
      const oldPos = st.position;
      const pl = plugin ? pluginInfo(plugin) : null;
      st.type = type;
      st.name = pl ? pl.name : TYPES[type].label;
      st.config = clone(TYPES[type].def);
      if (pl) { st.config.plugin = pl.id; st.config.target = pl.id.replace(/-/g, "_"); }
      delete st.pinData;
      // positie behouden; bij een andere vorm (bv. taak -> beslissing) centreren
      st.position = oldPos;
      selected = { kind: "node", id };
      draw();
      changed();
      if (opts.onToast) opts.onToast(`Vervangen door ${TYPES[type].label}`);
    }
    function toggleDisabled(id) { toggleDisabledMany([id]); }
    function toggleDisabledMany(ids) {
      const list = ids.map(stepById).filter((st) => st && st.type !== "end");
      if (!list.length) return;
      pushHistory();
      const disable = list.some((st) => !st.disabled);
      for (const st of list) { if (disable) st.disabled = true; else delete st.disabled; }
      draw();
      changed();
      if (opts.onToast) opts.onToast(list.length === 1 ? (disable ? `"${list[0].name || list[0].id}" gedeactiveerd — wordt overgeslagen` : `"${list[0].name || list[0].id}" weer actief`) : `${list.length} stappen ${disable ? "gedeactiveerd" : "weer actief"}`);
    }
    function togglePin(id) {
      const st = stepById(id);
      if (!st) return;
      if (st.pinData) {
        pushHistory(); delete st.pinData; draw(); changed();
        if (opts.onToast) opts.onToast("Vastgezette output verwijderd");
        return;
      }
      const out = lastOutput(id);
      if (!out) { if (opts.onToast) opts.onToast("Voer het proces eerst uit; daarna kun je de output van deze stap vastzetten", true); return; }
      pushHistory(); st.pinData = clone(out); draw(); changed();
      if (opts.onToast) opts.onToast("Output vastgezet: test-runs gebruiken deze output in plaats van de stap uit te voeren");
    }
    function copyNode(id) { copyMany([id]); }
    function copyMany(ids) {
      const set = new Set(ids.filter((id) => id !== "start"));
      const steps = def.steps.filter((x) => set.has(x.id));
      if (!steps.length) return;
      CLIP = { steps: clone(steps), connections: clone(def.connections.filter((c) => set.has(c.from) && set.has(c.to))) };
      try { navigator.clipboard && navigator.clipboard.writeText(JSON.stringify(CLIP, null, 2)).catch(() => undefined); } catch { /* geen klembord */ }
      if (opts.onToast) opts.onToast(steps.length === 1 ? `"${steps[0].name || steps[0].id}" gekopieerd` : `${steps.length} stappen gekopieerd`);
    }
    // Stappen uit een klembord-object invoegen met nieuwe id's; posities verschoven.
    function insertClip(clip, at, offset, suffix) {
      if (!clip || !clip.steps.length) return;
      pushHistory();
      const xs = clip.steps.map((x) => x.position?.x ?? 0), ys = clip.steps.map((x) => x.position?.y ?? 0);
      const minX = Math.min(...xs), minY = Math.min(...ys);
      const dx = at ? at.x - minX : offset.x, dy = at ? at.y - minY : offset.y;
      const map = {};
      const added = [];
      for (const src of clip.steps) {
        const n = clone(src);
        n.id = uniqueId(n.type);
        map[src.id] = n.id;
        if (suffix) n.name = `${src.name || src.id}${suffix}`;
        delete n.pinData;
        n.position = { x: snap((src.position?.x ?? 200) + dx), y: snap((src.position?.y ?? 200) + dy) };
        def.steps.push(n);
        added.push(n.id);
      }
      for (const c of clip.connections || []) if (map[c.from] && map[c.to]) def.connections.push({ ...c, from: map[c.from], to: map[c.to] });
      multi = new Set(added.length > 1 ? added : []);
      selGroup = null;
      selected = { kind: "node", id: added[added.length - 1] };
      draw();
      ensureVisible(stepById(added[added.length - 1]));
      changed();
    }
    function pasteNode(at) {
      if (!CLIP) return;
      // Oud formaat (één stap) ondersteunen
      const clip = CLIP.steps ? CLIP : { steps: [CLIP], connections: [] };
      insertClip(clip, at, { x: 40, y: 140 });
    }
    function duplicateNode(id) { duplicateMany([id]); }
    function duplicateMany(ids) {
      const set = new Set(ids.filter((id) => id !== "start"));
      const steps = def.steps.filter((x) => set.has(x.id));
      if (!steps.length) return;
      insertClip({ steps: clone(steps), connections: clone(def.connections.filter((c) => set.has(c.from) && set.has(c.to))) }, null, { x: 40, y: 150 }, " (kopie)");
    }
    // Groepen
    function groupSelection() {
      const ids = selIds();
      if (!ids.length) return;
      pushHistory();
      def.layout.groups = def.layout.groups || [];
      let n = def.layout.groups.length + 1;
      while (def.layout.groups.some((g) => g.id === `g${n}`)) n++;
      // leden uit andere groepen halen (een element zit in één groep)
      for (const g of def.layout.groups) g.nodes = g.nodes.filter((x) => !ids.includes(x));
      def.layout.groups.push({ id: `g${n}`, label: `Groep ${n}`, nodes: ids });
      cleanupGroups();
      selGroup = `g${n}`;
      multi = new Set(ids);
      draw();
      changed();
      if (opts.onToast) opts.onToast(`Groep gemaakt met ${ids.length} element(en) — dubbelklik op de naam om te hernoemen`);
    }
    function ungroup(gid) {
      if (!def.layout.groups) return;
      pushHistory();
      def.layout.groups = def.layout.groups.filter((g) => g.id !== gid);
      cleanupGroups();
      selGroup = null;
      draw();
      changed();
    }
    function startGroupRename(gid) {
      const gr = (def.layout.groups || []).find((g) => g.id === gid);
      const b = gr && groupBox(gr);
      if (!b) return;
      const r = svg.getBoundingClientRect(), rr = root.getBoundingClientRect();
      root.querySelector(".pc-rename")?.remove();
      const inp = document.createElement("input");
      inp.className = "pc-rename f";
      inp.value = gr.label;
      inp.setAttribute("aria-label", "Naam van de groep");
      inp.style.left = `${r.left - rr.left + view.x + (b.x + 12) * view.k}px`;
      inp.style.top = `${r.top - rr.top + view.y + (b.y - 14) * view.k}px`;
      inp.style.textAlign = "left";
      root.appendChild(inp);
      inp.focus();
      inp.select();
      let done = false;
      const finish = (save) => {
        if (done) return;
        done = true;
        const v = inp.value.trim();
        inp.remove();
        if (save && v && v !== gr.label) { pushHistory(); gr.label = v; draw(); changed(); }
      };
      inp.addEventListener("keydown", (ev) => { ev.stopPropagation(); if (ev.key === "Enter") finish(true); if (ev.key === "Escape") finish(false); });
      inp.addEventListener("blur", () => finish(true));
    }
    function selectAll() {
      multi = new Set(["start", ...def.steps.map((x) => x.id)]);
      selGroup = null;
      selected = { kind: "node", id: def.steps.length ? def.steps[def.steps.length - 1].id : "start" };
      draw();
    }
    function clearSelection() { selected = null; multi = new Set(); selGroup = null; draw(); }
    function tidyAll() { pushHistory(); tidy(def); draw(); fit(); changed(); }
    function startRename(id) {
      const st = stepById(id);
      if (!st) return;
      const g = geom(st);
      const r = svg.getBoundingClientRect(), rr = root.getBoundingClientRect();
      const cx = r.left - rr.left + view.x + (st.position.x + g.w / 2) * view.k;
      const cy = r.top - rr.top + view.y + (st.position.y + (g.shape === "task" ? g.h / 2 : g.h + 12)) * view.k;
      root.querySelector(".pc-rename")?.remove();
      const inp = document.createElement("input");
      inp.className = "pc-rename f";
      inp.value = st.name || st.id;
      inp.setAttribute("aria-label", "Nieuwe naam");
      inp.style.left = `${cx - 110}px`;
      inp.style.top = `${cy - 17}px`;
      root.appendChild(inp);
      inp.focus();
      inp.select();
      let done = false;
      const finish = (save) => {
        if (done) return;
        done = true;
        const v = inp.value.trim();
        inp.remove();
        if (save && v && v !== st.name) { pushHistory(); st.name = v; draw(); changed(); }
      };
      inp.addEventListener("keydown", (ev) => { ev.stopPropagation(); if (ev.key === "Enter") finish(true); if (ev.key === "Escape") finish(false); });
      inp.addEventListener("blur", () => finish(true));
    }

    const menu = document.createElement("div");
    menu.className = "pc-menu hide";
    menu.setAttribute("role", "menu");
    // Aan <body> hangen zodat het menu niet door het canvas wordt afgesneden.
    if (!readonly) document.body.appendChild(menu);
    let menuCtx = null;
    function closeMenu() { menu.classList.add("hide"); menuCtx = null; }
    function menuItems(id, gid) {
      const kbd = (keys) => (keys || []).map((k) => `<kbd>${esc(k)}</kbd>`).join("");
      if (gid) {
        return [
          { a: "grename", label: "Groep hernoemen" },
          { a: "gselect", label: "Inhoud selecteren" },
          { a: "ungroup", label: "Groep opheffen", keys: [KEY.shift, KEY.mod, "G"] },
          "|",
          { a: "gdelete", label: "Groep en inhoud verwijderen", danger: true }
        ].map((x) => (x === "|" ? x : { ...x, kbd: kbd(x.keys) }));
      }
      const many = id && multi.has(id) && multi.size > 1;
      if (many) {
        const ids = selSteps();
        const steps = ids.map(stepById).filter(Boolean);
        return [
          { a: "mcopy", label: `Kopiëren (${steps.length})`, keys: [KEY.mod, "C"] },
          { a: "mdup", label: "Dupliceren", keys: [KEY.mod, "D"] },
          { a: "mtoggle", label: steps.some((x) => !x.disabled) ? "Deactiveren" : "Activeren", keys: ["D"] },
          "|",
          { a: "tidy", label: "Proces opruimen", keys: [KEY.shift, KEY.alt, "T"] },
          "|",
          { a: "msub", label: "Omzetten naar subproces", keys: [KEY.alt, "X"], disabled: !steps.length || !opts.onConvertToSubprocess },
          { a: "group", label: "Groeperen", keys: [KEY.mod, "G"] },
          "|",
          { a: "selectall", label: "Alles selecteren", keys: [KEY.mod, "A"] },
          { a: "clear", label: "Selectie opheffen" },
          "|",
          { a: "mdelete", label: `Verwijderen (${steps.length})`, keys: ["Del"], danger: true }
        ].map((x) => (x === "|" ? x : { ...x, kbd: kbd(x.keys) }));
      }
      if (!id) {
        return [
          { a: "add", label: "Element toevoegen…" },
          { a: "paste", label: "Plakken", keys: [KEY.mod, "V"], disabled: !CLIP },
          "|",
          { a: "tidy", label: "Proces opruimen", keys: [KEY.shift, KEY.alt, "T"] },
          "|",
          { a: "selectall", label: "Alles selecteren", keys: [KEY.mod, "A"] },
          { a: "clear", label: "Selectie opheffen", disabled: !selected && !multi.size }
        ].map((x) => (x === "|" ? x : { ...x, kbd: kbd(x.keys) }));
      }
      if (id === "start") {
        return [
          { a: "chat", label: "Aan chat toevoegen", keys: [KEY.alt, "I"], icon: "✦" },
          "|",
          { a: "open", label: "Openen…", keys: ["↵"] },
          { a: "trigger", label: "Trigger wijzigen…" },
          "|",
          { a: "tidy", label: "Proces opruimen", keys: [KEY.shift, KEY.alt, "T"] },
          "|",
          { a: "clear", label: "Selectie opheffen" }
        ].map((x) => (x === "|" ? x : { ...x, kbd: kbd(x.keys) }));
      }
      const st = stepById(id);
      const isEnd = st.type === "end";
      return [
        { a: "chat", label: "Aan chat toevoegen", keys: [KEY.alt, "I"], icon: "✦" },
        "|",
        { a: "open", label: "Openen…", keys: ["↵"] },
        { a: "exec", label: "Stap uitvoeren", disabled: isEnd },
        { a: "rename", label: "Hernoemen", keys: ["Spatie"] },
        { a: "replace", label: "Vervangen", keys: ["R"], disabled: isEnd },
        { a: "toggle", label: st.disabled ? "Activeren" : "Deactiveren", keys: ["D"], disabled: isEnd },
        { a: "pin", label: st.pinData ? "Losmaken" : "Vastzetten", keys: ["P"], disabled: isEnd || (!st.pinData && !lastOutput(id)), title: !st.pinData && !lastOutput(id) ? "Voer het proces eerst uit om output te kunnen vastzetten" : "" },
        { a: "copy", label: "Kopiëren", keys: [KEY.mod, "C"] },
        { a: "dup", label: "Dupliceren", keys: [KEY.mod, "D"] },
        "|",
        { a: "tidy", label: "Proces opruimen", keys: [KEY.shift, KEY.alt, "T"] },
        "|",
        { a: "sub", label: "Omzetten naar subproces", keys: [KEY.alt, "X"], disabled: isEnd || st.type === "branch" || st.type === "subprocess" || !opts.onConvertToSubprocess },
        { a: "group", label: "Groeperen", keys: [KEY.mod, "G"] },
        "|",
        { a: "selectall", label: "Alles selecteren", keys: [KEY.mod, "A"] },
        { a: "clear", label: "Selectie opheffen" },
        "|",
        { a: "delete", label: "Verwijderen", keys: ["Del"], danger: true }
      ].map((x) => (x === "|" ? x : { ...x, kbd: kbd(x.keys) }));
    }
    function openMenu(e, id, gid) {
      menuCtx = { id, gid, at: toWorld(e) };
      menu.innerHTML = menuItems(id, gid).map((x) => x === "|" ? '<div class="sep" role="separator"></div>'
        : `<button type="button" role="menuitem" class="mi ${x.danger ? "danger" : ""}" data-mi="${x.a}" ${x.disabled ? "disabled" : ""} ${x.title ? `title="${esc(x.title)}"` : ""}>${x.icon ? `<span class="mi-ic">${x.icon}</span>` : ""}<span class="mi-l">${esc(x.label)}</span><span class="mi-k">${x.kbd}</span></button>`).join("");
      menu.classList.remove("hide");
      const mw = menu.offsetWidth, mh = Math.min(menu.scrollHeight, window.innerHeight - 16);
      let x = e.clientX, y = e.clientY;
      if (x + mw > window.innerWidth - 8) x = Math.max(8, x - mw);
      if (y + mh > window.innerHeight - 8) y = Math.max(8, window.innerHeight - mh - 8);
      menu.style.left = `${x}px`;
      menu.style.top = `${y}px`;
      const first = menu.querySelector(".mi:not([disabled])");
      if (first) first.focus({ preventScroll: true });
    }
    function runAction(a, id, at, gid) {
      switch (a) {
        case "grename": startGroupRename(gid); break;
        case "gselect": { const gr = (def.layout.groups || []).find((g) => g.id === gid); if (gr) { multi = new Set(gr.nodes); selGroup = gid; selected = { kind: "node", id: gr.nodes[0] }; draw(); } break; }
        case "ungroup": ungroup(gid); break;
        case "gdelete": { const gr = (def.layout.groups || []).find((g) => g.id === gid); if (gr) deleteMany(gr.nodes); break; }
        case "mcopy": copyMany(selSteps()); break;
        case "mdup": duplicateMany(selSteps()); break;
        case "mtoggle": toggleDisabledMany(selSteps()); break;
        case "msub": if (opts.onConvertToSubprocess) opts.onConvertToSubprocess(selSteps()); break;
        case "mdelete": deleteMany(selSteps()); break;
        case "group": groupSelection(); break;
        case "selectall": selectAll(); break;
        case "chat": if (opts.onAddToChat) opts.onAddToChat(id, id === "start" ? "startevent" : stepById(id)?.name || id); break;
        case "open": if (opts.onOpenNode) opts.onOpenNode(id); break;
        case "exec": if (opts.onExecuteStep) opts.onExecuteStep(id); break;
        case "rename": startRename(id); break;
        case "replace": openPicker({ replace: id }); break;
        case "toggle": toggleDisabled(id); break;
        case "pin": togglePin(id); break;
        case "copy": copyNode(id); break;
        case "dup": duplicateNode(id); break;
        case "tidy": tidyAll(); break;
        case "sub": if (opts.onConvertToSubprocess) opts.onConvertToSubprocess(id); break;
        case "clear": clearSelection(); break;
        case "delete": deleteNode(id); break;
        case "add": openPicker({ at }); break;
        case "paste": pasteNode(at); break;
        case "trigger": if (opts.onChooseTrigger) opts.onChooseTrigger(); break;
      }
    }
    if (!readonly) {
      svg.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        closePicker();
        const glab = e.target.closest(".grp-l");
        if (glab) { selGroup = glab.dataset.group; draw(); openMenu(e, null, glab.dataset.group); return; }
        const nodeEl = e.target.closest("[data-node]");
        const id = nodeEl ? nodeEl.dataset.node : null;
        if (id && !multi.has(id)) { multi = new Set(); selGroup = null; }
        if (id) { selected = { kind: "node", id }; draw(); }
        openMenu(e, id);
      });
      menu.addEventListener("click", (e) => {
        const b = e.target.closest("[data-mi]");
        if (!b || b.disabled) return;
        const ctx = menuCtx;
        closeMenu();
        runAction(b.dataset.mi, ctx.id, ctx.at, ctx.gid);
      });
      menu.addEventListener("keydown", (e) => {
        const items = [...menu.querySelectorAll(".mi:not([disabled])")];
        const i = items.indexOf(document.activeElement);
        if (e.key === "ArrowDown") { e.preventDefault(); items[(i + 1) % items.length]?.focus(); }
        if (e.key === "ArrowUp") { e.preventDefault(); items[(i - 1 + items.length) % items.length]?.focus(); }
        if (e.key === "Escape") { e.preventDefault(); closeMenu(); }
      });
      root._outside = (e) => { if (!menu.classList.contains("hide") && !menu.contains(e.target)) closeMenu(); };
      document.addEventListener("pointerdown", root._outside, true);
      svg.addEventListener("wheel", () => closeMenu(), { passive: true });
    }

    function onKey(e) {
      if (readonly || !root.isConnected) return;
      if (e.target && e.target.closest && e.target.closest("input, textarea, select, [contenteditable]")) return;
      if (document.querySelector(".ndv")) return;
      const modal = document.getElementById("modal");
      if (modal && !modal.classList.contains("hide")) return;
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      if (mod && key === "z") { e.preventDefault(); e.shiftKey ? doRedo() : doUndo(); }
      else if (mod && key === "y") { e.preventDefault(); doRedo(); }
      else if ((e.key === "Delete" || e.key === "Backspace") && (selected || multi.size || selGroup)) { e.preventDefault(); deleteSelected(); }
      else if (e.key === "Enter" && selected && selected.kind === "node" && opts.onOpenNode) opts.onOpenNode(selected.id);
      else if (e.key === "Escape") { closeMenu(); closePicker(); clearSelection(); }
      else {
        const selId = selected && selected.kind === "node" ? selected.id : null;
        const isStep = selId && selId !== "start";
        const code = e.code;
        const many = multi.size > 1;
        if (mod && !e.shiftKey && !e.altKey && key === "a") { e.preventDefault(); selectAll(); }
        else if (mod && e.shiftKey && !e.altKey && key === "g" && selGroup) { e.preventDefault(); ungroup(selGroup); }
        else if (mod && !e.shiftKey && !e.altKey && key === "g" && (many || selId)) { e.preventDefault(); groupSelection(); }
        else if (mod && !e.shiftKey && !e.altKey && key === "c" && (many || isStep)) { e.preventDefault(); copyMany(selSteps()); }
        else if (mod && !e.shiftKey && !e.altKey && key === "v" && CLIP) { e.preventDefault(); pasteNode(null); }
        else if (mod && !e.shiftKey && !e.altKey && key === "d" && (many || isStep)) { e.preventDefault(); duplicateMany(selSteps()); }
        else if (e.shiftKey && e.altKey && !mod && code === "KeyT") { e.preventDefault(); tidyAll(); }
        else if (e.altKey && !mod && !e.shiftKey && code === "KeyX" && (many || isStep) && opts.onConvertToSubprocess) { e.preventDefault(); opts.onConvertToSubprocess(many ? selSteps() : selId); }
        else if (!mod && !e.altKey && many && key === "d") { e.preventDefault(); toggleDisabledMany(selSteps()); }
        else if (e.altKey && !mod && !e.shiftKey && code === "KeyI" && selId && opts.onAddToChat) { e.preventDefault(); runAction("chat", selId); }
        else if (!mod && !e.altKey && isStep && e.key === " ") { e.preventDefault(); startRename(selId); }
        else if (!mod && !e.altKey && isStep && key === "r") { e.preventDefault(); openPicker({ replace: selId }); }
        else if (!mod && !e.altKey && isStep && key === "d") { e.preventDefault(); toggleDisabled(selId); }
        else if (!mod && !e.altKey && isStep && key === "p") { e.preventDefault(); togglePin(selId); }
      }
    }
    document.addEventListener("keydown", onKey);
    const ro = new ResizeObserver(() => applyView());
    ro.observe(svg);

    applyView();
    draw();

    return {
      fit,
      redraw: draw,
      openPicker,
      pushHistory,
      deleteNode,
      setRun(run) { lastRun = run || null; runState = computeRunState(run); draw(); },
      undo: doUndo,
      flash(ids) {
        flashIds = new Set(ids);
        draw();
        clearTimeout(this._ft);
        this._ft = setTimeout(() => { flashIds = new Set(); draw(); }, 2400);
      },
      select(id) { multi = new Set(); selGroup = null; selected = id ? { kind: "node", id } : null; draw(); },
      destroy() { menu.remove(); document.removeEventListener("keydown", onKey); if (root._outside) document.removeEventListener("pointerdown", root._outside, true); ro.disconnect(); }
    };
  }

  // ---------------------------------------------------------------- detailvenster (NDV)
  function jsonBlock(v) {
    return `<pre class="code ndv-json">${esc(JSON.stringify(v, null, 2))}</pre>`;
  }

  // Data-weergaven voor INPUT/OUTPUT: Schema, Tabel en JSON. Elk veld draagt zijn pad
  // (data-path) en is sleepbaar naar een invulveld; daar wordt het {{pad}}.
  const DATA_VIEWS = [["schema", "Schema"], ["table", "Tabel"], ["json", "JSON"]];
  const TYPE_IC = { string: "T", number: "#", boolean: "☑", array: "[ ]", object: "{ }", null: "∅" };
  const typeOf = (v) => (v === null || v === undefined ? "null" : Array.isArray(v) ? "array" : typeof v === "object" ? "object" : typeof v);
  const joinPath = (base, k) => (typeof k === "number" ? `${base}[${k}]` : base ? `${base}.${k}` : String(k));
  function getPathC(obj, path) {
    const p = String(path).trim().replace(/^\$json\.?/, "").replace(/\[(\d+)\]/g, ".$1").replace(/^\./, "");
    if (!p) return obj;
    return p.split(".").reduce((a, k) => (a && typeof a === "object" ? a[k] : undefined), obj);
  }
  // Zelfde regels als de engine (tpl/deepTpl): een veld dat alleen uit één {{expressie}} bestaat behoudt het type.
  function previewTpl(str, data) {
    const special = (e) => (e === "$now" ? new Date().toISOString() : e === "$date" ? new Date().toISOString().slice(0, 10) : e === "$env" ? "dev" : e === "$uuid" ? "(uuid)" : undefined);
    const whole = str.match(/^\s*\{\{\s*([^}]+?)\s*\}\}\s*$/);
    if (whole) { const s = special(whole[1]); return s !== undefined ? s : getPathC(data, whole[1]); }
    return str.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_m, e) => {
      const s = special(e);
      if (s !== undefined) return s;
      const v = getPathC(data, e);
      return v === undefined || v === null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
    });
  }
  function shortVal(v, max = 80) {
    const t = typeOf(v);
    const s = t === "string" ? v : t === "array" ? `[${v.length} items]` : t === "object" ? `{${Object.keys(v).length} velden}` : String(v);
    return s.length > max ? s.slice(0, max) + "…" : s;
  }
  const fieldChip = (path, label, t) => `<span class="dk" draggable="true" data-path="${esc(path)}" title="Sleep naar een invulveld of klik om {{${esc(path)}}} in te voegen"><i>${esc(TYPE_IC[t] || "T")}</i>${esc(label)}</span>`;
  function schemaHtml(v, base = "", depth = 0) {
    const t = typeOf(v);
    if (t !== "object" && t !== "array") return "";
    const entries = t === "array" ? (v.length ? [[0, v[0]]] : []) : Object.entries(v);
    if (!entries.length) return `<div class="sch-e" style="--d:${depth}">${t === "array" ? "lege lijst" : "leeg object"}</div>`;
    return entries.map(([k, val]) => {
      const p = joinPath(base, k);
      const vt = typeOf(val);
      const label = typeof k === "number" ? `${base.split(".").pop() || "item"}[0]` : k;
      const nested = vt === "object" || vt === "array";
      const meta = vt === "array" ? `<span class="sch-m">${val.length} item${val.length === 1 ? "" : "s"}</span>` : "";
      if (nested) {
        return `<details class="sch-n" open><summary style="--d:${depth}"><span class="sch-c">▾</span>${fieldChip(p, label, vt)}${meta}</summary>${schemaHtml(val, p, depth + 1)}</details>`;
      }
      return `<div class="sch-r" style="--d:${depth}">${fieldChip(p, label, vt)}<span class="sch-v ${vt}">${esc(shortVal(val, 140))}</span></div>`;
    }).join("") + (t === "array" && v.length > 1 ? `<div class="sch-e" style="--d:${depth}">schema van het eerste item · ${v.length} items in totaal</div>` : "");
  }
  function tableHtml(v) {
    const t = typeOf(v);
    if (t !== "object" && t !== "array") return `<div class="empty">${esc(shortVal(v))}</div>`;
    // Eén lijst met records in het bericht (bijv. {data:[...]}) als rijen tonen.
    let rows, base;
    if (t === "array") { rows = v; base = ""; }
    else {
      const lists = Object.entries(v).filter(([, x]) => Array.isArray(x) && x.length && x.every((r) => typeOf(r) === "object"));
      if (lists.length === 1 && Object.keys(v).length === 1) { rows = lists[0][1]; base = lists[0][0]; }
      else { rows = [v]; base = null; }
    }
    if (!rows.length) return `<div class="empty">Geen rijen.</div>`;
    const objRows = rows.every((r) => typeOf(r) === "object");
    const cols = objRows ? [...new Set(rows.flatMap((r) => Object.keys(r)))].slice(0, 50) : ["waarde"];
    const pathOf = (i, c) => (base === null ? c : joinPath(joinPath(base, i), objRows ? c : undefined).replace(/\.undefined$/, ""));
    const shown = rows.slice(0, 200);
    return `<div class="dt-wrap"><table class="dt"><thead><tr>${base !== null ? "<th>#</th>" : ""}${cols.map((c) => `<th>${fieldChip(pathOf(0, c), c, typeOf(objRows ? rows[0][c] : rows[0]))}</th>`).join("")}</tr></thead>
      <tbody>${shown.map((r, i) => `<tr>${base !== null ? `<td class="faint">${i}</td>` : ""}${cols.map((c) => { const x = objRows ? r[c] : r; return `<td class="${typeOf(x)}" data-path="${esc(pathOf(i, c))}" draggable="true" title="${esc(typeof x === "object" && x !== null ? JSON.stringify(x) : String(x ?? ""))}">${esc(x === undefined ? "" : shortVal(x, 60))}</td>`; }).join("")}</tr>`).join("")}</tbody></table></div>
      ${rows.length > shown.length ? `<div class="sch-e">… en nog ${rows.length - shown.length} rijen</div>` : ""}`;
  }
  function jsonHtml(v, base = "", ind = 0) {
    const t = typeOf(v);
    if (t === "string") return `<span class="js">${esc(JSON.stringify(v))}</span>`;
    if (t === "number") return `<span class="jn">${v}</span>`;
    if (t === "boolean" || t === "null") return `<span class="jb">${v === undefined ? "null" : String(v)}</span>`;
    const arr = t === "array";
    const all = arr ? v.map((x, i) => [i, x]) : Object.entries(v);
    if (!all.length) return arr ? "[]" : "{}";
    const ents = all.slice(0, 300);
    const pad = "  ".repeat(ind);
    const inner = ents.map(([k, x], i) => `${pad}  ${arr ? "" : `<span class="jk" draggable="true" data-path="${esc(joinPath(base, k))}">${esc(JSON.stringify(k))}</span>: `}${jsonHtml(x, joinPath(base, k), ind + 1)}${i < ents.length - 1 || all.length > ents.length ? "," : ""}`).join("\n");
    const more = all.length > ents.length ? `\n${pad}  <span class="faint">… nog ${all.length - ents.length}</span>` : "";
    return `${arr ? "[" : "{"}\n${inner}${more}\n${pad}${arr ? "]" : "}"}`;
  }
  function dataViewHtml(view, v) {
    if (view === "table") return tableHtml(v);
    if (view === "json") return `<pre class="code ndv-json dj">${jsonHtml(v)}</pre>`;
    const t = typeOf(v);
    return t === "object" || t === "array" ? `<div class="sch">${schemaHtml(v)}</div>` : `<pre class="code ndv-json">${esc(JSON.stringify(v))}</pre>`;
  }
  const itemCount = (v) => (Array.isArray(v) ? `${v.length} item${v.length === 1 ? "" : "s"}` : "1 item");
  const viewSeg = (side, cur) => `<div class="seg ndv-seg" role="tablist" aria-label="Weergave ${side}">${DATA_VIEWS.map(([k, l]) => `<button type="button" data-view="${side}:${k}" class="${cur === k ? "on" : ""}" aria-pressed="${cur === k}">${l}</button>`).join("")}</div>`;
  function lsGet(k, d) { try { return localStorage.getItem(k) || d; } catch { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch { /* geen opslag */ } }
  function parseVal(v) {
    const s = String(v).trim();
    if (s === "") return "";
    if (s.includes("{{")) return s;
    try { return JSON.parse(s); } catch { return s; }
  }

  // ---------- formulierbouwstenen (data-k = configsleutel, data-t = type) ----------
  let fid = 0;
  const hintHtml = (h) => (h ? `<div class="hint">${h}</div>` : "");
  const opt = (o) => (Array.isArray(o) ? o : [o, o]);
  const F = {
    text: (k, label, v, ph = "", hint = "") => { const id = `f${++fid}`; return `<label for="${id}">${label}</label><input class="f" id="${id}" data-k="${k}" value="${esc(v ?? "")}" placeholder="${esc(ph)}">${hintHtml(hint)}`; },
    num: (k, label, v, hint = "") => { const id = `f${++fid}`; return `<label for="${id}">${label}</label><input class="f" id="${id}" type="number" data-k="${k}" data-t="num" value="${esc(v ?? "")}">${hintHtml(hint)}`; },
    select: (k, label, v, options, hint = "", rerender = false) => { const id = `f${++fid}`; return `<label for="${id}">${label}</label><select class="f" id="${id}" data-k="${k}" ${rerender ? "data-rerender" : ""}>${options.map(opt).map(([val, lab]) => `<option value="${esc(val)}" ${String(v ?? "") === String(val) ? "selected" : ""}>${esc(lab)}</option>`).join("")}</select>${hintHtml(hint)}`; },
    area: (k, label, v, ph = "", hint = "", cls = "") => { const id = `f${++fid}`; return `<label for="${id}">${label}</label><textarea class="f ${cls}" id="${id}" data-k="${k}" data-t="raw" placeholder="${esc(ph)}">${esc(v ?? "")}</textarea>${hintHtml(hint)}`; },
    lines: (k, label, arr, ph = "", hint = "") => { const id = `f${++fid}`; return `<label for="${id}">${label}</label><textarea class="f" id="${id}" data-k="${k}" data-t="lines" placeholder="${esc(ph)}">${esc((arr || []).join("\n"))}</textarea>${hintHtml(hint)}`; },
    json: (k, label, obj, hint = "") => { const id = `f${++fid}`; return `<label for="${id}">${label}</label><textarea class="f" id="${id}" data-k="${k}" data-t="json">${esc(JSON.stringify(obj ?? {}, null, 2))}</textarea>${hintHtml(hint)}`; },
    check: (k, label, v, hint = "") => { const id = `f${++fid}`; return `<label class="chk" for="${id}"><input type="checkbox" id="${id}" data-k="${k}" data-t="bool" ${v ? "checked" : ""}> ${label}</label>${hintHtml(hint)}`; },
    cred: (label, v, types, ctx, hint = "") => {
      const list = (ctx.credentials || []).filter((c) => types.includes(c.type));
      const id = `f${++fid}`;
      return `<label for="${id}">${label}</label><select class="f" id="${id}" data-k="credential"><option value="">— geen —</option>${list.map((c) => `<option value="${esc(c.name)}" ${v === c.name ? "selected" : ""}>${esc(c.name)} (${esc(c.type)}${c.envs && c.envs.length ? " · " + c.envs.join("/") : ""})</option>`).join("")}${v && !list.some((c) => c.name === v) ? `<option value="${esc(v)}" selected>${esc(v)} (onbekend)</option>` : ""}</select>${hintHtml(hint || (list.length ? "" : `Nog geen koppeling van type ${types.join("/")}. Maak er een aan onder Beheer → Koppelingen.`))}`;
    },
    rows: (k, label, obj, left, right, arrow, hint = "") => {
      const entries = Object.entries(obj || {});
      const rows = (entries.length ? entries : [["", ""]]).map(([a, b]) => `<div class="kvr"><input class="f" placeholder="${left}" value="${esc(a)}"><span class="kva">${arrow}</span><input class="f" placeholder="${right}" value="${esc(typeof b === "string" ? b : JSON.stringify(b))}"><button class="x" data-delrow aria-label="Rij verwijderen">×</button></div>`).join("");
      return `<label>${label}</label><div class="rows" data-k="${k}">${rows}</div><div class="ndv-drop" data-drop="${k}">Sleep invoervelden hierheen of <button type="button" class="lnk" data-addrow="${k}" data-l="${left}" data-r="${right}" data-a="${arrow}">+ Rij toevoegen</button></div>${hintHtml(hint)}`;
    },
    conds: (k, label, list, columns, hint = "") => {
      const ops = [["eq", "is gelijk aan"], ["ne", "is niet"], ["gt", ">"], ["gte", "≥"], ["lt", "<"], ["lte", "≤"], ["contains", "bevat"], ["empty", "is leeg"], ["notEmpty", "is niet leeg"]];
      const row = (c) => `<div class="cdr"><input class="f" list="cols-${k}" placeholder="kolom" value="${esc(c.column || "")}"><select class="f">${ops.map(([v, l]) => `<option value="${v}" ${(c.op || "eq") === v ? "selected" : ""}>${l}</option>`).join("")}</select><input class="f" placeholder="waarde of {{veld}}" value="${esc(c.value ?? "")}"><button class="x" data-delcond aria-label="Voorwaarde verwijderen">×</button></div>`;
      return `<label>${label}</label><datalist id="cols-${k}">${(columns || []).map((c) => `<option value="${esc(c)}">`).join("")}</datalist><div class="conds" data-k="${k}">${(list && list.length ? list : [{}]).map(row).join("")}</div><button class="btn sm sec" data-addcond="${k}">+ Voorwaarde</button>${hintHtml(hint)}`;
    }
  };
  const FORMATS = [["text", "tekst"], ["json", "JSON"], ["csv", "CSV"], ["xml", "XML"]];
  const TPL_HINT = "Gebruik <code>{{veld}}</code> voor waarden uit het bericht, en <code>{{$now}}</code>, <code>{{$date}}</code>, <code>{{$uuid}}</code>.";

  // Formulier van de stap "connector": plugin -> operatie -> koppeling -> parameters.
  function connectorForm(c, ctx) {
    const list = pluginList();
    const def = c.plugin ? (window.AIP_PLUGIN_DEFS || {})[c.plugin] : null;
    let html = `<label for="cn-plugin">Plugin</label><select class="f" id="cn-plugin" data-k="plugin" data-rerender><option value="">— kies een plugin —</option>${list.map((p) => `<option value="${esc(p.id)}" ${p.id === c.plugin ? "selected" : ""}>${esc(p.name)} · ${esc(p.category)}</option>`).join("")}</select>`;
    if (!c.plugin) return html + hintHtml("Alle connectors staan op de pagina Plugins.");
    if (!def) { if (ctx.loadPlugin) ctx.loadPlugin(c.plugin); return html + `<div class="hint">Definitie laden…</div>`; }
    const groups = [...new Set(def.operations.map((o) => o.resource))];
    html += `<label for="cn-op">Operatie</label><select class="f" id="cn-op" data-k="operation" data-rerender><option value="">— kies een operatie —</option>${groups.map((g) => `<optgroup label="${esc(g)}">${def.operations.filter((o) => o.resource === g).map((o) => `<option value="${esc(o.id)}" ${o.id === c.operation ? "selected" : ""}>${esc(o.label)}</option>`).join("")}</optgroup>`).join("")}</select>`;
    if (def.auth.type !== "none") {
      const creds = (ctx.credentials || []).filter((x) => (x.type === "plugin" && x.plugin === def.id) || (def.auth.type === "bearer" && x.type === "http-bearer"));
      html += `<label for="cn-cred">Koppeling</label><select class="f" id="cn-cred" data-k="credential"><option value="">— geen —</option>${creds.map((x) => `<option value="${esc(x.name)}" ${x.name === c.credential ? "selected" : ""}>${esc(x.name)}${x.envs && x.envs.length ? " · " + x.envs.join("/") : ""}</option>`).join("")}${c.credential && !creds.some((x) => x.name === c.credential) ? `<option value="${esc(c.credential)}" selected>${esc(c.credential)} (onbekend)</option>` : ""}</select>
        ${hintHtml(creds.length ? "Per omgeving eigen waarden (DEV/TEST/ACC/PROD)." : `Nog geen ${esc(def.name)}-koppeling. Maak er een op de pagina Plugins → ${esc(def.name)}.`)}`;
    }
    const op = def.operations.find((o) => o.id === c.operation);
    if (!op) return html;
    if (op.description) html += hintHtml(op.description);
    const pv = c.params || {};
    for (const p of op.params || []) {
      const k = `params.${p.name}`;
      const label = `${esc(p.label)}${p.required ? ' <span class="req">*</span>' : ""}`;
      const val = pv[p.name] !== undefined ? (typeof pv[p.name] === "object" ? JSON.stringify(pv[p.name], null, 2) : pv[p.name]) : "";
      const ph = p.placeholder || (p.default !== undefined ? (typeof p.default === "object" ? JSON.stringify(p.default) : String(p.default)) : "");
      const hint = [p.help, p.format === "list" ? "Komma-gescheiden" : "", p.type === "json" ? "JSON; {{templates}} mogen" : ""].filter(Boolean).join(" · ");
      if (p.options) html += F.select(k, label, val || (p.default ?? ""), [["", p.default !== undefined ? `(standaard: ${p.default})` : "—"], ...p.options.map((o) => [o, o])], hint);
      else if (p.type === "json" || p.type === "text") html += F.area(k, label, val, ph, hint, p.type === "json" ? "mono" : "");
      else html += F.text(k, label, val, ph, hint);
    }
    html += F.text("target", "Resultaat opslaan in veld", c.target, def.id.replace(/-/g, "_"));
    return html;
  }
  // Na uitlezen: "params.x"-velden samenvoegen tot config.params.
  function normalizeConnector(cfg) {
    const params = {};
    for (const k of Object.keys(cfg)) if (k.startsWith("params.")) { const v = cfg[k]; if (v !== "" && v !== undefined) params[k.slice(7)] = v; delete cfg[k]; }
    cfg.params = params;
    return cfg;
  }

  function formHtml(step, ctx) {
    const c = step.config || {};
    switch (step.type) {
      case "validate":
        return F.lines("required", "Verplichte velden", c.required, "orderId\ncustomer.email", "Eén veld per regel; punten voor geneste velden. Ontbreekt of leeg → de stap faalt.");
      case "transform":
        return F.rows("mapping", "Mapping", c.mapping, "doelveld", "bron.pad of {{template}}", "←", "Doelveld krijgt de waarde van het bronpad. Punten in het doelveld maken geneste objecten. Velden die je niet mapt blijven behouden.");
      case "enrich":
        return F.rows("set", "Velden instellen", c.set, "veld", "waarde", "=", "Waarden als JSON waar mogelijk (42, true). " + TPL_HINT);
      case "duplicate-check":
        return F.text("key", "Sleutelveld", c.key, "orderId", "Berichten met een sleutel die al voorbijkwam (binnen deze uitvoering) worden tegengehouden.");
      case "csv":
        return F.select("mode", "Modus", c.mode, [["parse", "CSV lezen → records"], ["generate", "records → CSV maken"]], "", true) +
          F.text("field", "Bronveld", c.field, c.mode === "generate" ? "records" : "content") + F.text("target", "Doelveld", c.target, c.mode === "generate" ? "csv" : "records") +
          F.text("delimiter", "Scheidingsteken", c.delimiter, ",") + F.check("header", "Eerste regel bevat kolomnamen", c.header !== false);
      case "xml":
        return F.select("mode", "Modus", c.mode, [["parse", "XML lezen → object"], ["build", "object → XML maken"]], "", true) +
          F.text("field", "Bronveld", c.field, c.mode === "build" ? "data" : "content") + F.text("target", "Doelveld", c.target, c.mode === "build" ? "xml" : "data") +
          (c.mode === "build" ? F.text("root", "Root-element", c.root, "orders") : "");
      case "call":
        return F.select("method", "Methode", c.method || "GET", ["GET", "POST", "PUT", "PATCH", "DELETE"], "", true) +
          F.text("url", "URL", c.url, "https://api.voorbeeld.nl/orders/{{orderId}}", "Leeg = gesimuleerde aanroep (handig op DEV). " + TPL_HINT) +
          F.cred("Authenticatie", c.credential, ["http-basic", "http-bearer", "api-key", "generic"], ctx, "Koppeling met per omgeving andere gegevens. Leeg = geen authenticatie.") +
          F.rows("headers", "Headers", c.headers, "naam", "waarde", ":") + F.rows("query", "Queryparameters", c.query, "naam", "waarde", "=") +
          (["GET", "DELETE"].includes(c.method || "GET") ? "" : F.select("body", "Body", c.body || "payload", [["payload", "het hele bericht"], ["field", "één veld"], ["custom", "eigen JSON"], ["none", "geen body"]], "", true) +
            (c.body === "field" ? F.text("bodyField", "Veld als body", c.bodyField, "order") : "") + (c.body === "custom" ? F.json("bodyTemplate", "Body (JSON met templates)", c.bodyTemplate) : "")) +
          F.text("target", "Antwoord opslaan in veld", c.target, "response") + F.num("timeoutMs", "Timeout (ms)", c.timeoutMs ?? 30000) +
          F.check("failOnError", "Fout bij HTTP-status ≥ 400", c.failOnError !== false);
      case "code":
        return F.area("code", "JavaScript", c.code, "return { ...input, klaar: true };", "<code>input</code> (of <code>$json</code>) is het bericht; geef het nieuwe bericht terug. <code>console.log()</code> komt in <code>_logs</code>. Maximaal 2 seconden.", "codearea");
      case "delay":
        return F.num("ms", "Wachttijd (ms)", c.ms ?? 1000, "Maximaal 60000 ms.");
      case "subprocess":
        return F.select("process", "Proces", c.process, [["", "— kies een proces —"], ...(ctx.processes || []).map((n) => [n, n])], "Voert de actieve versie uit op dezelfde omgeving als dit proces.") +
          F.text("inputField", "Invoer uit veld (optioneel)", c.inputField, "order", "Leeg = het hele bericht.") + F.text("target", "Uitkomst opslaan in veld", c.target, "subprocess");
      case "file":
      case "ftp": {
        const isFtp = step.type === "ftp";
        const ops = isFtp ? [["download", "downloaden"], ["upload", "uploaden"], ["list", "lijst"], ["move", "verplaatsen"], ["delete", "verwijderen"]] : [["read", "lezen"], ["write", "schrijven"], ["list", "lijst"], ["move", "verplaatsen"], ["delete", "verwijderen"]];
        const op = c.operation || (isFtp ? "upload" : "write");
        const writes = op === "write" || op === "upload";
        return (isFtp ? F.cred("Server (koppeling)", c.credential, ["ftp", "ftps", "sftp"], ctx) : "") +
          F.select("operation", "Operatie", op, ops, "", true) +
          F.text("path", op === "list" ? "Map" : "Pad", c.path, isFtp ? "/in/order-{{orderId}}.json" : "uit/order-{{orderId}}.json", (isFtp ? "" : "Relatief binnen de bestandsmap van de omgeving. ") + TPL_HINT) +
          (op === "list" ? F.text("pattern", "Patroon", c.pattern, "*.csv") : "") +
          (op === "move" ? F.text("toPath", "Naar", c.toPath, "archief/{{file.name}}") : "") +
          (["read", "download", "write", "upload"].includes(op) ? F.select("format", "Formaat", c.format || "text", FORMATS) : "") +
          (writes ? F.text("contentField", "Inhoud uit veld (optioneel)", c.contentField, "records", "Leeg = het hele bericht.") : "") +
          F.text("target", "Resultaat opslaan in veld", c.target, op === "list" ? "files" : "file");
      }
      case "queue-publish":
        return F.text("queue", "Queue", c.queue, "orders", `Queue op dezelfde omgeving. ${(ctx.queues || []).length ? "Bestaand: " + ctx.queues.map(esc).join(", ") + "." : ""}`) +
          F.text("bodyField", "Bericht uit veld (optioneel)", c.bodyField, "order", "Leeg = het hele bericht.");
      case "queue-get":
        return F.text("queue", "Queue", c.queue, "orders", (ctx.queues || []).length ? "Bestaand: " + ctx.queues.map(esc).join(", ") : "") +
          F.num("max", "Maximaal aantal berichten", c.max ?? 1, "1 = één bericht (object), meer = lijst.") + F.check("failIfEmpty", "Fout als de queue leeg is", c.failIfEmpty) +
          F.text("target", "Opslaan in veld", c.target, "messages");
      case "datatable": {
        const tbl = (ctx.tables || []).find((t) => t.name === c.table);
        const cols = tbl ? tbl.columns.map((x) => x.name) : [];
        const op = c.operation || "insert";
        return F.select("table", "Tabel", c.table, [["", "— kies een tabel —"], ...(ctx.tables || []).map((t) => [t.name, `${t.name} (${t.columns.length} kolommen)`])], (ctx.tables || []).length ? "Tabellen van DEV; op andere omgevingen moet een tabel met dezelfde naam bestaan." : "Nog geen tabellen. Maak er een aan onder Opslag → Datatabellen.", true) +
          F.select("operation", "Operatie", op, [["insert", "rij toevoegen"], ["upsert", "toevoegen of bijwerken (upsert)"], ["find", "rijen zoeken"], ["get", "één rij ophalen"], ["update", "rijen bijwerken"], ["delete", "rijen verwijderen"]], "", true) +
          (op !== "insert" ? F.conds("conditions", op === "upsert" ? "Sleutel (voorwaarden)" : "Voorwaarden", c.conditions, cols, TPL_HINT) : "") +
          (["insert", "upsert", "update"].includes(op) ? F.rows("values", "Waarden", c.values, "kolom", "waarde of {{veld}}", "=", cols.length ? `Kolommen: ${cols.map(esc).join(", ")}` : "") : "") +
          (op === "find" ? F.num("limit", "Maximaal aantal rijen", c.limit ?? 100) + F.text("sortBy", "Sorteren op kolom", c.sortBy) + F.check("desc", "Aflopend", c.desc) : "") +
          (op === "get" ? F.check("failIfEmpty", "Fout als er geen rij is", c.failIfEmpty) : "") +
          F.text("target", "Resultaat opslaan in veld", c.target, op === "find" ? "rows" : "row");
      }
      case "sql":
        return F.cred("Database (koppeling)", c.credential, ["postgres"], ctx) + F.area("query", "SQL", c.query, "select * from orders where id = $1", "Gebruik $1, $2… voor parameters (veilig tegen SQL-injectie).", "codearea sm") +
          F.lines("params", "Parameters ($1, $2…)", c.params, "{{orderId}}", "Eén per regel. " + TPL_HINT) + F.check("single", "Alleen de eerste rij", c.single) + F.text("target", "Resultaat opslaan in veld", c.target, "rows");
      case "email":
        return F.cred("SMTP-server (koppeling)", c.credential, ["smtp"], ctx, "Zonder koppeling wordt de mail gesimuleerd (niet verstuurd).") +
          F.text("to", "Aan", c.to, "{{customer.email}}") + F.text("cc", "Cc", c.cc) + F.text("subject", "Onderwerp", c.subject, "Order {{orderId}} ontvangen") +
          F.area("text", "Tekst", c.text, "Beste klant, …", TPL_HINT) + F.area("html", "HTML (optioneel)", c.html);
      case "notify":
        return F.select("kind", "Kanaal", c.kind || "teams", [["teams", "Microsoft Teams"], ["slack", "Slack"]]) +
          F.cred("Webhook (koppeling)", c.credential, ["webhook"], ctx, "Zonder koppeling en URL wordt het bericht gesimuleerd.") + F.text("url", "Of webhook-URL", c.url) +
          F.text("title", "Titel", c.title) + F.area("text", "Bericht", c.text, "Order {{orderId}} is verwerkt", TPL_HINT);
      case "connector":
        return connectorForm(c, ctx);
      case "mcp-tool":
        return F.cred("MCP-server (koppeling)", c.credential, ["mcp"], ctx) + F.text("url", "Of server-URL", c.url, "https://server.example/mcp") +
          F.text("tool", "Tool", c.tool, "list_processes", "Test de koppeling onder Beheer → Koppelingen om de beschikbare tools te zien.") +
          F.json("arguments", "Argumenten (JSON met templates)", c.arguments) + F.text("target", "Resultaat opslaan in veld", c.target, "mcp");
      case "branch":
        return F.text("when", "Veld", c.when, "order.priority") +
          F.select("op", "Voorwaarde", c.op || "truthy", [["truthy", "is waar / gevuld"], ["exists", "bestaat"], ["equals", "is gelijk aan"], ["notEquals", "is niet gelijk aan"], ["gt", "groter dan"], ["lt", "kleiner dan"], ["contains", "bevat"]], "", true) +
          (["equals", "notEquals", "gt", "lt", "contains"].includes(c.op) ? F.text("value", "Waarde", c.value) : "") +
          hintHtml("Voldaan → <b>ja</b>-pad (rechts). Anders → <b>nee</b>-pad (onder).");
      case "end":
        return `<p class="muted">Eindevent: dit pad van het proces stopt hier. Er zijn geen parameters.</p>`;
      default:
        return `<p class="muted">Deze stap geeft het bericht ongewijzigd door.</p>`;
    }
  }

  function triggerFormHtml(def, ctx) {
    const t = def.trigger || { type: "manual" };
    const name = def.integration;
    let html = F.select("type", "Trigger", t.type || "manual", Object.entries(TRIGGERS).map(([k, v]) => [k, v.label]), (TRIGGERS[t.type] || {}).desc || "", true);
    if (t.type === "webhook") {
      const path = String(t.path || name).replace(/^\//, "");
      html += F.text("path", "Pad", t.path, name) + F.select("method", "Methode", t.method || "POST", ["POST", "GET", "PUT", "ANY"]) +
        F.select("auth", "Beveiliging", t.auth || "none", [["none", "geen"], ["apikey", "API-key (header)"]], "", true) +
        (t.auth === "apikey" ? F.cred("API-key (koppeling)", t.credential, ["api-key"], ctx, "Per omgeving een andere sleutel.") : "") +
        F.select("response", "Antwoord", t.response || "result", [["result", "wachten op resultaat (200/500)"], ["accepted", "direct 202 Accepted"]], "Een proces kan zelf antwoorden met een veld <code>_response: { status, body }</code>.") +
        `<label>URL per omgeving</label><div class="urls">${["dev", "test", "acc", "prod"].map((e) => `<div><span class="env ${e}">${e}</span> <code>${esc(location.origin)}/hooks/${e}/${esc(path)}</code></div>`).join("")}</div>` +
        hintHtml("Actief op elke omgeving waar deze versie gedeployed is.");
    } else if (t.type === "api") {
      const path = String(t.path || `${String(name).toLowerCase()}/{id}`).replace(/^\//, "");
      const method = String(t.method || "GET").toUpperCase();
      html += F.text("path", "Pad", t.path, `${String(name).toLowerCase()}/{id}`, "Gebruik <code>{naam}</code> voor padparameters; die komen in het bericht als <code>params.naam</code>, query-parameters als <code>query</code>.") +
        F.select("method", "Methode", method, ["GET", "POST", "PUT", "PATCH", "DELETE"], "", true) +
        F.select("auth", "Beveiliging", t.auth || "none", [["none", "geen"], ["apikey", "API-key (header)"]], "", true) +
        (t.auth === "apikey" ? F.cred("API-key (koppeling)", t.credential, ["api-key"], ctx, "Per omgeving een andere sleutel.") : "") +
        hintHtml("Antwoord: het bericht aan het eind van het proces (zonder interne velden), of een eigen <code>_response: { status, body }</code>.") +
        `<label>Endpoint per omgeving</label><div class="urls">${["dev", "test", "acc", "prod"].map((e) => `<div><span class="env ${e}">${e}</span> <code>${method} ${esc(location.origin)}/apis/${e}/${esc(path)}</code> · <a href="/apis/${e}/openapi.json" target="_blank" rel="noopener">OpenAPI</a></div>`).join("")}</div>` +
        hintHtml("Actief op elke omgeving waar deze versie gedeployed is.");
    } else if (t.type === "schedule") {
      html += F.select("cron", "Snelkeuze", t.cron || "", [["", "— eigen expressie —"], ["*/5 * * * *", "elke 5 minuten"], ["0 * * * *", "elk uur"], ["0 7 * * *", "dagelijks 07:00"], ["0 9 * * 1-5", "werkdagen 09:00"], ["0 0 1 * *", "maandelijks"]], "", true) +
        F.text("cron", "Cron-expressie", t.cron, "*/5 * * * *", "minuut uur dag maand weekdag") + F.num("everySeconds", "Of: elke N seconden", t.everySeconds, "Heeft voorrang op cron als het ingevuld is (minimaal 5).");
    } else if (t.type === "queue") {
      html += F.text("queue", "Queue", t.queue, "orders", (ctx.queues || []).length ? "Bestaand: " + ctx.queues.map(esc).join(", ") : "") + F.num("concurrency", "Tegelijk verwerken", t.concurrency ?? 1, "Faalt een bericht 3 keer, dan gaat het naar <code>&lt;queue&gt;.dlq</code>.");
    } else if (t.type === "file" || t.type === "ftp") {
      html += (t.type === "ftp" ? F.cred("Server (koppeling)", t.credential, ["ftp", "ftps", "sftp"], ctx) : "") +
        F.text("dir", "Map", t.dir, t.type === "ftp" ? "/out" : "inbox", t.type === "file" ? "Binnen de bestandsmap van de omgeving (upload testbestanden via Opslag → Bestanden)." : "") +
        F.text("pattern", "Patroon", t.pattern, "*.csv") + F.num("intervalSeconds", "Controleren elke (seconden)", t.intervalSeconds ?? 30) +
        F.select("format", "Inhoud lezen als", t.format || "text", FORMATS, "Het bericht bevat <code>file.name</code>, <code>file.content</code> en <code>file.data</code>.") +
        F.select("after", "Na verwerken", t.after || "move", [["move", "verplaatsen naar archief"], ["delete", "verwijderen"]], "Mislukte bestanden gaan naar <code>&lt;map&gt;/error</code>.") +
        F.text("archiveDir", "Archiefmap", t.archiveDir, `${t.dir || "inbox"}/archive`);
    } else {
      html += F.text("source", "Omschrijving bron", t.source, "webshop");
    }
    return `<div id="t-form">${html}</div>`;
  }

  // Formulier uitlezen naar een configobject.
  function readInto(container, base) {
    const cfg = { ...(base || {}) };
    container.querySelectorAll("[data-k]").forEach((el) => {
      const k = el.dataset.k, t = el.dataset.t;
      if (el.classList.contains("rows")) {
        const obj = {};
        el.querySelectorAll(".kvr").forEach((r) => {
          const [a, b] = r.querySelectorAll("input");
          if (a.value.trim()) obj[a.value.trim()] = k === "set" || k === "values" ? parseVal(b.value) : b.value;
        });
        cfg[k] = obj;
      } else if (el.classList.contains("conds")) {
        cfg[k] = [...el.querySelectorAll(".cdr")].map((r) => {
          const [col, op, val] = r.querySelectorAll("input, select");
          return { column: col.value.trim(), op: op.value, value: val.value };
        }).filter((x) => x.column);
      } else if (t === "bool") cfg[k] = el.checked;
      else if (t === "num") { if (el.value === "") delete cfg[k]; else cfg[k] = Number(el.value); }
      else if (t === "lines") cfg[k] = el.value.split("\n").map((x) => x.trim()).filter(Boolean);
      else if (t === "json") {
        try { cfg[k] = el.value.trim() ? JSON.parse(el.value) : {}; el.classList.remove("bad"); }
        catch { el.classList.add("bad"); }
      } else if (t === "raw") cfg[k] = el.value;
      else if (el.tagName === "SELECT" && el.dataset.k === "cron" && el.value === "") { /* snelkeuze leeg: niets */ }
      else cfg[k] = el.value.trim();
    });
    return cfg;
  }

  function openNodeDetail(o) {
    // o: { def, id, run, ctx, getTestInput, setTestInput, onChange, pushHistory, onDelete, api }
    closeNodeDetail();
    const def = o.def;
    const ctx = o.ctx || {};
    const isStart = o.id === "start";
    const step = isStart ? null : def.steps.find((s) => s.id === o.id);
    if (!isStart && !step) return;
    const t = isStart ? { label: (TRIGGERS[def.trigger?.type] || { label: "Trigger" }).label, color: "#1f9d55" } : TYPES[step.type] || TYPES.custom;
    const lastStep = o.run && o.run.steps ? o.run.steps.filter((s) => s.id === o.id).pop() : null;
    let output = lastStep ? (lastStep.status === "ok" ? { ok: true, output: lastStep.output, port: lastStep.port, ms: lastStep.ms, fromRun: true } : { ok: false, error: lastStep.error, fromRun: true }) : null;
    const snapStr = JSON.stringify(def);
    let pushed = false;
    const changedNd = () => { if (!pushed) { o.pushHistory(snapStr); pushed = true; } o.onChange(); };
    const iconKey = isStart ? `t-${def.trigger?.type || "manual"}` : step.type;
    // Plugin-definitie op aanvraag laden (stap "connector")
    const pluginLoading = new Set();
    ctx.loadPlugin = async (id) => {
      if (pluginLoading.has(id)) return;
      pluginLoading.add(id);
      try { window.AIP_PLUGIN_DEFS = window.AIP_PLUGIN_DEFS || {}; window.AIP_PLUGIN_DEFS[id] = await o.api(`/api/v1/plugins/${encodeURIComponent(id)}`); }
      catch { return; }
      if (document.body.contains(overlay) && tab === "p") renderForm();
    };

    const views = { in: lsGet("aip.ndv.in", "schema"), out: lsGet("aip.ndv.out", "json") };
    let lastField = null; // laatst gefocust invulveld: klik op een veld voegt daar {{pad}} in

    const overlay = document.createElement("div");
    overlay.className = "ndv";
    overlay.innerHTML = `
      <div class="ndv-box" role="dialog" aria-modal="true" aria-label="${esc(t.label)}">
        <div class="ndv-h">
          <span class="ndv-ic" style="background:${t.color}"><svg viewBox="0 0 24 24" width="20" height="20">${iconSvg(ICONS[iconKey] ? iconKey : "start", "#fff", 24, 0, 0, 2)}</svg></span>
          ${isStart ? `<b class="ndv-title">Startevent — trigger</b>` : `<input class="ndv-name" value="${esc(step.name || step.id)}" aria-label="Naam van het element">`}
          <span class="chip info" id="ndv-kind">${esc(t.label)}</span>
          <span style="flex:1"></span>
          <button class="x ndv-x" aria-label="Sluiten">×</button>
        </div>
        <div class="ndv-b">
          <section class="ndv-col"><div class="ndv-ch"><span>INPUT <span class="ndv-cnt" id="ndv-in-n"></span></span>${isStart ? "" : viewSeg("in", views.in)}</div><div class="ndv-cb" id="ndv-in"></div></section>
          <section class="ndv-col mid"><div class="ndv-ch">
              <div class="ndv-tabs"><button class="on" data-tab="p">Parameters</button><button data-tab="s">Instellingen</button></div>
              ${isStart || step.type === "end" ? "" : `<button class="btn sm run" id="ndv-run">▶ Stap uitvoeren</button>`}
            </div><div class="ndv-cb" id="ndv-form"></div></section>
          <section class="ndv-col"><div class="ndv-ch"><span>OUTPUT <span class="ndv-cnt" id="ndv-out-n"></span></span>${isStart ? "" : viewSeg("out", views.out)}</div><div class="ndv-cb" id="ndv-out"></div></section>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const $n = (s) => overlay.querySelector(s);
    let tab = "p";

    function inputData() {
      if (lastStep && lastStep.input !== undefined) return lastStep.input;
      try { return JSON.parse(o.getTestInput() || "{}"); } catch { return {}; }
    }
    function renderIn() {
      if (isStart) {
        $n("#ndv-in").innerHTML = `<p class="muted">Het startevent ontvangt het bericht van de trigger. Bij “Proces uitvoeren” in de editor gaat de testdata (rechts) het proces in.</p>
          <p class="muted" style="font-size:.8rem">Triggers zijn actief op elke omgeving waar een versie van dit proces gedeployed is. Een overzicht staat onder Beheer → Actieve triggers.</p>`;
        return;
      }
      const fromRun = lastStep && lastStep.input !== undefined;
      const data = inputData();
      const notReached = o.run && !lastStep;
      $n("#ndv-in-n").textContent = `· ${itemCount(data)}`;
      $n("#ndv-in").innerHTML = `<div class="ndv-src">${fromRun ? "Uit de laatste uitvoering" : notReached ? "Niet bereikt in de laatste uitvoering — testdata van het proces" : "Geen uitvoering — testdata van het proces"}
          ${o.onRunPrevious ? `<button class="lnk" id="ndv-prev" type="button">▶ Vorige stappen uitvoeren</button>` : ""}</div>
        <div class="ndv-tip">Sleep een veld naar een invulveld in het midden, of klik in een invulveld en daarna op een veld.</div>
        ${dataViewHtml(views.in, data)}`;
    }
    function renderOut() {
      const el = $n("#ndv-out");
      if (isStart) {
        el.innerHTML = `<label for="t-data" class="muted" style="font-size:.74rem;font-weight:600">TESTDATA (JSON)</label><textarea class="f" id="t-data" style="min-height:260px;margin-top:6px">${esc(o.getTestInput())}</textarea><div class="hint">Dit bericht gaat het proces in bij “Proces uitvoeren” en bij “Stap uitvoeren” zolang er nog geen uitvoering is.</div>`;
        return;
      }
      const cnt = $n("#ndv-out-n");
      cnt.textContent = output && output.ok ? `· ${itemCount(output.output)}` : "";
      if (!output) { el.innerHTML = `<div class="empty">Nog geen output.<br>Klik op “Stap uitvoeren”.</div>`; return; }
      if (!output.ok) { el.innerHTML = `<div class="ndv-src">${output.fromRun ? "Uit de laatste uitvoering" : "Stap uitgevoerd"}</div><div class="ndv-err">✕ ${esc(output.error)}</div>`; return; }
      el.innerHTML = `<div class="ndv-src">${output.fromRun ? "Uit de laatste uitvoering" : `Stap uitgevoerd in ${output.ms} ms`}${output.port ? ` · <span class="chip ${output.port === "true" ? "ok" : "warn"}">→ ${output.port === "true" ? "ja" : "nee"}-pad</span>` : ""}<span style="flex:1"></span><button class="lnk" id="ndv-copy" type="button" title="Output als JSON kopiëren">Kopiëren</button></div>${dataViewHtml(views.out, output.output)}`;
    }
    function renderForm() {
      overlay.querySelectorAll(".ndv-tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
      const el = $n("#ndv-form");
      if (isStart) {
        el.innerHTML = tab === "p" ? triggerFormHtml(def, ctx) : `<p class="muted">Het startevent is het beginpunt van elk proces en kan niet verwijderd worden.</p>`;
        return;
      }
      if (tab === "p") {
        el.innerHTML = formHtml(step, ctx) + (step.type === "end" ? "" : `<details class="adv"><summary>Configuratie als JSON</summary><textarea class="f" id="f-json">${esc(JSON.stringify(step.config || {}, null, 2))}</textarea></details>`);
      } else {
        el.innerHTML = `<label for="s-id">Technische naam (id)</label><input class="f mono" id="s-id" value="${esc(step.id)}">
          <div class="hint">Wordt gebruikt in logs en verbindingen. Letters, cijfers, - en _.</div>
          <label>Type</label><div>${esc(t.label)} <span class="faint mono">(${esc(step.type)})</span></div>
          <label>Verbindingen</label><div class="muted" style="font-size:.85rem">${def.connections.filter((c) => c.to === step.id).map((c) => `← ${esc(c.from)}`).join("<br>") || "geen inkomende"}<br>${def.connections.filter((c) => c.from === step.id).map((c) => `→ ${esc(c.to)}${c.port ? ` (${c.port === "true" ? "ja" : "nee"})` : ""}`).join("<br>") || "geen uitgaande"}</div>
          <div style="margin-top:18px"><button class="btn sm no" id="s-del">Element verwijderen</button></div>`;
      }
    }
    function readForm(rerender) {
      const form = $n("#ndv-form");
      if (isStart) {
        const prevType = def.trigger?.type;
        let trig = readInto(form, def.trigger);
        if (trig.type !== prevType) trig = { type: trig.type }; // ander type: schone configuratie
        def.trigger = trig;
        const kind = $n("#ndv-kind");
        if (kind) kind.textContent = (TRIGGERS[trig.type] || { label: trig.type }).label;
        const ic = $n(".ndv-ic svg");
        if (ic) ic.innerHTML = iconSvg(ICONS[`t-${trig.type}`] ? `t-${trig.type}` : "start", "#fff", 24, 0, 0, 2);
      } else {
        step.config = readInto(form, step.type === "connector" ? { ...step.config, params: {} } : step.config);
        if (step.type === "connector") {
          const prevPlugin = (JSON.parse(snapStr).steps || []).find((x) => x.id === step.id)?.config?.plugin;
          normalizeConnector(step.config);
          if (step.config.plugin !== prevPlugin && rerender) { const pl = pluginInfo(step.config.plugin); if (pl && (!step.name || step.name === "Connector" || pluginList().some((x) => x.name === step.name))) { step.name = pl.name; const n = $n(".ndv-name"); if (n) n.value = pl.name; } }
        }
        const j = $n("#f-json");
        if (j && !rerender) j.value = JSON.stringify(step.config, null, 2);
      }
      changedNd();
      if (rerender) renderForm();
    }

    overlay.addEventListener("input", (e) => {
      if (e.target.classList.contains("ndv-name")) { step.name = e.target.value; changedNd(); return; }
      if (e.target.id === "t-data") { o.setTestInput(e.target.value); return; }
      if (e.target.id === "f-json" || e.target.id === "s-id") return;
      if (e.target.tagName === "SELECT" || e.target.type === "checkbox") return; // via change
      if (e.target.closest("#ndv-form")) readForm(false);
    });
    overlay.addEventListener("change", (e) => {
      if (e.target.id === "f-json") {
        try { step.config = JSON.parse(e.target.value || "{}"); e.target.classList.remove("bad"); changedNd(); renderForm(); }
        catch { e.target.classList.add("bad"); }
        return;
      }
      if (e.target.id === "s-id") {
        const v = e.target.value.trim();
        if (!/^[A-Za-z0-9_-]{1,64}$/.test(v) || v === "start" || def.steps.some((s) => s !== step && s.id === v)) { e.target.value = step.id; e.target.classList.add("bad"); return; }
        const old = step.id;
        if (v === old) return;
        if (!pushed) { o.pushHistory(snapStr); pushed = true; }
        step.id = v;
        for (const c of def.connections) { if (c.from === old) c.from = v; if (c.to === old) c.to = v; }
        o.onChange();
        return;
      }
      if ((e.target.tagName === "SELECT" || e.target.type === "checkbox") && e.target.closest("#ndv-form")) {
        // Snelkeuze cron: kopieer naar het tekstveld.
        if (e.target.dataset.k === "cron" && e.target.tagName === "SELECT" && e.target.value) {
          const txt = $n('#t-form input[data-k="cron"]');
          if (txt) txt.value = e.target.value;
        }
        readForm(e.target.hasAttribute("data-rerender"));
      }
    });
    overlay.addEventListener("click", async (e) => {
      if (e.target === overlay || e.target.closest(".ndv-x")) { closeNodeDetail(); return; }
      const tb = e.target.closest(".ndv-tabs [data-tab]");
      if (tb) { tab = tb.dataset.tab; renderForm(); return; }
      const vb = e.target.closest("[data-view]");
      if (vb) {
        const [side, v] = vb.dataset.view.split(":");
        views[side] = v;
        lsSet(`aip.ndv.${side}`, v);
        vb.parentElement.querySelectorAll("button").forEach((b) => { b.classList.toggle("on", b === vb); b.setAttribute("aria-pressed", String(b === vb)); });
        side === "in" ? renderIn() : renderOut();
        return;
      }
      if (e.target.id === "ndv-copy" && output && output.ok) {
        try { await navigator.clipboard.writeText(JSON.stringify(output.output, null, 2)); e.target.textContent = "Gekopieerd ✓"; } catch { e.target.textContent = "Kopiëren mislukt"; }
        setTimeout(() => { if (e.target.isConnected) e.target.textContent = "Kopiëren"; }, 1500);
        return;
      }
      if (e.target.id === "ndv-prev") { e.target.disabled = true; e.target.textContent = "Bezig…"; await o.onRunPrevious(); return; }
      const chip = e.target.closest("#ndv-in [data-path]");
      if (chip) {
        e.preventDefault(); // niet in-/uitklappen bij klik op de naam
        if (lastField && lastField.isConnected) insertRef(lastField, chip.dataset.path);
        else {
          const tip = $n("#ndv-in .ndv-tip");
          if (tip) { tip.textContent = `Klik eerst in een invulveld in het midden; daarna voegt een klik op een veld {{${chip.dataset.path}}} in.`; tip.classList.add("warn"); }
        }
        return;
      }
      const add = e.target.closest("[data-addrow]");
      if (add) {
        const rows = $n(`.rows[data-k="${add.dataset.addrow}"]`);
        rows.insertAdjacentHTML("beforeend", `<div class="kvr"><input class="f" placeholder="${add.dataset.l}"><span class="kva">${add.dataset.a}</span><input class="f" placeholder="${add.dataset.r}"><button class="x" data-delrow aria-label="Rij verwijderen">×</button></div>`);
        rows.lastElementChild.querySelector("input").focus();
        return;
      }
      const addc = e.target.closest("[data-addcond]");
      if (addc) {
        const box = $n(`.conds[data-k="${addc.dataset.addcond}"]`);
        const first = box.querySelector(".cdr");
        const clone = first.cloneNode(true);
        clone.querySelectorAll("input").forEach((i) => (i.value = ""));
        box.appendChild(clone);
        clone.querySelector("input").focus();
        return;
      }
      if (e.target.closest("[data-delrow]")) { e.target.closest(".kvr").remove(); readForm(false); return; }
      if (e.target.closest("[data-delcond]")) {
        const box = e.target.closest(".conds");
        if (box.querySelectorAll(".cdr").length > 1) e.target.closest(".cdr").remove();
        else e.target.closest(".cdr").querySelectorAll("input").forEach((i) => (i.value = ""));
        readForm(false);
        return;
      }
      if (e.target.id === "s-del") { closeNodeDetail(); o.onDelete(); return; }
      if (e.target.closest("#ndv-run")) {
        const btn = $n("#ndv-run");
        btn.disabled = true;
        try {
          const r = await o.api("/api/v1/engine/execute-step", { body: { type: step.type, config: step.config || {}, input: inputData() } });
          output = r.ok ? { ok: true, output: r.output, port: r.port, ms: r.ms } : { ok: false, error: r.error };
        } catch (err) { output = { ok: false, error: err.message }; }
        btn.disabled = false;
        renderOut();
      }
    });
    // ---- verwijzingen naar invoervelden: slepen, klikken, preview
    const isField = (el) => el && el.closest && el.closest("#ndv-form") && (el.tagName === "TEXTAREA" || (el.tagName === "INPUT" && !["checkbox", "radio"].includes(el.type))) && el.id !== "s-id";
    function insertRef(el, path, atEnd) {
      const ref = `{{${path}}}`;
      const v = el.value;
      let a = el.selectionStart ?? v.length, b = el.selectionEnd ?? v.length;
      if (atEnd) { a = b = v.length; }
      // Een mapping-bronveld (transform) verwacht een pad of een {{template}}; leeg veld → alleen de verwijzing.
      el.value = v.slice(0, a) + ref + v.slice(b);
      el.focus();
      const pos = a + ref.length;
      try { el.setSelectionRange(pos, pos); } catch { /* niet elk type */ }
      el.classList.add("got");
      setTimeout(() => el.classList.remove("got"), 700);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }
    function showPreview(el) {
      if (!isField(el) || el.id === "f-json") return;
      const host = el.closest(".kvr, .cdr") || el;
      let pv = host.nextElementSibling && host.nextElementSibling.classList.contains("xp") ? host.nextElementSibling : null;
      if (!el.value.includes("{{")) { if (pv) pv.remove(); return; }
      if (!pv) { pv = document.createElement("div"); pv.className = "xp"; host.after(pv); }
      const r = previewTpl(el.value, inputData());
      const txt = r === undefined ? "(leeg — pad bestaat niet in de invoer)" : typeof r === "object" && r !== null ? JSON.stringify(r) : String(r);
      pv.textContent = txt.length > 240 ? txt.slice(0, 240) + "…" : txt;
      pv.classList.toggle("miss", r === undefined || r === "");
      pv.title = "Resultaat met de huidige invoer";
    }
    overlay.addEventListener("focusin", (e) => { if (isField(e.target)) { lastField = e.target; showPreview(e.target); } });
    overlay.addEventListener("input", (e) => showPreview(e.target));
    overlay.addEventListener("pointerdown", (e) => { if (isField(e.target)) lastField = e.target; });
    overlay.addEventListener("dragstart", (e) => {
      const src = e.target.closest && e.target.closest("[data-path]");
      if (!src) return;
      e.dataTransfer.setData("text/aip-path", src.dataset.path);
      e.dataTransfer.setData("text/plain", `{{${src.dataset.path}}}`);
      e.dataTransfer.effectAllowed = "copy";
      overlay.classList.add("dragging");
    });
    overlay.addEventListener("dragend", () => { overlay.classList.remove("dragging"); overlay.querySelectorAll(".drop-t").forEach((x) => x.classList.remove("drop-t")); });
    const dropTarget = (t) => (isField(t) ? t : t.closest && t.closest("#ndv-form .ndv-drop"));
    overlay.addEventListener("dragover", (e) => {
      if (!e.dataTransfer.types.includes("text/aip-path")) return;
      const t = dropTarget(e.target);
      if (!t) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      overlay.querySelectorAll(".drop-t").forEach((x) => x !== t && x.classList.remove("drop-t"));
      t.classList.add("drop-t");
    });
    overlay.addEventListener("dragleave", (e) => { const t = dropTarget(e.target); if (t && !t.contains(e.relatedTarget)) t.classList.remove("drop-t"); });
    overlay.addEventListener("drop", (e) => {
      const path = e.dataTransfer.getData("text/aip-path");
      const t = path && dropTarget(e.target);
      if (!t) return;
      e.preventDefault();
      t.classList.remove("drop-t");
      overlay.classList.remove("dragging");
      if (t.classList.contains("ndv-drop")) {
        // Nieuwe rij: naam = laatste deel van het pad, waarde = verwijzing
        const rows = $n(`.rows[data-k="${t.dataset.drop}"]`);
        if (!rows) return;
        const name = path.replace(/\[\d+\]/g, "").split(".").pop();
        let row = [...rows.querySelectorAll(".kvr")].find((r) => [...r.querySelectorAll("input")].every((i) => !i.value));
        if (!row) {
          $n(`[data-addrow="${t.dataset.drop}"]`).click();
          row = rows.lastElementChild;
        }
        const [l, r] = row.querySelectorAll("input");
        l.value = name;
        r.value = `{{${path}}}`;
        readForm(false);
        showPreview(r);
        r.classList.add("got");
        setTimeout(() => r.classList.remove("got"), 700);
        return;
      }
      const focused = document.activeElement === t;
      lastField = t;
      insertRef(t, path, !focused);
    });

    overlay._onKey = (e) => { if (e.key === "Escape") closeNodeDetail(); };
    document.addEventListener("keydown", overlay._onKey);
    overlay._onClose = o.onClose;

    renderIn();
    renderForm();
    renderOut();
    const first = overlay.querySelector("#ndv-form input:not([type=checkbox]), #ndv-form textarea");
    if (first) setTimeout(() => first.focus(), 0);
  }
  function closeNodeDetail() {
    const el = document.querySelector(".ndv");
    if (!el) return;
    document.removeEventListener("keydown", el._onKey);
    el.remove();
    if (el._onClose) el._onClose();
  }

  window.ProcessCanvas = { mount, normalize, tidy, geom, TYPES, TRIGGERS, GROUPS, ICONS, iconSvg, triggerSub, openNodeDetail, closeNodeDetail };
})();
