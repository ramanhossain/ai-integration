import type { EnvName } from "../domain/environments";
import { deployments } from "../domain/deployments";
import { runDeployed } from "../runtime/dispatch";
import { safeFetch } from "../net/egress";
import { apim, type ApiDoc, type Operation, type Policy, type OpLink } from "./apim";
import { parseJwt, verifyJwt, checkRules, claimValue } from "./jwt";

// API-gateway: elke aanroep op /apis/<omgeving>/<basispad>/<operatie> (of /o/<org>/apis/…).
// Volgorde: API en operatie zoeken → CORS → beleid (zonder beleid geen toegang) →
// IP-beperking → authenticatie (OAuth → API-sleutel → publiek) → throttling (endpoint en
// identiteit) → proces of passthrough → monitoring (velden volgens het beleid).

export interface GwRequest { method: string; path: string; rawQuery: string; query: Record<string, unknown>; headers: Record<string, unknown>; body: unknown; ip: string; baseUrl: string }
export interface GwResponse { status: number; headers: Record<string, string>; body: unknown }

const HOP = new Set(["connection", "keep-alive", "transfer-encoding", "upgrade", "proxy-authorization", "proxy-authenticate", "te", "trailer", "host", "content-length"]);
const hdr = (h: Record<string, unknown>, k: string) => { const v = h[k.toLowerCase()]; return Array.isArray(v) ? String(v[0]) : v === undefined ? undefined : String(v); };
const clip = (s: string, kb: number) => (s.length > kb * 1024 ? s.slice(0, kb * 1024) + "…" : s);
const asText = (b: unknown) => (b === undefined || b === null ? "" : Buffer.isBuffer(b) ? b.toString("utf8") : typeof b === "string" ? b : JSON.stringify(b));
// Geheimen nooit in de monitoring: sleutels/tokens gemaskeerd.
const masked = (h: Record<string, string>) => Object.fromEntries(Object.entries(h).map(([k, v]) => [k, /key|token|secret|signature|password/i.test(k) ? "•••" : v]));
const plainHeaders = (h: Record<string, unknown>, drop: string[] = []) => Object.fromEntries(Object.entries(h).filter(([k]) => !drop.includes(k.toLowerCase())).map(([k, v]) => [k, Array.isArray(v) ? v.join(", ") : String(v)]));

function ipOf(req: GwRequest, mode: Policy["logging"]["ip"] | undefined): string | undefined {
  const xff = hdr(req.headers, "x-forwarded-for");
  if (mode === "disable") return undefined;
  if (mode === "xff-first" && xff) return xff.split(",")[0].trim();
  if (mode === "xff-all" && xff) return xff;
  return req.ip;
}
function ipAllowed(ip: string, list: string[]): boolean {
  if (!list.length) return true;
  const v4 = (s: string) => s.replace(/^::ffff:/, "").split(".").reduce((n, x) => (n << 8) + Number(x), 0) >>> 0;
  return list.some((entry) => {
    const [net, bits] = entry.split("/");
    if (!bits) return ip.replace(/^::ffff:/, "") === net;
    if (!/^\d+\.\d+\.\d+\.\d+$/.test(net) || !/\d+\.\d+\.\d+\.\d+$/.test(ip)) return false;
    const mask = Number(bits) === 0 ? 0 : (~0 << (32 - Number(bits))) >>> 0;
    return (v4(ip) & mask) === (v4(net) & mask);
  });
}
function corsHeaders(p: Policy | undefined, origin: string | undefined): Record<string, string> {
  if (!p?.cors || !origin) return {};
  const allowed = p.cors.origins.includes("*") ? (p.cors.credentials ? origin : "*") : p.cors.origins.find((o) => o.toLowerCase() === origin.toLowerCase());
  if (!allowed) return {};
  return { "access-control-allow-origin": allowed, vary: "Origin", ...(p.cors.credentials ? { "access-control-allow-credentials": "true" } : {}) };
}

// OpenAPI-document zoals afnemers het zien (server-URL per omgeving).
export function publicSpec(doc: ApiDoc, env: EnvName, baseUrl: string): unknown {
  const { parse } = require("yaml") as typeof import("yaml");
  const spec = parse(doc.specText) as Record<string, unknown>;
  const url = `${baseUrl}/apis/${env}${doc.basePath}`;
  if (spec.openapi) spec.servers = [{ url, description: env.toUpperCase() }];
  else { const u = new URL(url); spec.host = u.host; spec.basePath = u.pathname; spec.schemes = [u.protocol.replace(":", "")]; }
  spec.info = { ...((spec.info as object) || {}), version: doc.version };
  return spec;
}

export async function handleGateway(env: EnvName, req: GwRequest): Promise<GwResponse | undefined> {
  const t0 = Date.now();
  const route = apim.route(env, req.method === "OPTIONS" ? String(hdr(req.headers, "access-control-request-method") || "GET").toUpperCase() : req.method, req.path);
  if (!route) return undefined; // geen API op dit pad: oude API-endpoints (triggers) proberen
  const { doc, op, params } = route;
  const origin = hdr(req.headers, "origin");
  const fullPath = "/" + req.path.replace(/^\/+/, "");
  const opMethod = req.method === "OPTIONS" ? String(hdr(req.headers, "access-control-request-method") || "GET").toUpperCase() : req.method;
  const hit = apim.policyFor(env, opMethod, fullPath);
  const policy = hit?.policy;
  const fields = new Set(policy?.logging.fields || ["identity"]);
  const kb = policy?.logging.bodyMaxKb || 1;
  const base = { env, method: req.method, path: fullPath, apiId: doc.id, api: doc.title, operation: op?.operationId || op?.key, origin, policy: policy?.name, ip: ipOf(req, policy?.logging.ip ?? "client"), query: fields.has("query") && req.rawQuery ? req.rawQuery.slice(0, 1000) : undefined, reqHeaders: fields.has("requestHeaders") ? masked(plainHeaders(req.headers, ["authorization", "cookie", "proxy-authorization"])) : undefined, reqBody: fields.has("requestBody") ? clip(asText(req.body), kb) : undefined };
  const finish = (status: number, body: unknown, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}): GwResponse => {
    const h = { ...corsHeaders(policy, origin), ...headers };
    const text = asText(body);
    apim.log({ ...base, at: new Date(t0).toISOString(), status, durationMs: Date.now() - t0, outcome: String(extra.outcome || (status < 400 ? "ok" : "error")), ...(extra as object),
      resHeaders: fields.has("responseHeaders") ? masked(h) : undefined,
      resBody: fields.has("responseBody") ? clip(text, kb) : fields.has("errorBody") && status >= 400 ? clip(text, kb) : undefined,
      identity: fields.has("identity") ? (extra.identity as string | undefined) : undefined });
    return { status, headers: h, body };
  };

  // Specificatie (openapi.json) is openbaar te lezen voor afnemers.
  if (route.spec) return { status: 200, headers: { "content-type": "application/json", "access-control-allow-origin": "*" }, body: publicSpec(doc, env, req.baseUrl) };

  // CORS-preflight.
  if (req.method === "OPTIONS") {
    if (!policy?.cors) return finish(204, null, { outcome: "preflight" });
    const h = corsHeaders(policy, origin);
    if (!h["access-control-allow-origin"]) return finish(403, { error: "Origin niet toegestaan" }, { outcome: "cors" });
    return finish(204, null, { outcome: "preflight" }, { "access-control-allow-methods": [...new Set([...policy.endpoints.map((e) => (e.method === "ALL" ? "GET, POST, PUT, PATCH, DELETE" : e.method)), "OPTIONS"])].join(", "), "access-control-allow-headers": ["content-type", "authorization", ...policy.identities.flatMap((i) => (i.type === "apikey" && i.location === "header" ? [i.keyName] : [])), ...(policy.cors.headers || [])].join(", "), "access-control-max-age": "600" });
  }
  if (!op && !doc.passthroughAll?.target) return finish(404, { error: `Operatie ${req.method} ${route.rest} bestaat niet in ${doc.title}` }, { outcome: "geen operatie" });
  if (!policy) return finish(401, { error: "Geen toegang: er is geen API-beleid voor dit endpoint op deze omgeving" }, { outcome: "geen beleid" });
  if (policy.ipAllow?.length && !ipAllowed(req.ip, policy.ipAllow)) return finish(403, { error: "IP-adres niet toegestaan" }, { outcome: "ip geweigerd" });

  // Authenticatie: OAuth → API-sleutel → publiek.
  let identity: string | undefined, identityKey: string | undefined, idThrottle;
  const auth = hdr(req.headers, "authorization") || "";
  const bearer = /^Bearer\s+/i.test(auth) ? auth.replace(/^Bearer\s+/i, "").trim() : "";
  const oauthIds = policy.identities.filter((i) => i.type === "oauth");
  if (bearer && oauthIds.length && parseJwt(bearer)) {
    let lastErr = "Token ongeldig";
    for (const i of oauthIds) {
      if (i.type !== "oauth") continue;
      try {
        const { claims } = await verifyJwt(bearer, apim.issuersFor(i.issuers));
        const ruleErr = checkRules(claims, i.rules);
        if (ruleErr) { lastErr = ruleErr; continue; }
        const who = String(claimValue(claims, i.throttleClaim || "sub") ?? claims.sub ?? "?");
        identity = `${i.name}: ${who}`; identityKey = `oauth:${i.name}:${who}`; idThrottle = i.throttle;
        break;
      } catch (err) { lastErr = (err as Error).message; }
    }
    if (!identity) return finish(401, { error: `Geen toegang: ${lastErr}` }, { outcome: "token geweigerd" }, { "www-authenticate": "Bearer" });
  }
  if (!identity) for (const i of policy.identities) {
    if (i.type !== "apikey") continue;
    const val = i.location === "query" ? (req.query[i.keyName] as string | undefined) : hdr(req.headers, i.keyName);
    if (!val) continue;
    const k = apim.matchKey(String(val), env, i.keys);
    if (k) { identity = `${i.name}: ${k.name}`; identityKey = `key:${k.id}`; idThrottle = i.throttle; break; }
  }
  if (!identity && policy.identities.some((i) => i.type === "public")) { identity = "publiek"; identityKey = undefined; }
  if (!identity) return finish(401, { error: "Geen toegang: geldige API-sleutel of token vereist" }, { outcome: "niet geauthenticeerd" });

  // Throttling: endpoint (voor iedereen samen) en identiteit (per sleutel/claim).
  const tEp = apim.throttle(`ep:${env}:${policy.id}:${hit!.endpoint.method}:${hit!.endpoint.path}`, hit!.endpoint.throttle);
  if (!tEp.ok) return finish(429, { error: "Te veel aanvragen voor dit endpoint" }, { outcome: "throttled", identity }, { "retry-after": String(tEp.retryAfter) });
  if (identityKey) {
    const tId = apim.throttle(`id:${env}:${identityKey}`, idThrottle);
    if (!tId.ok) return finish(429, { error: "Te veel aanvragen" }, { outcome: "throttled", identity }, { "retry-after": String(tId.retryAfter) });
  }

  // Uitvoeren: gekoppeld proces of passthrough.
  const link: OpLink | undefined = (op && doc.links[op.key]) || (doc.passthroughAll?.target ? doc.passthroughAll : undefined);
  if (!link || link.mode === "none") return finish(501, { error: `Operatie ${op?.key} is nog niet gekoppeld aan een proces` }, { outcome: "niet gekoppeld", identity });
  try {
    if (link.mode === "passthrough") return await passthrough(req, doc, op, link, finish, identity);
    return await runProcess(env, req, op!, params, link.process!, finish, identity);
  } catch (err) {
    return finish(502, { error: (err as Error).message }, { outcome: "fout", identity, error: (err as Error).message });
  }
}

type Finish = (status: number, body: unknown, extra?: Record<string, unknown>, headers?: Record<string, string>) => GwResponse;

async function runProcess(env: EnvName, req: GwRequest, op: Operation, params: Record<string, string>, name: string, finish: Finish, identity: string): Promise<GwResponse> {
  const def = deployments.getActiveDefinition(name, env);
  if (!def) return finish(503, { error: `Proces ${name} staat niet op ${env.toUpperCase()}` }, { outcome: "proces ontbreekt", target: name, identity });
  const body = req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body) && !Array.isArray(req.body) ? (req.body as Record<string, unknown>) : req.body === undefined ? {} : { body: Buffer.isBuffer(req.body) ? req.body.toString("utf8") : req.body };
  const headers = plainHeaders(req.headers, ["authorization", "cookie"]);
  const input = { ...body, params, query: req.query, headers, _trigger: { type: "api", env, method: req.method, path: req.path, operation: op.operationId || op.key, identity, firedAt: new Date().toISOString() } };
  const run = await runDeployed(def, env, input, { triggeredBy: "api" });
  const extra = { target: name, runId: run.id, processVersion: Number(def.version), identity };
  if (run.status !== "success") return finish(500, { error: run.error || "Proces gefaald", runId: run.id }, { ...extra, outcome: "proces gefaald", error: run.error });
  const custom = run.output?._response as { status?: number; body?: unknown; headers?: Record<string, string> } | undefined;
  if (custom) return finish(Number(custom.status || 200), custom.body ?? null, extra, Object.fromEntries(Object.entries(custom.headers || {}).map(([k, v]) => [k.toLowerCase(), String(v)])));
  const out = Object.fromEntries(Object.entries(run.output ?? {}).filter(([k]) => !k.startsWith("_") && !["params", "query", "headers"].includes(k)));
  return finish(200, out, extra);
}

async function passthrough(req: GwRequest, doc: ApiDoc, op: Operation | undefined, link: OpLink, finish: Finish, identity: string): Promise<GwResponse> {
  const rest = req.path.slice(doc.basePath.length) || "";
  let url = link.target!.replace(/\/+$/, "");
  if (link.forwardPath !== false) url += rest.startsWith("/") ? rest : `/${rest}`;
  if (link.forwardQuery !== false && req.rawQuery) url += (url.includes("?") ? "&" : "?") + req.rawQuery;
  const remove = new Set([...(link.removeHeaders || []), "cookie", "x-aip-user"]);
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers)) if (!HOP.has(k.toLowerCase()) && !remove.has(k.toLowerCase())) headers[k] = Array.isArray(v) ? v.join(", ") : String(v);
  // API-sleutel van de afnemer niet doorsturen naar de achterliggende API.
  for (const k of Object.keys(headers)) if (/^(x-api-key|apikey|api-key)$/i.test(k)) delete headers[k];
  Object.assign(headers, link.setHeaders || {});
  const hasBody = !["GET", "HEAD"].includes(req.method) && req.body !== undefined;
  const res = await safeFetch(url, { method: req.method, headers, body: hasBody ? (Buffer.isBuffer(req.body) ? new Uint8Array(req.body) : typeof req.body === "string" ? req.body : JSON.stringify(req.body)) : undefined, signal: AbortSignal.timeout(30000) });
  const ct = res.headers.get("content-type") || "";
  const buf = Buffer.from(await res.arrayBuffer());
  const outHeaders: Record<string, string> = {};
  res.headers.forEach((v, k) => { if (!HOP.has(k) && k !== "content-encoding" && k !== "set-cookie") outHeaders[k] = v; });
  const body = /json/.test(ct) ? (() => { try { return JSON.parse(buf.toString("utf8")); } catch { return buf.toString("utf8"); } })() : /^text\/|xml/.test(ct) ? buf.toString("utf8") : buf;
  return finish(res.status, body, { target: url.replace(/\?.*$/, ""), identity, outcome: res.status < 400 ? "ok" : "fout van doelsysteem" }, outHeaders);
}
