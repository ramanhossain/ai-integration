// AIP-agent: draait in een omgevingsvariant (bv. PROD op AWS of Azure) en praat met het portaal.
// - verbindt met AIP_URL met de verbindingssleutel van zijn agentgroep (AIP_AGENT_KEY)
// - meldt zich elke 15 s (heartbeat: host, OS, versie, cloud)
// - haalt jobs op (long-poll), voert ze uit met dezelfde engine als het portaal en meldt het resultaat
// - datatabel- en queue-stappen worden door het portaal uitgevoerd (daar staat die opslag)
// Alleen uitgaand HTTPS-verkeer naar het portaal is nodig; er hoeft geen poort open.
//
// Start: AIP_URL=https://portaal AIP_AGENT_KEY=aipk_... npm run agent

import { hostname, platform, release, arch } from "node:os";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { engine } from "../engine/engine";
import { setStepDelegate } from "../engine/nodes";
import { credentials } from "../connectors/credentials";
import { deployments } from "../domain/deployments";
import type { Integration } from "../domain/types";
import type { EnvName } from "../domain/environments";

const VERSION = "1.0.0";
const BASE = String(process.env.AIP_URL || "").replace(/\/$/, "");
const KEY = String(process.env.AIP_AGENT_KEY || "");
const NAME = process.env.AIP_AGENT_NAME || hostname();
const CONCURRENCY = Math.max(1, Math.min(32, Number(process.env.AIP_AGENT_CONCURRENCY || 4)));
const ID_FILE = process.env.AIP_AGENT_ID_FILE || join(process.cwd(), ".aip-agent-id");

interface Job { id: string; env: EnvName; definition: Integration; subprocesses: Integration[]; credentials: Record<string, { type: string; values: Record<string, string> }>; input: Record<string, unknown>; triggeredBy?: string }

function agentId(): string {
  if (process.env.AIP_AGENT_ID) return process.env.AIP_AGENT_ID;
  try { if (existsSync(ID_FILE)) return readFileSync(ID_FILE, "utf8").trim(); } catch { /* */ }
  const id = `${hostname()}-${randomUUID().slice(0, 8)}`;
  try { writeFileSync(ID_FILE, id); } catch { /* alleen-lezen bestandssysteem: per start een nieuwe id */ }
  return id;
}
const ID = agentId();

// Cloud herkennen uit omgevingsvariabelen (AWS ECS/EC2/Lambda, Azure App Service/Container Apps/ACI).
function cloud(): Record<string, string> {
  const e = process.env;
  if (e.AWS_EXECUTION_ENV || e.ECS_CONTAINER_METADATA_URI_V4 || e.AWS_REGION) return { provider: "aws", region: e.AWS_REGION || e.AWS_DEFAULT_REGION || "", service: e.AWS_EXECUTION_ENV || (e.ECS_CONTAINER_METADATA_URI_V4 ? "ECS" : "EC2") };
  if (e.WEBSITE_SITE_NAME || e.CONTAINER_APP_NAME || e.IDENTITY_ENDPOINT || e.AZURE_REGION) return { provider: "azure", region: e.REGION_NAME || e.AZURE_REGION || "", service: e.WEBSITE_SITE_NAME ? "App Service" : e.CONTAINER_APP_NAME ? "Container Apps" : "VM/ACI" };
  if (e.GOOGLE_CLOUD_PROJECT || e.K_SERVICE) return { provider: "gcp", region: e.GOOGLE_CLOUD_REGION || "", service: e.K_SERVICE ? "Cloud Run" : "GCE" };
  if (e.KUBERNETES_SERVICE_HOST) return { provider: "kubernetes", region: "", service: "pod" };
  return { provider: "onprem", region: "", service: "" };
}

async function call<T>(method: string, path: string, body?: unknown, timeoutMs = 30_000): Promise<{ status: number; data: T }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(BASE + path, {
      method,
      headers: { authorization: `Bearer ${KEY}`, "x-aip-agent-id": ID, "content-type": "application/json", "user-agent": `aip-agent/${VERSION}` },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal
    });
    const text = await res.text();
    return { status: res.status, data: (text ? JSON.parse(text) : null) as T };
  } finally { clearTimeout(t); }
}

let running = 0;
let group = "";
const log = (...a: unknown[]) => console.log(new Date().toISOString(), "[aip-agent]", ...a);

async function heartbeat(): Promise<void> {
  try {
    const r = await call<{ group?: { id: string; env: string; name: string }; error?: string }>("POST", "/api/v1/agent-api/heartbeat", {
      id: ID, name: NAME, host: hostname(), os: `${platform()} ${release()} ${arch()}`, version: VERSION, runtime: `node ${process.version}`, cloud: cloud(), running
    });
    if (r.status === 401) { log("Sleutel geweigerd — controleer AIP_AGENT_KEY (misschien geroteerd)."); return; }
    if (r.data?.group && r.data.group.id !== group) { group = r.data.group.id; log(`Verbonden met ${BASE} als ${NAME} in agentgroep ${r.data.group.name} (${r.data.group.env.toUpperCase()})`); }
  } catch (err) { log("Portaal niet bereikbaar:", (err as Error).message); }
}

// Datatabel/queue-stappen: via het portaal uitvoeren.
setStepDelegate(async (type, config, payload, env) => {
  const r = await call<{ ok: boolean; output?: Record<string, unknown>; error?: string }>("POST", "/api/v1/agent-api/steps/execute", { env, type, config, input: payload });
  if (r.status !== 200 || !r.data?.ok) throw new Error(r.data?.error || `Portaal gaf ${r.status} bij stap ${type}`);
  return r.data.output ?? {};
});

async function runJob(job: Job): Promise<void> {
  running++;
  const t0 = Date.now();
  try {
    for (const sub of job.subprocesses || []) deployments.install(sub, job.env);
    credentials.useDelivered(job.env, job.credentials || {});
    const run = await engine.run(job.definition, job.env, job.input || {}, { triggeredBy: job.triggeredBy, agent: NAME, store: false });
    const r = await call("POST", `/api/v1/agent-api/jobs/${job.id}/result`, { agent: ID, run });
    log(`${job.definition.integration} v${job.definition.version} → ${run.status} in ${Date.now() - t0} ms${r.status !== 200 ? ` (melden gaf ${r.status})` : ""}`);
  } catch (err) {
    log(`Job ${job.id} faalde:`, (err as Error).message);
    await call("POST", `/api/v1/agent-api/jobs/${job.id}/result`, { agent: ID, error: (err as Error).message }).catch(() => undefined);
  } finally { running--; }
}

async function worker(n: number): Promise<void> {
  for (;;) {
    try {
      const r = await call<Job>("GET", `/api/v1/agent-api/jobs/next?wait=25`, undefined, 35_000);
      if (r.status === 200 && r.data) await runJob(r.data);
      else if (r.status === 401) await new Promise((res) => setTimeout(res, 15_000));
      else if (r.status !== 204) await new Promise((res) => setTimeout(res, 3_000));
    } catch (err) {
      if (n === 0) log("Ophalen van jobs mislukt:", (err as Error).message);
      await new Promise((res) => setTimeout(res, 5_000));
    }
  }
}

export async function main(): Promise<void> {
  if (!BASE || !KEY) {
    console.error("Zet AIP_URL (adres van het portaal) en AIP_AGENT_KEY (verbindingssleutel van de agentgroep).");
    process.exit(2);
  }
  if (!/^https:\/\//.test(BASE) && !/\/\/(localhost|127\.0\.0\.1)/.test(BASE)) log("Let op: AIP_URL gebruikt geen HTTPS; de sleutel en geheimen gaan dan onversleuteld over het netwerk.");
  log(`Start ${NAME} (${ID}), ${CONCURRENCY} gelijktijdige jobs`);
  await heartbeat();
  setInterval(heartbeat, 15_000).unref();
  await Promise.all(Array.from({ length: CONCURRENCY }, (_, i) => worker(i)));
}
