import { timingSafeEqual } from "node:crypto";
import type { Integration } from "../domain/types";
import { ENVIRONMENTS, type EnvName } from "../domain/environments";
import { deployments } from "../domain/deployments";
import { runDeployed } from "../runtime/dispatch";
import { engine, type Run } from "../engine/engine";
import { broker } from "../connectors/queue";
import { openFs } from "../connectors/files";
import { credentials } from "../connectors/credentials";
import { csvParse, xmlParse } from "../connectors/formats";
import { globToRegex } from "../connectors/util";
import { persistence } from "../store";
import { bus } from "../events/bus";
import { audit } from "../audit/auditLog";
import { parseCron } from "./cron";
import { scoped, orgPathPrefix } from "../tenancy/context";

// Triggers draaien per omgeving waar een proces gedeployed is (een
// proces op PROD reageert op de PROD-trigger met de PROD-koppelingen). De manager
// start/stopt ze automatisch bij elke deployment. Webhooks worden per request opgezocht.

type Trig = Record<string, unknown> & { type: string };

interface ActiveTrigger {
  key: string;
  integration: string;
  env: EnvName;
  version: number;
  type: string;
  sig: string;
  startedAt: string;
  nextAt?: string;
  lastFiredAt?: string;
  lastRunId?: string;
  lastStatus?: string;
  lastError?: string;
  fires: number;
  errors: number;
  stop: () => void;
}

const RUNTIME_TYPES = new Set(["schedule", "queue", "file", "ftp"]);
const k = (env: string, name: string) => `${env}:${name}`;

function parseByFormat(text: string, format: unknown): unknown {
  if (format === "json") return JSON.parse(text);
  if (format === "csv") return csvParse(text);
  if (format === "xml") return xmlParse(text);
  return undefined;
}

class TriggerManager {
  private active = new Map<string, ActiveTrigger>();
  private paused = new Set<string>();
  private webhookStats = new Map<string, { fires: number; errors: number; lastFiredAt?: string; lastRunId?: string; lastStatus?: string; lastError?: string }>();
  private started = false;

  async hydrate(): Promise<void> {
    for (const { id } of await persistence.loadAll("trigger-paused")) this.paused.add(id);
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.reconcile();
    bus.onEvent((e) => {
      if (e.type === "deployment.promoted" || e.type === "version.created" || e.type === "integration.deleted" || e.type === "deployment.targets") this.reconcile();
    });
  }

  stopAll(): void {
    for (const t of this.active.values()) t.stop();
    this.active.clear();
  }

  // Gewenste triggers bepalen en verschillen toepassen.
  reconcile(): void {
    const desired = new Map<string, { def: Integration; env: EnvName; version: number; sig: string }>();
    for (const s of deployments.listStates()) {
      for (const env of ENVIRONMENTS) {
        const version = s.envs[env];
        if (version == null) continue;
        const def = deployments.getDefinition(s.integration, version);
        const t = def?.trigger as Trig | undefined;
        if (!def || !t || !RUNTIME_TYPES.has(t.type) || this.paused.has(k(env, s.integration))) continue;
        desired.set(k(env, s.integration), { def, env, version, sig: `${version}|${JSON.stringify(t)}` });
      }
    }
    for (const [key, t] of this.active) {
      const d = desired.get(key);
      if (!d || d.sig !== t.sig) { t.stop(); this.active.delete(key); }
    }
    for (const [key, d] of desired) {
      if (this.active.has(key)) continue;
      try {
        this.active.set(key, this.startTrigger(key, d.def, d.env, d.version, d.sig));
      } catch (err) {
        audit.append({ actor: "trigger-manager", event: "trigger.error", subject: key, data: { error: (err as Error).message } });
      }
    }
  }

  private async fire(t: ActiveTrigger, def: Integration, input: Record<string, unknown>): Promise<Run> {
    t.lastFiredAt = new Date().toISOString();
    t.fires++;
    const run = await runDeployed(def, t.env, input, { triggeredBy: t.type });
    t.lastRunId = run.id;
    t.lastStatus = run.status;
    if (run.status !== "success") { t.errors++; t.lastError = run.error; }
    bus.publish("trigger.fired", { integration: t.integration, env: t.env, type: t.type, runId: run.id, status: run.status });
    return run;
  }

  private startTrigger(key: string, def: Integration, env: EnvName, version: number, sig: string): ActiveTrigger {
    const trig = def.trigger as Trig;
    const t: ActiveTrigger = { key, integration: def.integration, env, version, type: trig.type, sig, startedAt: new Date().toISOString(), fires: 0, errors: 0, stop: () => undefined };
    const meta = (extra: Record<string, unknown>) => ({ type: trig.type, env, firedAt: new Date().toISOString(), ...extra });

    if (trig.type === "schedule") {
      const every = Number(trig.everySeconds || 0);
      if (every > 0) {
        const ms = Math.max(5, every) * 1000;
        t.nextAt = new Date(Date.now() + ms).toISOString();
        const h = setInterval(() => { t.nextAt = new Date(Date.now() + ms).toISOString(); void this.fire(t, def, { _trigger: meta({ everySeconds: every }) }); }, ms);
        t.stop = () => clearInterval(h);
      } else {
        const cron = parseCron(String(trig.cron || "*/5 * * * *"));
        let h: NodeJS.Timeout;
        const schedule = () => {
          const next = cron.next(new Date());
          t.nextAt = next.toISOString();
          h = setTimeout(() => { void this.fire(t, def, { _trigger: meta({ cron: cron.expr }) }); schedule(); }, Math.max(0, next.getTime() - Date.now()));
        };
        schedule();
        t.stop = () => clearTimeout(h);
      }
    }

    if (trig.type === "queue") {
      const queue = String(trig.queue || "");
      if (!queue) throw new Error("Queue-trigger zonder queuenaam");
      t.stop = broker.subscribe(env, queue, async (m) => {
        const body = m.body && typeof m.body === "object" && !Array.isArray(m.body) ? (m.body as Record<string, unknown>) : { body: m.body };
        const run = await this.fire(t, def, { ...body, _trigger: meta({ queue, messageId: m.id, attempt: m.attempts, headers: m.headers }) });
        if (run.status !== "success") throw new Error(run.error || "run faalde"); // -> retry / dead-letter
      }, Number(trig.concurrency || 1));
    }

    if (trig.type === "file" || trig.type === "ftp") {
      const dir = String(trig.dir || (trig.type === "file" ? "inbox" : "/"));
      const re = globToRegex(String(trig.pattern || "*"));
      const interval = Math.max(2, Number(trig.intervalSeconds || 30)) * 1000;
      const after = String(trig.after || "move");
      const archive = String(trig.archiveDir || `${dir.replace(/\/$/, "")}/archive`);
      const errorDir = `${dir.replace(/\/$/, "")}/error`;
      const cred = trig.type === "ftp" ? String(trig.credential || "") : undefined;
      if (trig.type === "ftp" && !cred) throw new Error("FTP-trigger zonder koppeling");
      let busy = false;
      const tick = async () => {
        if (busy) return;
        busy = true;
        t.nextAt = new Date(Date.now() + interval).toISOString();
        let fs;
        try {
          fs = await openFs(env, cred);
          const files = (await fs.list(dir)).filter((f) => !f.isDir && re.test(f.name)).sort((a, b) => a.name.localeCompare(b.name));
          for (const f of files) {
            const content = await fs.read(f.path);
            let data: unknown;
            try { data = parseByFormat(content, trig.format); } catch (err) { data = undefined; t.lastError = `Parsen ${f.name}: ${(err as Error).message}`; }
            const run = await this.fire(t, def, { file: { name: f.name, path: f.path, size: f.size, content, data }, _trigger: meta({ dir, file: f.name }) });
            if (run.status === "success") {
              if (after === "delete") await fs.remove(f.path);
              else await fs.move(f.path, `${archive.replace(/\/$/, "")}/${f.name}`);
            } else {
              await fs.move(f.path, `${errorDir}/${f.name}`);
            }
          }
        } catch (err) {
          t.errors++;
          t.lastError = (err as Error).message;
        } finally {
          await fs?.close().catch(() => undefined);
          busy = false;
        }
      };
      const h = setInterval(() => void tick(), interval);
      setTimeout(() => void tick(), 500);
      t.nextAt = new Date(Date.now() + 500).toISOString();
      t.stop = () => clearInterval(h);
    }
    return t;
  }

  // ---------- webhooks ----------
  findWebhook(env: EnvName, path: string): Integration | undefined {
    for (const s of deployments.listStates()) {
      const def = deployments.getActiveDefinition(s.integration, env);
      const t = def?.trigger as Trig | undefined;
      if (def && t?.type === "webhook" && String(t.path || def.integration).replace(/^\//, "") === path) return def;
    }
    return undefined;
  }

  async handleWebhook(env: EnvName, path: string, req: { method: string; headers: Record<string, unknown>; query: Record<string, unknown>; body: unknown }): Promise<{ status: number; body: unknown }> {
    const def = this.findWebhook(env, path);
    if (!def) return { status: 404, body: { error: `Geen proces met webhook '${path}' op ${env.toUpperCase()}` } };
    const trig = def.trigger as Trig;
    if (this.paused.has(k(env, def.integration))) return { status: 503, body: { error: "Trigger is gepauzeerd" } };
    const method = String(trig.method || "POST").toUpperCase();
    if (method !== "ANY" && req.method.toUpperCase() !== method) return { status: 405, body: { error: `Methode ${req.method} niet toegestaan; gebruik ${method}` } };
    if (trig.auth === "apikey") {
      const { values } = credentials.resolve(String(trig.credential || ""), env);
      const header = (values.header || "x-api-key").toLowerCase();
      const got = String(req.headers[header] ?? "");
      const want = String(values.key ?? "");
      const ok = got.length === want.length && want.length > 0 && timingSafeEqual(Buffer.from(got), Buffer.from(want));
      if (!ok) return { status: 401, body: { error: "Ongeldige of ontbrekende API-key" } };
    }
    const body = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? (req.body as Record<string, unknown>) : req.body === undefined ? {} : { body: req.body };
    const headers = Object.fromEntries(Object.entries(req.headers).filter(([h]) => !/authorization|cookie|api-key/i.test(h)));
    const input = { ...body, _trigger: { type: "webhook", env, method: req.method, path, query: req.query, headers, firedAt: new Date().toISOString() } };
    const st = this.webhookStats.get(k(env, def.integration)) ?? { fires: 0, errors: 0 };
    this.webhookStats.set(k(env, def.integration), st);
    st.fires++;
    st.lastFiredAt = new Date().toISOString();
    const exec = runDeployed(def, env, input, { triggeredBy: "webhook" }).then((run) => {
      st.lastRunId = run.id; st.lastStatus = run.status;
      if (run.status !== "success") { st.errors++; st.lastError = run.error; }
      bus.publish("trigger.fired", { integration: def.integration, env, type: "webhook", runId: run.id, status: run.status });
      return run;
    });
    if (trig.response === "accepted") { void exec; return { status: 202, body: { accepted: true } }; }
    const run = await exec;
    const custom = run.output?._response as { status?: number; body?: unknown } | undefined;
    if (run.status === "success" && custom) return { status: Number(custom.status || 200), body: custom.body ?? null };
    return run.status === "success"
      ? { status: 200, body: { runId: run.id, status: run.status, output: run.output } }
      : { status: 500, body: { runId: run.id, status: run.status, error: run.error } };
  }

  // ---------- API-endpoints (API-management) ----------
  // Pad met parameters, bv. "orders/{id}"; per methode; schoon JSON-antwoord.
  findApi(env: EnvName, method: string, path: string): { def: Integration; params: Record<string, string> } | undefined {
    const want = path.replace(/^\/|\/$/g, "").split("/");
    for (const s of deployments.listStates()) {
      const def = deployments.getActiveDefinition(s.integration, env);
      const t = def?.trigger as Trig | undefined;
      if (!def || t?.type !== "api") continue;
      if (String(t.method || "GET").toUpperCase() !== method.toUpperCase()) continue;
      const tpl = String(t.path || def.integration).replace(/^\/|\/$/g, "").split("/");
      if (tpl.length !== want.length) continue;
      const params: Record<string, string> = {};
      const ok = tpl.every((seg, i) => {
        const m = seg.match(/^\{(\w+)\}$/);
        if (m) { params[m[1]] = decodeURIComponent(want[i]); return true; }
        return seg === want[i];
      });
      if (ok) return { def, params };
    }
    return undefined;
  }

  private checkApiKey(trig: Trig, env: EnvName, headers: Record<string, unknown>): boolean {
    if (trig.auth !== "apikey") return true;
    const { values } = credentials.resolve(String(trig.credential || ""), env);
    const header = (values.header || "x-api-key").toLowerCase();
    const got = String(headers[header] ?? "");
    const want = String(values.key ?? "");
    return got.length === want.length && want.length > 0 && timingSafeEqual(Buffer.from(got), Buffer.from(want));
  }

  async handleApi(env: EnvName, path: string, req: { method: string; headers: Record<string, unknown>; query: Record<string, unknown>; body: unknown }): Promise<{ status: number; body: unknown }> {
    const hit = this.findApi(env, req.method, path);
    if (!hit) return { status: 404, body: { error: `Geen API-endpoint ${req.method} /${path} op ${env.toUpperCase()}` } };
    const { def, params } = hit;
    const trig = def.trigger as Trig;
    if (this.paused.has(k(env, def.integration))) return { status: 503, body: { error: "API-endpoint is gepauzeerd" } };
    try { if (!this.checkApiKey(trig, env, req.headers)) return { status: 401, body: { error: "Ongeldige of ontbrekende API-key" } }; }
    catch (e) { return { status: 500, body: { error: (e as Error).message } }; }
    const body = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? (req.body as Record<string, unknown>) : req.body === undefined ? {} : { body: req.body };
    const input = { ...body, params, query: req.query, _trigger: { type: "api", env, method: req.method, path, firedAt: new Date().toISOString() } };
    const key = k(env, def.integration);
    const st = this.webhookStats.get(key) ?? { fires: 0, errors: 0 };
    this.webhookStats.set(key, st);
    st.fires++;
    st.lastFiredAt = new Date().toISOString();
    const run = await runDeployed(def, env, input, { triggeredBy: "api" });
    st.lastRunId = run.id; st.lastStatus = run.status;
    if (run.status !== "success") { st.errors++; st.lastError = run.error; }
    bus.publish("trigger.fired", { integration: def.integration, env, type: "api", runId: run.id, status: run.status });
    if (run.status !== "success") return { status: 500, body: { error: run.error, runId: run.id } };
    const custom = run.output?._response as { status?: number; body?: unknown } | undefined;
    if (custom) return { status: Number(custom.status || 200), body: custom.body ?? null };
    // Schoon antwoord: interne velden (_trigger, _branch, _logs …) en de invoer-metadata eruit.
    const out = Object.fromEntries(Object.entries(run.output ?? {}).filter(([kk]) => !kk.startsWith("_") && kk !== "params" && kk !== "query"));
    return { status: 200, body: out };
  }

  // OpenAPI-specificatie van alle API-endpoints op een omgeving.
  openApi(env: EnvName, baseUrl: string) {
    const paths: Record<string, Record<string, unknown>> = {};
    let secured = false;
    for (const s of deployments.listStates()) {
      const def = deployments.getActiveDefinition(s.integration, env);
      const t = def?.trigger as Trig | undefined;
      if (!def || t?.type !== "api") continue;
      const p = "/" + String(t.path || def.integration).replace(/^\/|\/$/g, "");
      const method = String(t.method || "GET").toLowerCase();
      const params = [...p.matchAll(/\{(\w+)\}/g)].map((m) => ({ name: m[1], in: "path", required: true, schema: { type: "string" } }));
      if (t.auth === "apikey") secured = true;
      paths[p] = {
        ...(paths[p] ?? {}),
        [method]: {
          operationId: def.integration,
          summary: def.description || def.integration,
          tags: [def.integration],
          parameters: params,
          ...(["post", "put", "patch"].includes(method) ? { requestBody: { content: { "application/json": { schema: { type: "object" } } } } } : {}),
          ...(t.auth === "apikey" ? { security: [{ apiKey: [] }] } : {}),
          responses: { "200": { description: "Resultaat van het proces", content: { "application/json": { schema: { type: "object" } } } }, "401": { description: "Ongeldige API-key" }, "500": { description: "Proces gefaald" } },
          "x-aip-process": def.integration,
          "x-aip-version": def.version
        }
      };
    }
    return {
      openapi: "3.0.3",
      info: { title: `AIP API's — ${env.toUpperCase()}`, version: "1", description: "Automatisch gegenereerd uit processen met een API-endpoint-trigger." },
      servers: [{ url: `${baseUrl}${orgPathPrefix()}/apis/${env}` }],
      paths,
      components: secured ? { securitySchemes: { apiKey: { type: "apiKey", in: "header", name: "x-api-key" } } } : {}
    };
  }

  // ---------- beheer ----------
  setPaused(env: EnvName, name: string, paused: boolean, actor: string): void {
    const key = k(env, name);
    if (paused) { this.paused.add(key); persistence.put("trigger-paused", key, { key }); }
    else { this.paused.delete(key); persistence.delete("trigger-paused", key); }
    audit.append({ actor, event: paused ? "trigger.paused" : "trigger.resumed", subject: key });
    bus.publish(paused ? "trigger.paused" : "trigger.resumed", { env, integration: name });
    this.reconcile();
  }

  list(baseUrl: string) {
    const out = [];
    for (const s of deployments.listStates()) {
      for (const env of ENVIRONMENTS) {
        const version = s.envs[env];
        if (version == null) continue;
        const def = deployments.getDefinition(s.integration, version);
        const trig = (def?.trigger ?? { type: "manual" }) as Trig;
        const key = k(env, s.integration);
        const a = this.active.get(key);
        const wh = this.webhookStats.get(key);
        out.push({
          integration: s.integration,
          env,
          version,
          type: trig.type,
          config: trig,
          paused: this.paused.has(key),
          running: Boolean(a) || trig.type === "webhook" || trig.type === "api",
          url: trig.type === "webhook" ? `${baseUrl}${orgPathPrefix()}/hooks/${env}/${String(trig.path || s.integration).replace(/^\//, "")}` : trig.type === "api" ? `${String(trig.method || "GET").toUpperCase()} ${baseUrl}${orgPathPrefix()}/apis/${env}/${String(trig.path || s.integration).replace(/^\//, "")}` : undefined,
          nextAt: a?.nextAt,
          lastFiredAt: a?.lastFiredAt ?? wh?.lastFiredAt,
          lastRunId: a?.lastRunId ?? wh?.lastRunId,
          lastStatus: a?.lastStatus ?? wh?.lastStatus,
          lastError: a?.lastError ?? wh?.lastError,
          fires: a?.fires ?? wh?.fires ?? 0,
          errors: a?.errors ?? wh?.errors ?? 0
        });
      }
    }
    return out;
  }
}

export const triggers = scoped("triggers", () => new TriggerManager());
