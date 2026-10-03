import type { Integration } from "./types";
import { ENVIRONMENTS, sourceEnv, type EnvName } from "./environments";
import { persistence } from "../store";
import { audit } from "../audit/auditLog";
import { bus } from "../events/bus";
import { settings } from "./settings";
import { scoped } from "../tenancy/context";

// Beheert versies en deployments. Elke integratie krijgt een oplopend versienummer
// bij elke wijziging. Bewerken kan ALLEEN op DEV: opslaan maakt altijd een nieuwe versie
// op DEV. TEST/ACC/PROD krijgen een versie uitsluitend via deploy (met goedkeuring); daar
// wordt nooit iets bewerkt. Deployen mag elke bestaande versie naar elke omgeving
// (ook DEV -> PROD met overslaan van TEST en ACC, of terugzetten naar een oudere versie).

export interface DeploymentEvent { env: EnvName; version: number; from: number | null; at: string; by: string; kind: "build" | "deploy" | "rollback" }
export interface DeploymentState {
  integration: string;
  latestVersion: number;
  envs: Record<EnvName, number | null>;
  history?: DeploymentEvent[];
}
export interface VersionMeta { createdAt: string; createdBy: string; note?: string; restoredFrom?: number }

function emptyEnvs(): Record<EnvName, number | null> {
  return { dev: null, test: null, acc: null, prod: null };
}

class Deployments {
  private states = new Map<string, DeploymentState>();
  private snapshots = new Map<string, Integration>(); // key: `${name}@${version}`
  private meta = new Map<string, VersionMeta>();

  async hydrate(): Promise<void> {
    for (const { doc } of await persistence.loadAll("deployments")) {
      const s = doc as DeploymentState;
      this.states.set(s.integration, s);
    }
    for (const { id, doc } of await persistence.loadAll("versions")) {
      this.snapshots.set(id, doc as Integration);
    }
    for (const { id, doc } of await persistence.loadAll("version-meta")) this.meta.set(id, doc as VersionMeta);
  }

  private persistState(s: DeploymentState): void {
    persistence.put("deployments", s.integration, s);
  }
  private pushHistory(s: DeploymentState, e: DeploymentEvent): void {
    s.history = [...(s.history ?? []), e].slice(-200);
  }

  // Nieuwe versie vastleggen (op DEV). Aangeroepen wanneer een integratie wordt
  // aangemaakt, gewijzigd of een oude versie wordt teruggezet.
  recordNewVersion(def: Integration, extra: { note?: string; restoredFrom?: number } = {}): DeploymentState {
    let s = this.states.get(def.integration);
    if (!s) {
      s = { integration: def.integration, latestVersion: 0, envs: emptyEnvs() };
      this.states.set(def.integration, s);
    }
    s.latestVersion += 1;
    const version = s.latestVersion;
    const snapshot: Integration = { ...def, version: String(version) };
    this.snapshots.set(`${def.integration}@${version}`, snapshot);
    persistence.put("versions", `${def.integration}@${version}`, snapshot);
    const prevDev = s.envs.dev;
    s.envs.dev = version; // op DEV meteen actief
    const by = def.owner ?? "builder-agent";
    const m: VersionMeta = { createdAt: new Date().toISOString(), createdBy: by, ...extra };
    this.meta.set(`${def.integration}@${version}`, m);
    persistence.put("version-meta", `${def.integration}@${version}`, m);
    this.pushHistory(s, { env: "dev", version, from: prevDev, at: m.createdAt, by, kind: "build" });
    this.persistState(s);
    audit.append({ actor: by, event: "version.created", subject: def.integration, data: { version, ...extra } });
    bus.publish("version.created", { integration: def.integration, version });
    this.prune(def.integration, settings.get().versionRetention);
    return s;
  }

  // ---------- opruimen ----------
  // Versies van een proces (oplopend) die bestaan.
  private existing(name: string): number[] {
    const s = this.states.get(name);
    const out: number[] = [];
    const max = s?.latestVersion ?? 0;
    for (let v = 1; v <= max; v++) if (this.snapshots.has(`${name}@${v}`)) out.push(v);
    return out;
  }
  // Versies die weg mogen als er `keep` bewaard blijven: nooit de nieuwste `keep`,
  // nooit een versie die op een omgeving actief is, nooit een versie in `protect`.
  removable(name: string, keep: number, protect: Set<number> = new Set()): number[] {
    const s = this.states.get(name);
    if (!s) return [];
    const all = this.existing(name);
    const newest = new Set(all.slice(-Math.max(1, keep)));
    const active = new Set(Object.values(s.envs).filter((v): v is number => v != null));
    return all.filter((v) => !newest.has(v) && !active.has(v) && !protect.has(v));
  }
  private dropVersion(name: string, v: number): void {
    const key = `${name}@${v}`;
    this.snapshots.delete(key);
    this.meta.delete(key);
    persistence.delete("versions", key);
    persistence.delete("version-meta", key);
  }
  prune(name: string, keep: number, protect?: Set<number>, by = "system"): number[] {
    const gone = this.removable(name, keep, protect);
    for (const v of gone) this.dropVersion(name, v);
    if (gone.length) audit.append({ actor: by, event: "versions.pruned", subject: name, data: { removed: gone, keep } });
    return gone;
  }
  // Voor alle processen; `keep` standaard de instelling.
  pruneAll(keep: number, protectOf: (name: string) => Set<number> = () => new Set(), by = "system"): { processes: number; removed: number; details: Array<{ integration: string; removed: number[] }> } {
    const details: Array<{ integration: string; removed: number[] }> = [];
    for (const name of this.states.keys()) {
      const removed = this.prune(name, keep, protectOf(name), by);
      if (removed.length) details.push({ integration: name, removed });
    }
    if (details.length) bus.publish("versions.pruned", { processes: details.length });
    return { processes: details.length, removed: details.reduce((n, d) => n + d.removed.length, 0), details };
  }
  versionStats(keep: number, protectOf: (name: string) => Set<number> = () => new Set()): { processes: number; versions: number; removableAtRetention: number; removableCleanup: number } {
    let versions = 0, atRet = 0, cleanup = 0;
    for (const name of this.states.keys()) {
      versions += this.existing(name).length;
      atRet += this.removable(name, keep, protectOf(name)).length;
      cleanup += this.removable(name, 1, protectOf(name)).length;
    }
    return { processes: this.states.size, versions, removableAtRetention: atRet, removableCleanup: cleanup };
  }

  // Standaardversie voor een deploy naar `toEnv`: de versie op de vorige omgeving, of
  // (als die leeg is) de nieuwste versie op DEV.
  defaultVersion(name: string, toEnv: EnvName): number | null {
    const s = this.states.get(name);
    if (!s) return null;
    const from = sourceEnv(toEnv);
    return (from ? s.envs[from] : null) ?? s.envs.dev ?? s.latestVersion ?? null;
  }

  // Deploy een bestaande versie naar een omgeving (TEST/ACC/PROD). Overslaan (DEV -> PROD)
  // en terugzetten naar een oudere versie mogen; DEV wordt alleen gevuld door te bouwen.
  deploy(name: string, toEnv: EnvName, version?: number, by = "system"): { integration: string; env: EnvName; version: number; from: number | null; kind: "deploy" | "rollback"; skipped: EnvName[] } {
    const s = this.states.get(name);
    if (!s) throw new Error(`Onbekende integratie: ${name}`);
    if (toEnv === "dev") throw new Error("DEV wordt gevuld door te bouwen, niet door deployen. Zet een oude versie terug op DEV via Versies → Terugzetten op DEV.");
    const v = version ?? this.defaultVersion(name, toEnv);
    if (v == null) throw new Error(`Er is nog geen versie van ${name} om te deployen.`);
    if (!this.snapshots.has(`${name}@${v}`)) throw new Error(`Versie ${v} van ${name} bestaat niet.`);
    const from = s.envs[toEnv];
    const kind: "deploy" | "rollback" = from != null && v < from ? "rollback" : "deploy";
    const skipped = this.skippedEnvs(name, toEnv, v);
    s.envs[toEnv] = v;
    this.pushHistory(s, { env: toEnv, version: v, from, at: new Date().toISOString(), by, kind });
    this.persistState(s);
    audit.append({ actor: by, event: kind === "rollback" ? "deployment.rolled_back" : "deployment.promoted", subject: name, data: { env: toEnv, version: v, from, skipped } });
    bus.publish("deployment.promoted", { integration: name, env: toEnv, version: v, from, kind });
    return { integration: name, env: toEnv, version: v, from, kind, skipped };
  }

  // Oud gedrag (promotie van de vorige omgeving) blijft beschikbaar.
  promote(name: string, toEnv: EnvName): { integration: string; env: EnvName; version: number } {
    const r = this.deploy(name, toEnv);
    return { integration: r.integration, env: r.env, version: r.version };
  }

  // Omgevingen tussen DEV en `toEnv` waar deze versie nooit gedraaid heeft (overgeslagen).
  skippedEnvs(name: string, toEnv: EnvName, version: number): EnvName[] {
    const s = this.states.get(name);
    if (!s) return [];
    const ran = new Set<EnvName>((s.history ?? []).filter((h) => h.version === version).map((h) => h.env));
    for (const e of ENVIRONMENTS) if (s.envs[e] === version) ran.add(e);
    return ENVIRONMENTS.filter((e) => e !== "dev" && ENVIRONMENTS.indexOf(e) < ENVIRONMENTS.indexOf(toEnv) && !ran.has(e));
  }

  // Alle versies met metadata en waar ze nu actief zijn (nieuwste eerst).
  listVersions(name: string): Array<{ version: number; createdAt?: string; createdBy?: string; note?: string; restoredFrom?: number; activeOn: EnvName[]; steps: number; trigger?: string }> {
    const s = this.states.get(name);
    if (!s) return [];
    const out = [];
    for (let v = s.latestVersion; v >= 1; v--) {
      const def = this.snapshots.get(`${name}@${v}`);
      if (!def) continue;
      const m = this.meta.get(`${name}@${v}`);
      out.push({ version: v, createdAt: m?.createdAt, createdBy: m?.createdBy ?? def.owner, note: m?.note, restoredFrom: m?.restoredFrom, activeOn: ENVIRONMENTS.filter((e) => s.envs[e] === v), steps: (def.steps || []).filter((x) => x.type !== "end").length, trigger: def.trigger?.type });
    }
    return out;
  }

  // Proces van alle omgevingen halen (verwijderen). Versies blijven bewaard voor de historie.
  remove(name: string): void {
    this.states.delete(name);
    persistence.delete("deployments", name);
  }

  // Agent: een definitie (met versie) als actief op een omgeving installeren, zonder historie.
  install(def: Integration, env: EnvName): void {
    const version = Number(def.version) || 1;
    this.snapshots.set(`${def.integration}@${version}`, def);
    const s = this.states.get(def.integration) ?? { integration: def.integration, latestVersion: version, envs: emptyEnvs() };
    s.envs[env] = version;
    s.latestVersion = Math.max(s.latestVersion, version);
    this.states.set(def.integration, s);
  }

  getState(name: string): DeploymentState | undefined {
    return this.states.get(name);
  }
  listStates(): DeploymentState[] {
    return [...this.states.values()];
  }
  getActiveVersion(name: string, env: EnvName): number | null {
    return this.states.get(name)?.envs[env] ?? null;
  }
  getDefinition(name: string, version: number): Integration | undefined {
    return this.snapshots.get(`${name}@${version}`);
  }
  getActiveDefinition(name: string, env: EnvName): Integration | undefined {
    const v = this.getActiveVersion(name, env);
    return v == null ? undefined : this.getDefinition(name, v);
  }
  // Snelle knoppen in de GUI: omgevingen waar de versie van de vorige omgeving nog niet staat.
  // (Deployen met overslaan of terugzetten kan altijd via deploy() met een versie.)
  promotableEnvs(name: string): EnvName[] {
    const s = this.states.get(name);
    if (!s) return [];
    const out: EnvName[] = [];
    for (const env of ENVIRONMENTS) {
      if (env === "dev") continue;
      const from = sourceEnv(env)!;
      if (s.envs[from] != null && s.envs[from] !== s.envs[env]) out.push(env);
    }
    return out;
  }
}

export const deployments = scoped("deployments", () => new Deployments());
