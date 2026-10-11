import { timingSafeEqual, X509Certificate } from "node:crypto";
import type { TLSSocket } from "node:tls";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { isEnv, ENVIRONMENTS } from "../domain/environments";
import { credentials } from "../connectors/credentials";
import { orgPathPrefix } from "../tenancy/context";
import { ebms, resolveConnection } from "../plugins/ebms/manager";
import { checkedCert } from "../plugins/ebms/security";
import { MAX_BYTES } from "../plugins/ebms/xml";
import { unseal } from "../plugins/ebms/repository";
import { checkConnection } from "../plugins/ebms";
import { audit } from "../audit/auditLog";

export function authenticateEbms(req: FastifyRequest, v: Record<string, string>): boolean {
  const peer = checkedCert(v.peerTlsCert);
  const socket = req.raw.socket as TLSSocket;
  if (socket.encrypted && socket.authorized && typeof socket.getPeerCertificate === "function") {
    const certificate = socket.getPeerCertificate();
    if (certificate.raw && new X509Certificate(certificate.raw).fingerprint256 === peer.fingerprint256) return true;
  }
  // Opt-in only: the private reverse proxy must validate mTLS, replace these headers,
  // and keep its per-connection bearer secret off the public internet.
  const allowedIps = (process.env.AIP_EBMS_PROXY_IPS || "").split(",").map(ip => ip.trim()).filter(Boolean);
  if (process.env.AIP_EBMS_PROXY_MODE !== "mtls" || !allowedIps.includes(req.raw.socket.remoteAddress || "")) return false;
  const got = Buffer.from(String(req.headers["x-ebms-ingress-token"] || "")), want = Buffer.from(v.ingressToken || "");
  if (want.length < 32 || got.length !== want.length || !timingSafeEqual(got, want)) return false;
  return req.headers["x-ebms-client-verified"] === "SUCCESS" && req.headers["x-forwarded-proto"] === "https" && String(req.headers["x-ebms-peer-fingerprint"] || "").toUpperCase() === peer.fingerprint256;
}
export async function registerEbmsRoutes(app: FastifyInstance): Promise<void> {
  for (const type of ["text/xml", "application/xml", "multipart/related"]) if (app.hasContentTypeParser(type)) app.removeContentTypeParser(type);
  app.addContentTypeParser(["text/xml", "application/xml", "multipart/related"], { parseAs: "buffer", bodyLimit: MAX_BYTES }, (_req, body, done) => done(null, body));
  type IncomingParams = { env: string; credential: string; org?: string };
  for (const url of ["/ebms/:env/:credential", "/o/:org/ebms/:env/:credential"]) {
    app.post<{ Params: IncomingParams }>(url, {
      bodyLimit: MAX_BYTES,
      schema: { tags: ["ebms"], summary: "ebMS 2.0 ontvangendpoint (mTLS, CPA-controle, duurzame ontvangst)" },
      onRequest: async (req, reply) => {
        if (!isEnv(req.params.env)) return reply.code(404).send({ error: "Onbekende omgeving" });
        try {
          const { values } = resolveConnection(req.params.credential, req.params.env);
          if (values.enabled !== "true") return reply.code(503).send({ error: "ebMS-koppeling niet geactiveerd" });
          if (!authenticateEbms(req, values)) return reply.code(401).send({ error: "Geldig en vertrouwd mTLS-partnercertificaat vereist" });
        } catch { return reply.code(401).send({ error: "Onbekende koppeling of ongeldig partnercertificaat" }); }
      },
    }, async (req, reply) => {
      if (!isEnv(req.params.env)) return reply.code(404).send();
      try {
        if (!Buffer.isBuffer(req.body)) return reply.code(415).send({ error: "SOAP XML of multipart/related vereist" });
        const result = await ebms.receive(req.params.credential, req.params.env, req.body, String(req.headers["content-type"] || ""));
        reply.header("cache-control", "no-store");
        if (result.reply) return reply.type(result.reply.contentType).code(200).send(result.reply.wire);
        return reply.code(result.error ? 400 : 200).send("");
      } catch (e) {
        try {
          if (Buffer.isBuffer(req.body)) {
            const protocolError = await ebms.rejectMessage(req.params.credential, req.params.env, req.body, String(req.headers["content-type"] || ""), e as Error);
            return reply.code(200).type(protocolError?.contentType || "text/plain").send(protocolError?.wire || "");
          }
        } catch { /* no safe correlation; use an uncorrelated HTTP error */ }
        // Neither payload contents nor internal protocol/security details leak to callers.
        return reply.code(400).type("text/plain").send("ebMS-bericht afgewezen; controleer CPA, XML, MIME en beveiliging");
      }
    });
  }
  const paramsSchema = { type: "object", required: ["env"], properties: { env: { type: "string", enum: [...ENVIRONMENTS] } } };
  app.get<{ Params: { env: string } }>("/api/v1/ebms/:env/connections", { schema: { tags: ["ebms"], params: paramsSchema } }, async (req) => {
    if (!isEnv(req.params.env)) return [];
    const env = req.params.env;
    const base = (process.env.AIP_PUBLIC_URL || `${req.protocol}://${req.headers.host}`).replace(/\/$/, "");
    return credentials.list().filter(c => c.type === "plugin" && ["ebms", "digipoort", "berichtenbox", "lopende-zaken", "digilevering"].includes(c.plugin || "")).map(c => {
      try {
        const { values: v } = resolveConnection(c.name, env);
        return { credential: c.name, plugin: c.plugin, enabled: v.enabled === "true", profile: v.profile, cpaId: v.cpaId, endpoint: `${base}${orgPathPrefix()}/ebms/${env}/${encodeURIComponent(c.name)}` };
      } catch { return { credential: c.name, plugin: c.plugin, enabled: false, configured: false }; }
    });
  });
  app.get<{ Params: { env: string }; Querystring: { credential?: string; box?: string; state?: string } }>("/api/v1/ebms/:env/messages", { schema: { tags: ["ebms"], params: paramsSchema } }, async req =>
    (await ebms.repo.all()).filter(r => r.env === req.params.env && (!req.query.credential || r.credential === req.query.credential) && (!req.query.box || r.box === req.query.box) && (!req.query.state || r.state === req.query.state)).map(r => ebms.repo.summary(r)));
  app.post<{ Params: { env: string; credential: string; action: string } }>("/api/v1/ebms/:env/connections/:credential/:action", { schema: { tags: ["ebms"], summary: "ebMS-koppeling activeren/deactiveren per omgeving", params: { type: "object", required: ["env", "credential", "action"], properties: { env: { type: "string", enum: [...ENVIRONMENTS] }, credential: { type: "string" }, action: { type: "string", enum: ["activate", "deactivate"] } } } } }, async (req, reply) => {
    if (!isEnv(req.params.env)) return reply.code(400).send({ error: "Onbekende omgeving" });
    try {
      const { values } = resolveConnection(req.params.credential, req.params.env);
      if (req.params.action === "activate") checkConnection(values);
      credentials.patchValues(req.params.credential, req.params.env, { enabled: req.params.action === "activate" ? "true" : "false" }, req.auth?.identity || "ebms");
      audit.append({ actor: req.auth?.identity || "ebms", event: `ebms.${req.params.action}`, subject: req.params.credential, data: { env: req.params.env } });
      return { enabled: req.params.action === "activate" };
    } catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
  });
  app.get<{ Params: { env: string; id: string }; Querystring: { includePayload?: string } }>("/api/v1/ebms/:env/messages/:id", { schema: { tags: ["ebms"] } }, async (req, reply) => {
    const r = (await ebms.repo.all()).find(r => r.id === req.params.id && r.env === req.params.env);
    if (!r) return reply.code(404).send({ error: "Bericht niet gevonden" });
    return { ...ebms.repo.summary(r), ...(req.query.includePayload === "true" ? { content: unseal(r) } : {}) };
  });
  app.post<{ Params: { env: string; id: string } }>("/api/v1/ebms/:env/messages/:id/redrive", { schema: { tags: ["ebms"], summary: "Gefaalde/onzekere verwerking bewust opnieuw aanbieden" } }, async (req, reply) => {
    const r = (await ebms.repo.all()).find(r => r.id === req.params.id && r.env === req.params.env);
    if (!r) return reply.code(404).send({ error: "Bericht niet gevonden" });
    try { return await ebms.redrive(r.credential, r.env, r.messageId, r.box); }
    catch (e) { return reply.code(409).send({ error: (e as Error).message }); }
  });
}
