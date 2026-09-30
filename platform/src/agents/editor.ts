import type { Integration } from "../domain/types";
import { claudeAvailable, claudeJson } from "./claude";
import { heuristicDesign } from "./builder";

// Process Editor Agent: past een bestaande procesdefinitie aan op basis van een opdracht
// ("voeg een e-mail toe naar ops@bedrijf.nl", "zet de trigger op elke 5 minuten",
// "verwijder de duplicaatcheck"). Met Claude wanneer een key aanwezig is; anders een
// regelgebaseerde fallback die de gangbare Nederlandse opdrachten begrijpt.
// De agent geeft altijd een volledige nieuwe definitie terug plus een lijst wijzigingen;
// de GUI past die toe op het canvas (met ongedaan maken).

type Step = Integration["steps"][number];
type Conn = { from: string; to: string; port?: string };

export interface EditResult {
  definition: Integration;
  changes: string[];
  by: "claude" | "heuristic";
  understood: boolean;
  ask?: "trigger"; // de agent heeft een keuze van de gebruiker nodig
}

const LABELS: Record<string, string> = {
  validate: "Validatie", transform: "Transformatie", enrich: "Velden instellen", "duplicate-check": "Duplicaatcheck",
  csv: "CSV", xml: "XML", call: "HTTP-aanroep", code: "Code", delay: "Wachten", subprocess: "Subproces", custom: "Doorgeven",
  file: "Bestand", ftp: "FTP / SFTP", "queue-publish": "Queue: publiceren", "queue-get": "Queue: ophalen", datatable: "Datatabel",
  sql: "SQL", email: "E-mail", notify: "Teams / Slack", "mcp-tool": "MCP-tool", branch: "Beslissing", end: "Einde"
};

// Trefwoorden -> staptype (volgorde telt: specifiek eerst).
const KEYWORDS: Array<[RegExp, string]> = [
  [/\b(e-?mail|mail)\b/, "email"],
  [/\b(teams|slack)\b/, "notify"],
  [/\b(s?ftps?)\b/, "ftp"],
  [/\bdatatabel|\btabel\b/, "datatable"],
  [/\bqueue\b.*\b(ophalen|lezen|halen)\b|\b(haal|lees)\b.*\bqueue\b/, "queue-get"],
  [/\b(queue|wachtrij)\b/, "queue-publish"],
  [/\b(sql|database|query|postgres)\b/, "sql"],
  [/\bmcp\b/, "mcp-tool"],
  [/\b(http|api|rest|aanroep|endpoint|webservice)\b|https?:\/\//, "call"],
  [/\bduplica/, "duplicate-check"],
  [/\b(valideer|validatie|verplicht)/, "validate"],
  [/\b(transformatie|mapping|transformeer)\b/, "transform"],
  [/\bcsv\b/, "csv"],
  [/\bxml\b/, "xml"],
  [/\b(code|javascript|script)\b/, "code"],
  [/\b(wacht|pauze|vertraging)\b/, "delay"],
  [/\bsubproces\b/, "subprocess"],
  [/\b(beslissing|gateway|als\b|indien\b)/, "branch"],
  [/\b(bestand|file)\b/, "file"],
  [/\b(velden? instellen|zet veld|verrijk)/, "enrich"],
  [/\beinde\b|\beindevent\b/, "end"]
];

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");

function uniqueId(def: Integration, base: string): string {
  const b = base.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "stap";
  let id = b, n = 1;
  while (def.steps.some((s) => s.id === id) || id === "start") id = `${b}${++n}`;
  return id;
}

function portOf(def: Integration, c: Conn): string {
  const from = def.steps.find((s) => s.id === c.from);
  return c.port ?? (from?.type === "branch" ? "true" : "out");
}

function findNode(def: Integration, phrase: string): Step | undefined {
  const p = norm(phrase).replace(/["“”'‘’]/g, "").replace(/^(de|het|een)\s+/, "").trim();
  if (!p) return undefined;
  return (
    def.steps.find((s) => norm(s.id) === p || norm(String(s.name || "")) === p) ||
    def.steps.find((s) => norm(String(s.name || "")).includes(p) || norm(s.id).includes(p)) ||
    def.steps.find((s) => norm(LABELS[s.type] || "").includes(p) || p.includes(norm(LABELS[s.type] || "~~")))
  );
}

// Het "eind" van het hoofdpad: de stap die naar een eindevent leidt, of de laatste stap zonder uitgang.
function tail(def: Integration): { anchor: string; beforeEnd?: string } {
  const conns = def.connections as Conn[];
  const endIds = new Set(def.steps.filter((s) => s.type === "end").map((s) => s.id));
  const toEnd = conns.find((c) => endIds.has(c.to) && c.from !== "start");
  if (toEnd) return { anchor: toEnd.from, beforeEnd: toEnd.to };
  // volg het pad vanaf start
  let cur = "start";
  const seen = new Set<string>();
  for (;;) {
    seen.add(cur);
    const next = conns.find((c) => c.from === cur && !seen.has(c.to) && portOf(def, c) !== "false");
    if (!next || endIds.has(next.to)) return { anchor: cur, beforeEnd: next?.to };
    cur = next.to;
  }
}

// Stap invoegen na `after` (of aan het eind van het hoofdpad) en verbindingen omleggen.
function insertAfter(def: Integration, step: Step, after?: string): string {
  const conns = def.connections as Conn[];
  def.steps.push(step);
  if (after) {
    const outs = conns.filter((c) => c.from === after && portOf(def, c) !== "false");
    for (const c of outs) c.from = step.id;
    conns.push({ from: after, to: step.id });
    if (step.type !== "end" && !outs.length) { /* niets om door te verbinden */ }
    return after;
  }
  const t = tail(def);
  if (t.beforeEnd) {
    const c = conns.find((x) => x.from === t.anchor && x.to === t.beforeEnd);
    if (c) c.to = step.id;
    else conns.push({ from: t.anchor, to: step.id });
    if (step.type !== "end") conns.push({ from: step.id, to: t.beforeEnd });
  } else {
    conns.push({ from: t.anchor, to: step.id });
  }
  return t.anchor;
}

function removeStep(def: Integration, id: string): void {
  const conns = def.connections as Conn[];
  const ins = conns.filter((c) => c.to === id);
  const outs = conns.filter((c) => c.from === id);
  def.connections = conns.filter((c) => c.to !== id && c.from !== id);
  // voorgangers direct doorverbinden met opvolgers (bypass)
  for (const i of ins) for (const o of outs) (def.connections as Conn[]).push({ from: i.from, to: o.to, ...(i.port ? { port: i.port } : {}) });
  def.steps = def.steps.filter((s) => s.id !== id);
}

function fieldsIn(text: string): string[] {
  const m = text.match(/(?:velden?|op|voor)\s+([a-z0-9_.,\s-]+?)(?:\s+(?:toe|en daarna|daarna|na|voor)\b|$)/i);
  if (!m) return [];
  return m[1].split(/,|\ben\b/).map((x) => x.trim()).filter((x) => /^[a-z][a-z0-9_.-]*$/i.test(x));
}

function stepFor(type: string, text: string, def: Integration): Step {
  const raw = text;
  const t = norm(text);
  const email = raw.match(/[\w.+-]+@[\w-]+\.[\w.-]+/)?.[0];
  const url = raw.match(/https?:\/\/[^\s"')]+/)?.[0];
  const quoted = raw.match(/["“'‘]([^"”'’]+)["”'’]/)?.[1];
  const named = (re: RegExp) => raw.match(re)?.[1];
  const step: Step = { id: uniqueId(def, type === "duplicate-check" ? "dedupe" : type), type, name: LABELS[type] || type, config: {} };
  const c = step.config as Record<string, unknown>;
  switch (type) {
    case "email":
      Object.assign(c, { credential: "", to: email || "{{customer.email}}", subject: quoted || "Bericht van {{$env}}: {{orderId}}", text: "Proces " + def.integration + " is uitgevoerd." });
      step.name = email ? `E-mail naar ${email}` : "E-mail";
      break;
    case "notify":
      Object.assign(c, { kind: /slack/.test(t) ? "slack" : "teams", credential: "", title: def.integration, text: quoted || "Proces {{$env}} verwerkt: {{orderId}}" });
      step.name = /slack/.test(t) ? "Slack-bericht" : "Teams-bericht";
      break;
    case "call": {
      const method = (t.match(/\b(get|post|put|patch|delete)\b/)?.[1] || (url ? "POST" : "GET")).toUpperCase();
      Object.assign(c, { method, url: url || "", credential: "", headers: {}, query: {}, body: "payload", target: "response" });
      step.name = url ? `${method} ${new URL(url).host}` : "HTTP-aanroep";
      break;
    }
    case "validate": {
      const f = fieldsIn(raw);
      Object.assign(c, { required: f });
      step.name = f.length ? `Valideer ${f.join(", ")}` : "Validatie";
      break;
    }
    case "duplicate-check": {
      const key = named(/\bop\s+([a-z][a-z0-9_.-]*)/i) || "id";
      Object.assign(c, { key });
      step.name = `Duplicaatcheck op ${key}`;
      break;
    }
    case "transform": {
      const m = raw.match(/\bmap\s+([a-z][\w.]*)\s+(?:naar|->|→)\s+([a-z][\w.]*)/i);
      Object.assign(c, { mapping: m ? { [m[2]]: m[1] } : {} });
      break;
    }
    case "datatable": {
      const table = named(/\btabel\s+["“]?([a-z][a-z0-9_]*)/i) || "";
      const op = /\b(zoek|opzoeken|ophalen|haal)\b/.test(t) ? "find" : /\b(bijwerken|update)\b/.test(t) ? "update" : /\bverwijder\b/.test(t) ? "delete" : "insert";
      Object.assign(c, { table, operation: op, conditions: [], values: {}, target: op === "find" ? "rows" : "row" });
      step.name = table ? `Datatabel ${table}` : "Datatabel";
      break;
    }
    case "queue-publish":
    case "queue-get": {
      const q = named(/\b(?:queue|wachtrij)\s+["“]?([a-z0-9_.-]+)/i) || "orders";
      Object.assign(c, type === "queue-get" ? { queue: q, max: 1, target: "messages" } : { queue: q });
      step.name = type === "queue-get" ? `Ophalen uit ${q}` : `Naar queue ${q}`;
      break;
    }
    case "sql":
      Object.assign(c, { credential: "", query: quoted || "select * from orders where id = $1", params: ["{{id}}"], target: "rows" });
      break;
    case "ftp": {
      const path = named(/\b(?:naar|in|map)\s+(\/[^\s]+)/i) || "/in/{{id}}.json";
      Object.assign(c, { credential: "", operation: /\b(download|ophalen|lees)\b/.test(t) ? "download" : "upload", path, format: "json", target: "file" });
      step.name = /\bsftp\b/.test(t) ? "SFTP-upload" : "FTP-upload";
      break;
    }
    case "file": {
      const path = named(/\b(?:naar|in|map)\s+([a-z0-9_./{}-]+)/i) || "uit/{{id}}.json";
      Object.assign(c, { operation: /\b(lees|read|ophalen)\b/.test(t) ? "read" : "write", path, format: /\bcsv\b/.test(t) ? "csv" : "json", target: "file" });
      break;
    }
    case "code":
      Object.assign(c, { code: "// input bevat het bericht\nreturn { ...input };" });
      break;
    case "delay": {
      const n = Number(t.match(/(\d+)\s*(seconde|sec|s\b)/)?.[1] ?? 0) * 1000 || Number(t.match(/(\d+)\s*ms/)?.[1] ?? 1000);
      Object.assign(c, { ms: Math.min(n, 60000) });
      step.name = `Wacht ${Math.round(n / 1000) || 1} s`;
      break;
    }
    case "branch": {
      const field = named(/\b(?:op veld|veld|als|indien)\s+([a-z][\w.]*)/i) || "";
      Object.assign(c, { when: field, op: "truthy", value: "" });
      step.name = field ? `${field}?` : "Beslissing";
      break;
    }
    case "subprocess":
      Object.assign(c, { process: named(/\bsubproces\s+["“]?([A-Za-z][\w-]*)/i) || "", target: "subprocess" });
      break;
    case "csv":
      Object.assign(c, { mode: /\b(maak|genereer|schrijf)\b/.test(t) ? "generate" : "parse", field: "content", target: "records", delimiter: ",", header: true });
      break;
    case "xml":
      Object.assign(c, { mode: /\b(maak|genereer|bouw)\b/.test(t) ? "build" : "parse", field: "content", target: "data" });
      break;
    case "enrich":
      Object.assign(c, { set: {} });
      break;
  }
  return step;
}

// Marker: de gebruiker wil de trigger wijzigen maar noemt geen soort -> vraag welke.
export const ASK_TRIGGER = "__ASK_TRIGGER__";

function applyTrigger(def: Integration, text: string): string | null {
  const t = norm(text);
  const name = def.integration;
  const every = t.match(/(?:elke|iedere|om de)\s+(\d+)\s*(minuut|minuten|min|seconde|seconden|sec|uur|uren)/);
  if (every) {
    const n = Number(every[1]);
    if (/^sec/.test(every[2])) def.trigger = { type: "schedule", everySeconds: Math.max(5, n) };
    else if (/^uur|^uren/.test(every[2])) def.trigger = { type: "schedule", cron: `0 */${n} * * *` };
    else def.trigger = { type: "schedule", cron: `*/${n} * * * *` };
    return `Trigger: schema (${def.trigger.cron ?? `elke ${def.trigger.everySeconds} s`})`;
  }
  const daily = t.match(/(dagelijks|elke dag|iedere dag|werkdagen|iedere werkdag|elke werkdag|elke ochtend|elke avond)\s*(?:om)?\s*(\d{1,2})?(?:[:.](\d{2}))?\s*(?:uur)?/);
  if (daily) {
    const hour = daily[2] !== undefined ? Number(daily[2]) : /avond/.test(daily[1]) ? 18 : 7;
    const cron = `${Number(daily[3] ?? 0)} ${hour} * * ${/werkdag/.test(daily[1]) ? "1-5" : "*"}`;
    def.trigger = { type: "schedule", cron };
    return `Trigger: schema (${cron})`;
  }
  if (/\b(elk|ieder) uur\b|\bper uur\b/.test(t)) { def.trigger = { type: "schedule", cron: "0 * * * *" }; return "Trigger: elk uur"; }
  if (/\belke minuut\b/.test(t)) { def.trigger = { type: "schedule", cron: "* * * * *" }; return "Trigger: elke minuut"; }

  const aboutTrigger = /\b(trigger|triggers|start|starten|startevent|gestart|begint|beginnen|opstarten)\b/.test(t) || /\b(queue|webhook|api|endpoint|schema|cron|handmatig|ftp|sftp)[- ]?trigger\b/.test(t);
  if (!aboutTrigger) return null;

  if (/\b(api|endpoint|rest)\b/.test(t)) {
    const path = text.match(/\/[a-z0-9/_{}.-]+/i)?.[0]?.replace(/^\//, "") || `${name.toLowerCase()}/{id}`;
    const method = (t.match(/\b(get|post|put|patch|delete)\b/)?.[1] || "get").toUpperCase();
    def.trigger = { type: "api", method, path };
    return `Trigger: API-endpoint ${method} /${path}`;
  }
  if (/\b(webhook|http)\b/.test(t)) {
    const path = text.match(/\/[a-z0-9/_-]+/i)?.[0];
    def.trigger = { type: "webhook", method: "POST", ...(path ? { path: path.replace(/^\//, "") } : {}) };
    return "Trigger: webhook / HTTP";
  }
  if (/\b(queue|wachtrij)\b/.test(t)) {
    const q = text.match(/\b(?:queue|wachtrij)\s+["“]?([a-z0-9_.-]+)/i)?.[1];
    const queue = q && !/^(trigger|als|met|op)$/i.test(q) ? q : "orders";
    def.trigger = { type: "queue", queue };
    return `Trigger: queue ${queue}`;
  }
  if (/\bs?ftps?\b/.test(t)) { def.trigger = { type: "ftp", credential: "", dir: "/out", pattern: "*", intervalSeconds: 30, format: "text", after: "move" }; return "Trigger: FTP/SFTP-poller (kies nog een koppeling bij het startevent)"; }
  if (/\b(map|bestand|bestanden|folder)\b/.test(t)) {
    const dir = text.match(/\bmap\s+["“]?([a-z0-9_./-]+)/i)?.[1] || "inbox";
    def.trigger = { type: "file", dir, pattern: /\bcsv\b/.test(t) ? "*.csv" : "*", intervalSeconds: 30, format: /\bcsv\b/.test(t) ? "csv" : "text", after: "move" };
    return `Trigger: map ${dir}`;
  }
  if (/\b(schema|cron|periodiek|tijdschema|gepland)\b/.test(t)) { def.trigger = { type: "schedule", cron: "*/5 * * * *" }; return "Trigger: schema (elke 5 minuten; pas aan bij het startevent)"; }
  if (/\b(handmatig|manual|knop)\b/.test(t)) { def.trigger = { type: "manual" }; return "Trigger: handmatig"; }
  // Wel over de trigger, maar geen soort genoemd: vragen welke.
  return ASK_TRIGGER;
}

// Eén deelopdracht uitvoeren. Geeft een beschrijving terug, of null als hij niet begrepen is.
function applyCommand(def: Integration, cmd: string): string | null {
  const t = norm(cmd).trim();
  if (!t) return null;

  // hernoemen
  const ren = cmd.match(/hernoem\s+(.+?)\s+(?:naar|in)\s+["“]?(.+?)["”]?\s*$/i);
  if (ren) {
    const s = findNode(def, ren[1]);
    if (!s) return null;
    const old = s.name || s.id;
    s.name = ren[2].trim();
    return `"${old}" hernoemd naar "${s.name}"`;
  }

  // verwijderen
  const del = cmd.match(/(?:verwijder|schrap|haal)\s+(?:de |het |een )?(.+?)(?:\s+weg)?\s*$/i);
  if (del && /verwijder|schrap|haal .* weg/.test(t)) {
    const s = findNode(def, del[1]);
    if (!s) return null;
    removeStep(def, s.id);
    return `"${s.name || s.id}" verwijderd (verbindingen doorgekoppeld)`;
  }

  // retry
  const retry = t.match(/(\d+)\s*(?:keer|x|maal)\s*(?:opnieuw|retry|proberen)|retry\s*(\d+)/);
  if (retry) {
    const n = Math.min(10, Number(retry[1] ?? retry[2]));
    def.retry = { ...(def.retry ?? {}), attempts: n, backoff: def.retry?.backoff ?? "exponential", onExhaust: /dead.?letter|dlq/.test(t) ? "dead-letter-queue" : def.retry?.onExhaust ?? "dead-letter-queue" };
    return `Retry: ${n} pogingen`;
  }

  // trigger (met een soort genoemd)
  const trig = applyTrigger(def, cmd);
  if (trig && trig !== ASK_TRIGGER) return trig;

  // toevoegen
  const type = KEYWORDS.find(([re]) => re.test(t))?.[1];
  if (type && /\b(voeg|toevoegen|zet|plaats|maak|stuur|verstuur|sla|schrijf|bewaar|valideer|controleer|roep|haal|lees|wacht|upload|publiceer|meld|mail|log|transformeer|map)\b/.test(t)) {
    const step = stepFor(type, cmd, def);
    const afterM = cmd.match(/\b(?:na|achter|direct na)\s+(?:de |het )?(.+?)(?:\s+toe)?\s*$/i);
    const beforeM = cmd.match(/\b(?:voor|vóór)\s+(?:de |het )?(.+?)(?:\s+toe)?\s*$/i);
    let after: string | undefined;
    if (afterM) after = findNode(def, afterM[1])?.id;
    else if (beforeM && !/\bvoor\s+(elke|iedere|alle)\b/.test(t)) {
      const target = findNode(def, beforeM[1]);
      const inc = target && (def.connections as Conn[]).find((c) => c.to === target.id);
      if (inc) after = inc.from;
    }
    insertAfter(def, step, after);
    const where = after ? ` na "${def.steps.find((s) => s.id === after)?.name ?? after}"` : "";
    return `${step.name} toegevoegd${where}`;
  }
  return trig === ASK_TRIGGER ? ASK_TRIGGER : null;
}

// Opsplitsen in deelopdrachten. "daarna/vervolgens/dan" zijn vulwoorden (geen scheiding);
// we splitsen op regels, puntkomma's, zinnen en op "en" gevolgd door een nieuwe opdracht.
function splitCommands(prompt: string): string[] {
  const VERBS = "voeg|verwijder|zet|stuur|hernoem|maak|haal|verstuur|sla|schrijf|valideer|roep|wacht|upload|publiceer|controleer|bewaar";
  return prompt
    .replace(new RegExp(`\\b(daarna|vervolgens|en dan|dan)\\s+(?=(?:${VERBS})\\b)`, "gi"), "; ")
    .replace(/\b(daarna|vervolgens|en dan|dan|ook)\b/gi, " ")
    .split(new RegExp(`\\n|;|\\.\\s+|,\\s*(?=(?:${VERBS})\\b)|\\s+en\\s+(?=(?:${VERBS})\\b)`, "i"))
    .map((x) => x.replace(/\s+/g, " ").trim())
    .filter((x) => x.length > 2);
}

// Engelse opdrachten ("add an email to ops@x.nl after the validation") omzetten naar de
// Nederlandse vorm die de regels hieronder begrijpen. Alleen als de opdracht Engels oogt.
const EN_HINT = /\b(add|remove|delete|rename|set|send|store|save|after|before|every|then|the|trigger to|make it|insert|put)\b/i;
const NL_HINT = /\b(voeg|verwijder|hernoem|zet|stuur|sla|na|voor|elke|daarna|de|het|een|naar)\b/i;
const EN_TO_NL: Array<[RegExp, string]> = [
  [/\bmake it an? ([\w-]+) trigger\b/gi, "maak er een $1-trigger van"],
  [/\b(send|mail) (an? )?e-?mail\b/gi, "stuur een e-mail"],
  [/\b(store|save|write) (it )?(in|into|to) (the )?(data )?table\b/gi, "sla op in tabel"],
  [/\bduplicate[- ]check\b/gi, "duplicaatcheck"], [/\bhttp (request|call)\b/gi, "HTTP-aanroep"], [/\bapi (request|call)\b/gi, "API-aanroep"],
  [/\bend event\b/gi, "eindevent"], [/\bstart event\b/gi, "startevent"], [/\bdata ?table\b/gi, "datatabel"],
  [/\b(and then|then|afterwards)\b/gi, "daarna"], [/\b(add|insert|put)\b/gi, "voeg"], [/\b(remove|delete|drop)\b/gi, "verwijder"],
  [/\brename\b/gi, "hernoem"], [/\bset\b/gi, "zet"], [/\bsend\b/gi, "stuur"], [/\b(store|save)\b/gi, "sla op"], [/\bmake\b/gi, "maak"],
  [/\bafter\b/gi, "na"], [/\bbefore\b/gi, "voor"], [/\bevery\b/gi, "elke"], [/\bminutes?\b/gi, "minuten"], [/\bseconds?\b/gi, "seconden"],
  [/\bhours?\b/gi, "uur"], [/\bdaily\b/gi, "dagelijks"], [/\bweekdays\b/gi, "werkdagen"], [/\b(\d+) times\b/gi, "$1 keer"], [/\btimes\b/gi, "keer"],
  [/\bvalidation\b/gi, "validatie"], [/\bvalidate\b/gi, "valideer"], [/\btable\b/gi, "tabel"], [/\bwait\b/gi, "wacht"], [/\bdecision\b/gi, "beslissing"],
  [/\bfile\b/gi, "bestand"], [/\bfolder\b/gi, "map"], [/\bsubprocess\b/gi, "subproces"], [/\btransform(ation)?\b/gi, "transformatie"],
  [/\bschedule\b/gi, "schema"], [/\b(fetch|read|get) from\b/gi, "haal uit"], [/\bread\b/gi, "lees"], [/\brequired\b/gi, "verplicht"],
  [/\bat (\d)/gi, "om $1"], [/\bto\b/gi, "naar"], [/\bon\b/gi, "op"], [/\bwith\b/gi, "met"], [/\bthe\b/gi, "de"], [/\ban?\b/gi, "een"], [/\band\b/gi, "en"]
];
export function englishToDutch(prompt: string): string {
  const en = (prompt.match(new RegExp(EN_HINT, "gi")) || []).length;
  const nl = (prompt.match(new RegExp(NL_HINT, "gi")) || []).length;
  if (!en || nl > en) return prompt;
  let out = prompt;
  // Tekst tussen aanhalingstekens (namen) en e-mailadressen/URL's ongemoeid laten.
  const keep: string[] = [];
  out = out.replace(/(["“][^"”]*["”]|\S+@\S+|https?:\/\/\S+|\/[\w/{}.-]+)/g, (m) => { keep.push(m); return `\u0000${keep.length - 1}\u0000`; });
  for (const [re, to] of EN_TO_NL) out = out.replace(re, to);
  // "voeg ... toe": Nederlands zet "toe" achteraan; de regels hieronder accepteren beide.
  return out.replace(/\u0000(\d+)\u0000/g, (_m, i) => keep[Number(i)]);
}

export function heuristicEdit(input: Integration, prompt: string): EditResult {
  prompt = englishToDutch(prompt);
  const def: Integration = JSON.parse(JSON.stringify(input));
  def.connections = def.connections?.length ? def.connections : def.steps.map((s, i) => ({ from: i === 0 ? "start" : def.steps[i - 1].id, to: s.id }));
  // "Leeg" proces: alleen de standaardvalidatie zonder velden (of helemaal niets).
  const nonEnd = def.steps.filter((s) => s.type !== "end");
  const isFresh = nonEnd.length === 0 || (nonEnd.length === 1 && nonEnd[0].type === "validate" && !((nonEnd[0].config as { required?: unknown[] })?.required?.length));
  const describesWhole = prompt.length > 60 && /\b(integratie|koppeling|koppel|stuur iedere|synchroniseer|nieuwe .* naar)\b/i.test(prompt);

  // Nieuw/leeg proces + beschrijving van een hele integratie: volledig ontwerpen, naam behouden.
  if (isFresh && describesWhole) {
    const designed = heuristicDesign(prompt);
    const steps = designed.steps.map((s) => ({ ...s, name: LABELS[s.type] || s.type }));
    steps.push({ id: "einde", type: "end", name: "Einde", config: {} });
    const out: Integration = {
      ...def,
      description: designed.description,
      trigger: designed.trigger,
      steps,
      connections: steps.map((s, i) => ({ from: i === 0 ? "start" : steps[i - 1].id, to: s.id })),
      retry: designed.retry
    };
    delete (out as any).layout;
    return { definition: out, changes: [`Proces opgebouwd: ${steps.length - 1} stappen (${steps.filter((s) => s.type !== "end").map((s) => s.name).join(" → ")})`, `Trigger: ${designed.trigger.type}`], by: "heuristic", understood: true };
  }

  const changes: string[] = [];
  const failed: string[] = [];
  let ask: EditResult["ask"];
  for (const cmd of splitCommands(prompt)) {
    const r = applyCommand(def, cmd);
    if (r === ASK_TRIGGER) ask = "trigger";
    else if (r) changes.push(r);
    else failed.push(cmd);
  }
  if (ask && !changes.length) return { definition: def, changes: [], by: "heuristic", understood: false, ask };
  if (failed.length && changes.length) changes.push(`Niet begrepen: "${failed.join('", "')}"`);
  return { definition: def, changes, by: "heuristic", understood: changes.length > 0 };
}

const SYSTEM = `Je bent de Process Editor Agent van een integratieplatform.
Je krijgt de huidige procesdefinitie (JSON) en een opdracht van de gebruiker. Pas de definitie aan en geef
UITSLUITEND JSON terug: { "definition": <volledige nieuwe definitie>, "changes": ["korte Nederlandse beschrijving per wijziging"] }.
Regels:
- Behoud "integration", bestaande stap-id's en hun "position" als ze niet veranderen. Nieuwe stappen krijgen GEEN position (de editor plaatst ze).
- Een proces is een graaf: steps[] {id, type, name, config} en connections[] {from, to, port?}. "start" is het startevent. Een beslissing (branch) heeft port "true"/"false".
- Staptypes en config: validate {required[]}, transform {mapping{doel:bron}}, enrich {set{}}, duplicate-check {key}, csv {mode,field,target}, xml {mode,field,target},
  call {method,url,credential,headers{},query{},body,target}, code {code}, delay {ms}, subprocess {process,target}, file {operation,path,format,target},
  ftp {credential,operation,path,format,target}, queue-publish {queue}, queue-get {queue,max,target}, datatable {table,operation,conditions[{column,op,value}],values{},target},
  sql {credential,query,params[],target}, email {credential,to,subject,text}, notify {kind,credential,title,text}, mcp-tool {credential,url,tool,arguments,target},
  branch {when,op,value}, end {}.
- Triggers: manual | webhook {path,method,auth} | schedule {cron | everySeconds} | queue {queue} | file {dir,pattern,intervalSeconds,format,after} | ftp {credential,dir,pattern,...}.
- Templates in waarden: {{veld.pad}}, {{$now}}, {{$date}}, {{$uuid}}.
- Houd verbindingen consistent: geen verwijzingen naar verwijderde stappen.`;

export async function editProcess(def: Integration, prompt: string): Promise<EditResult> {
  if (claudeAvailable()) {
    try {
      const r = await claudeJson<{ definition: Integration; changes: string[] }>({
        system: SYSTEM,
        user: `Huidige definitie:\n${JSON.stringify(def)}\n\nOpdracht: ${prompt}`,
        maxTokens: 4000
      });
      if (r?.definition?.steps && Array.isArray(r.definition.steps)) {
        const ids = new Set(r.definition.steps.map((s) => s.id));
        r.definition.integration = def.integration;
        r.definition.connections = (r.definition.connections ?? []).filter((c) => (c.from === "start" || ids.has(c.from)) && ids.has(c.to));
        return { definition: r.definition, changes: r.changes ?? [], by: "claude", understood: true };
      }
    } catch {
      // val terug op de heuristiek
    }
  }
  return heuristicEdit(def, prompt);
}
