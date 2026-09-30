import { createHmac } from "node:crypto";
import type { PluginDef } from "./types";

// Eigen ondertekening of sessies voor diensten die niet met een vaste header/token werken
// (auth.type "custom"). Een signer mag headers aanvullen en de URL aanpassen (bv. een base-ID invullen).

export interface SignCtx { def: PluginDef; values: Record<string, string>; method: string; url: URL; headers: Record<string, string>; body?: string; credKey: string }
type Signer = (c: SignCtx) => Promise<void> | void;

const TIMEOUT_MS = Number(process.env.AIP_PLUGIN_TIMEOUT_MS || 30000);
const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
const need = (v: Record<string, string>, ...keys: string[]) => { for (const k of keys) if (!v[k]) throw new Error(`Koppeling: '${k}' ontbreekt`); };

// Kortlevende sessietokens per koppeling/omgeving (FileMaker, SeaTable, Wekan, Venafi).
const sessions = new Map<string, { exp: number; data: Record<string, string> }>();
async function session(key: string, ttlMs: number, login: () => Promise<Record<string, string>>): Promise<Record<string, string>> {
  const hit = sessions.get(key);
  if (hit && hit.exp > Date.now()) return hit.data;
  const data = await login();
  sessions.set(key, { exp: Date.now() + ttlMs, data });
  return data;
}
async function postJson(url: string, body: unknown, headers: Record<string, string> = {}, form = false): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    method: "POST",
    headers: { accept: "application/json", "content-type": form ? "application/x-www-form-urlencoded" : "application/json", ...headers },
    body: form ? new URLSearchParams(body as Record<string, string>).toString() : body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
  const text = await res.text();
  let data: Record<string, unknown> = {};
  try { data = JSON.parse(text); } catch { /* geen json */ }
  if (!res.ok) throw new Error(`Aanmelden mislukt (${res.status}): ${String((data as { message?: string }).message || (data as { error?: string }).error || text).slice(0, 200)}`);
  return data;
}
const base = (u: string) => String(u || "").replace(/\/$/, "");

export const SIGNERS: Record<string, Signer> = {
  // Drivers (databases, brokers, …) melden zelf aan; hier niets te doen.
  driver() { /* geen HTTP */ },

  // Ghost Admin API: sleutel "id:secret" -> JWT (HS256), 5 minuten geldig.
  ghost({ values, headers }) {
    need(values, "adminKey");
    const [id, secret] = values.adminKey.split(":");
    if (!id || !secret) throw new Error("Ghost Admin API key heeft de vorm id:secret");
    const now = Math.floor(Date.now() / 1000);
    const head = b64url(JSON.stringify({ alg: "HS256", typ: "JWT", kid: id }));
    const payload = b64url(JSON.stringify({ iat: now, exp: now + 300, aud: "/admin/" }));
    const sig = b64url(createHmac("sha256", Buffer.from(secret, "hex")).update(`${head}.${payload}`).digest());
    headers.authorization = `Ghost ${head}.${payload}.${sig}`;
    headers["accept-version"] = "v5.0";
  },

  // Azure Storage (Blob): Shared Key, of een SAS-token als dat is ingevuld.
  "azure-storage"({ values, method, url, headers, body }) {
    need(values, "account");
    headers["x-ms-version"] = "2021-08-06";
    headers["x-ms-date"] = new Date().toUTCString();
    if (values.sasToken) { for (const [k, v] of new URLSearchParams(values.sasToken.replace(/^\?/, ""))) url.searchParams.set(k, v); return; }
    need(values, "accountKey");
    const len = body ? Buffer.byteLength(body) : 0;
    const h = (n: string) => headers[n] ?? "";
    const canonHeaders = Object.keys(headers).filter((k) => k.startsWith("x-ms-")).sort().map((k) => `${k}:${String(headers[k]).trim()}\n`).join("");
    const qs = [...new Set([...url.searchParams.keys()])].map((k) => k.toLowerCase()).sort().map((k) => `\n${k}:${url.searchParams.getAll(k).sort().join(",")}`).join("");
    const canonResource = `/${values.account}${decodeURIComponent(url.pathname)}${qs}`;
    const sts = [method, h("content-encoding"), h("content-language"), len ? String(len) : "", h("content-md5"), h("content-type"), "", h("if-modified-since"), h("if-match"), h("if-none-match"), h("if-unmodified-since"), h("range")].join("\n") + "\n" + canonHeaders + canonResource;
    headers.authorization = `SharedKey ${values.account}:${createHmac("sha256", Buffer.from(values.accountKey, "base64")).update(sts, "utf8").digest("base64")}`;
  },

  // Azure Cosmos DB (SQL API): master-key token per aanvraag.
  "azure-cosmos"({ values, method, url, headers }) {
    need(values, "accountKey");
    const date = new Date().toUTCString();
    headers["x-ms-date"] = date;
    headers["x-ms-version"] = "2018-12-31";
    const parts = decodeURIComponent(url.pathname).replace(/^\/|\/$/g, "").split("/").filter(Boolean);
    const even = parts.length % 2 === 0;
    const type = even ? parts[parts.length - 2] ?? "" : parts[parts.length - 1] ?? "";
    const link = even ? parts.join("/") : parts.slice(0, -1).join("/");
    const text = `${method.toLowerCase()}\n${type.toLowerCase()}\n${link}\n${date.toLowerCase()}\n\n`;
    const sig = createHmac("sha256", Buffer.from(values.accountKey, "base64")).update(text).digest("base64");
    headers.authorization = encodeURIComponent(`type=master&ver=1.0&sig=${sig}`);
    if (headers["content-type"] === "application/query+json") { headers["x-ms-documentdb-isquery"] = "True"; headers["x-ms-documentdb-query-enablecrosspartition"] = "True"; }
  },

  // Unleashed: HMAC-SHA256 van de querystring met de API-key.
  unleashed({ values, url, headers }) {
    need(values, "apiId", "apiKey");
    headers["api-auth-id"] = values.apiId;
    headers["api-auth-signature"] = createHmac("sha256", values.apiKey).update(url.search.replace(/^\?/, "")).digest("base64");
    headers["client-type"] = "AIP/integratieplatform";
  },

  // SeaTable: API-token van de base -> tijdelijk base-token; BASE_UUID in het pad wordt ingevuld.
  async seatable({ values, url, headers, credKey }) {
    need(values, "url", "apiToken");
    const s = await session(`seatable:${credKey}`, 60 * 60 * 1000, async () => {
      const res = await fetch(`${base(values.url)}/api/v2.1/dtable/app-access-token/`, { headers: { authorization: `Token ${values.apiToken}`, accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
      const d = (await res.json().catch(() => ({}))) as Record<string, string>;
      if (!res.ok || !d.access_token) throw new Error(`SeaTable: base-token ophalen mislukt (${res.status})`);
      return { token: d.access_token, uuid: d.dtable_uuid };
    });
    url.pathname = url.pathname.replace("BASE_UUID", s.uuid);
    headers.authorization = `Bearer ${s.token}`;
  },

  // FileMaker Data API: sessie via basic-auth, daarna bearer (sessie verloopt na 15 min zonder gebruik).
  async filemaker({ values, headers, credKey }) {
    need(values, "url", "database", "user", "password");
    const s = await session(`filemaker:${credKey}`, 10 * 60 * 1000, async () => {
      const d = await postJson(`${base(values.url)}/fmi/data/vLatest/databases/${encodeURIComponent(values.database)}/sessions`, {}, { authorization: `Basic ${Buffer.from(`${values.user}:${values.password}`).toString("base64")}` });
      const token = (d.response as { token?: string } | undefined)?.token;
      if (!token) throw new Error("FileMaker: geen sessietoken ontvangen");
      return { token };
    });
    headers.authorization = `Bearer ${s.token}`;
  },

  // Wekan: inloggen met gebruiker/wachtwoord; ME in het pad wordt de eigen gebruikers-ID.
  async wekan({ values, url, headers, credKey }) {
    need(values, "url", "user", "password");
    const s = await session(`wekan:${credKey}`, 12 * 60 * 60 * 1000, async () => {
      const d = await postJson(`${base(values.url)}/users/login`, { username: values.user, password: values.password }, {}, true);
      if (!d.token) throw new Error("Wekan: inloggen mislukt");
      return { token: String(d.token), id: String(d.id) };
    });
    url.pathname = url.pathname.replace("/ME/", `/${s.id}/`).replace(/\/ME$/, `/${s.id}`);
    headers.authorization = `Bearer ${s.token}`;
  },

  // Venafi TLS Protect Datacenter (TPP): OAuth-token via gebruikersnaam/wachtwoord.
  async "venafi-tpp"({ values, headers, credKey }) {
    need(values, "url", "clientId", "user", "password");
    const s = await session(`venafi:${credKey}`, 30 * 60 * 1000, async () => {
      const d = await postJson(`${base(values.url)}/vedauth/authorize/oauth`, { client_id: values.clientId, username: values.user, password: values.password, scope: values.scope || "certificate:manage" });
      if (!d.access_token) throw new Error("Venafi: geen token ontvangen");
      return { token: String(d.access_token) };
    });
    headers.authorization = `Bearer ${s.token}`;
  }
};

export async function applySigner(name: string, ctx: SignCtx): Promise<void> {
  const s = SIGNERS[name];
  if (!s) throw new Error(`Onbekende ondertekening '${name}'`);
  await s(ctx);
}
