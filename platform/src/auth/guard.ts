import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { accounts, type User, type ApiKey, type Access } from "./accounts";
import { runInOrg, DEFAULT_ORG } from "../tenancy/context";
import { agentGroups } from "../runtime/agentGroups";
import { approvals } from "../approval/approvalEngine";
import { ENVIRONMENTS, type EnvName } from "../domain/environments";

// Authenticatie, organisatiecontext en toegang per omgeving voor elk request.
// - AIP_AUTH=off: geen accounts (ontwikkeling/tests); alles in de organisatie "default".
// - Anders: sessiecookie (GUI) of API-sleutel (Authorization: Bearer aip_…).
// - Publiek: GUI-bestanden, docs, inloggen/aanmelden, webhooks/API-endpoints (eigen
//   beveiliging per trigger) en de agent-API (verbindingssleutel van een agentgroep).

export const AUTH_ENABLED = process.env.AIP_AUTH !== "off";
export const SESSION_COOKIE = "aip_session";

export interface AuthInfo { user?: User; apiKey?: ApiKey; org: string; identity: string; superAdmin: boolean; admin: boolean }
declare module "fastify" { interface FastifyRequest { auth?: AuthInfo } }

const PUBLIC = [
  /^\/$/, /^\/app(\/|$)/, /^\/docs(\/|$)/, /^\/openapi\.json$/, /^\/health$/, /^\/favicon/,
  /^\/api\/v1\/auth\/(status|setup|signup|login|logout|forgot|reset)(\/|$)/,
  /^\/api\/v1\/schemas\//, /^\/api\/v1\/oauth\/callback/, /^\/agent\//,
  /^\/hooks\//, /^\/apis\//
];

export function readCookie(req: FastifyRequest, name: string): string | undefined {
  const raw = String(req.headers.cookie || "");
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return undefined;
}
export function setSessionCookie(req: FastifyRequest, reply: FastifyReply, token: string | null): void {
  const secure = req.protocol === "https" || String(req.headers["x-forwarded-proto"] || "") === "https";
  const v = token
    ? `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${14 * 86400}${secure ? "; Secure" : ""}`
    : `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`;
  reply.header("set-cookie", v);
}
const bearer = (req: FastifyRequest) => { const h = String(req.headers.authorization || ""); return h.startsWith("Bearer ") ? h.slice(7).trim() : undefined; };

export function identify(req: FastifyRequest): AuthInfo | undefined {
  const key = accounts.resolveKey(bearer(req));
  if (key) return { apiKey: key, org: key.orgId, identity: `api:${key.name}`, superAdmin: false, admin: true };
  const user = accounts.resolveSession(readCookie(req, SESSION_COOKIE));
  if (user) return { user, org: user.orgId, identity: user.email, superAdmin: Boolean(user.superAdmin), admin: user.role === "beheerder" };
  return undefined;
}

// Toegang tot een omgeving: beheerders en API-sleutels alles; gebruikers volgens envAccess.
export function access(auth: AuthInfo | undefined, env: EnvName): Access {
  if (!AUTH_ENABLED || !auth || auth.admin || !auth.user) return "edit";
  return auth.user.envAccess[env] ?? "none";
}
const isEnv = (e: unknown): e is EnvName => typeof e === "string" && (ENVIRONMENTS as readonly string[]).includes(e);

// Welke omgevingen raakt dit request?
function envsOf(req: FastifyRequest): EnvName[] {
  const out = new Set<EnvName>();
  const p = (req.params || {}) as Record<string, unknown>, q = (req.query || {}) as Record<string, unknown>;
  const b = (req.body && typeof req.body === "object" ? req.body : {}) as Record<string, unknown>;
  for (const v of [p.env, q.env, b.env, b.toEnv, b.environment]) if (isEnv(v)) out.add(v);
  if (Array.isArray(b.envs)) for (const v of b.envs) if (isEnv(v)) out.add(v);
  const url = req.url.split("?")[0];
  if (req.method !== "GET" && /^\/api\/v1\/credentials\//.test(url) && b.values && typeof b.values === "object") for (const e of Object.keys(b.values)) if (isEnv(e)) out.add(e);
  const ap = url.match(/^\/api\/v1\/approvals\/([^/]+)\/(approve|reject)$/);
  if (ap) { const a = approvals.get(ap[1]); const e = (a?.action.target as { environment?: string } | undefined)?.environment; if (isEnv(e)) out.add(e); }
  // Bouwen (opslaan, terugzetten, importeren) gebeurt altijd op DEV.
  // API's bouwen (opslaan, terugzetten, verwijderen, koppelen) is werk op DEV.
  if (req.method !== "GET" && /^\/api\/v1\/apim\/apis(\/[^/]+)?(\/(versions\/[^/]+\/restore|link-new-process))?$/.test(url)) out.add("dev");
  if (req.method === "POST" && (/^\/api\/v1\/integrations\/?$/.test(url) || /\/versions\/\d+\/restore$/.test(url) || /^\/api\/v1\/(transfer\/)?import/.test(url))) out.add("dev");
  return [...out];
}

// Alleen voor beheerders van de organisatie.
const ADMIN_ONLY = [/^\/api\/v1\/org(\/|$)/, /^\/api\/v1\/versions\/cleanup$/];
const ADMIN_WRITE = [/^\/api\/v1\/settings$/];

const CSP = [
  "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:", "img-src 'self' data: blob:", "connect-src 'self'",
  "frame-ancestors 'none'", "base-uri 'self'", "form-action 'self'", "object-src 'none'"
].join("; ");

export function registerAuth(app: FastifyInstance): void {
  app.decorateRequest("auth", undefined);

  // Beveiligingsheaders; strikte CSP voor de GUI (geen inline scripts).
  app.addHook("onSend", (req, reply, payload, done) => {
    reply.header("x-content-type-options", "nosniff");
    reply.header("referrer-policy", "same-origin");
    if (!reply.hasHeader("x-frame-options")) reply.header("x-frame-options", "DENY");
    if (req.url.startsWith("/app")) { reply.header("content-security-policy", CSP); reply.header("cache-control", "no-cache"); }
    if (req.url.startsWith("/api/") && !reply.hasHeader("cache-control")) reply.header("cache-control", "no-store");
    done(null, payload);
  });

  app.addHook("onRequest", (req, reply, done) => {
    const url = req.url.split("?")[0];
    // Publieke webhooks/API-endpoints van een organisatie: /o/<org>/hooks|apis/...
    const m = url.match(/^\/o\/([a-z0-9-]{2,40})\/(hooks|apis)\//);
    if (m) {
      const o = accounts.getOrg(m[1]);
      if (!o || o.disabled) { reply.code(404).send({ error: "Onbekende organisatie" }); return; }
      runInOrg(o.id, done);
      return;
    }
    // Webhooks/API-endpoints zonder /o/-prefix horen bij de hoofdorganisatie (ook met een cookie).
    if (/^\/(hooks|apis)\//.test(url)) { runInOrg(DEFAULT_ORG, done); return; }
    if (!AUTH_ENABLED) { req.auth = { org: DEFAULT_ORG, identity: String(req.headers["x-aip-user"] || "gebruiker"), superAdmin: true, admin: true }; runInOrg(DEFAULT_ORG, done); return; }

    // Agent-API: de verbindingssleutel bepaalt de organisatie.
    if (url.startsWith("/api/v1/agent/")) {
      const key = bearer(req);
      for (const org of accounts.orgIds()) {
        if (runInOrg(org, () => agentGroups.authenticate(key))) { runInOrg(org, done); return; }
      }
      done();
      return;
    }
    const auth = identify(req);
    if (auth) {
      req.auth = auth;
      // De echte identiteit overschrijft wat een client meestuurt.
      req.headers["x-aip-user"] = auth.identity;
      runInOrg(auth.org, done);
      return;
    }
    if (PUBLIC.some((r) => r.test(url))) { done(); return; }
    reply.code(401).send({ error: "Niet ingelogd", login: "/app/#login" });
  });

  // Identiteitsvelden in de body (indiener, goedkeurder, eigenaar) altijd = ingelogde gebruiker.
  app.addHook("preValidation", (req, _reply, done) => {
    if (AUTH_ENABLED && req.auth && req.body && typeof req.body === "object" && !Array.isArray(req.body)) {
      const b = req.body as Record<string, unknown>;
      for (const k of ["approver", "proposedBy", "owner", "by", "decidedBy"]) if (k in b) b[k] = req.auth.identity;
      if (req.method === "POST" && /^\/api\/v1\/integrations\/?$/.test(req.url.split("?")[0])) b.owner = req.auth.identity;
    }
    done();
  });

  // Rechten: beheerdersfuncties en toegang per omgeving.
  app.addHook("preHandler", (req, reply, done) => {
    if (!AUTH_ENABLED || !req.auth) { done(); return; }
    const url = req.url.split("?")[0];
    if (ADMIN_ONLY.some((r) => r.test(url)) && !req.auth.admin) { reply.code(403).send({ error: "Alleen voor beheerders van de organisatie" }); return; }
    // Accounts en API-sleutels beheren kan alleen een ingelogde beheerder, niet met een API-sleutel.
    if (/^\/api\/v1\/(org|admin)(\/|$)/.test(url) && req.auth.apiKey) { reply.code(403).send({ error: "Accountbeheer kan niet met een API-sleutel" }); return; }
    if (ADMIN_WRITE.some((r) => r.test(url)) && req.method !== "GET" && !req.auth.admin) { reply.code(403).send({ error: "Alleen beheerders kunnen instellingen wijzigen" }); return; }
    if (/^\/api\/v1\/admin(\/|$)/.test(url) && !req.auth.superAdmin) { reply.code(403).send({ error: "Alleen voor het hoofdaccount" }); return; }
    const need: Access = req.method === "GET" || req.method === "HEAD" ? "view" : "edit";
    for (const env of envsOf(req)) {
      const a = access(req.auth, env);
      if (a === "none" || (need === "edit" && a !== "edit")) {
        reply.code(403).send({ error: `Geen ${need === "edit" ? "schrijf" : "lees"}rechten op ${env.toUpperCase()}`, env });
        return;
      }
    }
    done();
  });
}
