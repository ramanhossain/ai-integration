import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import Fastify from "fastify";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import fastifyStatic from "@fastify/static";
import { config } from "./config";
import { registerRoutes } from "./api/routes";
import { registerAgentRoutes } from "./api/agentRoutes";
import { persistence } from "./store";
import { registry } from "./domain/registry";
import { approvals } from "./approval/approvalEngine";
import { audit } from "./audit/auditLog";
import { deployments } from "./domain/deployments";
import { engine } from "./engine/engine";
import { registerPlatformRoutes } from "./api/platformRoutes";
import { registerTransferRoutes } from "./api/transferRoutes";
import { registerRuntimeRoutes } from "./api/runtimeRoutes";
import { registerPluginRoutes } from "./api/pluginRoutes";
import { agentGroups } from "./runtime/agentGroups";
import { registerConnectorRoutes } from "./api/connectorRoutes";
import { credentials } from "./connectors/credentials";
import { settings } from "./domain/settings";
import { broker } from "./connectors/queue";
import { datatables } from "./connectors/datatables";
import { triggers } from "./triggers/manager";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpServer } from "./mcp/server";

const SCHEMA_DIR = join(__dirname, "..", "schemas");
const PUBLIC_DIR = join(__dirname, "..", "public");

export async function buildServer() {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" } });

  // JSON-parser die een lege body accepteert (veel clients sturen content-type json
  // mee bij een POST zonder body, bv. pause/redrive-acties).
  app.removeContentTypeParser("application/json");
  app.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => {
    const text = String(body ?? "").trim();
    if (!text) return done(null, undefined);
    try { done(null, JSON.parse(text)); }
    catch (err) { (err as Error & { statusCode?: number }).statusCode = 400; done(err as Error, undefined); }
  });

  // Persistentie: init + status hydrateren (in-memory by default; Postgres via DATABASE_URL).
  await persistence.init();
  await audit.hydrate();
  await deployments.hydrate();
  await agentGroups.hydrate();
  await engine.hydrate();
  await registry.hydrate();
  await settings.hydrate();
  await approvals.hydrate();
  await credentials.hydrate();
  await broker.hydrate();
  await datatables.hydrate();
  await triggers.hydrate();

  // JSON Schemas als bron van waarheid: laden en registreren voor validatie + OpenAPI.
  for (const file of readdirSync(SCHEMA_DIR).filter((f) => f.endsWith(".json"))) {
    const schema = JSON.parse(readFileSync(join(SCHEMA_DIR, file), "utf8"));
    app.addSchema(schema);
  }

  await app.register(swagger, {
    openapi: {
      info: {
        title: "Agentic Integration Platform — Control Plane API",
        description: "API-first integratieplatform met eigen workflow-engine, omgevingen (dev/test/acc/prod), agents en human-in-the-loop. Alles is ook machine-leesbaar.",
        version: "0.1.0"
      },
      tags: [
        { name: "integrations", description: "Integration-as-Code" },
        { name: "environments", description: "Omgevingen en promotie dev -> test -> acc -> prod" },
        { name: "runs", description: "Uitvoeringen door de eigen engine" },
        { name: "actions", description: "Acties -> policy -> approval" },
        { name: "approvals", description: "Human-in-the-Loop goedkeuring" },
        { name: "agents", description: "AI-agents (Claude of heuristiek)" },
        { name: "monitoring", description: "Incidenten" },
        { name: "security", description: "Security-findings" },
        { name: "audit", description: "Append-only audit log" },
        { name: "catalog", description: "Machine-leesbaar register" },
        { name: "mcp", description: "MCP-server (Streamable HTTP op /mcp, stdio via npm run mcp)" },
        { name: "credentials", description: "Koppelingen met waarden per omgeving (geheimen versleuteld)" },
        { name: "queues", description: "Ingebouwde message broker per omgeving" },
        { name: "triggers", description: "Webhook, schema, queue, map en FTP/SFTP-triggers" },
        { name: "files", description: "Bestandsmap per omgeving" },
        { name: "datatables", description: "Ingebouwde datatabellen per omgeving" },
        { name: "settings", description: "Platforminstellingen (o.a. vier-ogenprincipe)" },
        { name: "events", description: "Event stream (SSE)" }
      ]
    }
  });
  await app.register(swaggerUi, { routePrefix: "/docs" });

  await registerRoutes(app);
  await registerAgentRoutes(app);
  await registerPlatformRoutes(app);
  await registerTransferRoutes(app);
  await registerRuntimeRoutes(app);
  await registerPluginRoutes(app);
  await registerConnectorRoutes(app);

  // JSON Schemas ook los opvraagbaar (o.a. voor MCP-resources).
  app.get<{ Params: { name: string } }>("/api/v1/schemas/:name", { schema: { tags: ["catalog"] } }, async (req, reply) => {
    try { return app.getSchema(`https://aip.local/schemas/${req.params.name}.json`) ?? reply.code(404).send({ error: "Schema niet gevonden" }); }
    catch { return reply.code(404).send({ error: "Schema niet gevonden" }); }
  });

  // ---------- MCP-server (Streamable HTTP, stateless) ----------
  const mcpToken = process.env.AIP_MCP_TOKEN;
  const allowApprovals = process.env.AIP_MCP_ALLOW_APPROVALS === "true";
  app.get("/api/v1/mcp/info", { schema: { tags: ["mcp"] } }, async (req) => {
    const host = process.env.AIP_PUBLIC_URL || `${req.protocol}://${req.headers.host}`;
    const root = join(__dirname, "..");
    return {
      httpUrl: `${host}/mcp`,
      tokenRequired: Boolean(mcpToken),
      allowApprovals,
      stdio: { command: join(root, "node_modules", ".bin", "tsx"), args: [join(root, "src", "mcp", "stdio.ts")], env: { AIP_URL: host } },
      tools: ["list_processes", "get_process", "save_process", "edit_process", "design_process", "test_process", "run_process", "deploy_process", "list_runs", "get_run", "get_dashboard", "report_incident", "list_approvals", "get_settings", ...(allowApprovals ? ["decide_approval"] : []), "list_step_types", "list_triggers", "list_credentials", "list_queues", "publish_message", "create_queue", "list_datatables", "query_datatable", "insert_datatable_rows", "create_datatable"],
      resources: ["aip://schema/integration", "aip://processes/{name}"],
      prompts: ["integratie-bouwen"]
    };
  });
  app.route({
    method: ["GET", "POST", "DELETE"],
    url: "/mcp",
    schema: { hide: true },
    handler: async (req, reply) => {
      if (mcpToken && req.headers.authorization !== `Bearer ${mcpToken}`) {
        return reply.code(401).send({ jsonrpc: "2.0", error: { code: -32001, message: "Ongeldig of ontbrekend MCP-token" }, id: null });
      }
      if (req.method !== "POST") {
        return reply.code(405).send({ jsonrpc: "2.0", error: { code: -32000, message: "Deze server is stateless: gebruik POST" }, id: null });
      }
      const server = createMcpServer({ baseUrl: `http://127.0.0.1:${config.port}`, allowApprovals, user: String(req.headers["x-aip-user"] || "mcp-http") });
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      reply.hijack();
      reply.raw.on("close", () => { void transport.close(); void server.close(); });
      await server.connect(transport);
      await transport.handleRequest(req.raw, reply.raw, req.body);
    }
  });

  // Machine-leesbare OpenAPI-spec op een stabiel pad.
  app.get("/openapi.json", async () => app.swagger());

  // GUI (de cockpit). Eén client naast agents en externe systemen.
  await app.register(fastifyStatic, { root: PUBLIC_DIR, prefix: "/app/" });
  app.get("/", async (_req, reply) => reply.redirect("/app/"));

  return app;
}

async function main() {
  const app = await buildServer();
  try {
    await app.listen({ port: config.port, host: config.host });
    broker.start();
    triggers.start();
    app.log.info(`Platform draait — persistentie: ${persistence.kind} · engine: built-in · MCP: /mcp${mcpTokenInfo()}`);
    app.log.info(`GUI: http://localhost:${config.port}/app/  ·  Docs: /docs  ·  OpenAPI: /openapi.json`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

function mcpTokenInfo(): string {
  return process.env.AIP_MCP_TOKEN ? " (token vereist)" : " (zonder token)";
}

if (require.main === module) {
  void main();
}
