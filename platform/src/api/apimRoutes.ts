import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { apim, parseSpec, type OpLink, type Policy } from "../apim/apim";
import { publicSpec } from "../apim/gateway";
import { approvals } from "../approval/approvalEngine";
import { registry } from "../domain/registry";
import { deployments } from "../domain/deployments";
import { ENVIRONMENTS, isEnv, type EnvName } from "../domain/environments";
import { orgPathPrefix } from "../tenancy/context";
import type { Integration } from "../domain/types";

// REST-API voor API-beheer: API's (OpenAPI + koppelingen), versies en deploys, API-beleid,
// API-sleutels voor afnemers, OAuth-uitgevers en API-monitoring.

const who = (req: FastifyRequest) => String(req.headers["x-aip-user"] || "gebruiker");
// Iets dat niet bestaat → 404; overige fouten (validatie) → 400, tenzij de fout een eigen status heeft.
const fail = (reply: FastifyReply, err: unknown, code = 400) => {
  const e = err as Error & { statusCode?: number };
  return reply.code(e.statusCode ?? (/niet gevonden|bestaat niet/i.test(e.message) ? 404 : code)).send({ error: e.message });
};
const baseUrl = (req: FastifyRequest) => `${req.protocol}://${req.headers.host}${orgPathPrefix()}`;

function detail(id: string, req: FastifyRequest) {
  const d = apim.getApi(id);
  if (!d) return undefined;
  const ops = apim.operations(d);
  const deployed = { dev: { version: d.version, at: d.updatedAt, by: d.updatedBy }, ...apim.deployed(id) };
  let specError: string | undefined;
  try { parseSpec(d.specText); } catch (err) { specError = (err as Error).message; }
  return {
    ...d, specError, deployed, versions: apim.versionsOf(id),
    urls: Object.fromEntries(ENVIRONMENTS.map((e) => [e, `${baseUrl(req)}/apis/${e}${d.basePath}`])),
    operations: ops.map((o) => {
      const link = d.links[o.key] || (d.passthroughAll?.target ? { ...d.passthroughAll, inherited: true } : { mode: "none" });
      const processOn = link.mode === "process" && link.process ? Object.fromEntries(ENVIRONMENTS.map((e) => [e, deployments.getActiveVersion(link.process!, e)])) : undefined;
      const policies = Object.fromEntries(ENVIRONMENTS.map((e) => [e, apim.policyFor(e, o.method, d.basePath + o.path.replace(/\{[^}]+\}/g, "x"))?.policy.name ?? null]));
      return { ...o, link, processOn, policies };
    })
  };
}

export async function registerApimRoutes(app: FastifyInstance): Promise<void> {
  const T = { tags: ["apim"] };

  // ---------------------------------------------------------------- API's
  app.get("/api/v1/apim/apis", { schema: { ...T, summary: "Alle API's met versies per omgeving" } }, async () => apim.listApis().map(({ specText: _s, ...a }) => a));
  app.post<{ Body: { specText: string; basePath?: string; title?: string; description?: string } }>(
    "/api/v1/apim/apis",
    { schema: { ...T, summary: "API aanmaken uit een OpenAPI-specificatie (JSON of YAML)", body: { type: "object", required: ["specText"], properties: { specText: { type: "string", maxLength: 2_000_000 }, basePath: { type: "string" }, title: { type: "string" }, description: { type: "string" } } } } },
    async (req, reply) => { try { return detail(apim.createApi(req.body, who(req)).id, req); } catch (err) { return fail(reply, err); } }
  );
  app.get<{ Params: { id: string } }>("/api/v1/apim/apis/:id", { schema: T }, async (req, reply) => detail(req.params.id, req) ?? reply.code(404).send({ error: "API niet gevonden" }));
  app.put<{ Params: { id: string }; Body: { specText?: string; basePath?: string; title?: string; description?: string; links?: Record<string, OpLink>; passthroughAll?: OpLink; note?: string } }>(
    "/api/v1/apim/apis/:id",
    { schema: { ...T, summary: "Opslaan (op DEV) = nieuwe patchversie", body: { type: "object", properties: { specText: { type: "string", maxLength: 2_000_000 }, basePath: { type: "string" }, title: { type: "string" }, description: { type: "string" }, links: { type: "object" }, passthroughAll: { type: "object" }, note: { type: "string", maxLength: 500 } } } } },
    async (req, reply) => {
      const { note, ...patch } = req.body;
      for (const [k, l] of Object.entries(patch.links || {})) if (l && l.mode === "process" && (!l.process || !registry.getIntegration(l.process))) return reply.code(400).send({ error: `Operatie ${k}: proces '${l.process || ""}' bestaat niet` });
      // Bouwen gebeurt op DEV: schrijfrechten op DEV vereist (zie auth-hook via env).
      try { apim.saveApi(req.params.id, patch, who(req), note); return detail(req.params.id, req); } catch (err) { return fail(reply, err); }
    }
  );
  app.delete<{ Params: { id: string } }>("/api/v1/apim/apis/:id", { schema: T }, async (req, reply) => { try { apim.deleteApi(req.params.id, who(req)); return { deleted: true }; } catch (err) { return fail(reply, err); } });
  app.get<{ Params: { id: string; version: string } }>("/api/v1/apim/apis/:id/versions/:version", { schema: T }, async (req, reply) => apim.getVersion(req.params.id, req.params.version) ?? reply.code(404).send({ error: "Versie niet gevonden" }));
  app.post<{ Params: { id: string; version: string } }>("/api/v1/apim/apis/:id/versions/:version/restore", { schema: { ...T, summary: "Oude versie terugzetten als nieuwe werkversie op DEV" } }, async (req, reply) => {
    try { apim.restoreApi(req.params.id, req.params.version, who(req)); return detail(req.params.id, req); } catch (err) { return fail(reply, err); }
  });
  // Deployen naar TEST/ACC/PROD gaat via goedkeuring (PROD: vier-ogen).
  app.post<{ Params: { id: string }; Body: { env: string; version?: string } }>(
    "/api/v1/apim/apis/:id/deploy",
    { schema: { ...T, summary: "API-versie deployen (goedkeuringsverzoek)", body: { type: "object", required: ["env"], properties: { env: { type: "string", enum: [...ENVIRONMENTS] }, version: { type: "string" } } } } },
    async (req, reply) => {
      const d = apim.getApi(req.params.id);
      if (!d) return reply.code(404).send({ error: "API niet gevonden" });
      const env = req.body.env as EnvName;
      if (env === "dev") return reply.code(400).send({ error: "DEV is altijd de werkversie" });
      const version = req.body.version || d.version;
      if (!apim.getVersion(d.id, version)) return reply.code(404).send({ error: `Versie ${version} bestaat niet` });
      const cur = apim.deployed(d.id)[env]?.version;
      const pub = apim.getVersion(d.id, version)?.publishedAs;
      if (cur === version || (pub && cur === pub)) return reply.code(409).send({ error: `Versie ${version} staat al op ${env.toUpperCase()}` });
      const open = approvals.list({ status: "pending" }).find((a) => a.action.type === "api.deploy" && a.action.target?.resource === d.id && a.action.target?.environment === env);
      if (open) return reply.code(409).send({ error: `Er staat al een deployverzoek voor ${d.title} naar ${env.toUpperCase()} open`, approvalId: open.id });
      // Controle vooraf: gekoppelde processen en beleid moeten ook op de doelomgeving staan.
      const vdoc = apim.getVersion(d.id, version)!.doc;
      let ops: Array<{ key: string; method: string; path: string }> = [];
      try { ops = parseSpec(vdoc.specText).ops; } catch { /* spec al gevalideerd bij opslaan */ }
      const procs = [...new Set(Object.values(vdoc.links).filter((l) => l?.mode === "process" && l.process).map((l) => l.process!))];
      const warnings = [
        ...procs.filter((p) => !deployments.getActiveDefinition(p, env)).map((p) => `Proces ${p} staat niet op ${env.toUpperCase()}`),
        ...(ops.length && !ops.some((o) => apim.policyFor(env, o.method, vdoc.basePath + o.path)) ? [`Geen API-beleid voor ${vdoc.basePath} op ${env.toUpperCase()}: alle aanroepen krijgen 401`] : [])
      ];
      const a = await approvals.propose({ type: "api.deploy", proposedBy: who(req), reason: `API ${d.title} (${version}) naar ${env.toUpperCase()}${cur ? ` (nu ${cur})` : ""}${warnings.length ? ` — let op: ${warnings.join("; ")}` : ""}`, target: { environment: env, resource: d.id }, payload: { apiId: d.id, version, from: cur, warnings }, reversible: true });
      return warnings.length ? { ...a, warnings } : a;
    }
  );
  app.delete<{ Params: { id: string; env: string } }>("/api/v1/apim/apis/:id/deploy/:env", { schema: { ...T, summary: "API van een omgeving halen" } }, async (req, reply) => {
    if (!isEnv(req.params.env) || req.params.env === "dev") return reply.code(400).send({ error: "Kies TEST, ACC of PROD" });
    try { apim.undeployApi(req.params.id, req.params.env, who(req)); } catch (err) { return reply.code((err as { statusCode?: number }).statusCode || 400).send({ error: (err as Error).message }); }
    return detail(req.params.id, req);
  });
  app.get<{ Params: { id: string }; Querystring: { env?: string } }>("/api/v1/apim/apis/:id/spec", { schema: { ...T, summary: "OpenAPI zoals afnemers die zien (met server-URL)" } }, async (req, reply) => {
    const env = (req.query.env && isEnv(req.query.env) ? req.query.env : "dev") as EnvName;
    const doc = apim.docFor(req.params.id, env);
    if (!doc) return reply.code(404).send({ error: `API staat niet op ${env.toUpperCase()}` });
    return publicSpec(doc, env, baseUrl(req));
  });
  // Nieuw proces voor een operatie (met API-trigger) en direct koppelen.
  app.post<{ Params: { id: string }; Body: { operation: string; name?: string } }>(
    "/api/v1/apim/apis/:id/link-new-process",
    { schema: { ...T, summary: "Nieuw proces voor een operatie maken en koppelen", body: { type: "object", required: ["operation"], properties: { operation: { type: "string" }, name: { type: "string" } } } } },
    async (req, reply) => {
      const d = apim.getApi(req.params.id);
      if (!d) return reply.code(404).send({ error: "API niet gevonden" });
      const op = apim.operations(d).find((o) => o.key === req.body.operation);
      if (!op) return reply.code(404).send({ error: "Operatie niet gevonden" });
      const base = (req.body.name || op.operationId || `${d.title}_${op.method}_${op.path}`).replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^[^A-Za-z]+/, "").slice(0, 60) || "ApiProces";
      let name = base;
      for (let i = 2; registry.getIntegration(name); i++) name = `${base.slice(0, 56)}_${i}`;
      const def = {
        integration: name, version: "1", owner: who(req),
        description: `${op.method} ${d.basePath}${op.path} — ${op.summary || "API-operatie"} (${d.title})`,
        trigger: { type: "api", method: op.method, path: op.path.replace(/^\//, ""), apiId: d.id, operation: op.key },
        // Voorbeeldantwoord; vervang door de echte logica. `_response` bepaalt status, headers en body.
        steps: [{ id: "antwoord", type: "enrich", name: "Antwoord samenstellen", config: { set: { _response: { status: 200, body: { ok: true, operatie: op.operationId || op.key, ...Object.fromEntries(op.params.filter((p) => p.in === "path").map((p) => [p.name, `{{params.${p.name}}}`])) } } } } }]
      } as unknown as Integration;
      try {
        registry.upsertIntegration(def, { note: `Aangemaakt voor API ${d.title} ${op.key}` });
        apim.saveApi(d.id, { links: { ...d.links, [op.key]: { mode: "process", process: name } } }, who(req), `${op.key} gekoppeld aan nieuw proces ${name}`);
        return { process: name, api: detail(d.id, req) };
      } catch (err) { return fail(reply, err); }
    }
  );
  app.get("/api/v1/apim/endpoints", { schema: { ...T, summary: "Bekende endpoints (voor beleid)" } }, async () =>
    apim.listApis().flatMap((a) => apim.operations(apim.getApi(a.id)!).map((o) => ({ apiId: a.id, api: a.title, basePath: a.basePath, key: o.key, method: o.method, opPath: o.path, path: a.basePath + o.path, operationId: o.operationId, summary: o.summary, linkedTo: apim.getApi(a.id)!.links[o.key]?.mode === "process" ? apim.getApi(a.id)!.links[o.key]?.process : undefined }))));

  // ---------------------------------------------------------------- beleid
  app.get("/api/v1/apim/policies", { schema: { ...T, summary: "API-beleid" } }, async () => apim.listPolicies());
  app.post<{ Body: Policy }>("/api/v1/apim/policies", { schema: { ...T, body: { type: "object", required: ["name"] } } }, async (req, reply) => { try { return apim.savePolicy(req.body, who(req)); } catch (err) { return fail(reply, err); } });
  app.put<{ Params: { id: string }; Body: Policy }>("/api/v1/apim/policies/:id", { schema: { ...T, body: { type: "object", required: ["name"] } } }, async (req, reply) => {
    const prev = apim.getPolicy(req.params.id);
    if (!prev) return reply.code(404).send({ error: "Beleid niet gevonden" });
    // Ook de omgevingen van het bestaande beleid vereisen schrijfrechten.
    const envs = [...new Set([...prev.envs, ...(req.body.envs || [])])];
    const { access } = require("../auth/guard") as typeof import("../auth/guard");
    for (const e of envs) if (access(req.auth, e) !== "edit") return reply.code(403).send({ error: `Geen schrijfrechten op ${e.toUpperCase()}` });
    try { return apim.savePolicy(req.body, who(req), req.params.id); } catch (err) { return fail(reply, err); }
  });
  app.delete<{ Params: { id: string } }>("/api/v1/apim/policies/:id", { schema: T }, async (req, reply) => {
    const prev = apim.getPolicy(req.params.id);
    if (!prev) return reply.code(404).send({ error: "Beleid niet gevonden" });
    const { access } = require("../auth/guard") as typeof import("../auth/guard");
    for (const e of prev.envs) if (access(req.auth, e) !== "edit") return reply.code(403).send({ error: `Geen schrijfrechten op ${e.toUpperCase()}` });
    apim.deletePolicy(req.params.id, who(req));
    return { deleted: true };
  });

  // ---------------------------------------------------------------- API-sleutels (afnemers)
  app.get("/api/v1/apim/keys", { schema: { ...T, summary: "API-sleutels van afnemers (per omgeving)" } }, async () => apim.listKeys());
  app.post<{ Body: { name: string; env: string; description?: string } }>(
    "/api/v1/apim/keys",
    { schema: { ...T, summary: "Sleutel maken (wordt eenmalig getoond)", body: { type: "object", required: ["name", "env"], properties: { name: { type: "string" }, env: { type: "string", enum: [...ENVIRONMENTS] }, description: { type: "string" } } } } },
    async (req, reply) => { try { return apim.createKey({ ...req.body, env: req.body.env as EnvName }, who(req)); } catch (err) { return fail(reply, err); } }
  );
  const keyEnvOk = (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply): boolean => {
    const k = apim.listKeys().find((x) => x.id === req.params.id);
    if (!k) { reply.code(404).send({ error: "Sleutel niet gevonden" }); return false; }
    const { access } = require("../auth/guard") as typeof import("../auth/guard");
    if (access(req.auth, k.env) !== "edit") { reply.code(403).send({ error: `Geen schrijfrechten op ${k.env.toUpperCase()}` }); return false; }
    return true;
  };
  app.put<{ Params: { id: string }; Body: { enabled?: boolean; name?: string; description?: string } }>("/api/v1/apim/keys/:id", { schema: T }, async (req, reply) => {
    if (!keyEnvOk(req, reply)) return reply;
    try { return apim.updateKey(req.params.id, req.body, who(req)); } catch (err) { return fail(reply, err); }
  });
  app.delete<{ Params: { id: string } }>("/api/v1/apim/keys/:id", { schema: T }, async (req, reply) => {
    if (!keyEnvOk(req, reply)) return reply;
    apim.deleteKey(req.params.id, who(req));
    return { deleted: true };
  });

  // ---------------------------------------------------------------- OAuth-uitgevers
  app.get("/api/v1/apim/issuers", { schema: { ...T, summary: "OAuth-uitgevers (identity providers)" } }, async () => apim.listIssuers());
  const issuerBody = { type: "object", required: ["name", "issuer"], properties: { name: { type: "string" }, issuer: { type: "string" }, audience: { type: "string" }, jwksUri: { type: "string" }, hsSecret: { type: "string" } } };
  app.post<{ Body: { name: string; issuer: string; audience?: string; jwksUri?: string; hsSecret?: string } }>("/api/v1/apim/issuers", { schema: { ...T, body: issuerBody } }, async (req, reply) => {
    if (!req.auth?.admin) return reply.code(403).send({ error: "Alleen beheerders" });
    try { return apim.saveIssuer(req.body, who(req)); } catch (err) { return fail(reply, err); }
  });
  app.put<{ Params: { id: string }; Body: { name: string; issuer: string; audience?: string; jwksUri?: string; hsSecret?: string } }>("/api/v1/apim/issuers/:id", { schema: { ...T, body: issuerBody } }, async (req, reply) => {
    if (!req.auth?.admin) return reply.code(403).send({ error: "Alleen beheerders" });
    try { return apim.saveIssuer(req.body, who(req), req.params.id); } catch (err) { return fail(reply, err); }
  });
  app.delete<{ Params: { id: string } }>("/api/v1/apim/issuers/:id", { schema: T }, async (req, reply) => {
    if (!req.auth?.admin) return reply.code(403).send({ error: "Alleen beheerders" });
    try { apim.deleteIssuer(req.params.id, who(req)); return { deleted: true }; } catch (err) { return fail(reply, err); }
  });

  // ---------------------------------------------------------------- monitoring
  app.get<{ Querystring: Record<string, string> }>("/api/v1/apim/logs", { schema: { ...T, summary: "API-monitoring: aanroepen met filters en statistiek" } }, async (req) => {
    const q = req.query;
    const { access } = require("../auth/guard") as typeof import("../auth/guard");
    const r = apim.queryLogs({ ...q, minMs: q.minMs ? Number(q.minMs) : undefined, limit: q.limit ? Number(q.limit) : undefined });
    // Alleen omgevingen waarop de gebruiker mag lezen.
    r.items = r.items.filter((l) => access(req.auth, l.env) !== "none");
    return r;
  });
  app.get<{ Params: { id: string } }>("/api/v1/apim/logs/:id", { schema: T }, async (req, reply) => {
    const l = apim.getLog(req.params.id);
    const { access } = require("../auth/guard") as typeof import("../auth/guard");
    if (!l || access(req.auth, l.env) === "none") return reply.code(404).send({ error: "Niet gevonden" });
    return l;
  });
}
