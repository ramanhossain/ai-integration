import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { agentGroups, PROVIDERS, type AgentGroup } from "../runtime/agentGroups";
import { ENVIRONMENTS, isEnv, type EnvName } from "../domain/environments";
import { deployments } from "../domain/deployments";
import { registry } from "../domain/registry";
import { approvals } from "../approval/approvalEngine";
import { engine, type Run } from "../engine/engine";
import { PORTAL_STEPS } from "../engine/nodes";
import { triggers } from "../triggers/manager";

// Omgevingsvarianten (agentgroepen), de agent-API en bulkacties op processen.

const ROOT = join(__dirname, "..", "..");
const actor = (req: FastifyRequest) => String(req.headers["x-aip-user"] || "gebruiker");
const baseUrl = (req: FastifyRequest) => `${req.protocol}://${req.headers.host}`;

function agentAuth(req: FastifyRequest, reply: FastifyReply): AgentGroup | undefined {
  const h = String(req.headers.authorization || "");
  const g = agentGroups.authenticate(h.startsWith("Bearer ") ? h.slice(7).trim() : undefined);
  if (!g) { reply.code(401).send({ error: "Ongeldige of ingetrokken verbindingssleutel" }); return undefined; }
  return g;
}

export async function registerRuntimeRoutes(app: FastifyInstance): Promise<void> {
  // ---------------------------------------------------------------- agentgroepen (GUI/API)
  app.get<{ Querystring: { env?: string } }>("/api/v1/agent-groups", { schema: { tags: ["runtime"], summary: "Agentgroepen (omgevingsvarianten) met agents en status" } }, async (req) => {
    const env = req.query.env && isEnv(req.query.env) ? req.query.env : undefined;
    return agentGroups.list(env).map((g) => ({ ...g, processes: agentGroups.processesOn(g.id) }));
  });
  app.get<{ Params: { id: string } }>("/api/v1/agent-groups/:id", { schema: { tags: ["runtime"] } }, async (req, reply) => {
    const g = agentGroups.get(req.params.id);
    if (!g) return reply.code(404).send({ error: "Agentgroep niet gevonden" });
    const runs = engine.list({ limit: 500 }).filter((r) => r.agentGroup === g.id);
    return { ...g, processes: agentGroups.processesOn(g.id), runs: { total: runs.length, failed: runs.filter((r) => r.status === "error").length, last: runs.slice(0, 10) } };
  });
  app.post<{ Body: { env: string; name: string; provider?: string; region?: string; description?: string } }>(
    "/api/v1/agent-groups",
    { schema: { tags: ["runtime"], summary: "Agentgroep maken; geeft eenmalig de verbindingssleutel terug", body: { type: "object", required: ["env", "name"], properties: { env: { type: "string", enum: [...ENVIRONMENTS] }, name: { type: "string", minLength: 2, maxLength: 80 }, provider: { type: "string", enum: PROVIDERS.filter((p) => p !== "platform") }, region: { type: "string", maxLength: 60 }, description: { type: "string", maxLength: 300 } } } } },
    async (req, reply) => {
      try { const r = agentGroups.create(req.body, actor(req)); return reply.code(201).send({ group: agentGroups.get(r.group.id), key: r.key }); }
      catch (err) { return reply.code(400).send({ error: (err as Error).message }); }
    }
  );
  app.patch<{ Params: { id: string }; Body: { name?: string; region?: string; description?: string; provider?: string } }>(
    "/api/v1/agent-groups/:id",
    { schema: { tags: ["runtime"], body: { type: "object", properties: { name: { type: "string", minLength: 2, maxLength: 80 }, region: { type: "string", maxLength: 60 }, description: { type: "string", maxLength: 300 }, provider: { type: "string" } } } } },
    async (req, reply) => { try { return agentGroups.update(req.params.id, req.body, actor(req)); } catch (err) { return reply.code(400).send({ error: (err as Error).message }); } }
  );
  app.post<{ Params: { id: string } }>("/api/v1/agent-groups/:id/rotate-key", { schema: { tags: ["runtime"], summary: "Nieuwe verbindingssleutel; de oude werkt direct niet meer" } }, async (req, reply) => {
    try { return { key: agentGroups.rotateKey(req.params.id, actor(req)) }; } catch (err) { return reply.code(400).send({ error: (err as Error).message }); }
  });
  app.delete<{ Params: { id: string } }>("/api/v1/agent-groups/:id", { schema: { tags: ["runtime"] } }, async (req, reply) => {
    try { agentGroups.remove(req.params.id, actor(req)); return { deleted: true }; } catch (err) { return reply.code(400).send({ error: (err as Error).message }); }
  });

  // ---------------------------------------------------------------- deploydoelen per proces
  app.get("/api/v1/targets", { schema: { tags: ["runtime"], summary: "Deploydoelen van alle processen per omgeving" } }, async () =>
    Object.fromEntries(deployments.listStates().map((s) => [s.integration, Object.fromEntries(ENVIRONMENTS.map((env) => [env, { version: s.envs[env], ...agentGroups.getTargets(s.integration, env) }]))]))
  );
  app.get<{ Params: { name: string } }>("/api/v1/integrations/:name/targets", { schema: { tags: ["runtime"], summary: "Op welke agentgroepen het proces per omgeving draait" } }, async (req, reply) => {
    const s = deployments.getState(req.params.name);
    if (!s) return reply.code(404).send({ error: "Integratie niet gevonden" });
    return Object.fromEntries(ENVIRONMENTS.map((env) => [env, { version: s.envs[env], ...agentGroups.getTargets(s.integration, env) }]));
  });
  app.put<{ Params: { name: string; env: string }; Body: { groups: string[]; mode?: "failover" | "all"; reason?: string } }>(
    "/api/v1/integrations/:name/targets/:env",
    { schema: { tags: ["runtime"], summary: "Deploydoelen wijzigen (DEV direct, anders via goedkeuring)", body: { type: "object", required: ["groups"], properties: { groups: { type: "array", items: { type: "string" }, minItems: 1 }, mode: { type: "string", enum: ["failover", "all"] }, reason: { type: "string" } } } } },
    async (req, reply) => {
      const { name, env } = req.params;
      if (!isEnv(env)) return reply.code(400).send({ error: "Onbekende omgeving" });
      if (!deployments.getState(name)) return reply.code(404).send({ error: "Integratie niet gevonden" });
      const err = agentGroups.validateTargets(env, req.body.groups);
      if (err) return reply.code(400).send({ error: err });
      const targets = { groups: req.body.groups, mode: req.body.mode ?? "failover" };
      if (env === "dev") return { applied: true, targets: agentGroups.setTargets(name, env, targets, actor(req)) };
      const approval = await approvals.propose({ type: "deployment.targets", proposedBy: actor(req), reason: req.body.reason ?? `Omgevingsvarianten van ${name} op ${env.toUpperCase()}: ${targets.groups.join(", ")} (${targets.mode})`, target: { integration: name, environment: env }, payload: { targets }, reversible: true });
      return { applied: false, approval };
    }
  );

  // ---------------------------------------------------------------- verwijderen en bulkacties
  async function deleteOne(name: string, by: string): Promise<{ name: string; ok: boolean; deleted?: boolean; approval?: unknown; error?: string }> {
    const s = deployments.getState(name);
    if (!registry.getIntegration(name)) return { name, ok: false, error: "Niet gevonden" };
    const highest = s ? [...ENVIRONMENTS].reverse().find((e) => e !== "dev" && s.envs[e] != null) : undefined;
    if (!highest) return { name, ok: true, deleted: registry.deleteIntegration(name, by) };
    // Draait het buiten DEV: eerst goedkeuring (PROD = vier-ogen).
    const approval = await approvals.propose({ type: "integration.delete", proposedBy: by, reason: `Verwijder ${name} (staat op ${highest.toUpperCase()})`, target: { integration: name, environment: highest }, reversible: false });
    return { name, ok: true, deleted: approval.status === "executed", approval };
  }
  app.delete<{ Params: { name: string } }>("/api/v1/integrations/:name", { schema: { tags: ["integrations"], summary: "Proces verwijderen (buiten DEV via goedkeuring)" } }, async (req, reply) => {
    const r = await deleteOne(req.params.name, actor(req));
    return r.ok ? r : reply.code(404).send({ error: r.error });
  });
  app.post<{ Body: { action: "delete" | "pause" | "resume"; names: string[]; env?: string } }>(
    "/api/v1/integrations/bulk",
    { schema: { tags: ["integrations"], summary: "Meerdere processen tegelijk verwijderen, of hun triggers (de)activeren op een omgeving", body: { type: "object", required: ["action", "names"], properties: { action: { type: "string", enum: ["delete", "pause", "resume"] }, names: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 500 }, env: { type: "string", enum: [...ENVIRONMENTS] } } } } },
    async (req, reply) => {
      const by = actor(req);
      const names = [...new Set(req.body.names)];
      if (req.body.action === "delete") return { results: await Promise.all(names.map((n) => deleteOne(n, by))) };
      const env = req.body.env as EnvName | undefined;
      if (!env) return reply.code(400).send({ error: "env is verplicht bij pause/resume" });
      const results = names.map((n) => {
        if (deployments.getActiveVersion(n, env) == null) return { name: n, ok: false, error: `Niet gedeployed op ${env.toUpperCase()}` };
        triggers.setPaused(env, n, req.body.action === "pause", by);
        return { name: n, ok: true, paused: req.body.action === "pause" };
      });
      return { results };
    }
  );

  // ---------------------------------------------------------------- agent-API (sleutel van de agentgroep)
  app.post<{ Body: { id: string; name?: string; host?: string; os?: string; version?: string; runtime?: string; cloud?: Record<string, string>; running?: number } }>(
    "/api/v1/agent-api/heartbeat",
    { schema: { tags: ["agent-api"], summary: "Agent meldt zich (elke 15 s)", body: { type: "object", required: ["id"], properties: { id: { type: "string", maxLength: 120 }, name: { type: "string" }, host: { type: "string" }, os: { type: "string" }, version: { type: "string" }, runtime: { type: "string" }, cloud: { type: "object", additionalProperties: { type: "string" } }, running: { type: "integer" } } } } },
    async (req, reply) => {
      const g = agentAuth(req, reply);
      if (!g) return;
      agentGroups.heartbeat(g, req.body, req.ip);
      return { group: { id: g.id, env: g.env, name: g.name }, serverTime: new Date().toISOString(), heartbeatS: 15 };
    }
  );
  app.get<{ Querystring: { wait?: number } }>("/api/v1/agent-api/jobs/next", { schema: { tags: ["agent-api"], summary: "Volgende job (long-poll, max 30 s)", querystring: { type: "object", properties: { wait: { type: "integer", minimum: 0, maximum: 30 } } } } }, async (req, reply) => {
    const g = agentAuth(req, reply);
    if (!g) return;
    const agentId = String(req.headers["x-aip-agent-id"] || "onbekend").slice(0, 80);
    agentGroups.heartbeat(g, { id: agentId }, req.ip);
    let closed = false;
    req.raw.on("close", () => { closed = true; });
    const job = await agentGroups.next(g, agentId, (req.query.wait ?? 25) * 1000);
    if (!job) return reply.code(204).send();
    if (closed) { agentGroups.requeue(job.id); return; }
    return { id: job.id, env: job.env, definition: job.definition, subprocesses: job.subprocesses, credentials: job.credentials, input: job.input, triggeredBy: job.triggeredBy };
  });
  app.post<{ Params: { id: string }; Body: { agent?: string; run?: Run; error?: string } }>(
    "/api/v1/agent-api/jobs/:id/result",
    { schema: { tags: ["agent-api"], summary: "Resultaat van een job", body: { type: "object", properties: { agent: { type: "string" }, run: { type: "object", additionalProperties: true }, error: { type: "string" } } } } },
    async (req, reply) => {
      const g = agentAuth(req, reply);
      if (!g) return;
      const agentId = String(req.body.agent || req.headers["x-aip-agent-id"] || "");
      const now = new Date().toISOString();
      const run = req.body.run ?? ({ status: "error", error: req.body.error || "Agent meldde een fout zonder details", steps: [], deadLettered: false, startedAt: now, finishedAt: now, durationMs: 0 } as unknown as Run);
      const name = agentGroups.get(g.id)?.agents.find((a) => a.id === `${g.id}/${agentId}`)?.name;
      const ok = agentGroups.complete(g, req.params.id, agentId, { ...run, agent: name || run.agent }, run.status !== "success");
      if (!ok) return reply.code(404).send({ error: "Job onbekend of verlopen" });
      return { ok: true };
    }
  );
  // Datatabel/queue-stappen van een agent: uitgevoerd in het portaal, op de omgeving van de groep.
  app.post<{ Body: { type: string; config?: Record<string, unknown>; input?: Record<string, unknown> } }>(
    "/api/v1/agent-api/steps/execute",
    { schema: { tags: ["agent-api"], body: { type: "object", required: ["type"], properties: { type: { type: "string" }, env: { type: "string" }, config: { type: "object", additionalProperties: true }, input: { type: "object", additionalProperties: true } } } } },
    async (req, reply) => {
      const g = agentAuth(req, reply);
      if (!g) return;
      if (!PORTAL_STEPS.has(req.body.type)) return reply.code(400).send({ ok: false, error: `Staptype ${req.body.type} voert de agent zelf uit` });
      return engine.executeStep(req.body.type, req.body.config ?? {}, req.body.input ?? {}, g.env);
    }
  );

  // ---------------------------------------------------------------- agentpakket en installatiescript
  app.get("/agent/aip-agent.tgz", { schema: { tags: ["agent-api"], summary: "Agentpakket (broncode + package.json) om op een server te installeren" } }, async (_req, reply) => {
    const tar = spawn("tar", ["-czf", "-", "package.json", "package-lock.json", "tsconfig.json", "src", "schemas"], { cwd: ROOT });
    reply.header("content-type", "application/gzip").header("content-disposition", 'attachment; filename="aip-agent.tgz"');
    return reply.send(tar.stdout);
  });
  app.get("/agent/Dockerfile", { schema: { tags: ["agent-api"], summary: "Dockerfile voor een agent-container (ECS/Fargate, Azure Container Apps/ACI, Kubernetes)" } }, async (_req, reply) => {
    reply.header("content-type", "text/plain; charset=utf-8");
    return AGENT_DOCKERFILE;
  });
  app.get("/agent/install.sh", { schema: { tags: ["agent-api"], summary: "Installatiescript voor Linux (EC2, Azure VM, on-prem): Node + agent als systemd-service" } }, async (req, reply) => {
    reply.header("content-type", "text/x-shellscript; charset=utf-8");
    return installScript(baseUrl(req));
  });
}

export const AGENT_DOCKERFILE = `# AIP-agent als container. Bouw naast aip-agent.tgz (te downloaden van het portaal: /agent/aip-agent.tgz):
#   docker build -t aip-agent .
#   docker run -d --restart=always -e AIP_URL=https://portaal -e AIP_AGENT_KEY=aipk_... aip-agent
FROM node:20-alpine
WORKDIR /app
ADD aip-agent.tgz /app/
RUN npm install --no-audit --no-fund --loglevel=error && chown -R node:node /app
USER node
ENV AIP_AGENT_ID_FILE=/tmp/.aip-agent-id
CMD ["npm", "run", "agent", "--silent"]
`;

export function installScript(portal: string): string {
  return `#!/usr/bin/env bash
# AIP-agent installeren als systemd-service (Amazon Linux, Ubuntu, Debian, RHEL; ook als EC2 user-data of Azure custom script).
# Gebruik: curl -fsSL ${portal}/agent/install.sh | sudo AIP_AGENT_KEY=aipk_... [AIP_URL=${portal}] [AIP_AGENT_NAME=naam] bash
set -euo pipefail
AIP_URL="\${AIP_URL:-${portal}}"
: "\${AIP_AGENT_KEY:?Zet AIP_AGENT_KEY (verbindingssleutel van de agentgroep)}"
AIP_AGENT_NAME="\${AIP_AGENT_NAME:-$(hostname)}"
DIR=/opt/aip-agent

if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  echo "Node.js 20 installeren…"
  if command -v dnf >/dev/null 2>&1; then curl -fsSL https://rpm.nodesource.com/setup_20.x | bash - && dnf install -y nodejs
  elif command -v yum >/dev/null 2>&1; then curl -fsSL https://rpm.nodesource.com/setup_20.x | bash - && yum install -y nodejs
  else curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt-get install -y nodejs; fi
fi

id -u aip >/dev/null 2>&1 || useradd --system --home "$DIR" --shell /usr/sbin/nologin aip
mkdir -p "$DIR"
curl -fsSL "$AIP_URL/agent/aip-agent.tgz" | tar -xz -C "$DIR"
cd "$DIR" && npm install --no-audit --no-fund --loglevel=error
umask 077
cat > /etc/aip-agent.env <<ENV
AIP_URL=$AIP_URL
AIP_AGENT_KEY=$AIP_AGENT_KEY
AIP_AGENT_NAME=$AIP_AGENT_NAME
AIP_AGENT_ID_FILE=$DIR/.aip-agent-id
ENV
chown -R aip:aip "$DIR"

cat > /etc/systemd/system/aip-agent.service <<UNIT
[Unit]
Description=AIP-agent (omgevingsvariant)
After=network-online.target
Wants=network-online.target

[Service]
User=aip
WorkingDirectory=$DIR
EnvironmentFile=/etc/aip-agent.env
ExecStart=/usr/bin/env npm run agent --silent
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now aip-agent
echo "AIP-agent draait. Logs: journalctl -u aip-agent -f"
`;
}
