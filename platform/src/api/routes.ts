import type { FastifyInstance } from "fastify";
import { approvals } from "../approval/approvalEngine";
import { registry } from "../domain/registry";
import { agents } from "../domain/agents";
import { audit } from "../audit/auditLog";
import { bus } from "../events/bus";
import { manifest, callTool } from "../mcp/bridge";
import { persistence } from "../store";
import { settings } from "../domain/settings";
import { ENVIRONMENTS } from "../domain/environments";
import type { Action, Integration } from "../domain/types";

// Alle functionaliteit is API-first: wat de (latere) GUI kan, kan ook een machine.
// De routes hangen op /api/v1.

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  app.get("/health", async () => ({
    status: "ok",
    service: "aip-control-plane",
    version: "0.1.0",
    persistence: persistence.kind,
    engine: "built-in",
    environments: ENVIRONMENTS
  }));

  // ---- Platforminstellingen ----
  app.get("/api/v1/settings", { schema: { tags: ["settings"] } }, async () => settings.get());
  app.put<{ Body: { fourEyes?: boolean } }>(
    "/api/v1/settings",
    { schema: { tags: ["settings"], body: { type: "object", additionalProperties: false, properties: { fourEyes: { type: "boolean" } } } } },
    async (req) => settings.update(req.body ?? {}, String(req.headers["x-aip-user"] || "gebruiker").slice(0, 80))
  );

  // ---- Integraties (Integration-as-Code) ----
  app.post<{ Body: Integration }>(
    "/api/v1/integrations",
    { schema: { tags: ["integrations"], body: { $ref: "https://aip.local/schemas/integration.json#" } } },
    async (req) => registry.upsertIntegration(req.body)
  );
  app.get("/api/v1/integrations", { schema: { tags: ["integrations"] } }, async () => registry.listIntegrations());
  app.get<{ Params: { name: string } }>(
    "/api/v1/integrations/:name",
    { schema: { tags: ["integrations"] } },
    async (req, reply) => {
      const found = registry.getIntegration(req.params.name);
      if (!found) return reply.code(404).send({ error: "Integratie niet gevonden" });
      return found;
    }
  );

  // ---- Acties -> policy + approval ----
  app.post<{ Body: Action }>(
    "/api/v1/actions",
    { schema: { tags: ["actions"], body: { $ref: "https://aip.local/schemas/action.json#" } } },
    async (req) => approvals.propose(req.body)
  );

  // ---- Approvals ----
  app.get<{ Querystring: { status?: string; riskLevel?: "green" | "orange" | "red" } }>(
    "/api/v1/approvals",
    { schema: { tags: ["approvals"] } },
    async (req) => approvals.list(req.query)
  );
  app.get<{ Params: { id: string } }>(
    "/api/v1/approvals/:id",
    { schema: { tags: ["approvals"] } },
    async (req, reply) => {
      const a = approvals.get(req.params.id);
      if (!a) return reply.code(404).send({ error: "Approval niet gevonden" });
      return a;
    }
  );
  app.post<{ Params: { id: string }; Body: { approver: string; reason?: string } }>(
    "/api/v1/approvals/:id/approve",
    {
      schema: {
        tags: ["approvals"],
        body: { type: "object", required: ["approver"], properties: { approver: { type: "string" }, reason: { type: "string" } } }
      }
    },
    async (req, reply) => {
      try {
        return await approvals.decide(req.params.id, req.body.approver, "approve", req.body.reason);
      } catch (e) {
        return reply.code(409).send({ error: (e as Error).message });
      }
    }
  );
  app.post<{ Params: { id: string }; Body: { approver: string; reason?: string } }>(
    "/api/v1/approvals/:id/reject",
    {
      schema: {
        tags: ["approvals"],
        body: { type: "object", required: ["approver"], properties: { approver: { type: "string" }, reason: { type: "string" } } }
      }
    },
    async (req, reply) => {
      try {
        return await approvals.decide(req.params.id, req.body.approver, "reject", req.body.reason);
      } catch (e) {
        return reply.code(409).send({ error: (e as Error).message });
      }
    }
  );

  // ---- Incidenten & findings (agent-output, gestructureerd) ----
  app.post<{ Body: never }>(
    "/api/v1/incidents",
    { schema: { tags: ["monitoring"], body: { $ref: "https://aip.local/schemas/incident.json#" } } },
    async (req) => registry.addIncident(req.body as never)
  );
  app.get("/api/v1/incidents", { schema: { tags: ["monitoring"] } }, async () => registry.listIncidents());

  app.post<{ Body: never }>(
    "/api/v1/findings",
    { schema: { tags: ["security"], body: { $ref: "https://aip.local/schemas/finding.json#" } } },
    async (req) => registry.addFinding(req.body as never)
  );
  app.get("/api/v1/findings", { schema: { tags: ["security"] } }, async () => registry.listFindings());

  // ---- Audit (append-only, verifieerbaar) ----
  app.get<{ Querystring: { limit?: number } }>("/api/v1/audit", { schema: { tags: ["audit"] } }, async (req) => ({
    entries: audit.list(req.query.limit ? Number(req.query.limit) : undefined),
    integrity: audit.verify()
  }));

  // ---- Machine-leesbare catalogus ----
  app.get("/api/v1/catalog", { schema: { tags: ["catalog"] } }, async () => ({
    service: "aip-control-plane",
    integrations: registry.listIntegrations().map((i) => ({ name: i.integration, version: i.version ?? "1", owner: i.owner })),
    agents: agents.map((a) => ({ id: a.id, name: a.name, role: a.role, capabilities: a.capabilities })),
    riskLevels: ["green", "orange", "red"],
    links: { openapi: "/openapi.json", mcp: "/api/v1/mcp/manifest", events: "/api/v1/events" }
  }));

  // ---- MCP-bridge ----
  app.get("/api/v1/mcp/manifest", { schema: { tags: ["mcp"] } }, async () => manifest());
  app.post<{ Params: { name: string }; Body: Record<string, unknown> }>(
    "/api/v1/mcp/tools/:name",
    { schema: { tags: ["mcp"] } },
    async (req, reply) => {
      try {
        return await callTool(req.params.name, req.body ?? {});
      } catch (e) {
        return reply.code(400).send({ error: (e as Error).message });
      }
    }
  );

  // ---- Events (SSE) ----
  app.get("/api/v1/events", { schema: { tags: ["events"] } }, async (req, reply) => {
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive"
    });
    reply.raw.write(`event: hello\ndata: ${JSON.stringify({ at: new Date().toISOString() })}\n\n`);
    const unsub = bus.onEvent((e) => {
      reply.raw.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
    });
    req.raw.on("close", () => unsub());
  });
}
