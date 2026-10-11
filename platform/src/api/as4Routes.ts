import type { FastifyInstance } from "fastify";
import { ENVIRONMENTS, isEnv } from "../domain/environments";
import { credentials } from "../connectors/credentials";
import { audit } from "../audit/auditLog";
import { as4, resolveAs4, checkAs4, contentOf } from "../plugins/as4/manager";
import { directories } from "../plugins/as4/spool";
export async function registerAs4Routes(app: FastifyInstance) {
  const envSchema = { type: "object", required: ["env"], properties: { env: { type: "string", enum: [...ENVIRONMENTS] } } };
  app.get<{ Params: { env: string } }>("/api/v1/as4/:env/connections", { schema: { tags: ["as4"], params: envSchema } }, async req => {
    if (!isEnv(req.params.env)) return [];
    const env = req.params.env;
    return credentials.list().filter(c => c.plugin === "as4").map(c => {
      try { const v = resolveAs4(c.name, env), d = directories(c.name, env); return { credential: c.name, enabled: v.enabled === "true", pmodeId: v.pmodeId, outDirectory: d.out, deliveryDirectory: d.incoming, gatewayVerified: false }; }
      catch { return { credential: c.name, enabled: false, configured: false }; }
    });
  });
  app.post<{ Params: { env: string; credential: string; action: string } }>("/api/v1/as4/:env/connections/:credential/:action", { schema: { tags: ["as4"], params: { type: "object", required: ["env", "credential", "action"], properties: { env: { type: "string", enum: [...ENVIRONMENTS] }, credential: { type: "string" }, action: { type: "string", enum: ["activate", "deactivate", "scan"] } } } } }, async (req, reply) => {
    if (!isEnv(req.params.env)) return reply.code(404).send();
    const { env, credential, action } = req.params;
    try {
      resolveAs4(credential, env);
      if (action === "scan") return await as4.scan(credential, env);
      if (action === "activate") await checkAs4(credential, env);
      credentials.patchValues(credential, env, { enabled: action === "activate" ? "true" : "false" }, req.auth?.identity || "as4");
      audit.append({ actor: req.auth?.identity || "as4", event: `as4.${action}`, subject: credential, data: { env } });
      return { enabled: action === "activate" };
    } catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
  });
  app.get<{ Params: { env: string }; Querystring: { credential?: string; box?: string } }>("/api/v1/as4/:env/messages", { schema: { tags: ["as4"], params: envSchema } }, async req => (await as4.all()).filter(r => r.env === req.params.env && (!req.query.credential || r.credential === req.query.credential) && (!req.query.box || r.box === req.query.box)).map(r => as4.summary(r)));
  app.get<{ Params: { env: string; id: string }; Querystring: { includePayload?: string } }>("/api/v1/as4/:env/messages/:id", { schema: { tags: ["as4"], params: envSchema } }, async (req, reply) => {
    const r = (await as4.all()).find(r => r.id === req.params.id && r.env === req.params.env);
    if (!r) return reply.code(404).send({ error: "AS4-bericht niet gevonden" });
    return { ...as4.summary(r), ...(req.query.includePayload === "true" ? { content: contentOf(r) } : {}) };
  });
  app.post<{ Params: { env: string; id: string } }>("/api/v1/as4/:env/messages/:id/redrive", { schema: { tags: ["as4"], params: envSchema } }, async (req, reply) => {
    if (!isEnv(req.params.env)) return reply.code(404).send();
    const r = (await as4.all()).find(r => r.id === req.params.id && r.env === req.params.env);
    if (!r) return reply.code(404).send({ error: "AS4-bericht niet gevonden" });
    try { return await as4.redrive(r.credential, req.params.env, r.messageId, r.box); }
    catch (e) { return reply.code(409).send({ error: (e as Error).message }); }
  });
}
