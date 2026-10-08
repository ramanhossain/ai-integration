import { persistence } from "../store";
import { audit } from "../audit/auditLog";
import { scoped } from "../tenancy/context";
import { credentials } from "../connectors/credentials";
import { registry } from "./registry";

// Werkruimte van een organisatie: welke plugins actief zijn (zichtbaar in de proceseditor)
// en concepten (drafts) van nieuwe processen die nog niet zijn opgeslagen.

// ---------------------------------------------------------------- plugins activeren
class PluginActivation {
  // null = nog nooit ingesteld: dan gelden de plugins die al in gebruik zijn (koppeling of processtap).
  private active: Set<string> | null = null;

  async hydrate(): Promise<void> {
    const row = (await persistence.loadAll("plugin-activation")).find((r) => r.id === "active");
    const ids = (row?.doc as { ids?: string[] } | undefined)?.ids;
    this.active = Array.isArray(ids) ? new Set(ids) : null;
  }

  private inUse(): Set<string> {
    const s = new Set<string>();
    for (const c of credentials.list()) if (c.type === "plugin" && c.plugin) s.add(c.plugin);
    for (const i of registry.listIntegrations()) for (const st of i.steps || []) {
      const p = (st.config as { plugin?: unknown } | undefined)?.plugin;
      if (st.type === "connector" && typeof p === "string" && p) s.add(p);
    }
    return s;
  }

  list(): string[] {
    return [...(this.active ?? this.inUse())].sort();
  }

  isActive(id: string): boolean {
    return (this.active ?? this.inUse()).has(id);
  }

  set(id: string, on: boolean, actor: string): string[] {
    const next = new Set(this.active ?? this.inUse());
    if (on) next.add(id); else next.delete(id);
    this.active = next;
    persistence.put("plugin-activation", "active", { ids: [...next].sort() });
    audit.append({ actor, event: on ? "plugin.activated" : "plugin.deactivated", subject: id });
    return this.list();
  }
}
export const pluginActivation = scoped("plugin-activation", () => new PluginActivation());

// ---------------------------------------------------------------- concepten
export interface Draft { id: string; name: string; def: Record<string, unknown>; steps: number; createdAt: string; updatedAt: string; by: string }
const MAX_DRAFT_BYTES = 2 * 1024 * 1024;

class Drafts {
  private items = new Map<string, Draft>();

  async hydrate(): Promise<void> {
    this.items.clear();
    for (const r of await persistence.loadAll("drafts")) this.items.set(r.id, r.doc as Draft);
  }

  list(): Array<Omit<Draft, "def">> {
    return [...this.items.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(({ def: _d, ...rest }) => rest);
  }

  get(id: string): Draft | undefined { return this.items.get(id); }

  save(id: string, def: Record<string, unknown>, by: string): Draft {
    if (!/^[a-z0-9]{8,40}$/.test(id)) throw new Error("Ongeldige concept-id");
    if (!def || typeof def !== "object" || Array.isArray(def)) throw new Error("Concept moet een procesdefinitie zijn");
    if (JSON.stringify(def).length > MAX_DRAFT_BYTES) throw new Error("Concept is te groot (max. 2 MB)");
    if (!this.items.has(id) && this.items.size >= 500) throw new Error("Te veel concepten; verwijder er eerst een paar");
    const prev = this.items.get(id);
    const now = new Date().toISOString();
    const d: Draft = {
      id, def,
      name: String(def.integration || "Naamloos").slice(0, 80),
      steps: Array.isArray(def.steps) ? def.steps.length : 0,
      createdAt: prev?.createdAt ?? now, updatedAt: now, by: (prev?.by ?? by).slice(0, 80)
    };
    this.items.set(id, d);
    persistence.put("drafts", id, d);
    return d;
  }

  delete(id: string): boolean {
    const had = this.items.delete(id);
    if (had) persistence.delete("drafts", id);
    return had;
  }
}
export const drafts = scoped("drafts", () => new Drafts());
