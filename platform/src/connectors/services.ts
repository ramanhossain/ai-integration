import nodemailer from "nodemailer";
import { Pool } from "pg";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { EnvName } from "../domain/environments";
import { credentials } from "./credentials";
import { safeFetch, assertHostAllowed, assertTargetsAllowed, assertUrlAllowed } from "../net/egress";

// ---------- HTTP-authenticatie via een koppeling ----------
export function authHeaders(env: EnvName, credentialName?: string): Record<string, string> {
  if (!credentialName) return {};
  const { type, values } = credentials.resolve(credentialName, env);
  if (type === "http-basic") return { authorization: `Basic ${Buffer.from(`${values.user ?? ""}:${values.password ?? ""}`).toString("base64")}` };
  if (type === "http-bearer") return { authorization: `Bearer ${values.token}` };
  if (type === "api-key") return { [(values.header || "x-api-key").toLowerCase()]: values.key };
  if (type === "generic") return Object.fromEntries(Object.entries(values).filter(([k]) => k.toLowerCase().startsWith("header.")).map(([k, v]) => [k.slice(7), v]));
  throw new Error(`Koppeling '${credentialName}' (type ${type}) is geen HTTP-authenticatie`);
}

// ---------- E-mail (SMTP) ----------
export async function sendMail(env: EnvName, credentialName: string | undefined, mail: { to: string; cc?: string; subject: string; text?: string; html?: string; from?: string }) {
  if (!mail.to) throw new Error("E-mail: ontvanger (to) ontbreekt");
  if (!credentialName) {
    // Zonder koppeling: gesimuleerd (handig op DEV). De mail wordt niet verstuurd.
    const t = nodemailer.createTransport({ jsonTransport: true });
    const info = await t.sendMail({ from: mail.from || "aip@localhost", ...mail });
    return { simulated: true, messageId: info.messageId, preview: JSON.parse(String(info.message)) };
  }
  const { values } = credentials.resolve(credentialName, env);
  await assertHostAllowed(values.host);
  const t = nodemailer.createTransport({
    host: values.host,
    port: Number(values.port || 587),
    secure: values.secure === "true",
    auth: values.user ? { user: values.user, pass: values.password } : undefined
  });
  const info = await t.sendMail({ from: mail.from || values.from || values.user, ...mail });
  return { simulated: false, messageId: info.messageId, accepted: info.accepted, rejected: info.rejected };
}

// ---------- SQL (PostgreSQL) ----------
const pools = new Map<string, Pool>();
export async function sqlQuery(env: EnvName, credentialName: string, query: string, params: unknown[]) {
  if (!credentialName) throw new Error("SQL: kies een PostgreSQL-koppeling");
  const { type, values } = credentials.resolve(credentialName, env);
  if (type !== "postgres") throw new Error(`Koppeling '${credentialName}' is geen PostgreSQL-koppeling`);
  await assertTargetsAllowed({ connectionString: values.connectionString });
  let pool = pools.get(values.connectionString);
  if (!pool) {
    pool = new Pool({ connectionString: values.connectionString, max: 4, connectionTimeoutMillis: 10000 });
    pools.set(values.connectionString, pool);
  }
  const res = await pool.query(query, params);
  return { rows: res.rows, rowCount: res.rowCount ?? 0 };
}

// ---------- Teams / Slack ----------
export async function notify(env: EnvName, cfg: { kind: string; url?: string; credential?: string; text: string; title?: string }) {
  let url = cfg.url;
  if (cfg.credential) url = credentials.resolve(cfg.credential, env).values.url;
  const body = cfg.kind === "teams"
    ? { "@type": "MessageCard", "@context": "https://schema.org/extensions", summary: cfg.title || "AIP", title: cfg.title, text: cfg.text }
    : { text: cfg.title ? `*${cfg.title}*\n${cfg.text}` : cfg.text };
  if (!url) return { simulated: true, kind: cfg.kind, body };
  const res = await safeFetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${cfg.kind} webhook -> ${res.status}`);
  return { simulated: false, kind: cfg.kind, status: res.status };
}

// ---------- MCP-client: een tool op een externe MCP-server aanroepen ----------
export async function mcpCall(env: EnvName, cfg: { credential?: string; url?: string; tool: string; args: Record<string, unknown> }) {
  let url = cfg.url, token: string | undefined;
  if (cfg.credential) {
    const { values } = credentials.resolve(cfg.credential, env);
    url = values.url; token = values.token;
  }
  if (!url) throw new Error("MCP: geen server-URL (kies een MCP-koppeling of vul een URL in)");
  await assertUrlAllowed(url);
  if (!cfg.tool) throw new Error("MCP: geen toolnaam");
  const client = new Client({ name: "aip-platform", version: "0.1.0" });
  const transport = new StreamableHTTPClientTransport(new URL(url), token ? { requestInit: { headers: { authorization: `Bearer ${token}` } } } : undefined);
  await client.connect(transport);
  try {
    const res = (await client.callTool({ name: cfg.tool, arguments: cfg.args })) as { content?: Array<{ type: string; text?: string }>; isError?: boolean; structuredContent?: unknown };
    const text = (res.content ?? []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
    let parsed: unknown = text;
    try { parsed = JSON.parse(text); } catch { /* tekst laten */ }
    if (res.isError) throw new Error(`MCP-tool ${cfg.tool} gaf een fout: ${text.slice(0, 300)}`);
    return { tool: cfg.tool, result: res.structuredContent ?? parsed };
  } finally {
    await client.close().catch(() => undefined);
  }
}

export async function mcpListTools(url: string, token?: string) {
  const client = new Client({ name: "aip-platform", version: "0.1.0" });
  const transport = new StreamableHTTPClientTransport(new URL(url), token ? { requestInit: { headers: { authorization: `Bearer ${token}` } } } : undefined);
  await client.connect(transport);
  try {
    return (await client.listTools()).tools.map((t) => ({ name: t.name, description: t.description }));
  } finally {
    await client.close().catch(() => undefined);
  }
}
