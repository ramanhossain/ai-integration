import type { PersistenceDriver } from "./driver";
import { MemoryDriver } from "./memory";
import { PostgresDriver } from "./postgres";
import { FileDriver } from "./file";
import { join } from "node:path";

// Kiest de driver op basis van DATABASE_URL. Write-through is fire-and-forget met
// foutlogging, zodat de (synchrone) engine-reads eenvoudig blijven; reads komen uit
// de in-memory status die bij startup is gehydrateerd.

// Standaard: bestanden in ./data/store (blijft bewaard na een herstart).
// DATABASE_URL -> Postgres. AIP_STORAGE=memory -> alleen in het geheugen (tests, agents).
function selectDriver(): PersistenceDriver {
  const url = process.env.DATABASE_URL;
  if (url) return new PostgresDriver(url);
  if (process.env.AIP_STORAGE === "memory") return new MemoryDriver();
  return new FileDriver(process.env.AIP_DATA_DIR || join(__dirname, "..", "..", "data", "store"));
}

class Persistence {
  readonly driver: PersistenceDriver = selectDriver();
  private ready = false;

  async init(): Promise<void> {
    await this.driver.init();
    this.ready = true;
  }

  get kind(): string {
    return this.driver.kind;
  }

  async loadAll(collection: string): Promise<Array<{ id: string; doc: unknown }>> {
    if (!this.ready) return [];
    return this.driver.loadAll(collection);
  }

  // Fire-and-forget schrijven; fouten worden gelogd maar blokkeren de engine niet.
  put(collection: string, id: string, doc: unknown): void {
    if (!this.ready) return;
    this.driver.put(collection, id, doc).catch((err) => {
      // eslint-disable-next-line no-console
      console.error(`[persistence] put ${collection}/${id} faalde:`, (err as Error).message);
    });
  }

  // Fire-and-forget verwijderen.
  delete(collection: string, id: string): void {
    if (!this.ready) return;
    this.driver.delete(collection, id).catch((err) => {
      // eslint-disable-next-line no-console
      console.error(`[persistence] delete ${collection}/${id} faalde:`, (err as Error).message);
    });
  }

  async close(): Promise<void> {
    await this.driver.close();
  }
}

export const persistence = new Persistence();
