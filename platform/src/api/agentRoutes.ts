import type { FastifyInstance } from "fastify";
import { agents } from "../domain/agents";
import { design } from "../agents/builder";
import { editProcess } from "../agents/editor";
import { advisePage, type PageContext } from "../agents/pageAdvisor";
import type { Integration } from "../domain/types";
import { analyze } from "../agents/monitoring";
import { claudeAvailable, claudeMeta } from "../agents/claude";
import { registry } from "../domain/registry";
import { approvals } from "../approval/approvalEngine";

// Endpoints waarmee agents het werk doen. Ze stellen acties/definities voor;
// uitvoering en risico lopen altijd via de policy/approval-laag.

export async function registerAgentRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/v1/agents", { schema: { tags: ["agents"] } }, async () => ({
    claude: { available: claudeAvailable(), model: claudeMeta.model },
    agents
  }));

  // AI Mode: prompt -> Integration-as-Code. Optioneel meteen registreren.
  app.post<{ Body: { prompt: string; register?: boolean } }>(
    "/api/v1/agents/builder/design",
    {
      schema: {
        tags: ["agents"],
        body: {
          type: "object",
          required: ["prompt"],
          properties: { prompt: { type: "string" }, register: { type: "boolean" } }
        }
      }
    },
    async (req) => {
      const result = await design(req.body.prompt);
      if (req.body.register) registry.upsertIntegration(result.integration);
      return { ...result, registered: Boolean(req.body.register) };
    }
  );

  // Proces bewerken met een opdracht (AI-assistent in de editor). Slaat niets op:
  // de editor past de nieuwe definitie toe op het canvas; opslaan blijft een eigen stap.
  app.post<{ Body: { definition: Integration; prompt: string } }>(
    "/api/v1/agents/builder/edit",
    {
      schema: {
        tags: ["agents"],
        body: { type: "object", required: ["definition", "prompt"], properties: { definition: { type: "object", additionalProperties: true }, prompt: { type: "string", minLength: 1 } } }
      }
    },
    async (req, reply) => {
      const d = req.body.definition;
      if (!d || !Array.isArray(d.steps)) return reply.code(400).send({ error: "definition.steps ontbreekt" });
      return editProcess(d, req.body.prompt);
    }
  );

  // Pagina-adviseur: de assistent leest de pagina die de gebruiker bekijkt en geeft advies.
  app.post<{ Body: PageContext }>(
    "/api/v1/agents/page/advise",
    {
      schema: {
        tags: ["agents"],
        summary: "Advies over een pagina (tekst van de pagina + platformdata; optioneel een vraag)",
        body: {
          type: "object",
          required: ["view"],
          properties: {
            view: { type: "string" }, param: { type: "string" }, env: { type: "string" }, title: { type: "string" },
            text: { type: "string", maxLength: 200000 }, definition: { type: "object", additionalProperties: true },
            dirty: { type: "boolean" }, question: { type: "string", maxLength: 2000 }
          }
        }
      }
    },
    async (req) => advisePage({ ...req.body, user: String(req.headers["x-aip-user"] || ""), lang: String(req.headers["x-aip-lang"] || "nl") })
  );

  // Recovery: incident -> herstelvoorstel -> approval (door de policy-laag).
  app.post<{
    Body: {
      integration: string;
      severity: "low" | "medium" | "high" | "critical";
      problem: string;
      failedRequests?: number;
      rootCause?: Record<string, unknown>;
      impact?: string;
    };
  }>(
    "/api/v1/agents/monitoring/analyze",
    {
      schema: {
        tags: ["agents"],
        body: {
          type: "object",
          required: ["integration", "severity", "problem"],
          properties: {
            integration: { type: "string" },
            severity: { type: "string", enum: ["low", "medium", "high", "critical"] },
            problem: { type: "string" },
            failedRequests: { type: "integer" },
            rootCause: { type: "object", additionalProperties: true },
            impact: { type: "string" }
          }
        }
      }
    },
    async (req) => {
      const incident = registry.addIncident(req.body);
      const analysis = await analyze(incident);
      const approval = await approvals.propose(analysis.proposedAction);
      return { incident, analysis, approval };
    }
  );
}
