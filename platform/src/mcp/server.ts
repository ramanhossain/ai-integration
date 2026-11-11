import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { blockedReason, matchTemplate } from "./policy";

// MCP-server van het integratieplatform. Elke tool is een dunne laag over de publieke
// REST-API, dus via MCP gelden exact dezelfde regels als via de GUI: deploys en
// uitvoeringen op PROD lopen door de goedkeuringslaag. Goedkeuringen beslissen kan
// alleen als AIP_MCP_ALLOW_APPROVALS=true (standaard uit: een AI stelt voor, een mens beslist).

export interface McpOptions {
  // Doorgegeven aan de platform-API (API-sleutel of sessie van de aanroeper).
  headers?: Record<string, string>;
  baseUrl: string; // REST-API van het platform
  allowApprovals: boolean;
  user: string; // wordt als actor/proposedBy vastgelegd in het audit log
  allowDelete?: boolean; // call_api: verwijderen/leegmaken toestaan (AIP_MCP_ALLOW_DELETE)
  onTool?: (name: string) => void; // voor de toollijst op de MCP-pagina en de MCP-agent
}

type ToolResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };

export function createMcpServer(opts: McpOptions): McpServer {
  const server = new McpServer(
    { name: "aip-integratieplatform", version: "0.1.0" },
    {
      instructions:
        "Integratieplatform met omgevingen DEV → TEST → ACC → PROD. Een proces is een BPMN-achtige graaf (steps + connections) volgens het schema in resource aip://schema/integration. " +
        "Opslaan maakt altijd een nieuwe versie op DEV. Deployen naar TEST/ACC vraagt 1 menselijke goedkeuring, PROD 2 (4-ogen). Gebruik list_step_types voor de beschikbare stappen en triggers. " +
        "Test een definitie eerst met test_process (of één stap met execute_step) voordat je save_process gebruikt. " +
        "Monitoren: get_process_health (succesratio en laatste fout per proces), list_runs met status=error, get_run, list_queue_messages/redrive_queue, list_b2b_messages, get_dashboard. " +
        "Functionaliteit zonder eigen tool vind je met list_api_operations en roep je aan met call_api."
    }
  );

  async function api(method: string, path: string, body?: unknown): Promise<any> {
    const res = await fetch(opts.baseUrl + path, {
      method,
      headers: { "content-type": "application/json", "x-aip-user": opts.user, ...(opts.headers || {}) },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await res.text();
    let data: any = text;
    try { data = JSON.parse(text); } catch { /* tekst */ }
    if (!res.ok) throw new Error(data?.error || data?.message || `${res.status} ${text.slice(0, 200)}`);
    return data;
  }
  const ok = (data: unknown): ToolResult => ({ content: [{ type: "text", text: typeof data === "string" ? data : JSON.stringify(data, null, 2) }] });
  const fail = (e: unknown): ToolResult => ({ content: [{ type: "text", text: `Fout: ${(e as Error).message}` }], isError: true });
  const tool = <S extends z.ZodRawShape>(name: string, title: string, description: string, shape: S, fn: (args: z.objectOutputType<S, z.ZodTypeAny>) => Promise<unknown>) =>
    (opts.onTool?.(name), server.registerTool(name, { title, description, inputSchema: shape }, (async (args: z.objectOutputType<S, z.ZodTypeAny>) => {
      try { return ok(await fn(args)); } catch (e) { return fail(e); }
    }) as never));

  const env = z.enum(["dev", "test", "acc", "prod"]);
  const json = z.record(z.string(), z.any());

  // ---------- processen ----------
  tool("list_processes", "Processen", "Alle processen met trigger, laatste versie en welke versie op DEV/TEST/ACC/PROD staat.", {}, async () => {
    const [ints, deps] = await Promise.all([api("GET", "/api/v1/integrations"), api("GET", "/api/v1/deployments")]);
    return ints.map((i: any) => {
      const d = deps.find((x: any) => x.integration === i.integration);
      return { name: i.integration, description: i.description, trigger: i.trigger?.type, steps: i.steps?.length, latestVersion: d?.latestVersion, environments: d?.envs, promotable: d?.promotable };
    });
  });
  tool("get_process", "Proces ophalen", "De volledige definitie (Integration-as-Code) van een proces; zonder versie de laatste (DEV).", { name: z.string(), version: z.number().int().optional() }, async (a) =>
    a.version ? api("GET", `/api/v1/integrations/${encodeURIComponent(a.name)}/versions/${a.version}`) : api("GET", `/api/v1/integrations/${encodeURIComponent(a.name)}`)
  );
  tool("save_process", "Proces opslaan", "Sla een procesdefinitie op als nieuwe versie op DEV. De definitie moet voldoen aan aip://schema/integration.", { definition: json }, async (a) =>
    api("POST", "/api/v1/integrations", { ...a.definition, owner: a.definition.owner ?? opts.user })
  );
  tool("export_process", "Proces exporteren", "Exporteer een proces als bundel (format aip.process-export): definitie, gebruikte subprocessen en benodigdheden (koppelingen, tabellen, queues bij naam — nooit geheimen).", { name: z.string(), version: z.number().int().optional(), subprocesses: z.boolean().optional() }, async (a) =>
    api("GET", `/api/v1/integrations/${encodeURIComponent(a.name)}/export?subprocesses=${a.subprocesses !== false}${a.version ? `&version=${a.version}` : ""}&by=${encodeURIComponent(opts.user)}`)
  );
  tool("import_process", "Proces importeren", "Importeer een AIP-export of een kale procesdefinitie als versie op DEV. onConflict: version (nieuwe versie, standaard), rename of fail. subprocesses: missing (standaard), all of none. Met dryRun=true alleen controleren wat er gebeurt en wat er op DEV ontbreekt.", { bundle: json, name: z.string().optional(), onConflict: z.enum(["version", "rename", "fail"]).optional(), subprocesses: z.enum(["missing", "all", "none"]).optional(), dryRun: z.boolean().optional() }, async (a) =>
    api("POST", "/api/v1/integrations/import", { ...a, owner: opts.user })
  );
  tool("review_process", "Proces beoordelen", "Laat de assistent een proces beoordelen: risico's (bv. endpoint zonder authenticatie), ontbrekende koppelingen, onbereikbare stappen, retry/dead-letter, recente fouten en deploystatus. Geeft samenvatting en bevindingen met niveau risk/warn/info/ok.", { name: z.string().optional(), definition: json.optional(), question: z.string().optional() }, async (a) =>
    api("POST", "/api/v1/agents/page/advise", { view: "editor", param: a.name, ...(a.definition ? { definition: a.definition } : {}), ...(a.question ? { question: a.question } : {}) })
  );
  tool("design_process", "Proces ontwerpen", "Laat de Builder Agent een proces ontwerpen uit een beschrijving in gewone taal. Met save=true wordt het direct als versie op DEV opgeslagen.", { prompt: z.string(), save: z.boolean().optional() }, async (a) =>
    api("POST", "/api/v1/agents/builder/design", { prompt: a.prompt, register: Boolean(a.save) })
  );
  tool("edit_process", "Proces aanpassen", "Pas een bestaand proces aan met een opdracht in gewone taal (bv. 'voeg een e-mail toe naar ops@bedrijf.nl', 'zet de trigger op elke 5 minuten'). Met save=true wordt het resultaat als nieuwe versie op DEV opgeslagen.", { name: z.string(), prompt: z.string(), save: z.boolean().optional() }, async (a) => {
    const def = await api("GET", `/api/v1/integrations/${encodeURIComponent(a.name)}`);
    const r = await api("POST", "/api/v1/agents/builder/edit", { definition: def, prompt: a.prompt });
    if (a.save && r.understood) {
      const saved = await api("POST", "/api/v1/integrations", { ...r.definition, version: undefined });
      return { changes: r.changes, savedVersion: saved.version };
    }
    return r;
  });
  tool("test_process", "Proces testen", "Voer een (nog niet opgeslagen) definitie of een bestaand proces uit op DEV met testinvoer. Geeft het gevolgde pad en de output per stap.", { name: z.string().optional(), definition: json.optional(), input: json.optional() }, async (a) => {
    const def = a.definition ?? (a.name ? await api("GET", `/api/v1/integrations/${encodeURIComponent(a.name)}`) : null);
    if (!def) throw new Error("Geef name of definition");
    return api("POST", "/api/v1/engine/test-run", { definition: def, input: a.input ?? {} });
  });
  tool("run_process", "Proces uitvoeren", "Voer de actieve versie van een proces uit op een omgeving. Op PROD is eerst menselijke goedkeuring nodig (dan komt status 'pending' terug).", { name: z.string(), env, input: json.optional() }, async (a) =>
    api("POST", `/api/v1/integrations/${encodeURIComponent(a.name)}/run`, { env: a.env, input: a.input ?? {}, proposedBy: opts.user })
  );
  tool("deploy_process", "Proces deployen", "Stel voor een versie op TEST, ACC of PROD te zetten. Zonder versie: de versie van de vorige omgeving. Met een versie kan ook overslaan (bv. DEV → PROD) of terugzetten naar een oudere versie. Dit maakt een goedkeuringsverzoek; een mens moet het goedkeuren. Bewerken gebeurt nooit op TEST/ACC/PROD, alleen op DEV.", { name: z.string(), env: z.enum(["test", "acc", "prod"]), version: z.number().int().min(1).optional(), reason: z.string().optional() }, async (a) =>
    api("POST", `/api/v1/integrations/${encodeURIComponent(a.name)}/deploy`, { toEnv: a.env, version: a.version, proposedBy: opts.user, reason: a.reason })
  );
  tool("list_versions", "Versies", "Alle versies van een proces, op welke omgeving ze actief zijn, en de deploygeschiedenis.", { name: z.string() }, async (a) =>
    api("GET", `/api/v1/integrations/${encodeURIComponent(a.name)}/versions`)
  );
  tool("restore_version", "Versie terugzetten op DEV", "Zet een oude versie terug op DEV. Dat wordt een nieuwe versie (kopie van de oude); daarna kun je hem deployen. Terugzetten op TEST/ACC/PROD doe je met deploy_process en een versie.", { name: z.string(), version: z.number().int().min(1) }, async (a) =>
    api("POST", `/api/v1/integrations/${encodeURIComponent(a.name)}/versions/${a.version}/restore`, { owner: opts.user })
  );

  // ---------- uitvoeringen & monitoring ----------
  tool("list_runs", "Uitvoeringen", "Recente uitvoeringen, optioneel gefilterd op proces, omgeving en status (success/error).", { name: z.string().optional(), env: env.optional(), status: z.enum(["success", "error"]).optional(), limit: z.number().int().min(1).max(200).optional() }, async (a) => {
    const q = new URLSearchParams();
    if (a.name) q.set("integration", a.name);
    if (a.env) q.set("env", a.env);
    q.set("limit", String(a.status ? 500 : a.limit ?? 20));
    let runs = await api("GET", `/api/v1/runs?${q}`);
    if (a.status) runs = runs.filter((r: any) => r.status === a.status).slice(0, a.limit ?? 20);
    return runs.map((r: any) => ({ id: r.id, integration: r.integration, env: r.env, version: r.version, status: r.status, triggeredBy: r.triggeredBy, durationMs: r.durationMs, at: r.finishedAt, error: r.error }));
  });
  tool("get_run", "Uitvoering ophalen", "Details van één uitvoering, inclusief input/output per stap.", { id: z.string() }, async (a) => api("GET", `/api/v1/runs/${encodeURIComponent(a.id)}`));
  tool("get_dashboard", "Dashboard", "Monitoring-overzicht: uitvoeringen, succesratio, fouten, deployments per omgeving, openstaande goedkeuringen.", {}, async () => api("GET", "/api/v1/dashboard"));
  tool("report_incident", "Incident melden", "Meld een incident; de Recovery Agent stelt een herstelactie voor die via goedkeuring loopt.", { integration: z.string(), severity: z.enum(["low", "medium", "high", "critical"]), problem: z.string(), rootCause: json.optional() }, async (a) =>
    api("POST", "/api/v1/agents/monitoring/analyze", a)
  );

  // ---------- goedkeuringen ----------
  tool("list_approvals", "Goedkeuringen", "Goedkeuringsverzoeken (standaard alleen openstaande).", { status: z.enum(["pending", "executed", "rejected", "failed", "expired", "all"]).optional() }, async (a) => {
    const all = await api("GET", "/api/v1/approvals");
    const s = a.status ?? "pending";
    return (s === "all" ? all : all.filter((x: any) => x.status === s)).map((x: any) => ({ id: x.id, type: x.action.type, riskLevel: x.riskLevel, status: x.status, target: x.action.target, proposedBy: x.action.proposedBy, approvals: x.approvals, required: x.requiredApprovals }));
  });
  if (opts.allowApprovals) {
    tool("decide_approval", "Goedkeuring beslissen", "Keur een verzoek goed of af. Alleen beschikbaar omdat AIP_MCP_ALLOW_APPROVALS=true.", { id: z.string(), decision: z.enum(["approve", "reject"]), reason: z.string().optional() }, async (a) =>
      api("POST", `/api/v1/approvals/${encodeURIComponent(a.id)}/${a.decision}`, { approver: opts.user, reason: a.reason })
    );
  }

  tool("get_settings", "Instellingen", "Platforminstellingen, o.a. of het vier-ogenprincipe aan staat (alleen lezen; wijzigen kan alleen door een mens in de GUI).", {}, async () => api("GET", "/api/v1/settings"));

  // ---------- catalogus, triggers, koppelingen, queues ----------
  tool("list_step_types", "Staptypes en triggers", "Alle beschikbare staptypes (koppelingen) en triggertypes met hun configuratievelden.", {}, async () => api("GET", "/api/v1/step-types"));
  tool("list_agent_groups", "Omgevingsvarianten", "Agentgroepen per omgeving (ingebouwd Platform, AWS, Azure, …) met verbonden agents, status en welke processen er draaien. Geen sleutels.", { env: env.optional() }, async (a) =>
    api("GET", `/api/v1/agent-groups${a.env ? `?env=${a.env}` : ""}`)
  );
  tool("list_plugins", "Plugins (connectors)", "Overzicht van alle connectors (Google, Microsoft, Slack, Salesforce, Stripe, …) met status beschikbaar/gepland. Filter met q (zoektekst) of category.", { q: z.string().optional(), category: z.string().optional() }, async (a) =>
    api("GET", `/api/v1/plugins?status=beschikbaar${a.q ? `&q=${encodeURIComponent(a.q)}` : ""}${a.category ? `&category=${encodeURIComponent(a.category)}` : ""}`)
  );
  tool("get_plugin", "Plugin-definitie", "Operaties en parameters van één connector, om een stap van type 'connector' te bouwen (config: plugin, operation, credential, params, target).", { id: z.string() }, async (a) =>
    api("GET", `/api/v1/plugins/${encodeURIComponent(a.id)}`)
  );
  tool("list_triggers", "Triggers", "Actieve triggers per omgeving, met webhook-URL's, volgende uitvoertijd en laatste status.", {}, async () => api("GET", "/api/v1/triggers"));
  tool("list_credentials", "Koppelingen", "Beschikbare koppelingen (naam, type, omgevingen). Geheime waarden worden nooit getoond.", {}, async () => {
    const r = await api("GET", "/api/v1/credentials");
    return r.items.map((c: any) => ({ name: c.name, type: c.type, description: c.description, environments: c.envs }));
  });
  tool("list_queues", "Queues", "Queues met diepte, dead-letter en verwerkingsstatistieken.", { env: env.optional() }, async (a) => api("GET", `/api/v1/queues${a.env ? `?env=${a.env}` : ""}`));
  tool("publish_message", "Bericht publiceren", "Zet een bericht op een queue van een omgeving (start processen met een queue-trigger).", { env, queue: z.string(), message: z.any() }, async (a) =>
    api("POST", `/api/v1/queues/${a.env}/${encodeURIComponent(a.queue)}/messages`, { body: a.message })
  );

  // ---------- datatabellen ----------
  tool("list_datatables", "Datatabellen", "Ingebouwde datatabellen van een omgeving met kolommen en aantal rijen.", { env }, async (a) => api("GET", `/api/v1/datatables/${a.env}`));
  tool("query_datatable", "Datatabel doorzoeken", "Rijen uit een datatabel, optioneel met voorwaarden [{column, op, value}] (op: eq, ne, gt, gte, lt, lte, contains, empty, notEmpty).", { env, table: z.string(), conditions: z.array(z.object({ column: z.string(), op: z.string().optional(), value: z.any().optional() })).optional(), limit: z.number().int().min(1).max(1000).optional() }, async (a) =>
    api("POST", `/api/v1/datatables/${a.env}/${encodeURIComponent(a.table)}/query`, { conditions: a.conditions, limit: a.limit })
  );
  tool("insert_datatable_rows", "Rijen toevoegen", "Voeg één of meer rijen toe aan een datatabel.", { env, table: z.string(), rows: z.array(json) }, async (a) =>
    api("POST", `/api/v1/datatables/${a.env}/${encodeURIComponent(a.table)}/rows`, a.rows)
  );
  tool("create_datatable", "Datatabel aanmaken", "Maak een datatabel met kolommen (types: string, number, boolean, date, json). De tabel wordt aangemaakt op alle omgevingen (DEV, TEST, ACC, PROD) met dezelfde kolommen; de rijen zijn per omgeving gescheiden.", { env, name: z.string(), columns: z.array(z.object({ name: z.string(), type: z.enum(["string", "number", "boolean", "date", "json"]) })), description: z.string().optional() }, async (a) =>
    api("POST", `/api/v1/datatables/${a.env}`, { name: a.name, columns: a.columns, description: a.description })
  );
  tool("create_queue", "Queue aanmaken", "Maak een queue. Hij wordt aangemaakt op alle omgevingen (DEV, TEST, ACC, PROD) met dezelfde naam; de berichten zijn per omgeving gescheiden.", { env, queue: z.string(), description: z.string().optional() }, async (a) =>
    api("POST", `/api/v1/queues/${a.env}`, { queue: a.queue, description: a.description })
  );

  // ---------- bouwen: stappen, koppelingen en plugins los testen ----------
  tool("execute_step", "Stap uitvoeren", "Voer één stap los uit op DEV (zoals 'Stap uitvoeren' in de editor) om de config te controleren voordat je hem in een proces zet. steps/trigger vullen {{$steps.<id>.…}} en {{$trigger.…}}.", { type: z.string(), config: json.optional(), input: json.optional(), steps: json.optional(), trigger: json.optional() }, async (a) =>
    api("POST", "/api/v1/engine/execute-step", { type: a.type, config: a.config ?? {}, input: a.input ?? {}, steps: a.steps, trigger: a.trigger })
  );
  tool("list_credential_types", "Koppelingstypes", "Soorten koppelingen (HTTP, SQL, SMTP, MCP, plugin, …) met hun velden; welke velden geheim zijn.", {}, async () => api("GET", "/api/v1/credential-types"));
  tool("save_credential", "Koppeling opslaan", "Maak of wijzig een koppeling met waarden per omgeving: values = { dev: {veld: waarde}, test: {...} }. Geheime velden worden versleuteld opgeslagen en nooit teruggegeven; laat een geheim veld weg om de bestaande waarde te houden.", { name: z.string(), type: z.string(), plugin: z.string().optional(), description: z.string().optional(), values: z.record(z.string(), z.record(z.string(), z.string())).optional() }, async (a) =>
    api("PUT", `/api/v1/credentials/${encodeURIComponent(a.name)}`, { type: a.type, plugin: a.plugin, description: a.description, values: a.values })
  );
  tool("test_credential", "Koppeling testen", "Test de verbinding van een koppeling met de waarden van één omgeving.", { name: z.string(), env }, async (a) =>
    api("POST", `/api/v1/credentials/${encodeURIComponent(a.name)}/test`, { env: a.env })
  );
  tool("run_plugin_operation", "Plugin-operatie uitvoeren", "Voer één operatie van een connector direct uit (niet op PROD), bv. om te zien welke velden een API teruggeeft voordat je een connector-stap bouwt.", { id: z.string(), operation: z.string(), credential: z.string().optional(), params: json.optional(), env: z.enum(["dev", "test", "acc"]).optional() }, async (a) =>
    api("POST", `/api/v1/plugins/${encodeURIComponent(a.id)}/execute`, { operation: a.operation, credential: a.credential, params: a.params ?? {}, env: a.env })
  );
  tool("set_trigger", "Trigger pauzeren/hervatten", "Pauzeer of hervat de trigger (schema, webhook, queue, polling, …) van een proces op een omgeving.", { env, name: z.string(), action: z.enum(["pause", "resume"]) }, async (a) =>
    api("POST", `/api/v1/triggers/${a.env}/${encodeURIComponent(a.name)}/${a.action}`)
  );

  // ---------- monitoring ----------
  tool("get_process_health", "Gezondheid per proces", "Per proces (en omgeving): aantal uitvoeringen, fouten, succesratio, gemiddelde en maximale duur, laatste fout en tijdstip, dead-letters. Over de laatste `limit` uitvoeringen (standaard 500).", { name: z.string().optional(), env: env.optional(), limit: z.number().int().min(1).max(5000).optional() }, async (a) => {
    const q = new URLSearchParams({ limit: String(a.limit ?? 500) });
    if (a.name) q.set("integration", a.name);
    if (a.env) q.set("env", a.env);
    const runs: any[] = await api("GET", `/api/v1/runs?${q}`);
    const groups = new Map<string, any[]>();
    for (const r of runs.filter((r) => !r.test)) {
      const k = `${r.integration}|${r.env}`;
      groups.set(k, [...(groups.get(k) ?? []), r]);
    }
    return [...groups.entries()].map(([k, rs]) => {
      const [integration, e] = k.split("|");
      const errors = rs.filter((r) => r.status === "error");
      const ms = rs.map((r) => r.durationMs ?? 0);
      const lastError = errors.sort((x, y) => String(y.finishedAt).localeCompare(String(x.finishedAt)))[0];
      return {
        integration, env: e, runs: rs.length, errors: errors.length,
        successRate: Math.round(((rs.length - errors.length) / rs.length) * 1000) / 10,
        avgMs: Math.round(ms.reduce((s, x) => s + x, 0) / rs.length), maxMs: Math.max(...ms),
        deadLettered: rs.filter((r) => r.deadLettered).length,
        lastRunAt: rs.map((r) => r.finishedAt).sort().pop(),
        lastError: lastError ? { at: lastError.finishedAt, message: lastError.error, runId: lastError.id } : undefined
      };
    }).sort((x, y) => y.errors - x.errors || x.integration.localeCompare(y.integration));
  });
  tool("list_incidents", "Incidenten", "Gemelde incidenten met analyse.", {}, async () => api("GET", "/api/v1/incidents"));
  tool("list_security_findings", "Beveiligingsbevindingen", "Bevindingen van de securitycontrole.", {}, async () => api("GET", "/api/v1/findings"));
  tool("get_audit_log", "Audit log", "Recente audit-regels (wie deed wat) en of de keten intact is.", { limit: z.number().int().min(1).max(1000).optional() }, async (a) =>
    api("GET", `/api/v1/audit?limit=${a.limit ?? 50}`)
  );
  tool("list_queue_messages", "Queue-berichten", "Berichten op een queue, inclusief dead-letter, om vastgelopen berichten te bekijken.", { env, queue: z.string() }, async (a) =>
    api("GET", `/api/v1/queues/${a.env}/${encodeURIComponent(a.queue)}/messages`)
  );
  tool("redrive_queue", "Dead-letter opnieuw aanbieden", "Zet alle dead-letterberichten van een queue terug op de queue zodat ze opnieuw verwerkt worden.", { env, queue: z.string() }, async (a) =>
    api("POST", `/api/v1/queues/${a.env}/${encodeURIComponent(a.queue)}/redrive`)
  );
  tool("list_api_calls", "API-aanroepen", "API-management-monitoring: aanroepen van gepubliceerde API's met status en duur, plus statistiek. Filters o.a. api, env, status, minMs, limit.", { filters: z.record(z.string(), z.union([z.string(), z.number()])).optional() }, async (a) =>
    api("GET", `/api/v1/apim/logs?${new URLSearchParams(Object.entries(a.filters ?? {}).map(([k, v]) => [k, String(v)] as [string, string]))}`)
  );

  tool("list_b2b_messages", "B2B-berichten (ebMS/AS4)", "Ingaande en uitgaande ebMS 2.0- of AS4-berichten van een omgeving met status (bv. om mislukte of onbevestigde berichten te vinden). box: inbox of outbox.", { protocol: z.enum(["ebms", "as4"]), env, credential: z.string().optional(), box: z.enum(["inbox", "outbox"]).optional() }, async (a) =>
    api("GET", `/api/v1/${a.protocol}/${a.env}/messages?${new URLSearchParams(Object.entries({ credential: a.credential, box: a.box }).filter(([, v]) => v) as [string, string][])}`)
  );
  tool("redrive_b2b_message", "B2B-bericht opnieuw", "Bied een mislukt ebMS- of AS4-bericht opnieuw aan (id uit list_b2b_messages).", { protocol: z.enum(["ebms", "as4"]), env, id: z.string() }, async (a) =>
    api("POST", `/api/v1/${a.protocol}/${a.env}/messages/${encodeURIComponent(a.id)}/redrive`)
  );
  tool("list_published_apis", "Gepubliceerde API's", "API's uit API-management met versies, gekoppelde processen en op welke omgevingen ze gedeployed zijn.", {}, async () => api("GET", "/api/v1/apim/apis"));

  // ---------- alle overige functionaliteit (blijft vanzelf actueel) ----------
  let spec: any;
  const operations = async () => {
    spec ??= await api("GET", "/openapi.json");
    const out: Array<{ method: string; path: string; tags: string[]; summary?: string; blocked?: string }> = [];
    for (const [path, ms] of Object.entries<any>(spec.paths ?? {}))
      for (const [method, op] of Object.entries<any>(ms))
        out.push({ method: method.toUpperCase(), path, tags: op.tags ?? [], summary: op.summary || op.description, blocked: blockedReason(method, path, { allowApprovals: opts.allowApprovals, allowDelete: Boolean(opts.allowDelete) }) });
    return out;
  };
  tool("list_api_operations", "API-operaties", "Alle REST-operaties van het platform (uit de OpenAPI-spec), ook functionaliteit zonder eigen MCP-tool. Filter op zoektekst of tag. Aanroepen met call_api.", { q: z.string().optional(), tag: z.string().optional() }, async (a) => {
    const q = a.q?.toLowerCase();
    return (await operations()).filter((o) => !o.blocked && (!a.tag || o.tags.includes(a.tag)) && (!q || `${o.method} ${o.path} ${o.tags.join(" ")} ${o.summary ?? ""}`.toLowerCase().includes(q)))
      .map(({ blocked: _b, ...o }) => o);
  });
  tool("call_api", "API aanroepen", "Roep een REST-operatie van het platform aan (zie list_api_operations), bv. method GET, path /api/v1/ebms/dev/messages. Zelfde regels als de GUI: PROD loopt via goedkeuring. Accounts/beheer, goedkeuren en verwijderen zijn hier niet toegestaan.", { method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]), path: z.string(), query: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(), body: z.any().optional() }, async (a) => {
    const path = a.path.split("?")[0];
    const template = matchTemplate(path, (await operations()).filter((o) => o.method === a.method).map((o) => o.path));
    if (!template) throw new Error(`Onbekende operatie ${a.method} ${path}; zie list_api_operations`);
    const why = blockedReason(a.method, template, { allowApprovals: opts.allowApprovals, allowDelete: Boolean(opts.allowDelete) });
    if (why) throw new Error(`Niet toegestaan via MCP: ${why}`);
    const qs = a.query ? `?${new URLSearchParams(Object.entries(a.query).map(([k, v]) => [k, String(v)] as [string, string]))}` : "";
    return api(a.method, path + qs, a.body);
  });

  // ---------- resources ----------
  server.registerResource("integration-schema", "aip://schema/integration", { title: "Schema procesdefinitie", description: "JSON Schema van een procesdefinitie (Integration-as-Code)", mimeType: "application/json" }, async (uri) => ({
    contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(await api("GET", "/api/v1/schemas/integration"), null, 2) }]
  }));
  server.registerResource(
    "process",
    new ResourceTemplate("aip://processes/{name}", {
      list: async () => ({
        resources: (await api("GET", "/api/v1/integrations")).map((i: any) => ({ uri: `aip://processes/${encodeURIComponent(i.integration)}`, name: i.integration, description: i.description, mimeType: "application/json" }))
      })
    }),
    { title: "Proces", description: "Definitie van een proces", mimeType: "application/json" },
    async (uri, vars) => ({
      contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(await api("GET", `/api/v1/integrations/${encodeURIComponent(String(vars.name))}`), null, 2) }]
    })
  );

  // ---------- prompt ----------
  server.registerPrompt(
    "integratie-bouwen",
    { title: "Integratie bouwen", description: "Begeleid het bouwen, testen en opslaan van een nieuwe integratie", argsSchema: { beschrijving: z.string() } },
    ({ beschrijving }) => ({
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: `Bouw een integratie op het AIP-platform: ${beschrijving}\n\n1. Lees resource aip://schema/integration en roep list_step_types en list_credentials aan.\n2. Stel een definitie op met steps (met position) en connections (from 'start').\n3. Test met test_process en verbeter tot het slaagt.\n4. Sla op met save_process (komt op DEV).\n5. Stel met deploy_process eventueel promotie naar TEST voor; een mens keurt goed.`
        }
      }]
    })
  );

  return server;
}

// Namen van alle tools die een client met deze opties ziet (zonder iets aan te roepen).
export function mcpToolNames(opts: McpOptions): string[] {
  const names: string[] = [];
  createMcpServer({ ...opts, onTool: (n) => names.push(n) });
  return names;
}
