import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync, readdirSync, openSync, closeSync, fsyncSync } from "node:fs";
import { join } from "node:path";
import type { PersistenceDriver } from "./driver";

// Bestandsopslag: de standaard zonder DATABASE_URL. Per collectie één JSON-bestand in
// de datamap (AIP_DATA_DIR, standaard ./data/store). Alles blijft bewaard na een herstart
// van de server. Schrijven gebeurt gebundeld (kort uitgesteld) en atomair (tijdelijk
// bestand + hernoemen), en bij afsluiten wordt alles direct weggeschreven.

export class FileDriver implements PersistenceDriver {
  readonly kind = "file";
  private data = new Map<string, Map<string, unknown>>();
  private dirty = new Set<string>();
  private timer: NodeJS.Timeout | null = null;

  constructor(private dir: string) {}

  async init(): Promise<void> {
    mkdirSync(this.dir, { recursive: true });
    for (const f of readdirSync(this.dir).filter((x) => x.endsWith(".json"))) {
      const name = decodeURIComponent(f.slice(0, -5));
      try {
        const obj = JSON.parse(readFileSync(join(this.dir, f), "utf8")) as Record<string, unknown>;
        this.data.set(name, new Map(Object.entries(obj)));
      } catch (err) {
        if (["ebms-messages", "as4-messages"].some(c => name === c || name.endsWith(`~${c}`))) throw new Error(`Duurzame berichtenopslag ${f} is beschadigd; herstel vereist vóór starten`);
        // Beschadigd bestand: niet overschrijven, wel melden.
        // eslint-disable-next-line no-console
        console.error(`[persistence] ${f} kon niet gelezen worden:`, (err as Error).message);
        renameSync(join(this.dir, f), join(this.dir, `${f}.kapot-${Date.now()}`));
      }
    }
    const flushNow = () => this.flush();
    process.once("exit", flushNow);
    for (const sig of ["SIGINT", "SIGTERM"] as const) process.once(sig, () => { flushNow(); process.exit(0); });
  }

  private col(name: string): Map<string, unknown> {
    let c = this.data.get(name);
    if (!c) { c = new Map(); this.data.set(name, c); }
    return c;
  }

  async loadAll(collection: string): Promise<Array<{ id: string; doc: unknown }>> {
    return [...this.col(collection).entries()].map(([id, doc]) => ({ id, doc }));
  }

  async put(collection: string, id: string, doc: unknown): Promise<void> {
    this.col(collection).set(id, JSON.parse(JSON.stringify(doc)));
    this.touch(collection);
  }

  async delete(collection: string, id: string): Promise<void> {
    if (this.col(collection).delete(id)) this.touch(collection);
  }

  // File storage supports one control-plane writer. Postgres supports competing writers.
  async create(collection: string, id: string, doc: unknown): Promise<boolean> {
    if (this.col(collection).has(id)) return false;
    this.col(collection).set(id, JSON.parse(JSON.stringify(doc)));
    this.dirty.add(collection);
    try { this.flush(); } catch (e) { this.col(collection).delete(id); throw e; }
    return true;
  }

  async replace(collection: string, id: string, expected: unknown, doc: unknown): Promise<boolean> {
    if (JSON.stringify(this.col(collection).get(id)) !== JSON.stringify(expected)) return false;
    this.col(collection).set(id, JSON.parse(JSON.stringify(doc)));
    this.dirty.add(collection);
    try { this.flush(); } catch (e) { this.col(collection).set(id, expected); throw e; }
    return true;
  }

  private touch(collection: string): void {
    this.dirty.add(collection);
    if (!this.timer) this.timer = setTimeout(() => this.flush(), 150);
  }

  flush(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    for (const name of this.dirty) {
      const file = join(this.dir, `${encodeURIComponent(name)}.json`);
      const tmp = `${file}.tmp`;
      writeFileSync(tmp, JSON.stringify(Object.fromEntries(this.col(name))));
      const fd = openSync(tmp, "r");
      try { fsyncSync(fd); } finally { closeSync(fd); }
      renameSync(tmp, file);
    }
    if (this.dirty.size) {
      const dirFd = openSync(this.dir, "r");
      try { fsyncSync(dirFd); } finally { closeSync(dirFd); }
    }
    this.dirty.clear();
  }

  async close(): Promise<void> {
    this.flush();
  }

  static exists(dir: string): boolean {
    return existsSync(dir);
  }
}
