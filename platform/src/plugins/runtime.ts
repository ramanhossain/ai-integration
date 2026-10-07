import { createHash, createHmac, randomUUID } from "node:crypto";
import { XMLParser } from "fast-xml-parser";
import type { EnvName } from "../domain/environments";
import { credentials } from "../connectors/credentials";
import type { AuthDef, OperationDef, ParamDef, PluginDef } from "./types";
import { runDriver } from "./drivers";
import { applySigner } from "./signers";
import { currentOrg } from "../tenancy/context";
import { safeFetch } from "../net/egress";

// Voert een operatie van een plugin uit: bouwt URL, headers en body uit de definitie,
// de parameters (al getemplated met het bericht) en de koppeling van de omgeving.

type Vars = Record<string, unknown>;
const TIMEOUT_MS = Number(process.env.AIP_PLUGIN_TIMEOUT_MS || 30000);
const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@" });

const getPath = (obj: unknown, path: string): unknown =>
  path.split(".").reduce<unknown>((a, k) => (a && typeof a === "object" ? (a as Record<string, unknown>)[k] : undefined), obj);
function setPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split(".");
  let cur = obj;
  keys.forEach((k, i) => {
    if (i === keys.length - 1) cur[k] = value;
    else { if (!cur[k] || typeof cur[k] !== "object") cur[k] = {}; cur = cur[k] as Record<string, unknown>; }
  });
}
const str = (v: unknown) => (v === undefined || v === null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));

// {{naam}} vervangen; een string die exact één {{naam}} is behoudt het type (object, getal).
// Lege waarden vallen weg uit objecten, zodat optionele velden niet als "" worden verstuurd.
export function fill(tpl: unknown, vars: Vars): unknown {
  if (typeof tpl === "string") {
    const whole = tpl.match(/^\{\{\s*([\w.$-]+)\s*\}\}$/);
    if (whole) return getPath(vars, whole[1]);
    return tpl.replace(/\{\{\s*([\w.$-]+)\s*\}\}/g, (_m, k) => str(getPath(vars, k)));
  }
  if (Array.isArray(tpl)) return tpl.map((x) => fill(x, vars)).filter((x) => x !== undefined && !(x && typeof x === "object" && !Array.isArray(x) && !Object.keys(x).length));
  if (tpl && typeof tpl === "object") {
    // "$if": "{{veld}}" -> dit object alleen meenemen als het veld gevuld is
    const cond = (tpl as Record<string, unknown>).$if;
    if (cond !== undefined) { const c = fill(cond, vars); if (c === undefined || c === null || c === "") return undefined; }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(tpl)) { if (k === "$if") continue; const f = fill(v, vars); if (f !== undefined && f !== "") out[k] = f; }
    return out;
  }
  return tpl;
}
function fillPath(path: string, vars: Vars, raw: Set<string>): string {
  return path.replace(/\{\{\s*([\w.$-]+)\s*\}\}/g, (_m, k) => {
    const s = str(getPath(vars, k));
    return raw.has(k) ? s.split("/").map(encodeURIComponent).join("/") : encodeURIComponent(s);
  });
}

const adf = (text: string) => ({ type: "doc", version: 1, content: String(text).split(/\n{2,}/).map((p) => ({ type: "paragraph", content: p ? [{ type: "text", text: p }] : [] })) });

function coerce(p: ParamDef, v: unknown): unknown {
  if (v === undefined || v === null || v === "") return p.default ?? undefined;
  if (p.format === "adf") return typeof v === "object" ? v : adf(String(v));
  if (p.format === "list") return Array.isArray(v) ? v : String(v).split(",").map((x) => x.trim()).filter(Boolean).map((x) => (p.type === "number" ? Number(x) : x));
  switch (p.type) {
    case "number": { const n = Number(v); if (Number.isNaN(n)) throw new Error(`${p.label}: '${v}' is geen getal`); return n; }
    case "boolean": return v === true || v === "true" || v === 1 || v === "1";
    case "json": if (typeof v === "string") { try { return JSON.parse(v); } catch { throw new Error(`${p.label}: geen geldige JSON`); } } return v;
    default: return typeof v === "object" ? v : String(v);
  }
}

// Formulier-codering zoals Stripe/Twilio: geneste objecten als a[b]=c.
function formEncode(obj: Record<string, unknown>, prefix = "", out = new URLSearchParams()): URLSearchParams {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}[${k}]` : k;
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) v.forEach((x, i) => (x && typeof x === "object" ? formEncode(x as Record<string, unknown>, `${key}[${i}]`, out) : out.append(`${key}[${i}]`, String(x))));
    else if (typeof v === "object") formEncode(v as Record<string, unknown>, key, out);
    else out.append(key, String(v));
  }
  return out;
}

function gmailRaw(p: Vars): string {
  const head = [`To: ${p.to}`, p.cc ? `Cc: ${p.cc}` : "", p.bcc ? `Bcc: ${p.bcc}` : "", `Subject: =?UTF-8?B?${Buffer.from(str(p.subject)).toString("base64")}?=`, "MIME-Version: 1.0", `Content-Type: ${p.html ? "text/html" : "text/plain"}; charset=UTF-8`].filter(Boolean);
  return Buffer.from(`${head.join("\r\n")}\r\n\r\n${str(p.html || p.text)}`).toString("base64url");
}

function sheetRows(data: unknown): unknown {
  const values = (data as { values?: unknown[][] })?.values;
  if (!Array.isArray(values) || !values.length) return [];
  const [header, ...rows] = values as string[][];
  return rows.map((r, i) => Object.fromEntries([["_row", i + 2], ...header.map((h, j) => [h || `kolom${j + 1}`, r[j] ?? ""])]));
}

// RSS 2.0 / Atom / RDF -> [{title, link, date, id, summary, author}]
function feedItems(data: unknown): unknown {
  const d = data as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const txt = (x: unknown): string | undefined => (x === undefined || x === null ? undefined : typeof x === "object" ? String((x as Record<string, unknown>)["#text"] ?? (x as Record<string, unknown>)["@href"] ?? "") : String(x));
  const list = (x: unknown) => (x === undefined ? [] : Array.isArray(x) ? x : [x]);
  if (d?.rss?.channel || d?.["rdf:RDF"]) {
    const items = list(d.rss?.channel?.item ?? d["rdf:RDF"]?.item);
    return items.map((i: Record<string, unknown>) => ({ title: txt(i.title), link: txt(i.link), date: txt(i.pubDate ?? i["dc:date"]), id: txt(i.guid) ?? txt(i.link), summary: txt(i.description), author: txt(i.author ?? i["dc:creator"]), categories: list(i.category).map(txt) }));
  }
  if (d?.feed) {
    return list(d.feed.entry).map((e: Record<string, unknown>) => {
      const links = list(e.link) as Array<Record<string, string>>;
      const link = (links.find((l) => !l["@rel"] || l["@rel"] === "alternate") ?? links[0])?.["@href"];
      return { title: txt(e.title), link, date: txt(e.updated ?? e.published), id: txt(e.id), summary: txt(e.summary ?? e.content), author: txt((e.author as Record<string, unknown> | undefined)?.name) };
    });
  }
  return data;
}

// ---------------------------------------------------------------- AWS Signature V4
const sha256 = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");
const hmac = (k: string | Buffer, s: string) => createHmac("sha256", k).update(s).digest();
const rfc3986 = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
function signAws(method: string, url: URL, headers: Record<string, string>, body: string, service: string, v: Record<string, string>): void {
  const region = v.region || "eu-west-1";
  const now = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const date = now.slice(0, 8);
  headers.host = url.host;
  headers["x-amz-date"] = now;
  headers["x-amz-content-sha256"] = sha256(body);
  if (v.sessionToken) headers["x-amz-security-token"] = v.sessionToken;
  const signed = Object.keys(headers).map((h) => h.toLowerCase()).sort();
  const canonHeaders = signed.map((h) => `${h}:${String(headers[h]).trim().replace(/\s+/g, " ")}\n`).join("");
  const canonPath = service === "s3" ? url.pathname : url.pathname.split("/").map((s) => rfc3986(decodeURIComponent(s))).join("/");
  const canonQuery = [...url.searchParams.entries()].map(([k, x]) => [rfc3986(k), rfc3986(x)]).sort(([a, b], [c, d]) => (a === c ? (b < d ? -1 : 1) : a < c ? -1 : 1)).map(([k, x]) => `${k}=${x}`).join("&");
  const creq = [method, canonPath || "/", canonQuery, canonHeaders, signed.join(";"), headers["x-amz-content-sha256"]].join("\n");
  const scope = `${date}/${region}/${service}/aws4_request`;
  const sts = ["AWS4-HMAC-SHA256", now, scope, sha256(creq)].join("\n");
  const key = hmac(hmac(hmac(hmac(`AWS4${v.secretAccessKey}`, date), region), service), "aws4_request");
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${v.accessKeyId}/${scope}, SignedHeaders=${signed.join(";")}, Signature=${createHmac("sha256", key).update(sts).digest("hex")}`;
}

// ---------------------------------------------------------------- OAuth2
const clientTokens = new Map<string, { token: string; exp: number }>();
async function tokenRequest(url: string, form: Record<string, string>, clientId: string, clientSecret: string, how: "body" | "basic" = "body") {
  const body = new URLSearchParams(how === "body" ? { ...form, client_id: clientId, client_secret: clientSecret } : form);
  const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded", accept: "application/json" };
  if (how === "basic") headers.authorization = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
  const res = await safeFetch(url, { method: "POST", headers, body, signal: AbortSignal.timeout(TIMEOUT_MS) });
  const text = await res.text();
  let data: Record<string, unknown> = {};
  try { data = JSON.parse(text); } catch { data = Object.fromEntries(new URLSearchParams(text)); }
  if (!res.ok || !data.access_token) throw new Error(`Token ophalen mislukt (${res.status}): ${String(data.error_description || data.error || text).slice(0, 200)}`);
  return data as { access_token: string; refresh_token?: string; expires_in?: number } & Record<string, unknown>;
}
export function withDefaults(def: PluginDef, values: Record<string, string>): Record<string, string> {
  const out = { ...values };
  for (const f of def.fields ?? []) if (!out[f.key] && f.default !== undefined) out[f.key] = f.default;
  if (def.auth.type === "headers" || def.auth.type === "query") for (const f of def.auth.fields) if (!out[f.key] && f.default !== undefined) out[f.key] = f.default;
  return out;
}
export async function exchangeCode(def: PluginDef, values: Record<string, string>, code: string, redirectUri: string) {
  const auth = def.auth as Extract<AuthDef, { type: "oauth2" }>;
  const v = withDefaults(def, values);
  const t = await tokenRequest(String(fill(auth.tokenUrl, v)), { grant_type: "authorization_code", code, redirect_uri: redirectUri }, v.clientId, v.clientSecret, auth.tokenAuth);
  const patch: Record<string, string> = { accessToken: t.access_token, expiresAt: String(Date.now() + (Number(t.expires_in) || 3600) * 1000) };
  if (t.refresh_token) patch.refreshToken = t.refresh_token;
  for (const [from, to] of Object.entries(def.tokenFields ?? {})) if (t[from]) patch[to] = String(t[from]);
  return patch;
}
async function accessToken(def: PluginDef, credName: string, env: EnvName, values: Record<string, string>): Promise<string> {
  const auth = def.auth;
  if (auth.type === "oauth2-client") {
    const key = `${currentOrg()}:${env}:${credName}`;
    const hit = clientTokens.get(key);
    if (hit && hit.exp > Date.now() + 30000) return hit.token;
    const t = await tokenRequest(String(fill(auth.tokenUrl, values)), { grant_type: "client_credentials", ...(auth.scopes?.length ? { scope: auth.scopes.join(" ") } : {}) }, values.clientId, values.clientSecret, auth.tokenAuth);
    clientTokens.set(key, { token: t.access_token, exp: Date.now() + (Number(t.expires_in) || 3600) * 1000 });
    return t.access_token;
  }
  if (auth.type !== "oauth2") return "";
  if (!values.accessToken) throw new Error(`Koppeling '${credName}' is nog niet verbonden met ${def.name} op ${env.toUpperCase()}. Klik bij de koppeling op “Verbinden”.`);
  const exp = Number(values.expiresAt || 0);
  if (exp && exp < Date.now() + 60000 && values.refreshToken) {
    const t = await tokenRequest(String(fill(auth.tokenUrl, values)), { grant_type: "refresh_token", refresh_token: values.refreshToken }, values.clientId, values.clientSecret, auth.tokenAuth);
    const patch: Record<string, string> = { accessToken: t.access_token, expiresAt: String(Date.now() + (Number(t.expires_in) || 3600) * 1000) };
    if (t.refresh_token) patch.refreshToken = t.refresh_token;
    credentials.patchValues(credName, env, patch, "oauth-refresh");
    return t.access_token;
  }
  return values.accessToken;
}

export function oauthAuthorizeUrl(def: PluginDef, rawValues: Record<string, string>, redirectUri: string, state: string): string {
  const a = def.auth;
  if (a.type !== "oauth2") throw new Error(`${def.name} gebruikt geen OAuth2`);
  const values = withDefaults(def, rawValues);
  if (!values.clientId) throw new Error("Client ID ontbreekt in de koppeling");
  const u = new URL(String(fill(a.authUrl, values)));
  u.searchParams.set("client_id", values.clientId);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("state", state);
  const scopes = (values.scopes ? values.scopes.split(/[\s,]+/) : a.scopes.map((x) => String(fill(x, values)))).filter(Boolean);
  if (scopes.length) u.searchParams.set("scope", scopes.join(a.scopeSeparator ?? " "));
  for (const [k, v] of Object.entries(a.authParams ?? {})) u.searchParams.set(k, v);
  return u.toString();
}

// ---------------------------------------------------------------- uitvoeren
export interface PluginCall { plugin: PluginDef; operation: string; credential?: string; params: Record<string, unknown>; env: EnvName }

export async function executePlugin(call: PluginCall): Promise<{ status: number; data: unknown; request: { method: string; url: string } }> {
  const { plugin: def, env } = call;
  const op: OperationDef | undefined = def.operations.find((o) => o.id === call.operation);
  if (!op) throw new Error(`${def.name}: onbekende operatie '${call.operation}'`);
  if (def.auth.type !== "none" && !call.credential) throw new Error(`${def.name}: kies een koppeling`);
  const cred = call.credential ? credentials.resolve(call.credential, env) : { type: "plugin", values: {} as Record<string, string> };
  const values = withDefaults(def, cred.values);

  // Parameters controleren en typen
  const params: Vars = {};
  for (const p of op.params ?? []) {
    const v = coerce(p, call.params[p.name]);
    if (p.required && (v === undefined || v === "")) throw new Error(`${def.name} · ${op.label}: '${p.label}' is verplicht`);
    if (v !== undefined) params[p.name] = v;
  }
  // $uuid en $now zijn altijd beschikbaar in sjablonen (bv. een transactie-ID per aanvraag)
  const vars: Vars = { ...values, ...params, $uuid: randomUUID(), $now: new Date().toISOString() };
  // Geheimen (sleutels, wachtwoorden, tokens) nooit in foutmeldingen terug laten komen.
  const secrets = Object.entries(values).filter(([k, v]) => typeof v === "string" && v.length >= 6 && !/^https?:\/\//.test(v) && !/^(url|host|region|user|username|email|account|tenant|database|domain|subdomain|instance|baseurl)$/i.test(k)).map(([, v]) => String(v)).sort((a, b) => b.length - a.length);
  const redact = (m: string) => secrets.reduce((acc, sec) => acc.split(sec).join("•••"), m);
  try {
  const credKey = `${env}:${call.credential ?? "-"}`;

  // Geen HTTP (database, broker, LDAP, IMAP, SSH, JSON-RPC): via een driver
  if (op.driver) {
    const r = await runDriver(op.driver, { def, op, params, values, credKey });
    return { status: 200, data: op.output ? getPath(r.data, op.output) : r.data ?? { ok: true }, request: { method: op.driver.split(":")[0].toUpperCase(), url: r.target } };
  }

  // URL
  // OAuth zonder token: eerst "nog niet verbonden" melden (bv. instanceUrl komt pas uit het tokenantwoord).
  if (def.auth.type === "oauth2" && !values.accessToken) await accessToken(def, call.credential ?? "-", env, values);
  const baseTpl = String(op.baseUrl ?? def.baseUrl ?? "");
  const base = String(fill(baseTpl, { ...params, ...values })).replace(/\/$/, "");
  if (!/^https?:\/\//.test(base)) {
    const empty = [...baseTpl.matchAll(/\{\{\s*([\w.$-]+)\s*\}\}/g)].map((m) => m[1]).filter((k) => str(getPath({ ...params, ...values }, k)) === "");
    const names = empty.map((k) => def.fields?.find((f) => f.key === k)?.label ?? op.params?.find((p) => p.name === k)?.label ?? k);
    throw new Error(`${def.name}: ${names.length ? `${names.join(", ")} ontbreekt in de koppeling` : `ongeldig adres '${base || "(leeg)"}' — begin met https://`}`);
  }
  const missing = [...op.path.matchAll(/\{\{\s*([\w.$-]+)\s*\}\}/g)].map((m) => m[1]).filter((k) => str(getPath(vars, k)) === "");
  if (missing.length) throw new Error(`${def.name} · ${op.label}: ${missing.map((k) => op.params?.find((p) => p.name === k)?.label ?? def.fields?.find((f) => f.key === k)?.label ?? k).join(", ")} ontbreekt`);
  const raw = new Set((op.params ?? []).filter((p) => p.format === "raw").map((p) => p.name));
  const url = new URL(base + fillPath(op.path, vars, raw));
  for (const p of op.params ?? []) {
    if (params[p.name] === undefined) continue;
    if (p.in === "query") url.searchParams.set(p.name, str(params[p.name]));
    if (p.in === "rawQuery") for (const [k, x] of new URLSearchParams(String(params[p.name]))) url.searchParams.append(k, x);
  }

  // Headers en authenticatie
  const headers: Record<string, string> = { accept: "application/json", "user-agent": "AIP-integratieplatform/1.0" };
  for (const [k, v] of Object.entries(def.headers ?? {})) { const f = str(fill(v, values)); if (f) headers[k.toLowerCase()] = f; }
  const a = def.auth;
  if (a.type === "bearer") { if (!values.token) throw new Error(`Koppeling '${call.credential}': token ontbreekt`); headers.authorization = `${a.prefix ?? "Bearer"} ${values.token}`.trim(); }
  else if (a.type === "basic") headers.authorization = `Basic ${Buffer.from(`${values.user ?? ""}:${values.password ?? ""}`).toString("base64")}`;
  else if (a.type === "apiKey") { if (!values.apiKey) throw new Error(`Koppeling '${call.credential}': API-key ontbreekt`); if (a.in === "header") headers[a.name.toLowerCase()] = `${a.prefix ?? ""}${values.apiKey}`; else url.searchParams.set(a.name, values.apiKey); }
  else if (a.type === "headers") for (const [k, v] of Object.entries(a.headers)) { const f = str(fill(v, values)); if (f) headers[k.toLowerCase()] = f; }
  else if (a.type === "query") for (const [k, v] of Object.entries(a.query)) { const f = str(fill(v, values)); if (f) url.searchParams.set(k, f); }
  else if (a.type === "oauth2" || a.type === "oauth2-client") headers.authorization = `Bearer ${await accessToken(def, call.credential!, env, values)}`;
  for (const p of op.params ?? []) if (p.in === "header" && params[p.name] !== undefined) headers[p.name.toLowerCase()] = str(params[p.name]);
  for (const [k, v] of Object.entries(op.headers ?? {})) { const f = str(fill(v, vars)); if (f && !f.includes('[""]')) headers[k.toLowerCase()] = f; }
  if (op.target) headers["x-amz-target"] = op.target;

  // Body
  let body: string | undefined;
  if (op.method !== "GET" && op.method !== "HEAD") {
    let obj: unknown;
    if (op.special === "gmail-raw") obj = { raw: gmailRaw(params) };
    else if (op.bodyParam) obj = params[op.bodyParam];
    else if (op.body !== undefined) obj = fill(op.body, vars);
    else {
      const o: Record<string, unknown> = {};
      for (const p of op.params ?? []) if ((p.in ?? "body") === "body" && params[p.name] !== undefined) setPath(o, p.name, params[p.name]);
      obj = Object.keys(o).length ? o : undefined;
    }
    if (obj !== undefined) {
      if (op.bodyType === "form") { headers["content-type"] = "application/x-www-form-urlencoded"; body = formEncode(obj as Record<string, unknown>).toString(); }
      else { headers["content-type"] = op.contentType ?? "application/json"; body = typeof obj === "string" ? obj : JSON.stringify(obj); }
    } else if (op.contentType) { headers["content-type"] = op.contentType; body = "{}"; }
  }
  if (a.type === "aws") { signAws(op.method, url, headers, body ?? "", a.service, values); delete headers.host; }
  if (a.type === "custom") await applySigner(a.signer, { def, values, method: op.method, url, headers, body, credKey });

  // Geen ".." in padparameters of koppelingsvelden (zou naar een ander endpoint kunnen wijzen).
  for (const v of [...Object.values(params), ...Object.values(values)]) if (typeof v === "string" && /(^|[\/\\])\.\.([\/\\]|$)/.test(v)) throw new Error(`${def.name}: '..' is niet toegestaan in parameters`);
  const res = await safeFetch(url, { method: op.method, headers, body, signal: AbortSignal.timeout(TIMEOUT_MS) }).catch((err: Error & { cause?: { code?: string } }) => {
    if (err.name === "TimeoutError" || err.name === "AbortError") throw new Error(`${def.name}: geen antwoord van ${url.host} binnen ${Math.round(TIMEOUT_MS / 1000)} s`);
    if (err.message === "fetch failed") throw new Error(`${def.name}: ${url.host} niet bereikbaar${err.cause?.code ? ` (${err.cause.code})` : ""}`);
    throw err;
  });
  // Maximaal 10 MB per antwoord (bescherming tegen geheugengebruik).
  const MAX = 10 * 1024 * 1024;
  if (Number(res.headers.get("content-length") || 0) > MAX) throw new Error(`${def.name}: antwoord groter dan 10 MB`);
  const text = await res.text();
  if (text.length > MAX) throw new Error(`${def.name}: antwoord groter dan 10 MB`);
  const ct = res.headers.get("content-type") || "";
  let data: unknown = text || { ok: true, status: res.status };
  if (text && (/json/i.test(ct) || /^[[{]/.test(text.trim()))) { try { data = JSON.parse(text); } catch { /* tekst */ } }
  else if (text && /xml/i.test(ct)) { try { data = xml.parse(text); } catch { /* tekst */ } }
  const d = data as Record<string, unknown>;
  const gqlErr = def.graphqlErrors && Array.isArray(d?.errors) && d.errors.length;
  if (!res.ok || (def.okField && d?.[def.okField] === false) || gqlErr) {
    const msg = (def.errorPath && getPath(d, def.errorPath)) || getPath(d, "error.message") || getPath(d, "errors.0.message") || d?.message || d?.error_description || (typeof d?.error === "string" ? d.error : undefined) || getPath(d, "ErrorResponse.Error.Message") || getPath(d, "Error.Message") || (typeof data === "string" ? data.slice(0, 200) : JSON.stringify(data).slice(0, 200));
    throw new Error(`${def.name} ${res.status}: ${str(msg)}`);
  }
  let out = op.output ? getPath(data, op.output) : data;
  if (op.transform === "sheet-rows") out = sheetRows(data);
  if (op.transform === "feed") out = feedItems(data);
  const safeUrl = url.toString().replace(/([?&](?:key|token|api_key|apikey|api_token|access_token|access_key|appid|auth|auth_token|signature|sig|secret|client_secret|password|pass)=)[^&]+/gi, "$1•••").replace(/\/bot\d+:[\w-]+/, "/bot•••");
  return { status: res.status, data: out === undefined ? (res.status === 204 || !text ? { ok: true, status: res.status } : out) : out, request: { method: op.method, url: safeUrl } };  } catch (err) {
    throw new Error(redact((err as Error).message));
  }
}
