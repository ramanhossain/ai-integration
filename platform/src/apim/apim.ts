import { randomBytes, createHash } from "node:crypto";
import { parse as parseYaml } from "yaml";
import { persistence } from "../store";
import { audit } from "../audit/auditLog";
import { bus } from "../events/bus";
import { scoped } from "../tenancy/context";
import { ENVIRONMENTS, type EnvName } from "../domain/environments";
import { encrypt, decrypt } from "../connectors/credentials";
import type { Issuer, ClaimRule } from "./jwt";

// API-beheer (per organisatie):
// - API's: OpenAPI-specificatie (JSON/YAML), basispad, koppeling per operatie aan een proces
//   of passthrough. Opslaan = nieuwe patchversie (DEV is altijd de werkversie). Deployen naar
//   TEST/ACC/PROD publiceert de versie (nieuwe majorversie, daarna onveranderlijk).
// - API-beleid: welke endpoints, wie mag erbij (API-sleutel, OAuth/JWT, publiek), throttling,
//   logging, CORS en IP-beperking — per omgeving. Zonder beleid: geen toegang.
// - API-sleutels voor afnemers (per omgeving), OAuth-uitgevers en API-monitoring.

export const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;
export type Method = (typeof METHODS)[number] | "ALL";

export interface OpLink {
  mode: "none" | "process" | "passthrough";
  process?: string;
  target?: string; // passthrough-doel-URL
  forwardPath?: boolean; // resterend pad doorgeven
  forwardQuery?: boolean; // querystring doorgeven
  setHeaders?: Record<string, string>;
  removeHeaders?: string[];
}
export interface ApiDoc {
  id: string; title: string; description?: string; basePath: string; specText: string; version: string;
  links: Record<string, OpLink>; passthroughAll?: OpLink;
  createdAt: string; createdBy: string; updatedAt: string; updatedBy: string;
}
export interface ApiVersion { key: string; apiId: string; version: string; at: string; by: string; note?: string; published?: boolean; publishedAs?: string; doc: ApiDoc }
export interface ApiDeploy { version: string; at: string; by: string }
export interface Operation { key: string; method: string; path: string; operationId?: string; summary?: string; params: Array<{ name: string; in: string; required?: boolean }>; hasBody: boolean; tags?: string[] }

export interface Throttle { limit: number; windowSec: number }
export interface PolicyEndpoint { method: Method; path: string; throttle?: Throttle }
export type Identity =
  | { type: "apikey"; name: string; keyName: string; location: "header" | "query"; keys: string[]; throttle?: Throttle }
  | { type: "oauth"; name: string; issuers: string[]; rules?: ClaimRule[]; throttleClaim?: string; throttle?: Throttle }
  | { type: "public"; name?: string };
export interface Policy {
  id: string; name: string; description?: string; tags?: string[]; enabled: boolean; envs: EnvName[];
  endpoints: PolicyEndpoint[]; identities: Identity[];
  logging: { fields: string[]; bodyMaxKb: 1 | 10 | 100; ip: "client" | "xff-first" | "xff-all" | "disable" };
  cors?: { origins: string[]; headers?: string[]; credentials?: boolean };
  ipAllow?: string[];
  createdAt: string; updatedAt: string; updatedBy: string;
}
export interface ConsumerKey { id: string; name: string; env: EnvName; hint: string; enabled: boolean; description?: string; createdAt: string; createdBy: string; lastUsedAt?: string }
export interface IssuerDoc extends Issuer { createdAt: string; createdBy: string; hasSecret?: boolean }
export interface ApiLog {
  id: string; at: string; env: EnvName; method: string; path: string; status: number; durationMs: number;
  apiId?: string; api?: string; operation?: string; target?: string; policy?: string; identity?: string; ip?: string; origin?: string;
  query?: string; reqHeaders?: Record<string, string>; resHeaders?: Record<string, string>; reqBody?: string; resBody?: string; error?: string;
  runId?: string; processVersion?: number; outcome: string;
}
export const LOG_FIELDS = ["identity", "query", "requestHeaders", "responseHeaders", "errorBody", "requestBody", "responseBody"] as const;

const now = () => new Date().toISOString();
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const slug = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "api";
const MAX_LOGS = 5000;

export function normBasePath(p: string): string {
  const clean = "/" + String(p || "").trim().replace(/^\/+|\/+$/g, "");
  if (clean === "/") throw new Error("Geef de API een basispad, bijv. /orders/v1");
  if (!/^(\/[A-Za-z0-9._~-]+)+$/.test(clean)) throw new Error("Basispad mag alleen letters, cijfers en - _ . ~ bevatten (bijv. /orders/v1)");
  return clean;
}
// OpenAPI (3.x of 2.0) uit JSON of YAML; geeft de operaties terug.
export function parseSpec(text: string): { spec: Record<string, unknown>; ops: Operation[]; title?: string; description?: string; serverPath?: string } {
  let spec: Record<string, unknown>;
  try { spec = parseYaml(text) as Record<string, unknown>; } catch (err) { throw new Error(`Specificatie is geen geldige JSON/YAML: ${(err as Error).message}`); }
  if (spec === null || spec === undefined || (typeof spec === "string" && !String(spec).trim())) throw new Error("Lege specificatie");
  if (typeof spec !== "object" || Array.isArray(spec)) throw new Error("Geen OpenAPI-document: verwacht een object met 'openapi', 'info' en 'paths'");
  if (!spec.openapi && !spec.swagger) throw new Error("Geen OpenAPI-document (veld 'openapi' of 'swagger' ontbreekt)");
  const paths = (spec.paths || {}) as Record<string, Record<string, unknown>>;
  const ops: Operation[] = [];
  for (const [p, item] of Object.entries(paths)) {
    if (!item || typeof item !== "object") continue;
    const shared = (item.parameters as Array<{ name: string; in: string; required?: boolean }>) || [];
    for (const m of Object.keys(item)) {
      const M = m.toUpperCase();
      if (!(METHODS as readonly string[]).includes(M)) continue;
      const op = item[m] as Record<string, unknown>;
      const params = [...shared, ...((op.parameters as Array<{ name: string; in: string; required?: boolean }>) || [])].filter((x) => x && x.name).map((x) => ({ name: x.name, in: x.in, required: x.required }));
      const path = "/" + p.replace(/^\/+/, "");
      ops.push({ key: `${M} ${path}`, method: M, path, operationId: op.operationId as string | undefined, summary: (op.summary || op.description) as string | undefined, params, hasBody: Boolean(op.requestBody) || params.some((x) => x.in === "body"), tags: op.tags as string[] | undefined });
    }
  }
  const info = (spec.info || {}) as Record<string, unknown>;
  const servers = spec.servers as Array<{ url?: string }> | undefined;
  let serverPath: string | undefined;
  const su = servers?.[0]?.url || (spec.basePath as string | undefined);
  if (su) { try { serverPath = new URL(su, "http://x").pathname.replace(/\/+$/, ""); } catch { /* geen pad */ } }
  return { spec, ops, title: info.title as string | undefined, description: info.description as string | undefined, serverPath: serverPath && serverPath !== "/" ? serverPath : undefined };
}
const bump = (v: string, part: "major" | "patch") => { const [a, b, c] = v.split(".").map((x) => Number(x) || 0); return part === "major" ? `${a + 1}.0.0` : `${a}.${b}.${c + 1}`; };

// Pad-sjabloon matchen: /orders/{id} ~ /orders/42
export function matchTemplate(tpl: string, path: string): Record<string, string> | null {
  const a = tpl.replace(/^\/+|\/+$/g, "").split("/"), b = path.replace(/^\/+|\/+$/g, "").split("/");
  if (a.length !== b.length || (a.length === 1 && a[0] === "" && b[0] !== "")) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < a.length; i++) {
    const m = a[i].match(/^\{([^}]+)\}$/);
    if (m) { if (!b[i]) return null; params[m[1]] = decodeURIComponent(b[i]); }
    else if (a[i] !== b[i]) return null;
  }
  return params;
}
// Beleid: segmentgewijze prefix, hoofdletterongevoelig, {var} = één willekeurig segment.
export function policyPathMatches(pattern: string, path: string): number {
  const a = pattern.toLowerCase().replace(/^\/+|\/+$/g, "").split("/").filter(Boolean);
  const b = path.toLowerCase().replace(/^\/+|\/+$/g, "").split("/").filter(Boolean);
  if (a.length > b.length) return -1;
  for (let i = 0; i < a.length; i++) if (!/^\{[^}]+\}$/.test(a[i]) && a[i] !== b[i]) return -1;
  return a.length; // specifieker = hoger
}

class Apim {
  private apis = new Map<string, ApiDoc>();
  private versions = new Map<string, ApiVersion>();
  private deploys = new Map<string, Partial<Record<EnvName, ApiDeploy>>>();
  private policies = new Map<string, Policy>();
  private keys = new Map<string, ConsumerKey & { hash: string }>();
  private issuers = new Map<string, IssuerDoc & { secretEnc?: string }>();
  private logs: ApiLog[] = [];
  private windows = new Map<string, { start: number; count: number }>();

  async hydrate(): Promise<void> {
    for (const { doc } of await persistence.loadAll("apim-apis")) { const d = doc as ApiDoc; this.apis.set(d.id, d); }
    for (const { doc } of await persistence.loadAll("apim-versions")) { const v = doc as ApiVersion; this.versions.set(v.key, v); }
    for (const { id, doc } of await persistence.loadAll("apim-deploys")) this.deploys.set(id, doc as Partial<Record<EnvName, ApiDeploy>>);
    for (const { doc } of await persistence.loadAll("apim-policies")) { const p = doc as Policy; this.policies.set(p.id, p); }
    for (const { doc } of await persistence.loadAll("apim-keys")) { const k = doc as ConsumerKey & { hash: string }; this.keys.set(k.id, k); }
    for (const { doc } of await persistence.loadAll("apim-issuers")) { const i = doc as IssuerDoc & { secretEnc?: string }; this.issuers.set(i.id, i); }
    this.logs = (await persistence.loadAll("apim-logs")).map((r) => r.doc as ApiLog).sort((a, b) => b.at.localeCompare(a.at)).slice(0, MAX_LOGS);
  }

  // ---------------------------------------------------------------- API's
  listApis(): Array<ApiDoc & { operations: number; linked: number; deployed: Partial<Record<EnvName, ApiDeploy>> }> {
    return [...this.apis.values()].sort((a, b) => a.title.localeCompare(b.title)).map((d) => {
      const ops = this.operations(d);
      return { ...d, operations: ops.length, linked: ops.filter((o) => (d.links[o.key]?.mode ?? "none") !== "none").length + (d.passthroughAll?.target ? ops.length : 0), deployed: { dev: { version: d.version, at: d.updatedAt, by: d.updatedBy }, ...(this.deploys.get(d.id) || {}) } };
    });
  }
  getApi(id: string): ApiDoc | undefined { return this.apis.get(id); }
  operations(d: ApiDoc): Operation[] { try { return parseSpec(d.specText).ops; } catch { return []; } }
  deployed(id: string): Partial<Record<EnvName, ApiDeploy>> { return this.deploys.get(id) || {}; }
  versionsOf(id: string): ApiVersion[] { return [...this.versions.values()].filter((v) => v.apiId === id).sort((a, b) => cmpVer(b.version, a.version)).map((v) => ({ ...v, doc: undefined as unknown as ApiDoc })); }
  getVersion(id: string, version: string): ApiVersion | undefined { return this.versions.get(`${id}@${version}`); }
  // De versie die op een omgeving draait (DEV = werkversie).
  docFor(id: string, env: EnvName): ApiDoc | undefined {
    if (env === "dev") return this.apis.get(id);
    const d = this.deploys.get(id)?.[env];
    return d ? this.versions.get(`${id}@${d.version}`)?.doc : undefined;
  }
  private checkBasePath(base: string, exceptId?: string): void {
    for (const d of this.apis.values()) {
      if (d.id === exceptId) continue;
      const a = d.basePath.toLowerCase(), b = base.toLowerCase();
      if (a === b || a.startsWith(b + "/") || b.startsWith(a + "/")) throw new Error(`Basispad ${base} overlapt met API '${d.title}' (${d.basePath})`);
    }
  }
  private record(d: ApiDoc, by: string, note?: string, published = false): void {
    const v: ApiVersion = { key: `${d.id}@${d.version}`, apiId: d.id, version: d.version, at: now(), by, note, published, doc: JSON.parse(JSON.stringify(d)) };
    this.versions.set(v.key, v);
    persistence.put("apim-versions", v.key, v);
  }
  createApi(input: { specText: string; basePath?: string; title?: string; description?: string }, by: string): ApiDoc {
    const p = parseSpec(input.specText);
    const base = normBasePath(input.basePath || p.serverPath || "");
    this.checkBasePath(base);
    const title = String(input.title || p.title || base).trim().slice(0, 100);
    let id = slug(title);
    for (let i = 2; this.apis.has(id); i++) id = `${slug(title).slice(0, 36)}-${i}`;
    const d: ApiDoc = { id, title, description: input.description ?? p.description, basePath: base, specText: input.specText, version: "1.0.0", links: {}, createdAt: now(), createdBy: by, updatedAt: now(), updatedBy: by };
    this.apis.set(id, d);
    persistence.put("apim-apis", id, d);
    this.record(d, by, "Aangemaakt");
    audit.append({ actor: by, event: "api.created", subject: id, data: { basePath: base } });
    bus.publish("api.changed", { id });
    return d;
  }
  saveApi(id: string, patch: Partial<Pick<ApiDoc, "specText" | "basePath" | "title" | "description" | "links" | "passthroughAll">>, by: string, note?: string): ApiDoc {
    const d = this.apis.get(id);
    if (!d) throw new Error("API niet gevonden");
    const next: ApiDoc = JSON.parse(JSON.stringify(d));
    if (patch.specText !== undefined) { parseSpec(patch.specText); next.specText = patch.specText; }
    if (patch.basePath !== undefined) { next.basePath = normBasePath(patch.basePath); this.checkBasePath(next.basePath, id); }
    if (patch.title !== undefined) { const t = String(patch.title).trim(); if (t.length < 2) throw new Error("Titel te kort"); next.title = t.slice(0, 100); }
    if (patch.description !== undefined) next.description = String(patch.description).slice(0, 2000);
    if (patch.links !== undefined) next.links = sanitizeLinks(patch.links);
    if (patch.passthroughAll !== undefined) next.passthroughAll = patch.passthroughAll && patch.passthroughAll.target ? sanitizeLink({ ...patch.passthroughAll, mode: "passthrough" }) : undefined;
    // Koppelingen van operaties die niet meer bestaan opruimen.
    const keys = new Set(this.operations(next).map((o) => o.key));
    for (const k of Object.keys(next.links)) if (!keys.has(k)) delete next.links[k];
    next.version = bump(d.version, "patch");
    next.updatedAt = now(); next.updatedBy = by;
    this.apis.set(id, next);
    persistence.put("apim-apis", id, next);
    this.record(next, by, note);
    audit.append({ actor: by, event: "api.saved", subject: id, data: { version: next.version, note } });
    bus.publish("api.changed", { id });
    return next;
  }
  // Deployen = publiceren: een nog niet gepubliceerde versie wordt de volgende majorversie
  // (onveranderlijk). Een al gepubliceerde versie kan naar elke omgeving (ook terugzetten).
  deployApi(id: string, env: EnvName, version: string | undefined, by: string): { version: string; from?: string } {
    if (env === "dev") throw new Error("DEV is altijd de werkversie; deployen gaat naar TEST, ACC of PROD");
    const d = this.apis.get(id);
    if (!d) throw new Error("API niet gevonden");
    let v = this.versions.get(`${id}@${version || d.version}`);
    if (!v) throw new Error(`Versie ${version} bestaat niet`);
    if (!v.published && v.publishedAs && this.versions.get(`${id}@${v.publishedAs}`)) v = this.versions.get(`${id}@${v.publishedAs}`)!;
    if (!v.published) {
      const source = v;
      const major = bump([...this.versions.values()].filter((x) => x.apiId === id).map((x) => x.version).sort(cmpVer).pop() || v.version, "major");
      const pub: ApiDoc = { ...JSON.parse(JSON.stringify(v.doc)), version: major };
      this.record(pub, by, `Gepubliceerd vanaf ${v.version}`, true);
      source.publishedAs = major;
      persistence.put("apim-versions", source.key, source);
      v = this.versions.get(`${id}@${major}`)!;
      if (d.version === version || !version) { d.version = major; persistence.put("apim-apis", id, d); }
    }
    const cur = this.deploys.get(id) || {};
    const from = cur[env]?.version;
    cur[env] = { version: v.version, at: now(), by };
    this.deploys.set(id, cur);
    persistence.put("apim-deploys", id, cur);
    audit.append({ actor: by, event: "api.deployed", subject: id, data: { env, version: v.version, from } });
    bus.publish("api.deployed", { id, env, version: v.version });
    return { version: v.version, from };
  }
  restoreApi(id: string, version: string, by: string): ApiDoc {
    const v = this.versions.get(`${id}@${version}`);
    if (!v) throw new Error("Versie niet gevonden");
    const { specText, basePath, title, description, links, passthroughAll } = v.doc;
    return this.saveApi(id, { specText, basePath, title, description, links, passthroughAll: passthroughAll ?? { mode: "none" } as OpLink }, by, `Teruggezet van ${version}`);
  }
  deleteApi(id: string, by: string): void {
    if (!this.apis.has(id)) throw new Error("API niet gevonden");
    const live = Object.entries(this.deploys.get(id) || {}).filter(([, x]) => x).map(([e]) => e.toUpperCase());
    if (live.length) throw new Error(`API staat nog op ${live.join(", ")}. Haal hem daar eerst weg.`);
    this.apis.delete(id);
    persistence.delete("apim-apis", id);
    for (const [k, v] of this.versions) if (v.apiId === id) { this.versions.delete(k); persistence.delete("apim-versions", k); }
    this.deploys.delete(id);
    persistence.delete("apim-deploys", id);
    audit.append({ actor: by, event: "api.deleted", subject: id });
    bus.publish("api.changed", { id });
  }
  undeployApi(id: string, env: EnvName, by: string): void {
    if (!this.apis.has(id)) throw Object.assign(new Error("API niet gevonden"), { statusCode: 404 });
    const cur = this.deploys.get(id) || {};
    if (!cur[env]) throw Object.assign(new Error(`API staat niet op ${env.toUpperCase()}`), { statusCode: 404 });
    delete cur[env];
    this.deploys.set(id, cur);
    persistence.put("apim-deploys", id, cur);
    audit.append({ actor: by, event: "api.undeployed", subject: id, data: { env } });
  }

  // Processen die in API-beheer aan een operatie gekoppeld zijn (werkversie of gedeployed):
  // die zijn alleen via de gateway (met beleid) bereikbaar, niet via de losse API-endpoints.
  linkedProcesses(): Set<string> {
    const out = new Set<string>();
    const add = (d?: ApiDoc) => { for (const l of Object.values(d?.links || {})) if (l.mode === "process" && l.process) out.add(l.process); };
    for (const d of this.apis.values()) { add(d); for (const e of ENVIRONMENTS) add(this.docFor(d.id, e)); }
    return out;
  }

  // Welke API en operatie hoort bij een pad op een omgeving?
  route(env: EnvName, method: string, path: string): { doc: ApiDoc; op?: Operation; params: Record<string, string>; rest: string; spec?: boolean } | undefined {
    const clean = "/" + path.replace(/^\/+/, "");
    for (const d0 of this.apis.values()) {
      const doc = this.docFor(d0.id, env);
      if (!doc) continue;
      const base = doc.basePath.toLowerCase();
      const lower = clean.toLowerCase();
      if (lower !== base && !lower.startsWith(base + "/")) continue;
      const rest = clean.slice(doc.basePath.length) || "/";
      if (method === "GET" && rest === "/openapi.json") return { doc, params: {}, rest, spec: true };
      const ops = this.operations(doc);
      const cands = ops.map((o) => ({ o, p: matchTemplate(o.path, rest) })).filter((x) => x.p);
      const exact = cands.find((x) => x.o.method === method) || (method === "HEAD" ? cands.find((x) => x.o.method === "GET") : undefined);
      if (exact) return { doc, op: exact.o, params: exact.p!, rest };
      return { doc, params: {}, rest, op: undefined };
    }
    return undefined;
  }

  // ---------------------------------------------------------------- beleid
  listPolicies(): Policy[] { return [...this.policies.values()].sort((a, b) => a.name.localeCompare(b.name)); }
  getPolicy(id: string): Policy | undefined { return this.policies.get(id); }
  savePolicy(input: Partial<Policy> & { name: string }, by: string, id?: string): Policy {
    const name = String(input.name || "").trim().slice(0, 80);
    if (name.length < 2) throw new Error("Geef het beleid een naam");
    if ([...this.policies.values()].some((p) => p.name.toLowerCase() === name.toLowerCase() && p.id !== id)) throw new Error("Er bestaat al een beleid met deze naam");
    const envs = (input.envs || []).filter((e): e is EnvName => (ENVIRONMENTS as readonly string[]).includes(e));
    if (!envs.length) throw new Error("Kies minstens één omgeving");
    const endpoints = (input.endpoints || []).map((e) => ({ method: (String(e.method || "ALL").toUpperCase() as Method), path: "/" + String(e.path || "").trim().replace(/^\/+|\/+$/g, ""), throttle: normThrottle(e.throttle) }));
    if (!endpoints.length) throw new Error("Kies minstens één endpoint");
    for (const e of endpoints) if (e.method !== "ALL" && !(METHODS as readonly string[]).includes(e.method)) throw new Error(`Onbekende methode ${e.method}`);
    const identities: Identity[] = (input.identities || []).map((i) => {
      if (i.type === "apikey") return { type: "apikey", name: String(i.name || "API-sleutel").slice(0, 60), keyName: String(i.keyName || "x-api-key").trim().slice(0, 60), location: i.location === "query" ? "query" : "header", keys: (i.keys || []).filter((k) => this.keys.has(k)), throttle: normThrottle(i.throttle) };
      if (i.type === "oauth") return { type: "oauth", name: String(i.name || "OAuth").slice(0, 60), issuers: (i.issuers || []).filter((k) => this.issuers.has(k)), rules: (i.rules || []).filter((r) => r && r.claim).map((r) => ({ claim: String(r.claim), op: (["exists", "exact", "regex"].includes(r.op) ? r.op : "exists") as ClaimRule["op"], value: r.value === undefined ? undefined : String(r.value) })), throttleClaim: i.throttleClaim ? String(i.throttleClaim) : undefined, throttle: normThrottle(i.throttle) };
      return { type: "public", name: "Publiek" };
    });
    if (!identities.length) throw new Error("Kies minstens één identiteit (API-sleutel, OAuth of publiek)");
    for (const i of identities) if (i.type === "apikey") {
      const wrong = i.keys.map((k) => this.keys.get(k)).filter((k) => k && !envs.includes(k.env));
      if (wrong.length) throw new Error(`Sleutel '${wrong[0]!.name}' hoort bij ${wrong[0]!.env.toUpperCase()}, dat niet in dit beleid zit`);
    }
    for (const i of identities) {
      if (i.type === "apikey" && !i.keys.length) throw new Error(`Identiteit '${i.name}': kies minstens één API-sleutel`);
      if (i.type === "oauth" && !i.issuers.length) throw new Error(`Identiteit '${i.name}': kies minstens één OAuth-uitgever`);
    }
    const lg = input.logging || { fields: ["identity"], bodyMaxKb: 1, ip: "client" };
    const p: Policy = {
      id: id || `pol-${randomBytes(4).toString("hex")}`, name, description: input.description ? String(input.description).slice(0, 500) : undefined,
      tags: (input.tags || []).map((t) => String(t).trim()).filter(Boolean).slice(0, 10), enabled: input.enabled !== false, envs, endpoints, identities,
      logging: { fields: (lg.fields || []).filter((f) => (LOG_FIELDS as readonly string[]).includes(f)), bodyMaxKb: ([1, 10, 100].includes(Number(lg.bodyMaxKb)) ? Number(lg.bodyMaxKb) : 1) as 1 | 10 | 100, ip: (["client", "xff-first", "xff-all", "disable"].includes(lg.ip) ? lg.ip : "client") as Policy["logging"]["ip"] },
      cors: input.cors && (input.cors.origins || []).length ? { origins: input.cors.origins.map((o) => String(o).trim()).filter(Boolean), headers: (input.cors.headers || []).map(String), credentials: Boolean(input.cors.credentials) } : undefined,
      ipAllow: (input.ipAllow || []).map((x) => String(x).trim()).filter(Boolean),
      createdAt: id ? this.policies.get(id)?.createdAt || now() : now(), updatedAt: now(), updatedBy: by
    };
    // Elke methode/pad-combinatie per omgeving mag maar door één beleid worden gedekt.
    if (p.enabled) for (const other of this.policies.values()) {
      if (other.id === p.id || !other.enabled) continue;
      const envOverlap = other.envs.filter((e) => p.envs.includes(e));
      if (!envOverlap.length) continue;
      for (const a of p.endpoints) for (const b of other.endpoints) {
        if (a.method === b.method && a.path.toLowerCase() === b.path.toLowerCase()) throw new Error(`${a.method} ${a.path} op ${envOverlap.map((e) => e.toUpperCase()).join(", ")} valt al onder beleid '${other.name}'`);
      }
    }
    this.policies.set(p.id, p);
    persistence.put("apim-policies", p.id, p);
    audit.append({ actor: by, event: id ? "api.policy_updated" : "api.policy_created", subject: p.id, data: { name: p.name, envs: p.envs } });
    return p;
  }
  deletePolicy(id: string, by: string): void {
    if (!this.policies.delete(id)) throw new Error("Beleid niet gevonden");
    persistence.delete("apim-policies", id);
    audit.append({ actor: by, event: "api.policy_deleted", subject: id });
  }
  // Het beleid dat een aanroep dekt: meest specifieke pad, daarna expliciete methode boven ALL.
  policyFor(env: EnvName, method: string, path: string): { policy: Policy; endpoint: PolicyEndpoint } | undefined {
    let best: { policy: Policy; endpoint: PolicyEndpoint; score: number } | undefined;
    for (const p of this.policies.values()) {
      if (!p.enabled || !p.envs.includes(env)) continue;
      for (const e of p.endpoints) {
        if (e.method !== "ALL" && e.method !== method) continue;
        const s = policyPathMatches(e.path, path);
        if (s < 0) continue;
        const score = s * 2 + (e.method === "ALL" ? 0 : 1);
        if (!best || score > best.score) best = { policy: p, endpoint: e, score };
      }
    }
    return best;
  }

  // ---------------------------------------------------------------- API-sleutels (afnemers)
  listKeys(): ConsumerKey[] { return [...this.keys.values()].map(({ hash: _h, ...k }) => k).sort((a, b) => a.env.localeCompare(b.env) || a.name.localeCompare(b.name)); }
  createKey(input: { name: string; env: EnvName; description?: string }, by: string): { key: string; info: ConsumerKey } {
    const name = String(input.name || "").trim().slice(0, 60);
    if (name.length < 2) throw new Error("Geef de sleutel een naam");
    if (!(ENVIRONMENTS as readonly string[]).includes(input.env)) throw new Error("Kies een omgeving");
    const key = `ak_${input.env}_${randomBytes(24).toString("base64url")}`;
    const info: ConsumerKey = { id: `key-${randomBytes(4).toString("hex")}`, name, env: input.env, hint: key.slice(-4), enabled: true, description: input.description?.slice(0, 300), createdAt: now(), createdBy: by };
    this.keys.set(info.id, { ...info, hash: sha(key) });
    persistence.put("apim-keys", info.id, { ...info, hash: sha(key) });
    audit.append({ actor: by, event: "api.key_created", subject: info.id, data: { name, env: input.env } });
    return { key, info };
  }
  updateKey(id: string, patch: { enabled?: boolean; name?: string; description?: string }, by: string): ConsumerKey {
    const k = this.keys.get(id);
    if (!k) throw new Error("Sleutel niet gevonden");
    if (patch.enabled !== undefined) k.enabled = Boolean(patch.enabled);
    if (patch.name) k.name = String(patch.name).slice(0, 60);
    if (patch.description !== undefined) k.description = String(patch.description).slice(0, 300);
    persistence.put("apim-keys", id, k);
    audit.append({ actor: by, event: "api.key_updated", subject: id, data: patch as Record<string, unknown> });
    const { hash: _h, ...info } = k;
    return info;
  }
  deleteKey(id: string, by: string): void {
    if (!this.keys.delete(id)) throw new Error("Sleutel niet gevonden");
    persistence.delete("apim-keys", id);
    for (const p of this.policies.values()) for (const i of p.identities) if (i.type === "apikey" && i.keys.includes(id)) { i.keys = i.keys.filter((x) => x !== id); persistence.put("apim-policies", p.id, p); }
    audit.append({ actor: by, event: "api.key_deleted", subject: id });
  }
  matchKey(value: string, env: EnvName, allowed: string[]): ConsumerKey | undefined {
    const h = sha(value);
    for (const id of allowed) {
      const k = this.keys.get(id);
      if (k && k.enabled && k.env === env && k.hash === h) {
        if (!k.lastUsedAt || Date.now() - Date.parse(k.lastUsedAt) > 60_000) { k.lastUsedAt = now(); persistence.put("apim-keys", k.id, k); }
        const { hash: _h, ...info } = k;
        return info;
      }
    }
    return undefined;
  }

  // ---------------------------------------------------------------- OAuth-uitgevers
  listIssuers(): IssuerDoc[] { return [...this.issuers.values()].map(({ secretEnc, hsSecret: _s, ...i }) => ({ ...i, hasSecret: Boolean(secretEnc) })); }
  saveIssuer(input: { name: string; issuer: string; audience?: string; jwksUri?: string; hsSecret?: string }, by: string, id?: string): IssuerDoc {
    const name = String(input.name || "").trim().slice(0, 60);
    if (name.length < 2) throw new Error("Geef de uitgever een naam");
    const iss = String(input.issuer || "").trim();
    if (!/^https?:\/\//.test(iss)) throw new Error("Issuer moet een URL zijn (bijv. https://login.microsoftonline.com/<tenant>/v2.0)");
    const prev = id ? this.issuers.get(id) : undefined;
    if (id && !prev) throw new Error("Uitgever niet gevonden");
    const jwksUri = input.jwksUri ? String(input.jwksUri).trim() : undefined;
    if (jwksUri && !/^https:\/\//.test(jwksUri)) throw new Error("JWKS-URI moet https gebruiken");
    const secretEnc = input.hsSecret ? encrypt(String(input.hsSecret)) : prev?.secretEnc;
    if (!jwksUri && !secretEnc) throw new Error("Vul een JWKS-URI in (of een gedeeld geheim voor HS-tokens)");
    const doc = { id: id || `iss-${randomBytes(4).toString("hex")}`, name, issuer: iss, audience: input.audience ? String(input.audience).trim() : undefined, jwksUri, secretEnc, createdAt: prev?.createdAt || now(), createdBy: prev?.createdBy || by };
    this.issuers.set(doc.id, doc as IssuerDoc & { secretEnc?: string });
    persistence.put("apim-issuers", doc.id, doc);
    audit.append({ actor: by, event: id ? "api.issuer_updated" : "api.issuer_created", subject: doc.id, data: { name, issuer: iss } });
    return this.listIssuers().find((x) => x.id === doc.id)!;
  }
  deleteIssuer(id: string, by: string): void {
    if (!this.issuers.delete(id)) throw new Error("Uitgever niet gevonden");
    persistence.delete("apim-issuers", id);
    for (const p of this.policies.values()) for (const i of p.identities) if (i.type === "oauth" && i.issuers.includes(id)) { i.issuers = i.issuers.filter((x) => x !== id); persistence.put("apim-policies", p.id, p); }
    audit.append({ actor: by, event: "api.issuer_deleted", subject: id });
  }
  issuersFor(ids: string[]): Issuer[] {
    return ids.map((id) => this.issuers.get(id)).filter((x): x is IssuerDoc & { secretEnc?: string } => Boolean(x)).map((x) => ({ id: x.id, name: x.name, issuer: x.issuer, audience: x.audience, jwksUri: x.jwksUri, hsSecret: x.secretEnc ? decrypt(x.secretEnc) : undefined }));
  }

  // ---------------------------------------------------------------- throttling (vast venster)
  throttle(key: string, t: Throttle | undefined): { ok: boolean; retryAfter?: number } {
    if (!t || !t.limit) return { ok: true };
    const nowMs = Date.now(), win = t.windowSec * 1000;
    const w = this.windows.get(key);
    if (!w || nowMs - w.start >= win) { this.windows.set(key, { start: nowMs, count: 1 }); return { ok: true }; }
    w.count++;
    if (w.count > t.limit) return { ok: false, retryAfter: Math.max(1, Math.ceil((w.start + win - nowMs) / 1000)) };
    return { ok: true };
  }

  // ---------------------------------------------------------------- monitoring
  log(rec: Omit<ApiLog, "id">): ApiLog {
    const l: ApiLog = { id: randomBytes(8).toString("hex"), ...rec };
    this.logs.unshift(l);
    persistence.put("apim-logs", l.id, l);
    for (const old of this.logs.splice(MAX_LOGS)) persistence.delete("apim-logs", old.id);
    bus.publish("api.request", { id: l.id, env: l.env, status: l.status });
    return l;
  }
  queryLogs(f: { env?: string; apiId?: string; operation?: string; status?: string; method?: string; minMs?: number; from?: string; to?: string; path?: string; query?: string; ip?: string; identity?: string; limit?: number }): { items: ApiLog[]; total: number; stats: Record<string, unknown> } {
    const has = (v: string | undefined, q?: string) => !q || String(v || "").toLowerCase().includes(q.toLowerCase());
    const st = f.status;
    const list = this.logs.filter((l) =>
      (!f.env || l.env === f.env) && (!f.apiId || (f.apiId === "_none" ? !l.apiId : l.apiId === f.apiId)) && (!f.operation || l.operation === f.operation) &&
      (!st || (st.endsWith("xx") ? String(l.status)[0] === st[0] : String(l.status) === st)) && (!f.method || l.method === f.method) &&
      (!f.minMs || l.durationMs >= f.minMs) && (!f.from || l.at >= f.from) && (!f.to || l.at <= f.to) &&
      has(l.path, f.path) && has(l.query, f.query) && has(l.ip, f.ip) && has(l.identity, f.identity));
    const total = list.length;
    const errors = list.filter((l) => l.status >= 400).length;
    const avg = total ? Math.round(list.reduce((n, l) => n + l.durationMs, 0) / total) : 0;
    const hours: Record<string, { ok: number; err: number }> = {};
    for (const l of list.slice(0, 2000)) { const h = l.at.slice(0, 13); hours[h] = hours[h] || { ok: 0, err: 0 }; if (l.status >= 400) hours[h].err++; else hours[h].ok++; }
    return { items: list.slice(0, Math.min(f.limit || 200, 1000)), total, stats: { total, errors, errorRate: total ? Math.round((errors / total) * 1000) / 10 : 0, avgMs: avg, perHour: Object.entries(hours).sort().slice(-24).map(([h, v]) => ({ hour: h, ...v })) } };
  }
  getLog(id: string): ApiLog | undefined { return this.logs.find((l) => l.id === id); }
}

function normThrottle(t: Partial<Throttle> | undefined): Throttle | undefined {
  const limit = Math.floor(Number(t?.limit));
  if (!t || !limit || limit < 1) return undefined;
  const windowSec = Math.max(1, Math.min(86400, Math.floor(Number(t.windowSec) || 60)));
  return { limit: Math.min(limit, 1_000_000), windowSec };
}
function sanitizeLink(l: Partial<OpLink>): OpLink {
  const mode = l.mode === "process" || l.mode === "passthrough" ? l.mode : "none";
  if (mode === "process") return { mode, process: String(l.process || "") };
  if (mode === "passthrough") {
    const target = String(l.target || "").trim();
    if (!/^https?:\/\//.test(target)) throw new Error("Passthrough: doel-URL moet met http:// of https:// beginnen");
    const setHeaders: Record<string, string> = {};
    for (const [k, v] of Object.entries(l.setHeaders || {})) if (/^[A-Za-z0-9-]{1,60}$/.test(k)) setHeaders[k] = String(v).slice(0, 2000);
    return { mode, target, forwardPath: l.forwardPath !== false, forwardQuery: l.forwardQuery !== false, setHeaders, removeHeaders: (l.removeHeaders || []).map((h) => String(h).toLowerCase()).filter(Boolean) };
  }
  return { mode: "none" };
}
function sanitizeLinks(links: Record<string, Partial<OpLink>>): Record<string, OpLink> {
  const out: Record<string, OpLink> = {};
  for (const [k, v] of Object.entries(links || {})) { const s = sanitizeLink(v); if (s.mode !== "none") out[k] = s; }
  return out;
}
export function cmpVer(a: string, b: string): number {
  const x = a.split(".").map(Number), y = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0);
  return 0;
}

export const apim = scoped("apim", () => new Apim());
