import { randomUUID } from "node:crypto";
import type { Integration } from "../domain/types";
import type { EnvName } from "../domain/environments";
import { getNode, RETRYABLE, type NodeContext, type StepDef } from "./nodes";
import { deployments } from "../domain/deployments";
import { persistence } from "../store";
import { bus } from "../events/bus";
import { scoped } from "../tenancy/context";

// De workflow-engine: voert de stappen van een integratie deterministisch uit,
// met retry en dead-letter-queue. Houdt run-records bij voor monitoring.

export interface StepResult {
  id: string;
  type: string;
  status: "ok" | "failed" | "skipped";
  ms: number;
  attempts: number;
  error?: string;
  port?: string; // gekozen uitgang bij een beslissing
  input?: unknown;
  output?: unknown;
}

export type Connection = { from: string; to: string; port?: string };

// Zonder expliciete connections: stappen lineair verbinden (achterwaarts compatibel).
export function effectiveConnections(def: Integration): Connection[] {
  if (def.connections?.length) return def.connections;
  const ids = def.steps.map((s) => s.id);
  return ids.map((id, i) => ({ from: i === 0 ? "start" : ids[i - 1], to: id }));
}

// Grote payloads inkorten in het run-record (houdt de opslag klein).
function clip(v: unknown): unknown {
  const s = JSON.stringify(v ?? null);
  // Ruim genoeg voor gewone API-antwoorden (bijv. 10 gebruikers of 100 posts); alleen echt
  // grote berichten worden in de run ingekort (de data zelf loopt wel volledig door).
  return s.length > 64000 ? { _truncated: true, preview: s.slice(0, 64000) } : v;
}

const MAX_NODE_EXECUTIONS = 500; // bescherming tegen oneindige lussen

export interface Run {
  id: string;
  integration: string;
  env: EnvName;
  version: number | null;
  status: "success" | "error";
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  steps: StepResult[];
  deadLettered: boolean;
  output?: Record<string, unknown>;
  error?: string;
  test?: boolean; // test-run vanuit de editor (niet-opgeslagen definitie)
  triggeredBy?: string; // manual | webhook | schedule | queue | file | ftp | test | subprocess | mcp | api
  definition?: Integration; // alleen bij test-runs, zodat de run later te tekenen is
  agentGroup?: string; // omgevingsvariant waarop de run draaide (bv. prod-platform, prod-aws)
  agent?: string; // naam van de externe agent (leeg = portaal)
}

class Engine {
  private runs: Run[] = [];
  private currentGroup = new Map<string, string | undefined>(); // subprocessen blijven op dezelfde groep

  async hydrate(): Promise<void> {
    const rows = await persistence.loadAll("runs");
    this.runs = rows.map((r) => r.doc as Run).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  }

  private async runStep(handler: () => Promise<Record<string, unknown>>, attempts: number, backoff: string): Promise<{ out: Record<string, unknown>; tries: number }> {
    let lastErr: unknown;
    for (let i = 0; i <= attempts; i++) {
      try {
        return { out: await handler(), tries: i + 1 };
      } catch (err) {
        lastErr = err;
        if ((err as { noRetry?: boolean }).noRetry) { (err as { tries?: number }).tries = i + 1; break; } // definitieve fout (bijv. 404): niet opnieuw proberen
        if (i < attempts && backoff === "exponential") {
          await new Promise((r) => setTimeout(r, Math.min(50 * 2 ** i, 400)));
        }
      }
    }
    if (lastErr && typeof lastErr === "object" && !(lastErr as { tries?: number }).tries) (lastErr as { tries?: number }).tries = attempts + 1;
    throw lastErr;
  }

  private context(integration: string, env: EnvName, depth: number): NodeContext {
    return {
      integration,
      env,
      seen: new Set(),
      depth,
      // Subproces: de actieve versie op dezelfde omgeving uitvoeren.
      callProcess: async (name, input) => {
        const sub = deployments.getActiveDefinition(name, env);
        if (!sub) throw new Error(`Subproces '${name}' heeft geen actieve versie op ${env}`);
        const r = await this.run(sub, env, input, { triggeredBy: "subprocess", depth: depth + 1, agentGroup: this.currentGroup.get(integration) });
        if (r.status !== "success") throw new Error(`Subproces '${name}' faalde: ${r.error}`);
        return r.output ?? {};
      }
    };
  }

  async run(def: Integration, env: EnvName, input: Record<string, unknown>, opts: { triggeredBy?: string; depth?: number; agentGroup?: string; agent?: string; store?: boolean } = {}): Promise<Run> {
    const started = Date.now();
    if (opts.agentGroup) this.currentGroup.set(def.integration, opts.agentGroup);
    const ctx = this.context(def.integration, env, opts.depth ?? 0);
    const attempts = def.retry?.attempts ?? 0;
    const backoff = def.retry?.backoff ?? "none";
    const onExhaust = def.retry?.onExhaust ?? "fail";

    const steps: StepResult[] = [];
    let payload: Record<string, unknown> = { ...input };
    let status: Run["status"] = "success";
    let deadLettered = false;
    let error: string | undefined;

    // Graaf-traversal over het BPMN-model: vanaf het startevent de sequence flows volgen.
    const byId = new Map((def.steps as StepDef[]).map((s) => [s.id, s]));
    const conns = effectiveConnections(def);
    const outgoing = (from: string, port: string) =>
      conns.filter((c) => c.from === from && (c.port ?? (byId.get(from)?.type === "branch" ? "true" : "out")) === port);
    // Stapel (depth-first); in omgekeerde volgorde pushen zodat de eerste flow eerst loopt.
    const stack: Array<{ id: string; payload: Record<string, unknown> }> = outgoing("start", "out")
      .reverse()
      .map((c) => ({ id: c.to, payload }));
    let executed = 0;

    while (stack.length && status === "success") {
      const { id, payload: inPayload } = stack.pop()!;
      const step = byId.get(id);
      if (!step) continue;
      if (++executed > MAX_NODE_EXECUTIONS) {
        status = "error";
        error = `Afgebroken: meer dan ${MAX_NODE_EXECUTIONS} stapuitvoeringen (lus?)`;
        break;
      }
      const t0 = Date.now();
      const flags = step as StepDef & { disabled?: boolean; pinData?: Record<string, unknown> };
      // Gedeactiveerde stap: overslaan en het bericht ongewijzigd doorgeven.
      if (flags.disabled) {
        steps.push({ id: step.id, type: step.type, status: "skipped", ms: 0, attempts: 0, input: clip(inPayload), output: clip(inPayload) });
        if (step.type === "end") continue;
        const port = step.type === "branch" ? "true" : "out";
        for (const c of outgoing(step.id, port).reverse()) stack.push({ id: c.to, payload: inPayload });
        continue;
      }
      // Vastgezette output (alleen bij test-runs vanuit de editor): niet opnieuw uitvoeren.
      if (flags.pinData && !def.version) {
        payload = { ...flags.pinData };
        const port = step.type === "branch" ? ((payload._branch as { taken?: boolean })?.taken === false ? "false" : "true") : "out";
        steps.push({ id: step.id, type: step.type, status: "ok", ms: 0, attempts: 0, port: step.type === "branch" ? port : undefined, input: clip(inPayload), output: clip(payload) });
        if (step.type === "end") continue;
        for (const c of outgoing(step.id, port).reverse()) stack.push({ id: c.to, payload });
        continue;
      }
      // Alleen stappen met I/O naar buiten krijgen retries; data-stappen zijn deterministisch.
      const retries = RETRYABLE.has(step.type) ? attempts : 0;
      try {
        const { out, tries } = await this.runStep(() => getNode(step.type)(inPayload, step, ctx), retries, backoff);
        payload = out;
        const port = step.type === "branch" ? ((out._branch as { taken?: boolean })?.taken ? "true" : "false") : "out";
        steps.push({ id: step.id, type: step.type, status: "ok", ms: Date.now() - t0, attempts: tries, port: step.type === "branch" ? port : undefined, input: clip(inPayload), output: clip(out) });
        if (step.type === "end") continue;
        for (const c of outgoing(step.id, port).reverse()) stack.push({ id: c.to, payload: out });
      } catch (err) {
        error = (err as Error).message;
        steps.push({ id: step.id, type: step.type, status: "failed", ms: Date.now() - t0, attempts: (err as { tries?: number }).tries ?? retries + 1, error, input: clip(inPayload) });
        status = "error";
        if (RETRYABLE.has(step.type) && onExhaust === "dead-letter-queue") deadLettered = true;
        break;
      }
    }

    const run: Run = {
      id: randomUUID(),
      integration: def.integration,
      env,
      version: def.version ? Number(def.version) : null,
      status,
      startedAt: new Date(started).toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - started,
      steps,
      deadLettered,
      output: status === "success" ? payload : undefined,
      error,
      triggeredBy: opts.triggeredBy ?? (def.version ? "manual" : "test"),
      ...(def.version ? {} : { test: true, definition: def }),
      ...(opts.agentGroup ? { agentGroup: opts.agentGroup } : {}),
      ...(opts.agent ? { agent: opts.agent } : {})
    };
    if (opts.store === false) return run; // agent: resultaat gaat naar het portaal
    this.runs.push(run);
    persistence.put("runs", run.id, run);
    bus.publish("run.finished", { id: run.id, integration: run.integration, env, status, durationMs: run.durationMs, deadLettered, triggeredBy: run.triggeredBy });
    return run;
  }

  // Resultaat van een externe agent vastleggen alsof het hier gedraaid heeft.
  record(input: Run): Run {
    const run: Run = { ...input, id: randomUUID() };
    this.runs.push(run);
    persistence.put("runs", run.id, run);
    bus.publish("run.finished", { id: run.id, integration: run.integration, env: run.env, status: run.status, durationMs: run.durationMs, deadLettered: run.deadLettered, triggeredBy: run.triggeredBy, agentGroup: run.agentGroup });
    return run;
  }

  // Eén stap los uitvoeren (proceseditor: "Stap uitvoeren"). Heeft geen bijwerkingen op runs.
  async executeStep(type: string, config: Record<string, unknown>, input: Record<string, unknown>, env: EnvName = "dev"): Promise<{ ok: boolean; ms: number; output?: unknown; error?: string; port?: string }> {
    const t0 = Date.now();
    try {
      const out = await getNode(type)(input, { id: "step", type, config }, this.context("editor", env, 0));
      const port = type === "branch" ? ((out._branch as { taken?: boolean })?.taken ? "true" : "false") : undefined;
      return { ok: true, ms: Date.now() - t0, output: out, port };
    } catch (err) {
      return { ok: false, ms: Date.now() - t0, error: (err as Error).message };
    }
  }

  get(id: string): Run | undefined {
    return this.runs.find((r) => r.id === id);
  }

  list(filter?: { integration?: string; env?: EnvName; limit?: number }): Run[] {
    let items = [...this.runs].reverse();
    if (filter?.integration) items = items.filter((r) => r.integration === filter.integration);
    if (filter?.env) items = items.filter((r) => r.env === filter.env);
    return filter?.limit ? items.slice(0, filter.limit) : items;
  }

  // Metrics voor het monitoring-dashboard.
  metrics(env?: EnvName): {
    totalRuns: number;
    success: number;
    error: number;
    successRate: number;
    deadLettered: number;
    avgDurationMs: number;
    perEnv: Record<string, { runs: number; error: number }>;
    recentErrors: Array<{ integration: string; env: string; error?: string; at: string }>;
  } {
    // Test-runs uit de editor (niet-opgeslagen definitie) tellen niet mee in de cijfers.
    const all = this.runs.filter((r) => !r.test && (!env || r.env === env));
    const total = all.length;
    const success = all.filter((r) => r.status === "success").length;
    const error = total - success;
    const dl = all.filter((r) => r.deadLettered).length;
    const avg = total ? Math.round(all.reduce((a, r) => a + r.durationMs, 0) / total) : 0;
    const perEnv: Record<string, { runs: number; error: number }> = {};
    for (const r of all) {
      perEnv[r.env] ??= { runs: 0, error: 0 };
      perEnv[r.env].runs++;
      if (r.status === "error") perEnv[r.env].error++;
    }
    const recentErrors = all
      .filter((r) => r.status === "error")
      .slice(-5)
      .reverse()
      .map((r) => ({ integration: r.integration, env: r.env, error: r.error, at: r.finishedAt }));
    return {
      totalRuns: total,
      success,
      error,
      successRate: total ? Math.round((success / total) * 100) : 100,
      deadLettered: dl,
      avgDurationMs: avg,
      perEnv,
      recentErrors
    };
  }
}

export const engine = scoped("engine", () => new Engine());
