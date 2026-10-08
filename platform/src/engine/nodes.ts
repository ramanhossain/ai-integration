// Stap-executors van de workflow-engine (taken/stappen).
// Elke stap krijgt het lopende bericht (payload) en geeft een nieuw bericht terug.
// Deterministisch — geen LLM in de runtime.

import type { EnvName } from "../domain/environments";
import { getPath, setPath, tpl, deepTpl, globToRegex, sleep, missingVars } from "../connectors/util";
import { csvParse, csvGenerate, xmlParse, xmlBuild, runCode } from "../connectors/formats";
import { openFs } from "../connectors/files";
import { broker } from "../connectors/queue";
import { datatables, type Condition } from "../connectors/datatables";
import { authHeaders, sendMail, sqlQuery, notify, mcpCall } from "../connectors/services";
import { plugins } from "../plugins/registry";
import { executePlugin } from "../plugins/runtime";
import { safeFetch } from "../net/egress";

export interface NodeContext {
  integration: string;
  env: EnvName;
  seen: Set<string>; // voor duplicate-check binnen een run
  depth?: number; // nesting van subprocessen
  callProcess?: (name: string, input: Record<string, unknown>) => Promise<Record<string, unknown>>;
}

export interface StepDef {
  id: string;
  type: string;
  config?: Record<string, unknown>;
}

type Payload = Record<string, unknown>;
export type NodeHandler = (payload: Payload, step: StepDef, ctx: NodeContext) => Promise<Payload>;

// Stappen met I/O naar buiten krijgen de retry-instellingen van het proces.
export const RETRYABLE = new Set(["call", "ftp", "sql", "email", "notify", "mcp-tool", "queue-publish", "connector"]);

function serialize(value: unknown, format: string): string {
  if (format === "csv") return csvGenerate(value);
  if (format === "xml") return xmlBuild(value);
  if (format === "json") return JSON.stringify(value, null, 2);
  return typeof value === "string" ? value : JSON.stringify(value);
}
function deserialize(text: string, format: string): unknown {
  if (format === "json") return JSON.parse(text);
  if (format === "csv") return csvParse(text);
  if (format === "xml") return xmlParse(text);
  return text;
}

// Gedeelde bestandsoperaties voor lokale bestanden en FTP/SFTP.
async function fileOp(payload: Payload, c: Record<string, unknown>, ctx: NodeContext, credential?: string): Promise<Payload> {
  const op = String(c.operation || "read");
  const path = tpl(c.path, payload, ctx.env);
  const format = String(c.format || "text");
  const target = String(c.target || (op === "list" ? "files" : "file"));
  const fs = await openFs(ctx.env, credential);
  try {
    if (op === "read" || op === "download") {
      const content = await fs.read(path);
      return setPath(payload, target, { path, content, data: format === "text" ? undefined : deserialize(content, format) });
    }
    if (op === "write" || op === "upload") {
      const source = c.contentField ? getPath(payload, String(c.contentField)) : payload;
      const content = serialize(source, format);
      await fs.write(path, content);
      return setPath(payload, target, { path, bytes: Buffer.byteLength(content), written: true });
    }
    if (op === "list") {
      const re = globToRegex(String(c.pattern || "*"));
      const items = (await fs.list(path || "/")).filter((f) => !f.isDir && re.test(f.name));
      return setPath(payload, target, items);
    }
    if (op === "delete") {
      await fs.remove(path);
      return setPath(payload, target, { path, deleted: true });
    }
    if (op === "move") {
      const to = tpl(c.toPath, payload, ctx.env);
      await fs.move(path, to);
      return setPath(payload, target, { from: path, to, moved: true });
    }
    throw new Error(`Onbekende bestandsoperatie: ${op}`);
  } finally {
    await fs.close();
  }
}

function compare(v: unknown, op: string, expected: unknown): boolean {
  switch (op) {
    case "exists": return v !== undefined && v !== null;
    case "equals": return String(v) === String(expected);
    case "notEquals": return String(v) !== String(expected);
    case "gt": return Number(v) > Number(expected);
    case "lt": return Number(v) < Number(expected);
    case "contains": return Array.isArray(v) ? v.map(String).includes(String(expected)) : String(v ?? "").includes(String(expected));
    default: return Boolean(v) && v !== "false" && v !== "0";
  }
}

// Veldpad uit de configuratie; "{{orderId}}" (ingesleept in de editor) betekent ook gewoon "orderId".
const asPath = (s: unknown): string => String(s ?? "").trim().replace(/^\{\{\s*([^{}]+?)\s*\}\}$/, "$1");

const nodes: Record<string, NodeHandler> = {
  // ---------- Data ----------
  validate: async (payload, step) => {
    const required = ((step.config?.required as string[]) ?? []).map(asPath).filter(Boolean);
    const missing = required.filter((f) => { const v = getPath(payload, f); return v === undefined || v === null || v === ""; });
    if (missing.length) throw new Error(`Validatie faalde: ontbrekende velden ${missing.join(", ")}`);
    return payload;
  },

  // Mapping: { doelveld: "bron.pad" } of { doelveld: "tekst met {{veld}}" }. Punten in het doelveld maken geneste objecten.
  transform: async (payload, step, ctx) => {
    const mapping = (step.config?.mapping as Record<string, string>) ?? null;
    if (!mapping) return payload;
    let out: Payload = step.config?.keepOthers === false ? {} : { ...payload };
    for (const [rawTarget, src] of Object.entries(mapping)) {
      const target = asPath(rawTarget);
      if (!target) continue;
      const value = typeof src === "string" && src.includes("{{") ? deepTpl(src, payload, ctx.env) : getPath(payload, String(src));
      out = setPath(out, target, value);
    }
    return out;
  },

  "duplicate-check": async (payload, step, ctx) => {
    const key = asPath(step.config?.key ?? "id") || "id";
    const value = String(getPath(payload, key) ?? "");
    if (value && ctx.seen.has(value)) throw new Error(`Duplicaat op ${key}=${value}`);
    if (value) ctx.seen.add(value);
    return payload;
  },

  // Velden toevoegen; waarden mogen {{templates}} bevatten.
  enrich: async (payload, step, ctx) => {
    // keepOthers false = alleen de ingestelde velden (zoals "Include Other Input Fields" uit); standaard: alles behouden.
    let out: Payload = step.config?.keepOthers === false ? {} : { ...payload };
    for (const [k, v] of Object.entries((step.config?.set as Record<string, unknown>) ?? {})) { const key = asPath(k); if (key) out = setPath(out, key, deepTpl(v, payload, ctx.env)); }
    return out;
  },

  csv: async (payload, step) => {
    const c = step.config ?? {};
    const field = String(c.field || (c.mode === "generate" ? "records" : "content"));
    const target = String(c.target || (c.mode === "generate" ? "csv" : "records"));
    const opts = { delimiter: String(c.delimiter || ","), header: c.header !== false };
    if (c.mode === "generate") return setPath(payload, target, csvGenerate(getPath(payload, field), opts));
    return setPath(payload, target, csvParse(String(getPath(payload, field) ?? ""), opts));
  },

  xml: async (payload, step) => {
    const c = step.config ?? {};
    const field = String(c.field || (c.mode === "build" ? "data" : "content"));
    const target = String(c.target || (c.mode === "build" ? "xml" : "data"));
    if (c.mode === "build") return setPath(payload, target, xmlBuild(getPath(payload, field), c.root ? String(c.root) : undefined));
    return setPath(payload, target, xmlParse(String(getPath(payload, field) ?? "")));
  },

  // ---------- Kern ----------
  // HTTP-aanroep. Zonder URL gesimuleerd met realistische latency (handig op DEV/TEST).
  call: async (payload, step, ctx) => {
    const c = step.config ?? {};
    // Ontbrekende {{variabelen}} in de URL niet stil leeg maken (zou een andere URL aanroepen).
    const missing = missingVars(c.url, payload);
    if (missing.length) throw Object.assign(new Error(`URL gebruikt ${missing.map((m) => `{{${m}}}`).join(", ")}, maar dat veld staat niet in het bericht`), { noRetry: true });
    const url = tpl(c.url, payload, ctx.env);
    // Zonder methode: GET (zoals in de editor), tenzij er expliciet een body is ingesteld.
    const method = String(c.method || (c.body && c.body !== "none" ? "POST" : "GET")).toUpperCase();
    const target = String(c.target || "_call");
    if (!url) {
      const latency = 20 + Math.round(Math.random() * 90);
      await sleep(latency);
      // Oude definities (zonder methode) gebruiken `target` als systeemnaam; in de editor is het het doelveld.
      const system = String(c.system ?? (c.method ? "geen URL ingesteld" : c.target ?? "onbekend"));
      return setPath(payload, target, { simulated: true, system, latencyMs: latency });
    }
    const u = new URL(url);
    for (const [k, v] of Object.entries((c.query as Record<string, unknown>) ?? {})) u.searchParams.set(k, tpl(v, payload, ctx.env));
    const headers: Record<string, string> = { "content-type": "application/json", ...authHeaders(ctx.env, c.credential as string | undefined) };
    for (const [k, v] of Object.entries((c.headers as Record<string, unknown>) ?? {})) headers[k.toLowerCase()] = tpl(v, payload, ctx.env);
    let body: string | undefined;
    if (!["GET", "HEAD"].includes(method) && c.body !== "none") {
      const src = c.body === "field" ? getPath(payload, String(c.bodyField || "")) : c.body === "custom" ? deepTpl(c.bodyTemplate ?? {}, payload, ctx.env) : payload;
      body = typeof src === "string" ? src : JSON.stringify(src);
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), Number(c.timeoutMs || 30000));
    try {
      const res = await safeFetch(u, { method, headers, body, signal: ctrl.signal }).catch((err: Error & { cause?: { code?: string } }) => {
        if (ctrl.signal.aborted) throw new Error(`${method} ${u.host}: geen antwoord binnen ${Number(c.timeoutMs || 30000)} ms`);
        if (err.message === "fetch failed") throw new Error(`${method} ${u.host}: niet bereikbaar${err.cause?.code ? ` (${err.cause.code})` : ""}`);
        throw err;
      });
      const text = await res.text();
      let data: unknown = text;
      try { data = JSON.parse(text); } catch { /* tekst */ }
      // 4xx (behalve 408/429) is definitief: niet opnieuw proberen.
      if (!res.ok && c.failOnError !== false) throw Object.assign(new Error(`${method} ${u.host}${u.pathname} -> ${res.status} ${String(text).slice(0, 200)}`), { noRetry: res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429 });
      return setPath(payload, target, { status: res.status, body: data });
    } finally {
      clearTimeout(timer);
    }
  },

  code: async (payload, step, ctx) => {
    const code = String(step.config?.code ?? "return input;");
    const { result, logs } = await runCode(code, payload, ctx.env, Number(step.config?.timeoutMs || 2000));
    return logs.length ? { ...result, _logs: logs } : result;
  },

  delay: async (payload, step) => {
    await sleep(Math.min(Math.max(Number(step.config?.ms ?? 1000), 0), 60000));
    return payload;
  },

  // Subproces: roep een ander (gedeployed) proces aan op dezelfde omgeving.
  subprocess: async (payload, step, ctx) => {
    const name = String(step.config?.process || "");
    if (!name) throw new Error("Subproces: kies een proces");
    if (!ctx.callProcess) throw new Error("Subproces niet beschikbaar in deze context");
    if ((ctx.depth ?? 0) >= 5) throw new Error("Subproces: maximale nesting (5) bereikt");
    const input = step.config?.inputField ? (getPath(payload, String(step.config.inputField)) as Payload) : payload;
    const out = await ctx.callProcess(name, input ?? {});
    // merge: de uitkomst vervangt/vult het bericht (zoals de oorspronkelijke stap deed).
    if (step.config?.merge) return { ...payload, ...out };
    return setPath(payload, String(step.config?.target || "subprocess"), out);
  },

  // ---------- Bestanden ----------
  file: async (payload, step, ctx) => fileOp(payload, step.config ?? {}, ctx),
  ftp: async (payload, step, ctx) => {
    const cred = step.config?.credential as string | undefined;
    if (!cred) throw new Error("FTP/SFTP: kies een koppeling (ftp, ftps of sftp)");
    return fileOp(payload, step.config ?? {}, ctx, cred);
  },

  // ---------- Berichten ----------
  "queue-publish": async (payload, step, ctx) => {
    const queue = tpl(step.config?.queue, payload, ctx.env);
    if (!queue) throw new Error("Queue: geen queuenaam");
    const body = step.config?.bodyField ? getPath(payload, String(step.config.bodyField)) : payload;
    const m = broker.publish(ctx.env, queue, body, { "x-source": ctx.integration });
    return setPath(payload, String(step.config?.target || "_queue"), { queue, messageId: m.id });
  },

  // Berichten van een queue ophalen (pull) en bevestigen.
  "queue-get": async (payload, step, ctx) => {
    const queue = tpl(step.config?.queue, payload, ctx.env);
    if (!queue) throw new Error("Queue: geen queuenaam");
    const msgs = broker.take(ctx.env, queue, Number(step.config?.max ?? 1));
    if (!msgs.length && step.config?.failIfEmpty) throw new Error(`Queue '${queue}' is leeg`);
    const bodies = msgs.map((m) => m.body);
    return setPath(payload, String(step.config?.target || "messages"), Number(step.config?.max ?? 1) === 1 ? bodies[0] ?? null : bodies);
  },

  // ---------- Datatabellen (ingebouwde opslag per omgeving) ----------
  datatable: async (payload, step, ctx) => {
    const c = step.config ?? {};
    const table = tpl(c.table, payload, ctx.env);
    if (!table) throw new Error("Datatabel: kies een tabel");
    const op = String(c.operation || "insert");
    const filter: Condition[] = ((c.conditions as Condition[]) ?? []).filter((x) => x.column).map((x) => ({ ...x, value: deepTpl(x.value, payload, ctx.env) }));
    const values = deepTpl(c.values ?? {}, payload, ctx.env) as Record<string, unknown>;
    const target = String(c.target || (op === "find" ? "rows" : "row"));
    if (op === "insert") return setPath(payload, target, datatables.insert(ctx.env, table, values)[0]);
    if (op === "upsert") return setPath(payload, target, datatables.upsert(ctx.env, table, filter, values).row);
    if (op === "find" || op === "get") {
      const r = datatables.find(ctx.env, table, filter, { limit: Number(c.limit || (op === "get" ? 1 : 100)), sortBy: c.sortBy ? String(c.sortBy) : undefined, desc: Boolean(c.desc) });
      if (op === "get" && !r.rows.length && c.failIfEmpty) throw new Error(`Geen rij gevonden in '${table}'`);
      return setPath(payload, target, op === "get" ? r.rows[0] ?? null : r.rows);
    }
    if (op === "update") return setPath(payload, target, { updated: datatables.update(ctx.env, table, filter, values).length });
    if (op === "delete") return setPath(payload, target, { deleted: datatables.remove(ctx.env, table, filter) });
    throw new Error(`Onbekende datatabel-operatie: ${op}`);
  },

  // ---------- Database ----------
  sql: async (payload, step, ctx) => {
    const c = step.config ?? {};
    const params = ((c.params as unknown[]) ?? []).map((p) => deepTpl(p, payload, ctx.env));
    const r = await sqlQuery(ctx.env, String(c.credential || ""), String(c.query || ""), params);
    return setPath(payload, String(c.target || "rows"), c.single ? r.rows[0] ?? null : r.rows);
  },

  // ---------- Communicatie ----------
  email: async (payload, step, ctx) => {
    const c = step.config ?? {};
    const r = await sendMail(ctx.env, c.credential as string | undefined, {
      to: tpl(c.to, payload, ctx.env),
      cc: c.cc ? tpl(c.cc, payload, ctx.env) : undefined,
      subject: tpl(c.subject, payload, ctx.env),
      text: c.text ? tpl(c.text, payload, ctx.env) : undefined,
      html: c.html ? tpl(c.html, payload, ctx.env) : undefined
    });
    return setPath(payload, String(c.target || "_email"), r);
  },

  notify: async (payload, step, ctx) => {
    const c = step.config ?? {};
    const r = await notify(ctx.env, { kind: String(c.kind || "teams"), url: c.url ? tpl(c.url, payload, ctx.env) : undefined, credential: c.credential as string | undefined, title: tpl(c.title, payload, ctx.env), text: tpl(c.text, payload, ctx.env) });
    return setPath(payload, String(c.target || "_notify"), r);
  },

  // ---------- AI & MCP ----------
  "mcp-tool": async (payload, step, ctx) => {
    const c = step.config ?? {};
    const r = await mcpCall(ctx.env, { credential: c.credential as string | undefined, url: c.url ? tpl(c.url, payload, ctx.env) : undefined, tool: String(c.tool || ""), args: (deepTpl(c.arguments ?? {}, payload, ctx.env) as Record<string, unknown>) });
    return setPath(payload, String(c.target || "mcp"), r.result);
  },

  // ---------- Plugins (connectors: Google, Microsoft, Slack, Salesforce, …) ----------
  connector: async (payload, step, ctx) => {
    const c = step.config ?? {};
    const def = plugins.get(String(c.plugin || ""));
    if (!def) throw new Error(c.plugin ? `Plugin '${c.plugin}' is nog niet beschikbaar` : "Connector: kies een plugin");
    const params = (deepTpl(c.params ?? {}, payload, ctx.env) ?? {}) as Record<string, unknown>;
    const r = await executePlugin({ plugin: def, operation: String(c.operation || ""), credential: c.credential ? String(c.credential) : undefined, params, env: ctx.env });
    return setPath(payload, String(c.target || def.id.replace(/-/g, "_")), r.data);
  },

  // ---------- Flow ----------
  // Exclusieve gateway: config.when (veld) + optioneel op/value. Zet _branch.taken.
  branch: async (payload, step) => {
    const c = step.config ?? {};
    const when = c.when === undefined ? undefined : asPath(c.when);
    const taken = when ? compare(getPath(payload, when), String(c.op || "truthy"), c.value) : true;
    return { ...payload, _branch: { taken } };
  },
  custom: async (payload) => payload,
  end: async (payload) => payload
};

// Stappen die opslag van het portaal gebruiken (datatabellen, queues). Op een externe
// agent (AWS/Azure) voert het portaal ze uit namens de agent; zie src/agent/agent.ts.
export const PORTAL_STEPS = new Set(["queue-publish", "queue-get", "datatable"]);
type StepDelegate = (type: string, config: Record<string, unknown>, payload: Payload, env: EnvName) => Promise<Payload>;
let delegate: StepDelegate | null = null;
export function setStepDelegate(fn: StepDelegate | null): void { delegate = fn; }

export function getNode(type: string): NodeHandler {
  if (delegate && PORTAL_STEPS.has(type)) { const d = delegate; return (payload, step, ctx) => d(type, step.config ?? {}, payload, ctx.env); }
  const handler = nodes[type];
  if (!handler) throw new Error(`Onbekend staptype: ${type}`);
  return handler;
}

// Machine-leesbare catalogus van staptypes (voor API, MCP en externe tooling).
export const STEP_CATALOG = [
  { type: "validate", group: "Data", label: "Validatie", description: "Controleer verplichte velden", config: { required: "string[] — veldpaden" } },
  { type: "transform", group: "Data", label: "Transformatie", description: "Velden mappen", config: { mapping: "{ doelveld: 'bron.pad' | 'tekst {{veld}}' }", keepOthers: "boolean (default true)" } },
  { type: "duplicate-check", group: "Data", label: "Duplicaatcheck", description: "Dubbele berichten tegenhouden", config: { key: "veldpad" } },
  { type: "enrich", group: "Data", label: "Velden instellen", description: "Velden toevoegen/overschrijven", config: { set: "{ veld: waarde | '{{template}}' }", keepOthers: "boolean (default true; false = alleen de ingestelde velden)" } },
  { type: "csv", group: "Data", label: "CSV", description: "CSV lezen of maken", config: { mode: "parse | generate", field: "bronveld", target: "doelveld", delimiter: "string", header: "boolean" } },
  { type: "xml", group: "Data", label: "XML", description: "XML lezen of maken", config: { mode: "parse | build", field: "bronveld", target: "doelveld", root: "rootelement (build)" } },
  { type: "call", group: "Kern", label: "HTTP-aanroep", description: "REST/HTTP-API aanroepen", retryable: true, config: { method: "GET|POST|PUT|PATCH|DELETE (default GET; POST als body is ingesteld)", url: "template; leeg = gesimuleerd", credential: "http-basic | http-bearer | api-key", headers: "object", query: "object", body: "payload | field | custom | none", target: "doelveld (default _call)" } },
  { type: "code", group: "Kern", label: "Code (JavaScript)", description: "Eigen JavaScript; `input` is het bericht, return het nieuwe bericht", config: { code: "string", timeoutMs: "number" } },
  { type: "delay", group: "Kern", label: "Wachten", description: "Pauzeer het proces", config: { ms: "number (max 60000)" } },
  { type: "subprocess", group: "Kern", label: "Subproces", description: "Ander proces aanroepen op dezelfde omgeving", config: { process: "procesnaam", inputField: "optioneel", target: "doelveld" } },
  { type: "file", group: "Bestanden", label: "Bestand (lokaal)", description: "Lezen/schrijven/lijst/verplaatsen/verwijderen in de bestandsmap van de omgeving", config: { operation: "read | write | list | move | delete", path: "template", format: "text | json | csv | xml", contentField: "veld (write)", pattern: "glob (list)", toPath: "template (move)", target: "doelveld" } },
  { type: "ftp", group: "Bestanden", label: "FTP / FTPS / SFTP", description: "Bestanden op een FTP-, FTPS- of SFTP-server", retryable: true, config: { credential: "ftp | ftps | sftp", operation: "download | upload | list | move | delete", path: "template", format: "text | json | csv | xml", contentField: "veld (upload)", pattern: "glob (list)", toPath: "template (move)", target: "doelveld" } },
  { type: "queue-publish", group: "Berichten", label: "Queue: publiceren", description: "Bericht op een queue zetten (zelfde omgeving)", retryable: true, config: { queue: "naam (template)", bodyField: "optioneel; default hele bericht" } },
  { type: "queue-get", group: "Berichten", label: "Queue: ophalen", description: "Berichten van een queue halen (pull) en bevestigen", config: { queue: "naam (template)", max: "aantal (1 = één bericht)", failIfEmpty: "boolean", target: "doelveld" } },
  { type: "datatable", group: "Database", label: "Datatabel", description: "Ingebouwde tabel (per omgeving): rijen toevoegen, zoeken, bijwerken, upserten of verwijderen", config: { table: "tabelnaam", operation: "insert | upsert | find | get | update | delete", conditions: "[{ column, op: eq|ne|gt|gte|lt|lte|contains|empty|notEmpty, value (template) }]", values: "{ kolom: waarde | '{{template}}' }", limit: "number", sortBy: "kolom", desc: "boolean", target: "doelveld" } },
  { type: "sql", group: "Database", label: "SQL (PostgreSQL)", description: "Query uitvoeren met parameters ($1, $2…)", retryable: true, config: { credential: "postgres", query: "string", params: "array van templates", single: "boolean", target: "doelveld" } },
  { type: "email", group: "Communicatie", label: "E-mail (SMTP)", description: "E-mail versturen; zonder koppeling gesimuleerd", retryable: true, config: { credential: "smtp", to: "template", cc: "template", subject: "template", text: "template", html: "template" } },
  { type: "notify", group: "Communicatie", label: "Teams / Slack", description: "Bericht naar een Teams- of Slack-webhook", retryable: true, config: { kind: "teams | slack", credential: "webhook", url: "optioneel", title: "template", text: "template" } },
  { type: "connector", group: "Plugins", label: "Connector (plugin)", description: "Een operatie van een plugin uitvoeren (Google, Microsoft, Slack, Salesforce, Stripe, …); zie /api/v1/plugins", retryable: true, config: { plugin: "plugin-id", operation: "operatie-id", credential: "koppeling (type plugin)", params: "object met parameters ({{templates}})", target: "doelveld" } },
  { type: "mcp-tool", group: "AI & MCP", label: "MCP-tool", description: "Tool aanroepen op een externe MCP-server", retryable: true, config: { credential: "mcp", url: "optioneel", tool: "toolnaam", arguments: "object met templates", target: "doelveld" } },
  { type: "custom", group: "Flow", label: "Doorgeven", description: "Bericht ongewijzigd doorgeven (placeholder of samenvoegpunt)", config: {} },
  { type: "branch", group: "Flow", label: "Beslissing", description: "Exclusieve gateway: ja/nee-pad", config: { when: "veldpad", op: "truthy | equals | notEquals | gt | lt | contains | exists", value: "vergelijkingswaarde" } },
  { type: "end", group: "Flow", label: "Einde", description: "Eindevent", config: {} }
];

export const TRIGGER_CATALOG = [
  { type: "manual", label: "Handmatig", description: "Starten vanuit de GUI, API of MCP", config: {} },
  { type: "api", label: "API-endpoint", description: "REST-endpoint per omgeving: /apis/<omgeving>/<pad>, met padparameters en OpenAPI-specificatie", config: { path: "bv. orders/{id}", method: "GET | POST | PUT | PATCH | DELETE", auth: "none | apikey", credential: "api-key-koppeling" } },
  { type: "webhook", label: "Webhook / HTTP", description: "HTTP-endpoint per omgeving: /hooks/<omgeving>/<pad>", config: { path: "pad (default procesnaam)", method: "POST | GET | PUT", auth: "none | apikey", credential: "api-key-koppeling (per omgeving andere sleutel)", response: "result | accepted" } },
  { type: "schedule", label: "Schema (cron)", description: "Periodiek starten", config: { cron: "5-velden cron, bv. */5 * * * *", everySeconds: "alternatief: interval in seconden" } },
  { type: "queue", label: "Queue", description: "Start per bericht op een queue van dezelfde omgeving", config: { queue: "naam", concurrency: "aantal tegelijk" } },
  { type: "file", label: "Map (lokaal)", description: "Nieuwe bestanden in een map van de omgeving", config: { dir: "map", pattern: "glob", intervalSeconds: "number", format: "text | json | csv | xml", after: "move | delete", archiveDir: "map" } },
  { type: "ftp", label: "FTP / SFTP", description: "Nieuwe bestanden op een FTP/FTPS/SFTP-server", config: { credential: "ftp | ftps | sftp", dir: "map", pattern: "glob", intervalSeconds: "number", format: "text | json | csv | xml", after: "move | delete", archiveDir: "map" } }
];
