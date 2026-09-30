import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

// MCP-server van het integratieplatform. Elke tool is een dunne laag over de publieke
// REST-API, dus via MCP gelden exact dezelfde regels als via de GUI: deploys en
// uitvoeringen op PROD lopen door de goedkeuringslaag. Goedkeuringen beslissen kan
// alleen als AIP_MCP_ALLOW_APPROVALS=true (standaard uit: een AI stelt voor, een mens beslist).

export interface McpOptions {
  baseUrl: string; // REST-API van het platform
  allowApprovals: boolean;
  user: string; // wordt als actor/proposedBy vastgelegd in het audit log
}

type ToolResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };

export function createMcpServer(opts: McpOptions): McpServer {
  const server = new McpServer(
    { name: "aip-integratieplatform", version: "0.1.0" },
    {
      instructions:
        "Integratieplatform met omgevingen DEV → TEST → ACC → PROD. Een proces is een BPMN-achtige graaf (steps + connections) volgens het schema in resource aip://schema/integration. " +
        "Opslaan maakt altijd een nieuwe versie op DEV. Deployen naar TEST/ACC vraagt 1 menselijke goedkeuring, PROD 2 (4-ogen). Gebruik list_step_types voor de beschikbare stappen en triggers. " +
        "Test een definitie eerst met test_process voordat je save_process gebruikt."
    }
  );

  async function api(method: string, path: string, body?: unknown): Promise<any> {
    const res = await fetch(opts.baseUrl + path, {
      method,
      headers: { "content-type": "application/json", "x-aip-user": opts.user },
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
    server.registerTool(name, { title, description, inputSchema: shape }, (async (args: z.objectOutputType<S, z.ZodTypeAny>) => {
      try { return ok(await fn(args)); } catch (e) { return fail(e); }
    }) as never);

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
  tool("list_runs", "Uitvoeringen", "Recente uitvoeringen, optioneel gefilterd op proces en omgeving.", { name: z.string().optional(), env: env.optional(), limit: z.number().int().min(1).max(200).optional() }, async (a) => {
    const q = new URLSearchParams();
    if (a.name) q.set("integration", a.name);
    if (a.env) q.set("env", a.env);
    q.set("limit", String(a.limit ?? 20));
    const runs = await api("GET", `/api/v1/runs?${q}`);
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
