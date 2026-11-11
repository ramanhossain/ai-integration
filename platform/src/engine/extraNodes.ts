// Aanvullende staptypes: lijsten bewerken, meerweg-beslissing (switch), crypto, datum/tijd,
// JWT, compressie, XSLT/XPath, SOAP en "stoppen met fout". Allemaal deterministisch.

import { createHash, createHmac, randomBytes, randomUUID, createSign, createVerify, timingSafeEqual } from "node:crypto";
import { gzipSync, gunzipSync, deflateSync, inflateSync, brotliCompressSync, brotliDecompressSync } from "node:zlib";
import { Xslt, XmlParser, XPath, ExprContext } from "xslt-processor";
import { getPath, setPath, tpl, deepTpl } from "../connectors/util";
import { xmlParse, xmlBuild } from "../connectors/formats";
import { credentials } from "../connectors/credentials";
import { authHeaders } from "../connectors/services";
import { safeFetch } from "../net/egress";
import type { EnvName } from "../domain/environments";

type Payload = Record<string, unknown>;
type Step = { id: string; type: string; config?: Record<string, unknown> };
type Handler = (payload: Payload, step: Step, ctx: { env: EnvName; integration: string }) => Promise<Payload>;

const asPath = (s: unknown): string => String(s ?? "").trim().replace(/^\{\{\s*([^{}]+?)\s*\}\}$/, "$1");
const fail = (msg: string) => Object.assign(new Error(msg), { noRetry: true });
const val = (item: unknown, path: string): unknown => (path ? getPath(item, path) : item);

// Vergelijking voor filters en de switch (zelfde operators als de beslissing, plus een paar extra).
export function test(v: unknown, op: string, expected: unknown): boolean {
  switch (op) {
    case "exists": return v !== undefined && v !== null;
    case "notExists": return v === undefined || v === null;
    case "empty": return v === undefined || v === null || v === "" || (Array.isArray(v) && !v.length);
    case "notEmpty": return !(v === undefined || v === null || v === "" || (Array.isArray(v) && !v.length));
    case "equals": case "eq": return String(v) === String(expected);
    case "notEquals": case "ne": return String(v) !== String(expected);
    case "gt": return Number(v) > Number(expected);
    case "gte": return Number(v) >= Number(expected);
    case "lt": return Number(v) < Number(expected);
    case "lte": return Number(v) <= Number(expected);
    case "contains": return Array.isArray(v) ? v.map(String).includes(String(expected)) : String(v ?? "").includes(String(expected));
    case "notContains": return !(Array.isArray(v) ? v.map(String).includes(String(expected)) : String(v ?? "").includes(String(expected)));
    case "startsWith": return String(v ?? "").startsWith(String(expected));
    case "endsWith": return String(v ?? "").endsWith(String(expected));
    case "regex": try { return new RegExp(String(expected)).test(String(v ?? "")); } catch { throw fail(`Ongeldige reguliere expressie: ${expected}`); }
    case "in": return String(expected).split(",").map((s) => s.trim()).includes(String(v));
    default: return Boolean(v) && v !== "false" && v !== "0";
  }
}

const cmp = (a: unknown, b: unknown): number => {
  if (a === b) return 0;
  if (a === undefined || a === null) return 1;
  if (b === undefined || b === null) return -1;
  const na = Number(a), nb = Number(b);
  if (typeof a !== "boolean" && typeof b !== "boolean" && a !== "" && b !== "" && !Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
  return String(a).localeCompare(String(b), "nl", { numeric: true });
};
const keyOf = (item: unknown, path: string) => JSON.stringify(val(item, path) ?? null);

// Samenvatten: per groep sum/count/avg/min/max/concat/first/last/unique.
function summarize(list: unknown[], groupBy: string[], metrics: Array<{ field?: string; fn: string; as?: string }>): Payload[] {
  const groups = new Map<string, unknown[]>();
  for (const it of list) { const k = JSON.stringify(groupBy.map((g) => val(it, g) ?? null)); (groups.get(k) ?? groups.set(k, []).get(k)!).push(it); }
  return [...groups.entries()].map(([k, items]) => {
    const keys = JSON.parse(k) as unknown[];
    let row: Payload = {};
    groupBy.forEach((g, i) => { row = setPath(row, g, keys[i]); });
    for (const m of metrics) {
      const field = asPath(m.field);
      const vals = items.map((it) => val(it, field)).filter((x) => x !== undefined && x !== null && x !== "");
      const nums = vals.map(Number).filter((n) => !Number.isNaN(n));
      const name = m.as || `${m.fn}${field ? "_" + field.replace(/\./g, "_") : ""}`;
      let out: unknown;
      switch (m.fn) {
        case "count": out = field ? vals.length : items.length; break;
        case "sum": out = Math.round(nums.reduce((s, n) => s + n, 0) * 1e10) / 1e10; break;
        case "avg": out = nums.length ? Math.round((nums.reduce((s, n) => s + n, 0) / nums.length) * 1e10) / 1e10 : null; break;
        case "min": out = nums.length ? Math.min(...nums) : null; break;
        case "max": out = nums.length ? Math.max(...nums) : null; break;
        case "concat": out = vals.map(String).join(", "); break;
        case "first": out = vals[0] ?? null; break;
        case "last": out = vals[vals.length - 1] ?? null; break;
        case "unique": out = [...new Set(vals.map((x) => JSON.stringify(x)))].map((x) => JSON.parse(x)); break;
        case "list": out = vals; break;
        default: throw fail(`Samenvatten: onbekende functie '${m.fn}'`);
      }
      row[name] = out;
    }
    return row;
  });
}

// ---------- datum/tijd ----------
const UNITS: Record<string, number> = { seconds: 1e3, minutes: 6e4, hours: 36e5, days: 864e5, weeks: 6048e5 };
function parseDate(v: unknown, fmt?: string): Date {
  if (v === undefined || v === null || v === "" || v === "now") return new Date();
  if (v instanceof Date) return v;
  if (typeof v === "number" || /^\d{9,13}$/.test(String(v))) { const n = Number(v); return new Date(n < 1e11 ? n * 1000 : n); }
  const s = String(v).trim();
  if (fmt) {
    // eenvoudige formaten zoals DD-MM-YYYY of DD/MM/YYYY HH:mm
    const order: string[] = [];
    const re = new RegExp("^" + fmt.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/YYYY|MM|DD|HH|mm|ss/g, (t) => { order.push(t); return t === "YYYY" ? "(\\d{4})" : "(\\d{1,2})"; }) + "$");
    const m = s.match(re);
    if (!m) throw fail(`Datum '${s}' past niet bij formaat ${fmt}`);
    const p: Record<string, number> = { YYYY: 1970, MM: 1, DD: 1, HH: 0, mm: 0, ss: 0 };
    order.forEach((t, i) => { p[t] = Number(m[i + 1]); });
    return new Date(p.YYYY, p.MM - 1, p.DD, p.HH, p.mm, p.ss);
  }
  const nl = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (nl) return new Date(Number(nl[3]), Number(nl[2]) - 1, Number(nl[1]), Number(nl[4] ?? 0), Number(nl[5] ?? 0), Number(nl[6] ?? 0));
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) throw fail(`Ongeldige datum: '${s}'`);
  return d;
}
function partsIn(d: Date, tz: string): Record<string, string> {
  try {
    const f = new Intl.DateTimeFormat("en-GB", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23", weekday: "short" });
    return Object.fromEntries(f.formatToParts(d).map((p) => [p.type, p.value]));
  } catch { throw fail(`Onbekende tijdzone: ${tz}`); }
}
function formatDate(d: Date, fmt: string, tz: string): string {
  if (fmt === "ISO" || !fmt) return d.toISOString();
  if (fmt === "unix") return String(Math.floor(d.getTime() / 1000));
  if (fmt === "unixMs") return String(d.getTime());
  const p = partsIn(d, tz);
  const map: Record<string, string> = { YYYY: p.year, YY: p.year.slice(2), MM: p.month, DD: p.day, HH: p.hour, mm: p.minute, ss: p.second, SSS: String(d.getUTCMilliseconds()).padStart(3, "0") };
  return fmt.replace(/YYYY|YY|SSS|MM|DD|HH|mm|ss/g, (t) => map[t]);
}

// ---------- JWT ----------
const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
const unb64url = (s: string) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
const HS: Record<string, string> = { HS256: "sha256", HS384: "sha384", HS512: "sha512" };
const RS: Record<string, string> = { RS256: "RSA-SHA256", RS384: "RSA-SHA384", RS512: "RSA-SHA512", ES256: "SHA256", ES384: "SHA384" };
function keyMaterial(c: Record<string, unknown>, env: EnvName, payload: Payload): { secret?: string; privateKey?: string; publicKey?: string } {
  const out: { secret?: string; privateKey?: string; publicKey?: string } = {};
  if (c.credential) {
    const { values } = credentials.resolve(String(c.credential), env);
    out.secret = values.secret || values.key || values.token; out.privateKey = values.privateKey; out.publicKey = values.publicKey;
  }
  if (c.secret) out.secret = tpl(c.secret, payload, env);
  return out;
}

// Tekstwaarde van een XPath-knoop: attribuut/tekst direct, element = alle onderliggende tekst.
type XNodeLike = { nodeType: number; nodeValue?: unknown; childNodes?: XNodeLike[] };
const textOf = (n: XNodeLike): string => (n.nodeType === 1 || n.nodeType === 9 ? (n.childNodes ?? []).map(textOf).join("") : n.nodeType === 8 || n.nodeType === 7 ? "" : String(n.nodeValue ?? ""));

// ---------- SOAP ----------
function soapBody(parsed: unknown): { body: unknown; fault?: unknown; header?: unknown } {
  const strip = (o: unknown): unknown => {
    if (Array.isArray(o)) return o.map(strip);
    if (!o || typeof o !== "object") return o;
    const r: Payload = {};
    for (const [k, v] of Object.entries(o as Payload)) { if (k.startsWith("@xmlns")) continue; r[k.replace(/^(@?)[\w.-]+:/, "$1")] = strip(v); }
    return r;
  };
  const doc = strip(parsed) as Payload;
  const env = (doc.Envelope ?? {}) as Payload;
  const body = (env.Body ?? {}) as Payload;
  return { body, header: env.Header, fault: body.Fault };
}

export const EXTRA_NODES: Record<string, Handler> = {
  // Lijsten: sorteren, beperken, ontdubbelen, filteren, plukken, samenvatten, platslaan, koppelen, vergelijken.
  list: async (payload, step, ctx) => {
    const c = step.config ?? {};
    const op = String(c.operation || "sort");
    const field = asPath(c.field || "items");
    const target = asPath(c.target) || field;
    const src = getPath(payload, field);
    if (!Array.isArray(src)) throw fail(`Lijst: '${field}' is geen lijst${src === undefined ? " (veld ontbreekt)" : ""}`);
    let out: unknown;
    switch (op) {
      case "sort": {
        const keys = (Array.isArray(c.by) ? c.by : String(c.by ?? "").split(",")).map(asPath).filter(Boolean);
        const dir = c.desc ? -1 : 1;
        out = [...src].sort((a, b) => { for (const k of keys.length ? keys : [""]) { const r = cmp(val(a, k), val(b, k)); if (r) return r * dir; } return 0; });
        break;
      }
      case "limit": { const n = Math.max(0, Number(c.count ?? 10)); out = c.from === "end" ? src.slice(Math.max(0, src.length - n)) : src.slice(0, n); break; }
      case "dedupe": { const k = asPath(c.key); const seen = new Set<string>(); out = src.filter((it) => { const x = keyOf(it, k); if (seen.has(x)) return false; seen.add(x); return true; }); break; }
      case "filter": {
        // "column" is de naam van de eerste kolom in het editorformulier (zelfde component als bij datatabellen)
        const conds = ((c.conditions as Array<{ field?: string; column?: string; op?: string; value?: unknown }>) ?? []).map((x) => ({ ...x, field: x.field ?? x.column })).filter((x) => x && (x.field || x.op));
        const any = c.match === "any";
        out = src.filter((it) => {
          if (!conds.length) return true;
          const res = conds.map((x) => test(val(it, asPath(x.field)), String(x.op || "truthy"), deepTpl(x.value, { ...payload, $item: it }, ctx.env)));
          return any ? res.some(Boolean) : res.every(Boolean);
        });
        break;
      }
      case "pluck": { const k = asPath(c.key); out = src.map((it) => val(it, k)).filter((x) => x !== undefined); break; }
      case "summarize": {
        const groupBy = (Array.isArray(c.groupBy) ? c.groupBy : String(c.groupBy ?? "").split(",")).map(asPath).filter(Boolean);
        const metrics = (c.metrics as Array<{ field?: string; fn: string; as?: string }>) ?? [{ fn: "count" }];
        out = summarize(src, groupBy, metrics.length ? metrics : [{ fn: "count" }]);
        if (!groupBy.length) out = (out as Payload[])[0] ?? {};
        break;
      }
      case "flatten": {
        const k = asPath(c.key);
        const keepParent = c.keepParent !== false;
        out = src.flatMap((it) => {
          const inner = k ? val(it, k) : it;
          if (!Array.isArray(inner)) return [inner];
          if (!k || !keepParent || !it || typeof it !== "object") return inner;
          const { [k.split(".")[0]]: _, ...parent } = it as Payload;
          return inner.map((x) => (x && typeof x === "object" && !Array.isArray(x) ? { ...parent, ...(x as Payload) } : { ...parent, [k]: x }));
        });
        break;
      }
      case "join": case "compare": {
        const otherPath = asPath(c.with);
        const other = getPath(payload, otherPath);
        if (!Array.isArray(other)) throw fail(`Lijst: '${otherPath}' (tweede lijst) is geen lijst`);
        const lk = asPath(c.key || "id"), rk = asPath(c.otherKey || c.key || "id");
        const index = new Map<string, unknown[]>();
        for (const r of other) { const x = keyOf(r, rk); (index.get(x) ?? index.set(x, []).get(x)!).push(r); }
        if (op === "join") {
          const mode = String(c.mode || "left"); // inner | left
          const into = asPath(c.into);
          out = src.flatMap((l) => {
            const hits = index.get(keyOf(l, lk));
            if (!hits) return mode === "inner" ? [] : [l];
            return hits.map((r) => (into ? setPath({ ...(l as Payload) }, into, r) : { ...(r as Payload), ...(l as Payload) }));
          });
        } else {
          const leftKeys = new Set(src.map((l) => keyOf(l, lk)));
          const same: unknown[] = [], different: unknown[] = [], onlyLeft: unknown[] = [];
          for (const l of src) {
            const r = index.get(keyOf(l, lk))?.[0];
            if (r === undefined) onlyLeft.push(l);
            else if (JSON.stringify(l) === JSON.stringify(r)) same.push(l);
            else different.push({ key: val(l, lk), links: l, rechts: r });
          }
          const onlyRight = other.filter((r) => !leftKeys.has(keyOf(r, rk)));
          out = { gelijk: same, verschillend: different, alleenLinks: onlyLeft, alleenRechts: onlyRight, telling: { gelijk: same.length, verschillend: different.length, alleenLinks: onlyLeft.length, alleenRechts: onlyRight.length } };
        }
        break;
      }
      case "chunk": { const n = Math.max(1, Number(c.count ?? 10)); const chunks: unknown[][] = []; for (let i = 0; i < src.length; i += n) chunks.push(src.slice(i, i + n)); out = chunks; break; }
      case "reverse": out = [...src].reverse(); break;
      case "count": out = src.length; break;
      default: throw fail(`Lijst: onbekende bewerking '${op}'`);
    }
    return setPath(payload, target, out);
  },

  // Meerweg-beslissing: eerste regel die klopt bepaalt de uitgang; anders "default".
  switch: async (payload, step) => {
    const c = step.config ?? {};
    const rules = ((c.rules as Array<{ name?: string; column?: string; field?: string; op?: string; value?: unknown }>) ?? []).map((r) => ({ ...r, name: r.name ?? r.column }));
    const base = asPath(c.field);
    let port = "default";
    for (let i = 0; i < rules.length; i++) {
      const r = rules[i];
      const f = asPath(r.field) || base;
      if (test(getPath(payload, f), String(r.op || "equals"), r.value)) { port = String(r.name || `regel${i + 1}`); break; }
    }
    if (port === "default" && c.failIfNoMatch) throw fail(`Geen regel klopt voor '${base || "het bericht"}'`);
    return { ...payload, _switch: { port } };
  },

  crypto: async (payload, step, ctx) => {
    const c = step.config ?? {};
    const op = String(c.operation || "hash");
    const target = asPath(c.target) || "crypto";
    const raw = c.field ? getPath(payload, asPath(c.field)) : tpl(c.value, payload, ctx.env);
    const input = typeof raw === "string" ? raw : JSON.stringify(raw ?? "");
    const enc = (String(c.encoding || "hex") as "hex" | "base64" | "base64url");
    let out: unknown;
    switch (op) {
      case "hash": out = createHash(String(c.algorithm || "sha256")).update(input).digest(enc); break;
      case "hmac": {
        const { secret } = keyMaterial(c, ctx.env, payload);
        if (!secret) throw fail("HMAC: geen sleutel (kies een koppeling of vul een sleutel in)");
        out = createHmac(String(c.algorithm || "sha256"), secret).update(input).digest(enc);
        break;
      }
      case "hmacVerify": {
        const { secret } = keyMaterial(c, ctx.env, payload);
        if (!secret) throw fail("HMAC: geen sleutel");
        const expected = createHmac(String(c.algorithm || "sha256"), secret).update(input).digest(enc);
        const got = String(tpl(c.signature, payload, ctx.env)).replace(/^sha\d+=/, "");
        out = got.length === expected.length && timingSafeEqual(Buffer.from(got), Buffer.from(expected));
        if (!out && c.failOnInvalid !== false) throw fail("Handtekening (HMAC) klopt niet");
        break;
      }
      case "uuid": out = randomUUID(); break;
      case "random": out = randomBytes(Math.min(1024, Math.max(1, Number(c.length || 16)))).toString(enc); break;
      case "base64Encode": out = Buffer.from(input, "utf8").toString("base64"); break;
      case "base64Decode": out = Buffer.from(input, "base64").toString("utf8"); break;
      case "urlEncode": out = encodeURIComponent(input); break;
      case "urlDecode": out = decodeURIComponent(input); break;
      case "hexEncode": out = Buffer.from(input, "utf8").toString("hex"); break;
      case "hexDecode": out = Buffer.from(input, "hex").toString("utf8"); break;
      default: throw fail(`Crypto: onbekende bewerking '${op}'`);
    }
    return setPath(payload, target, out);
  },

  datetime: async (payload, step, ctx) => {
    const c = step.config ?? {};
    const op = String(c.operation || "format");
    const target = asPath(c.target) || "datum";
    const tz = String(c.timezone || "Europe/Amsterdam");
    const srcVal = c.field ? getPath(payload, asPath(c.field)) : c.value !== undefined && c.value !== "" ? deepTpl(c.value, payload, ctx.env) : undefined;
    const d = parseDate(srcVal, c.inputFormat ? String(c.inputFormat) : undefined);
    const fmt = String(c.format || "ISO");
    let out: unknown;
    switch (op) {
      case "now": out = formatDate(new Date(), fmt, tz); break;
      case "format": out = formatDate(d, fmt, tz); break;
      case "add": case "subtract": {
        const unit = String(c.unit || "days");
        const n = Number(deepTpl(c.amount ?? 1, payload, ctx.env)) * (op === "subtract" ? -1 : 1);
        const r = new Date(d);
        if (unit === "months") r.setMonth(r.getMonth() + n);
        else if (unit === "years") r.setFullYear(r.getFullYear() + n);
        else if (UNITS[unit]) r.setTime(r.getTime() + n * UNITS[unit]);
        else throw fail(`Datum: onbekende eenheid '${unit}'`);
        out = formatDate(r, fmt, tz);
        break;
      }
      case "diff": {
        const other = parseDate(c.otherField ? getPath(payload, asPath(c.otherField)) : deepTpl(c.other, payload, ctx.env));
        const unit = String(c.unit || "days");
        const ms = other.getTime() - d.getTime();
        out = unit === "months" ? (other.getFullYear() - d.getFullYear()) * 12 + other.getMonth() - d.getMonth() : unit === "years" ? other.getFullYear() - d.getFullYear() : Math.floor(ms / (UNITS[unit] ?? UNITS.days));
        break;
      }
      case "startOf": case "endOf": {
        const unit = String(c.unit || "days");
        const r = new Date(d);
        if (unit === "days") r.setHours(0, 0, 0, 0);
        else if (unit === "months") { r.setDate(1); r.setHours(0, 0, 0, 0); }
        else if (unit === "years") { r.setMonth(0, 1); r.setHours(0, 0, 0, 0); }
        else if (unit === "weeks") { r.setDate(r.getDate() - ((r.getDay() + 6) % 7)); r.setHours(0, 0, 0, 0); }
        else if (unit === "hours") r.setMinutes(0, 0, 0);
        if (op === "endOf") {
          if (unit === "days") r.setDate(r.getDate() + 1); else if (unit === "months") r.setMonth(r.getMonth() + 1); else if (unit === "years") r.setFullYear(r.getFullYear() + 1); else if (unit === "weeks") r.setDate(r.getDate() + 7); else if (unit === "hours") r.setHours(r.getHours() + 1);
          r.setTime(r.getTime() - 1);
        }
        out = formatDate(r, fmt, tz);
        break;
      }
      case "parts": { const p = partsIn(d, tz); out = { jaar: Number(p.year), maand: Number(p.month), dag: Number(p.day), uur: Number(p.hour), minuut: Number(p.minute), seconde: Number(p.second), weekdag: p.weekday, iso: d.toISOString() }; break; }
      default: throw fail(`Datum: onbekende bewerking '${op}'`);
    }
    return setPath(payload, target, out);
  },

  jwt: async (payload, step, ctx) => {
    const c = step.config ?? {};
    const op = String(c.operation || "sign");
    const alg = String(c.algorithm || "HS256");
    const target = asPath(c.target) || (op === "sign" ? "token" : "jwt");
    const keys = keyMaterial(c, ctx.env, payload);
    if (op === "sign") {
      const now = Math.floor(Date.now() / 1000);
      const claims = { iat: now, ...(c.expiresIn ? { exp: now + Number(c.expiresIn) } : {}), ...((deepTpl(c.claims ?? {}, payload, ctx.env) as Payload) ?? {}) };
      const head = b64url(JSON.stringify({ alg, typ: "JWT", ...(c.kid ? { kid: String(c.kid) } : {}) }));
      const body = b64url(JSON.stringify(claims));
      const data = `${head}.${body}`;
      let sig: string;
      if (HS[alg]) { if (!keys.secret) throw fail("JWT: geen geheime sleutel"); sig = b64url(createHmac(HS[alg], keys.secret).update(data).digest()); }
      else if (RS[alg]) { if (!keys.privateKey) throw fail("JWT: geen private key (PEM) in de koppeling"); sig = b64url(createSign(RS[alg]).update(data).sign(alg.startsWith("ES") ? { key: keys.privateKey, dsaEncoding: "ieee-p1363" } : keys.privateKey)); }
      else throw fail(`JWT: algoritme ${alg} wordt niet ondersteund`);
      return setPath(payload, target, `${data}.${sig}`);
    }
    const token = String((c.tokenField ? getPath(payload, asPath(c.tokenField)) : tpl(c.token, payload, ctx.env)) ?? "").replace(/^Bearer\s+/i, "");
    const parts = token.split(".");
    if (parts.length !== 3) throw fail("JWT: ongeldig token (verwacht drie delen)");
    let header: Payload, claims: Payload;
    try { header = JSON.parse(unb64url(parts[0]).toString()); claims = JSON.parse(unb64url(parts[1]).toString()); } catch { throw fail("JWT: token is niet te lezen"); }
    if (op === "decode") return setPath(payload, target, { header, claims });
    const tAlg = String(header.alg);
    if (tAlg !== alg) throw fail(`JWT: algoritme ${tAlg} in het token, verwacht ${alg}`);
    const data = `${parts[0]}.${parts[1]}`;
    let ok = false;
    if (HS[alg]) { if (!keys.secret) throw fail("JWT: geen geheime sleutel"); const exp = createHmac(HS[alg], keys.secret).update(data).digest(); const got = unb64url(parts[2]); ok = got.length === exp.length && timingSafeEqual(got, exp); }
    else if (RS[alg]) { const pub = keys.publicKey || keys.privateKey; if (!pub) throw fail("JWT: geen public key (PEM) in de koppeling"); ok = createVerify(RS[alg]).update(data).verify(alg.startsWith("ES") ? { key: pub, dsaEncoding: "ieee-p1363" } : pub, unb64url(parts[2])); }
    else throw fail(`JWT: algoritme ${alg} wordt niet ondersteund`);
    if (!ok) throw fail("JWT: handtekening ongeldig");
    const now = Math.floor(Date.now() / 1000);
    if (typeof claims.exp === "number" && claims.exp < now) throw fail("JWT: token is verlopen");
    if (typeof claims.nbf === "number" && claims.nbf > now) throw fail("JWT: token is nog niet geldig");
    if (c.issuer && claims.iss !== tpl(c.issuer, payload, ctx.env)) throw fail("JWT: uitgever (iss) klopt niet");
    if (c.audience && ![].concat(claims.aud as never).includes(tpl(c.audience, payload, ctx.env) as never)) throw fail("JWT: doelgroep (aud) klopt niet");
    return setPath(payload, target, { valid: true, header, claims });
  },

  compression: async (payload, step) => {
    const c = step.config ?? {};
    const op = String(c.operation || "gzip");
    const field = asPath(c.field || "content");
    const target = asPath(c.target) || field;
    const src = getPath(payload, field);
    if (src === undefined || src === null) throw fail(`Compressie: bronveld '${field}' ontbreekt`);
    const text = typeof src === "string" ? src : JSON.stringify(src);
    const fns: Record<string, (b: Buffer) => Buffer> = { gzip: gzipSync, deflate: deflateSync, brotli: brotliCompressSync };
    const inv: Record<string, (b: Buffer) => Buffer> = { gunzip: gunzipSync, inflate: inflateSync, unbrotli: brotliDecompressSync };
    try {
      if (fns[op]) return setPath(payload, target, fns[op](Buffer.from(text, "utf8")).toString("base64"));
      if (inv[op]) { const out = inv[op](Buffer.from(text, "base64")).toString("utf8"); let data: unknown = out; if (c.parseJson) { try { data = JSON.parse(out); } catch { /* tekst */ } } return setPath(payload, target, data); }
    } catch (err) { throw fail(`Compressie (${op}): ${(err as Error).message}`); }
    throw fail(`Compressie: onbekende bewerking '${op}'`);
  },

  // XSLT 1.0-transformatie en XPath-expressies (zonder externe bestanden: xsl:import/document() van buiten is uit).
  xslt: async (payload, step, ctx) => {
    const c = step.config ?? {};
    const op = String(c.operation || "transform");
    const field = asPath(c.field || "content");
    const src = getPath(payload, field);
    const xmlText = typeof src === "string" ? src : src && typeof src === "object" ? xmlBuild(src, c.root ? String(c.root) : undefined) : "";
    if (!xmlText.trim()) throw fail(`XSLT: bronveld '${field}' ontbreekt of is leeg`);
    const p = new XmlParser();
    let doc;
    try { doc = p.xmlParse(xmlText); } catch (err) { throw fail(`XSLT: invoer is geen geldige XML: ${(err as Error).message}`); }
    if (op === "xpath") {
      const exprs = (c.expressions as Record<string, string>) ?? (c.expression ? { [asPath(c.target) || "xpath"]: String(c.expression) } : {});
      let out = payload;
      for (const [name, expr] of Object.entries(exprs)) {
        let r;
        try { r = new XPath().xPathEval(String(expr), new ExprContext([doc])); } catch (err) { throw fail(`XPath '${expr}': ${(err as Error).message}`); }
        const anyR = r as unknown as { type?: string; nodeSetValue?: () => Array<{ nodeValue?: string; textContent?: string }>; numberValue: () => number; booleanValue: () => boolean; stringValue: () => string };
        let v: unknown;
        if (anyR.type === "node-set" || (anyR.nodeSetValue && anyR.constructor?.name === "NodeSetValue")) {
          const nodes = anyR.nodeSetValue!() as unknown as XNodeLike[];
          const texts = nodes.map(textOf);
          v = c.all ? texts : texts[0] ?? null;
        } else if (anyR.type === "number" || anyR.constructor?.name === "NumberValue") v = anyR.numberValue();
        else if (anyR.type === "boolean" || anyR.constructor?.name === "BooleanValue") v = anyR.booleanValue();
        else v = anyR.stringValue();
        out = setPath(out, asPath(name), v);
      }
      return out;
    }
    const xslText = String(c.stylesheet || "");
    if (!xslText.trim()) throw fail("XSLT: geen stylesheet ingevuld");
    let xsl;
    try { xsl = p.xmlParse(xslText); } catch (err) { throw fail(`XSLT: stylesheet is geen geldige XML: ${(err as Error).message}`); }
    const params = Object.entries((deepTpl(c.parameters ?? {}, payload, ctx.env) as Record<string, unknown>) ?? {}).map(([name, value]) => ({ name, value: String(value ?? "") }));
    const x = new Xslt({ parameters: params, fetchFunction: async (uri: string) => { throw new Error(`externe bron niet toegestaan: ${uri}`); } } as never);
    let result: string;
    try { result = await x.xsltProcess(doc, xsl); } catch (err) { throw fail(`XSLT: ${(err as Error).message}`); }
    const target = asPath(c.target) || "xml";
    let out = setPath(payload, target, result);
    if (c.parse) { try { out = setPath(out, `${target}Data`, xmlParse(result)); } catch { /* geen XML-uitvoer */ } }
    return out;
  },

  // SOAP 1.1/1.2: envelope opbouwen, versturen, Body teruggeven; SOAP Fault wordt een fout.
  soap: async (payload, step, ctx) => {
    const c = step.config ?? {};
    const url = tpl(c.url, payload, ctx.env);
    if (!url) throw fail("SOAP: geen endpoint-URL");
    const v12 = String(c.version || "1.1") === "1.2";
    const ns = v12 ? "http://www.w3.org/2003/05/soap-envelope" : "http://schemas.xmlsoap.org/soap/envelope/";
    let bodyXml: string;
    if (typeof c.body === "string" && c.body.trim().startsWith("<")) bodyXml = tpl(c.body, payload, ctx.env);
    else if (c.bodyField) { const b = getPath(payload, asPath(c.bodyField)); bodyXml = typeof b === "string" ? b : xmlBuild(b).replace(/^<\?xml[^>]*>\s*/, ""); }
    else { const obj = deepTpl(c.body ?? {}, payload, ctx.env); bodyXml = xmlBuild(obj).replace(/^<\?xml[^>]*>\s*/, ""); }
    const headerXml = c.header ? tpl(c.header, payload, ctx.env) : "";
    const envelope = `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="${ns}">${headerXml ? `<soap:Header>${headerXml}</soap:Header>` : ""}<soap:Body>${bodyXml}</soap:Body></soap:Envelope>`;
    const action = c.action ? tpl(c.action, payload, ctx.env) : "";
    const headers: Record<string, string> = { ...authHeaders(ctx.env, c.credential as string | undefined), "content-type": v12 ? `application/soap+xml; charset=utf-8${action ? `; action="${action}"` : ""}` : "text/xml; charset=utf-8" };
    if (!v12) headers.soapaction = `"${action}"`;
    const res = await safeFetch(url, { method: "POST", headers, body: envelope, signal: AbortSignal.timeout(Number(c.timeoutMs || 30000)) }).catch((err: Error & { cause?: { code?: string } }) => {
      throw new Error(`SOAP ${new URL(url).host}: niet bereikbaar${err.cause?.code ? ` (${err.cause.code})` : ""}`);
    });
    const text = await res.text();
    let parsed: unknown;
    try { parsed = xmlParse(text); } catch { throw Object.assign(new Error(`SOAP: antwoord is geen XML (${res.status}): ${text.slice(0, 200)}`), { noRetry: res.status < 500 }); }
    const { body, fault, header } = soapBody(parsed);
    if (fault) {
      const f = fault as Payload;
      const msg = String(f.faultstring ?? (f.Reason as Payload)?.Text ?? JSON.stringify(f)).slice(0, 300);
      throw Object.assign(new Error(`SOAP Fault: ${typeof msg === "object" ? JSON.stringify(msg) : msg}`), { noRetry: true });
    }
    if (!res.ok) throw Object.assign(new Error(`SOAP ${res.status}: ${text.slice(0, 200)}`), { noRetry: res.status < 500 });
    const target = asPath(c.target) || "soap";
    return setPath(payload, target, { status: res.status, body, ...(header ? { header } : {}), ...(c.includeRaw ? { raw: text } : {}) });
  },

  // Proces bewust stoppen met een eigen foutmelding (geen retry).
  stop: async (payload, step, ctx) => {
    const msg = tpl(step.config?.message || "Proces gestopt", payload, ctx.env);
    throw Object.assign(new Error(msg), { noRetry: true, code: step.config?.code });
  }
};
