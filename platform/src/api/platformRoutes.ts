import type { FastifyInstance } from "fastify";
import { ENVIRONMENTS, ENV_LABELS, ENV_DEPLOY_RISK, ENV_DEPLOY_ACTION, isEnv, type EnvName } from "../domain/environments";
import { deployments } from "../domain/deployments";
import { engine } from "../engine/engine";
import { registry } from "../domain/registry";
import { approvals } from "../approval/approvalEngine";
import { agentGroups } from "../runtime/agentGroups";
import type { Integration } from "../domain/types";

// Omgevingen, deployments (promotie dev -> test -> acc -> prod), runs en het
// monitoring-dashboard.

export async function registerPlatformRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/v1/environments", { schema: { tags: ["environments"] } }, async () =>
    ENVIRONMENTS.map((env) => ({ id: env, label: ENV_LABELS[env], deployRisk: ENV_DEPLOY_RISK[env], deployAction: ENV_DEPLOY_ACTION[env] }))
  );

  app.get("/api/v1/deployments", { schema: { tags: ["environments"] } }, async () =>
    deployments.listStates().map((s) => ({ ...s, promotable: deployments.promotableEnvs(s.integration) }))
  );

  app.get<{ Params: { name: string } }>(
    "/api/v1/integrations/:name/deployments",
    { schema: { tags: ["environments"] } },
    async (req, reply) => {
      const s = deployments.getState(req.params.name);
      if (!s) return reply.code(404).send({ error: "Integratie niet gevonden" });
      return { ...s, promotable: deployments.promotableEnvs(s.integration) };
    }
  );

  // Deploy = voorstel om een versie op een omgeving te zetten. Loopt door de policy/approval-laag
  // (test/acc = ORANGE, prod = RED met 4-ogen). Elke bestaande versie mag naar elke omgeving:
  // de gewone stap (vorige omgeving), overslaan (bv. DEV -> PROD) of terugzetten (oudere versie).
  app.post<{ Params: { name: string }; Body: { toEnv: string; version?: number; proposedBy?: string; reason?: string; targets?: { groups: string[]; mode?: "failover" | "all" } } }>(
    "/api/v1/integrations/:name/deploy",
    {
      schema: {
        tags: ["environments"],
        summary: "Versie deployen naar TEST/ACC/PROD (ook overslaan of terugzetten); via goedkeuring",
        body: {
          type: "object",
          required: ["toEnv"],
          properties: {
            toEnv: { type: "string", enum: [...ENVIRONMENTS] }, version: { type: "integer", minimum: 1 }, proposedBy: { type: "string" }, reason: { type: "string" },
            targets: { type: "object", required: ["groups"], properties: { groups: { type: "array", items: { type: "string" }, minItems: 1 }, mode: { type: "string", enum: ["failover", "all"] } } }
          }
        }
      }
    },
    async (req, reply) => {
      const { name } = req.params;
      const toEnv = req.body.toEnv;
      if (!isEnv(toEnv)) return reply.code(400).send({ error: "Onbekende omgeving" });
      const state = deployments.getState(name);
      if (!state) return reply.code(404).send({ error: "Integratie niet gevonden" });
      if (toEnv === "dev") return reply.code(400).send({ error: "Op DEV wordt gebouwd, niet gedeployed. Opslaan in de editor maakt een nieuwe versie op DEV; een oude versie zet je terug via Versies → Terugzetten op DEV." });
      const version = req.body.version ?? deployments.defaultVersion(name, toEnv);
      if (version == null || !deployments.getDefinition(name, version)) return reply.code(404).send({ error: `Versie ${version ?? "?"} van ${name} bestaat niet` });
      const current = state.envs[toEnv];
      if (current === version) return reply.code(409).send({ error: `Versie ${version} staat al op ${toEnv.toUpperCase()}` });
      const targets = req.body.targets ? { groups: req.body.targets.groups, mode: req.body.targets.mode ?? "failover" } : undefined;
      if (targets) { const err = agentGroups.validateTargets(toEnv, targets.groups); if (err) return reply.code(400).send({ error: err }); }
      const skipped = deployments.skippedEnvs(name, toEnv, version);
      const rollback = current != null && version < current;
      const what = rollback ? `Terugzetten ${name} op ${ENV_LABELS[toEnv]} naar v${version} (nu v${current})` : `Deploy ${name} v${version} naar ${ENV_LABELS[toEnv]}${current != null ? ` (nu v${current})` : ""}`;
      const skipNote = skipped.length && !rollback ?` — ${skipped.map((e) => e.toUpperCase()).join(" en ")} overgeslagen` : "";
      const approval = await approvals.propose({
        type: ENV_DEPLOY_ACTION[toEnv],
        proposedBy: req.body.proposedBy ?? String(req.headers["x-aip-user"] || "gebruiker"),
        reason: `${req.body.reason ? req.body.reason + " — " : ""}${what}${skipNote}${targets ? ` (${targets.groups.join(", ")})` : ""}`,
        target: { integration: name, environment: toEnv },
        payload: { version, from: current, rollback, skipped, ...(targets ? { targets } : {}) },
        reversible: true
      });
      return approval;
    }
  );

  // Versies van een proces met waar ze actief zijn, plus de deploygeschiedenis.
  app.get<{ Params: { name: string } }>("/api/v1/integrations/:name/versions", { schema: { tags: ["environments"], summary: "Alle versies en de deploygeschiedenis" } }, async (req, reply) => {
    const s = deployments.getState(req.params.name);
    if (!s) return reply.code(404).send({ error: "Integratie niet gevonden" });
    return { integration: s.integration, latestVersion: s.latestVersion, envs: s.envs, versions: deployments.listVersions(s.integration), history: [...(s.history ?? [])].reverse() };
  });

  // Oude versie terugzetten op DEV: wordt een NIEUWE versie (kopie), zodat de geschiedenis
  // intact blijft. Daarna kun je die versie gewoon deployen.
  app.post<{ Params: { name: string; version: string }; Body: { owner?: string } }>(
    "/api/v1/integrations/:name/versions/:version/restore",
    { schema: { tags: ["environments"], summary: "Oude versie terugzetten op DEV (als nieuwe versie)" } },
    async (req, reply) => {
      const v = Number(req.params.version);
      const old = deployments.getDefinition(req.params.name, v);
      if (!old) return reply.code(404).send({ error: "Versie niet gevonden" });
      const by = req.body?.owner ?? String(req.headers["x-aip-user"] || "gebruiker");
      const { version: _v, ...copy } = old;
      const saved = registry.upsertIntegration({ ...copy, owner: by } as Integration, { note: `Teruggezet van v${v}`, restoredFrom: v });
      return { restored: true, from: v, version: Number(saved.version), definition: saved };
    }
  );

  // Uitvoeren van een integratie op een omgeving (met de daar actieve versie).
  app.post<{ Params: { name: string }; Body: { env?: string; input?: Record<string, unknown>; proposedBy?: string } }>(
    "/api/v1/integrations/:name/run",
    {
      schema: {
        tags: ["runs"],
        body: {
          type: "object",
          properties: {
            env: { type: "string", enum: [...ENVIRONMENTS] },
            input: { type: "object", additionalProperties: true },
            proposedBy: { type: "string" }
          }
        }
      }
    },
    async (req, reply) => {
      const env = (req.body?.env ?? "dev") as EnvName;
      if (!deployments.getActiveDefinition(req.params.name, env)) {
        return reply.code(409).send({ error: `Geen actieve versie van ${req.params.name} op ${env}` });
      }
      const approval = await approvals.propose({
        type: "integration.run",
        proposedBy: req.body?.proposedBy ?? String(req.headers["x-aip-user"] || "gebruiker"),
        target: { integration: req.params.name, environment: env },
        payload: { input: req.body?.input ?? {} }
      });
      return approval;
    }
  );

  app.get<{ Querystring: { integration?: string; env?: string; limit?: number } }>(
    "/api/v1/runs",
    { schema: { tags: ["runs"] } },
    async (req) =>
      engine.list({
        integration: req.query.integration,
        env: req.query.env && isEnv(req.query.env) ? req.query.env : undefined,
        limit: req.query.limit ? Number(req.query.limit) : 50
      })
  );

  app.post<{ Body: { type: string; config?: Record<string, unknown>; input?: Record<string, unknown> } }>(
    "/api/v1/engine/execute-step",
    {
      schema: {
        tags: ["runs"],
        body: {
          type: "object",
          required: ["type"],
          properties: { type: { type: "string" }, config: { type: "object", additionalProperties: true }, input: { type: "object", additionalProperties: true } }
        }
      }
    },
    async (req) => engine.executeStep(req.body.type, req.body.config ?? {}, req.body.input ?? {})
  );

  // Test-run vanuit de proceseditor: voert de (nog niet opgeslagen) definitie uit op DEV.
  app.post<{ Body: { definition: Integration; input?: Record<string, unknown> } }>(
    "/api/v1/engine/test-run",
    {
      schema: {
        tags: ["runs"],
        body: {
          type: "object",
          required: ["definition"],
          properties: { definition: { $ref: "https://aip.local/schemas/integration.json#" }, input: { type: "object", additionalProperties: true } }
        }
      }
    },
    async (req) => {
      const { version: _v, ...def } = req.body.definition;
      return engine.run(def as Integration, "dev", req.body.input ?? {});
    }
  );

  app.get<{ Params: { id: string } }>("/api/v1/runs/:id", { schema: { tags: ["runs"] } }, async (req, reply) => {
    const run = engine.get(req.params.id);
    if (!run) return reply.code(404).send({ error: "Run niet gevonden" });
    return run;
  });

  app.get<{ Params: { name: string; version: string } }>(
    "/api/v1/integrations/:name/versions/:version",
    { schema: { tags: ["integrations"] } },
    async (req, reply) => {
      const def = deployments.getDefinition(req.params.name, Number(req.params.version));
      if (!def) return reply.code(404).send({ error: "Versie niet gevonden" });
      return def;
    }
  );

  // Monitoring-dashboard: één call met alles wat de GUI nodig heeft.
  app.get<{ Querystring: { env?: string } }>("/api/v1/dashboard", { schema: { tags: ["monitoring"] } }, async (req) => {
    const env = req.query.env && isEnv(req.query.env) ? req.query.env : undefined;
    const states = deployments.listStates();
    const perEnvDeployed: Record<string, number> = {};
    for (const env of ENVIRONMENTS) perEnvDeployed[env] = states.filter((s) => s.envs[env] != null).length;
    const pending = approvals.list({ status: "pending" });
    return {
      at: new Date().toISOString(),
      integrations: registry.listIntegrations().length,
      deployedPerEnv: perEnvDeployed,
      approvals: {
        pending: pending.length,
        pendingByRisk: {
          green: pending.filter((a) => a.riskLevel === "green").length,
          orange: pending.filter((a) => a.riskLevel === "orange").length,
          red: pending.filter((a) => a.riskLevel === "red").length
        }
      },
      incidents: { open: registry.listIncidents().length },
      env: env ?? "all",
      runs: engine.metrics(env),
      overall: env ? engine.metrics() : undefined,
      recentRuns: engine.list({ limit: 10, env }).map((r) => ({
        id: r.id,
        integration: r.integration,
        env: r.env,
        version: r.version,
        test: r.test,
        status: r.status,
        durationMs: r.durationMs,
        at: r.finishedAt,
        deadLettered: r.deadLettered,
        triggeredBy: r.triggeredBy
      }))
    };
  });
}
