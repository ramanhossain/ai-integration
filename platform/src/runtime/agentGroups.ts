import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { ENVIRONMENTS, isEnv, type EnvName } from "../domain/environments";
import { persistence } from "../store";
import { audit } from "../audit/auditLog";
import { bus } from "../events/bus";
import type { Integration } from "../domain/types";
import { deployments } from "../domain/deployments";

// Omgevingsvarianten (agentgroepen): een omgeving (DEV/TEST/ACC/PROD)
// bevat één of meer agentgroepen. Elke omgeving heeft een ingebouwde groep "Platform"
// (processen draaien in het portaal zelf). Daarnaast kun je groepen maken voor
// bijvoorbeeld AWS of Azure; daar draait een agent die verbinding maakt met het portaal,
// jobs ophaalt, ze met dezelfde engine uitvoert en het resultaat terugmeldt.

export const PROVIDERS = ["platform", "aws", "azure", "gcp", "kubernetes", "onprem", "other"] as const;
export type Provider = (typeof PROVIDERS)[number];

export interface AgentGroup {
  id: string; // bv. "prod-aws-eu"
  env: EnvName;
  name: string;
  provider: Provider;
  region?: string;
  description?: string;
  builtin: boolean;
  keyHash?: string; // sha256 van de verbindingssleutel (nooit de sleutel zelf)
  keyHint?: string; // laatste 4 tekens, ter herkenning
  createdAt: string;
  createdBy?: string;
}
export interface AgentInfo {
  id: string;
  group: string;
  name: string;
  host?: string;
  os?: string;
  version?: string;
  runtime?: string;
  cloud?: Record<string, string>;
  ip?: string;
  firstSeen: string;
  lastSeen: string;
  running: number;
  jobsDone: number;
  jobsFailed: number;
}
export type TargetMode = "failover" | "all";
export interface Targets { groups: string[]; mode: TargetMode }

export interface Job {
  id: string;
  group: string;
  env: EnvName;
  definition: Integration;
  subprocesses: Integration[];
  credentials: Record<string, { type: string; values: Record<string, string> }>;
  input: Record<string, unknown>;
  triggeredBy?: string;
  createdAt: string;
  state: "queued" | "running" | "done" | "expired";
  agent?: string;
  startedAt?: string;
}

export const ONLINE_MS = 45_000;
const JOB_TIMEOUT_MS = Number(process.env.AIP_AGENT_JOB_TIMEOUT_MS || 120_000);
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const builtinId = (env: EnvName) => `${env}-platform`;

class AgentGroups {
  private groups = new Map<string, AgentGroup>();
  private agents = new Map<string, AgentInfo>();
  private targets = new Map<string, Targets>(); // `${integration}:${env}`
  private jobs = new Map<string, Job>();
  private queues = new Map<string, string[]>(); // group -> job ids
  private waiters = new Map<string, Array<(job: Job | null) => void>>(); // long-poll per groep
  private results = new Map<string, { resolve: (r: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();

  async hydrate(): Promise<void> {
    for (const { doc } of await persistence.loadAll("agentgroups")) { const g = doc as AgentGroup; this.groups.set(g.id, g); }
    for (const { id, doc } of await persistence.loadAll("targets")) this.targets.set(id, doc as Targets);
    for (const env of ENVIRONMENTS) {
      if (!this.groups.has(builtinId(env))) {
        const g: AgentGroup = { id: builtinId(env), env, name: "Platform (ingebouwd)", provider: "platform", builtin: true, description: "Processen draaien in het portaal zelf.", createdAt: new Date().toISOString() };
        this.groups.set(g.id, g);
        persistence.put("agentgroups", g.id, g);
      }
    }
  }

  // ------------------------------------------------------------ groepen
  list(env?: EnvName): Array<AgentGroup & { online: number; agents: AgentInfo[]; queued: number }> {
    return [...this.groups.values()]
      .filter((g) => !env || g.env === env)
      .sort((a, b) => ENVIRONMENTS.indexOf(a.env) - ENVIRONMENTS.indexOf(b.env) || Number(b.builtin) - Number(a.builtin) || a.name.localeCompare(b.name))
      .map((g) => this.view(g));
  }
  get(id: string) { const g = this.groups.get(id); return g ? this.view(g) : undefined; }
  private view(g: AgentGroup) {
    const agents = [...this.agents.values()].filter((a) => a.group === g.id).sort((a, b) => b.lastSeen.localeCompare(a.lastSeen));
    const { keyHash: _k, ...rest } = g;
    return { ...rest, hasKey: Boolean(g.keyHash), agents, online: g.builtin ? 1 : agents.filter((a) => this.isOnline(a)).length, queued: (this.queues.get(g.id) || []).length } as AgentGroup & { online: number; agents: AgentInfo[]; queued: number; hasKey: boolean };
  }
  isOnline(a: AgentInfo) { return Date.now() - Date.parse(a.lastSeen) < ONLINE_MS; }
  healthy(groupId: string): boolean {
    const g = this.groups.get(groupId);
    if (!g) return false;
    return g.builtin || [...this.agents.values()].some((a) => a.group === groupId && this.isOnline(a));
  }

  create(input: { env: string; name: string; provider?: string; region?: string; description?: string; id?: string }, by?: string): { group: AgentGroup; key: string } {
    if (!isEnv(input.env)) throw new Error("Onbekende omgeving");
    const provider = (PROVIDERS as readonly string[]).includes(String(input.provider)) && input.provider !== "platform" ? (input.provider as Provider) : "other";
    const slug = (input.id || `${input.env}-${input.name}`).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
    if (!slug) throw new Error("Geef de groep een naam");
    if (this.groups.has(slug)) throw new Error(`Er bestaat al een agentgroep ${slug}`);
    const key = `aipk_${randomBytes(24).toString("base64url")}`;
    const g: AgentGroup = { id: slug, env: input.env, name: input.name.trim().slice(0, 80), provider, region: input.region?.trim() || undefined, description: input.description?.trim() || undefined, builtin: false, keyHash: hash(key), keyHint: key.slice(-4), createdAt: new Date().toISOString(), createdBy: by };
    this.groups.set(g.id, g);
    persistence.put("agentgroups", g.id, g);
    audit.append({ actor: by ?? "system", event: "agentgroup.created", subject: g.id, data: { env: g.env, provider: g.provider } });
    bus.publish("agentgroup.changed", { id: g.id });
    return { group: g, key };
  }
  update(id: string, patch: { name?: string; region?: string; description?: string; provider?: string }, by?: string) {
    const g = this.groups.get(id);
    if (!g) throw new Error("Agentgroep niet gevonden");
    if (g.builtin && patch.provider) throw new Error("De ingebouwde groep kan niet van type veranderen");
    if (patch.name) g.name = patch.name.trim().slice(0, 80);
    if (patch.region !== undefined) g.region = patch.region.trim() || undefined;
    if (patch.description !== undefined) g.description = patch.description.trim() || undefined;
    if (patch.provider && (PROVIDERS as readonly string[]).includes(patch.provider) && patch.provider !== "platform") g.provider = patch.provider as Provider;
    persistence.put("agentgroups", g.id, g);
    audit.append({ actor: by ?? "system", event: "agentgroup.updated", subject: g.id });
    return this.view(g);
  }
  rotateKey(id: string, by?: string): string {
    const g = this.groups.get(id);
    if (!g || g.builtin) throw new Error("Deze groep heeft geen verbindingssleutel");
    const key = `aipk_${randomBytes(24).toString("base64url")}`;
    g.keyHash = hash(key);
    g.keyHint = key.slice(-4);
    persistence.put("agentgroups", g.id, g);
    for (const a of [...this.agents.values()]) if (a.group === id) this.agents.delete(a.id); // oude agents moeten opnieuw verbinden
    audit.append({ actor: by ?? "system", event: "agentgroup.key_rotated", subject: g.id });
    return key;
  }
  remove(id: string, by?: string) {
    const g = this.groups.get(id);
    if (!g) throw new Error("Agentgroep niet gevonden");
    if (g.builtin) throw new Error("De ingebouwde groep kan niet verwijderd worden");
    const using = [...this.targets.entries()].filter(([, t]) => t.groups.includes(id)).map(([k]) => k.split(":")[0]);
    if (using.length) throw new Error(`Nog in gebruik door: ${using.join(", ")}. Haal de groep eerst uit de deploydoelen.`);
    this.groups.delete(id);
    persistence.delete("agentgroups", id);
    for (const a of [...this.agents.values()]) if (a.group === id) this.agents.delete(a.id);
    audit.append({ actor: by ?? "system", event: "agentgroup.deleted", subject: id });
    bus.publish("agentgroup.changed", { id });
  }

  // Sleutel -> groep (voor de agent-API)
  authenticate(key: string | undefined): AgentGroup | undefined {
    if (!key) return undefined;
    const h = Buffer.from(hash(key));
    for (const g of this.groups.values()) {
      if (g.keyHash && g.keyHash.length === h.length && timingSafeEqual(Buffer.from(g.keyHash), h)) return g;
    }
    return undefined;
  }

  // ------------------------------------------------------------ agents
  heartbeat(group: AgentGroup, info: Partial<AgentInfo> & { id: string }, ip?: string): AgentInfo {
    const id = `${group.id}/${String(info.id).slice(0, 80)}`;
    const now = new Date().toISOString();
    const prev = this.agents.get(id);
    const a: AgentInfo = {
      id, group: group.id, name: String(info.name || prev?.name || info.host || info.id).slice(0, 80), host: info.host ?? prev?.host, os: info.os ?? prev?.os, version: info.version ?? prev?.version, runtime: info.runtime ?? prev?.runtime,
      cloud: info.cloud ?? prev?.cloud, ip, firstSeen: prev?.firstSeen ?? now, lastSeen: now, running: info.running !== undefined ? Number(info.running) || 0 : prev?.running ?? 0, jobsDone: prev?.jobsDone ?? 0, jobsFailed: prev?.jobsFailed ?? 0
    };
    this.agents.set(id, a);
    if (!prev) {
      audit.append({ actor: `agent:${a.name}`, event: "agent.connected", subject: group.id, data: { host: a.host, os: a.os, version: a.version } });
      bus.publish("agent.connected", { group: group.id, agent: a.name });
    }
    return a;
  }

  // ------------------------------------------------------------ deploydoelen
  getTargets(integration: string, env: EnvName): Targets {
    const t = this.targets.get(`${integration}:${env}`);
    const valid = (t?.groups || []).filter((g) => this.groups.get(g)?.env === env);
    return valid.length ? { groups: valid, mode: t!.mode || "failover" } : { groups: [builtinId(env)], mode: "failover" };
  }
  setTargets(integration: string, env: EnvName, t: Targets, by?: string): Targets {
    const groups = [...new Set(t.groups)].filter((g) => this.groups.get(g)?.env === env);
    if (!groups.length) throw new Error(`Kies minstens één agentgroep op ${env.toUpperCase()}`);
    const val: Targets = { groups, mode: t.mode === "all" ? "all" : "failover" };
    this.targets.set(`${integration}:${env}`, val);
    persistence.put("targets", `${integration}:${env}`, val);
    audit.append({ actor: by ?? "system", event: "deployment.targets", subject: integration, data: { env, ...val } });
    bus.publish("deployment.targets", { integration, env, ...val });
    return val;
  }
  validateTargets(env: EnvName, groups: string[]): string | null {
    for (const g of groups) { const x = this.groups.get(g); if (!x) return `Onbekende agentgroep ${g}`; if (x.env !== env) return `${g} hoort bij ${x.env.toUpperCase()}, niet bij ${env.toUpperCase()}`; }
    return groups.length ? null : "Kies minstens één agentgroep";
  }
  // Processen die op deze groep draaien: gedeployed op de omgeving én de groep in de (standaard)doelen.
  processesOn(groupId: string): string[] {
    const g = this.groups.get(groupId);
    if (!g) return [];
    return deployments.listStates().filter((s) => s.envs[g.env] != null && this.getTargets(s.integration, g.env).groups.includes(groupId)).map((s) => s.integration).sort();
  }
  isBuiltin(groupId: string) { return Boolean(this.groups.get(groupId)?.builtin); }

  // ------------------------------------------------------------ jobs (portaal -> agent)
  // Plaatst een job en wacht op het resultaat van een agent (of time-out).
  enqueue<T>(job: Omit<Job, "id" | "createdAt" | "state">): { job: Job; result: Promise<T> } {
    const j: Job = { ...job, id: randomUUID(), createdAt: new Date().toISOString(), state: "queued" };
    this.jobs.set(j.id, j);
    const result = new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (j.state === "done") return;
        j.state = "expired";
        this.queues.set(j.group, (this.queues.get(j.group) || []).filter((x) => x !== j.id));
        this.results.delete(j.id);
        this.jobs.delete(j.id);
        reject(new Error(`Geen resultaat van agentgroep ${j.group} binnen ${Math.round(JOB_TIMEOUT_MS / 1000)} s`));
      }, JOB_TIMEOUT_MS);
      this.results.set(j.id, { resolve: resolve as (r: unknown) => void, reject, timer });
    });
    const w = this.waiters.get(j.group);
    if (w && w.length) { this.claim(j, undefined); w.shift()!(j); }
    else this.queues.set(j.group, [...(this.queues.get(j.group) || []), j.id]);
    return { job: j, result };
  }
  private claim(j: Job, agent?: string) { j.state = "running"; j.agent = agent; j.startedAt = new Date().toISOString(); }

  // Long-poll door een agent: direct een job, of wachten tot er een komt.
  async next(group: AgentGroup, agentId: string, waitMs: number): Promise<Job | null> {
    const q = this.queues.get(group.id) || [];
    while (q.length) {
      const j = this.jobs.get(q.shift()!);
      this.queues.set(group.id, q);
      if (j && j.state === "queued") { this.claim(j, agentId); return j; }
    }
    if (waitMs <= 0) return null;
    return new Promise((resolve) => {
      const list = this.waiters.get(group.id) || [];
      const fn = (job: Job | null) => { clearTimeout(t); if (job) job.agent = agentId; resolve(job); };
      const t = setTimeout(() => { this.waiters.set(group.id, (this.waiters.get(group.id) || []).filter((x) => x !== fn)); resolve(null); }, waitMs);
      list.push(fn);
      this.waiters.set(group.id, list);
    });
  }
  // Agent verbrak de verbinding net toen hij een job kreeg: opnieuw aanbieden.
  requeue(jobId: string): void {
    const j = this.jobs.get(jobId);
    if (!j || j.state !== "running") return;
    j.state = "queued";
    j.agent = undefined;
    const w = this.waiters.get(j.group);
    if (w && w.length) { this.claim(j, undefined); w.shift()!(j); }
    else this.queues.set(j.group, [j.id, ...(this.queues.get(j.group) || [])]);
  }
  complete(group: AgentGroup, jobId: string, agentId: string, result: unknown, failed: boolean): boolean {
    const j = this.jobs.get(jobId);
    if (!j || j.group !== group.id) return false;
    j.state = "done";
    const a = this.agents.get(`${group.id}/${agentId}`);
    if (a) { if (failed) a.jobsFailed++; else a.jobsDone++; }
    const r = this.results.get(jobId);
    this.jobs.delete(jobId);
    if (r) { clearTimeout(r.timer); this.results.delete(jobId); r.resolve(result); }
    return true;
  }
  jobEnv(group: AgentGroup, jobId: string): EnvName | undefined {
    const j = this.jobs.get(jobId);
    return j && j.group === group.id ? j.env : undefined;
  }
}

export const agentGroups = new AgentGroups();
export const BUILTIN = builtinId;
