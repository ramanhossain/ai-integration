import { persistence } from "../store";
import { audit } from "../audit/auditLog";
import { bus } from "../events/bus";
import { scoped } from "../tenancy/context";

// Platforminstellingen (persistent). Wijzigingen komen in het audit log.

export interface Settings {
  // Vier-ogenprincipe: de indiener mag niet zelf goedkeuren en RED-acties (o.a. PROD)
  // vereisen twee verschillende goedkeurders. Uit = één goedkeuring volstaat.
  fourEyes: boolean;
  // Aantal versies dat per proces bewaard blijft (1–100). Oudere versies worden
  // opgeruimd, behalve versies die op een omgeving draaien.
  versionRetention: number;
}

export const MAX_VERSION_RETENTION = 100;
const DEFAULTS: Settings = { fourEyes: true, versionRetention: 50 };

class SettingsStore {
  private current: Settings = { ...DEFAULTS };
  private listeners: Array<(s: Settings) => void> = [];

  async hydrate(): Promise<void> {
    const rows = await persistence.loadAll("settings");
    const saved = rows.find((r) => r.id === "platform")?.doc as Partial<Settings> | undefined;
    if (saved) this.current = { ...DEFAULTS, ...saved };
  }

  get(): Settings {
    return { ...this.current };
  }

  get fourEyes(): boolean {
    return this.current.fourEyes;
  }

  update(patch: Partial<Settings>, actor: string): Settings {
    const before = this.get();
    const next: Settings = { ...this.current };
    if (typeof patch.fourEyes === "boolean") next.fourEyes = patch.fourEyes;
    if (patch.versionRetention !== undefined) {
      const n = Math.round(Number(patch.versionRetention));
      if (!Number.isFinite(n) || n < 1 || n > MAX_VERSION_RETENTION) throw new Error(`Aantal versies moet tussen 1 en ${MAX_VERSION_RETENTION} liggen`);
      next.versionRetention = n;
    }
    this.current = next;
    persistence.put("settings", "platform", next);
    const changed = Object.keys(next).filter((k) => (before as any)[k] !== (next as any)[k]);
    if (changed.length) {
      audit.append({ actor, event: "settings.updated", subject: "platform", data: { changed, before, after: next } });
      bus.publish("settings.updated", { changed, settings: next });
      for (const l of this.listeners) l(next);
    }
    return this.get();
  }

  onChange(listener: (s: Settings) => void): void {
    this.listeners.push(listener);
  }
}

export const settings = scoped("settings", () => new SettingsStore());
