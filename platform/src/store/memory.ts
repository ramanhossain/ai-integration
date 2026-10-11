import type { PersistenceDriver } from "./driver";

// In-memory driver. Standaard wanneer geen DATABASE_URL is gezet. Data leeft zolang
// het proces draait; genoeg om de core zonder database te draaien en te testen.

export class MemoryDriver implements PersistenceDriver {
  readonly kind = "memory";
  private data = new Map<string, Map<string, unknown>>();

  async init(): Promise<void> {}

  private col(name: string): Map<string, unknown> {
    let c = this.data.get(name);
    if (!c) {
      c = new Map();
      this.data.set(name, c);
    }
    return c;
  }

  async loadAll(collection: string): Promise<Array<{ id: string; doc: unknown }>> {
    return [...this.col(collection).entries()].map(([id, doc]) => ({ id, doc }));
  }

  async put(collection: string, id: string, doc: unknown): Promise<void> {
    this.col(collection).set(id, doc);
  }

  async delete(collection: string, id: string): Promise<void> {
    this.col(collection).delete(id);
  }

  async create(collection: string, id: string, doc: unknown): Promise<boolean> {
    if (this.col(collection).has(id)) return false;
    this.col(collection).set(id, structuredClone(doc));
    return true;
  }

  async replace(collection: string, id: string, expected: unknown, doc: unknown): Promise<boolean> {
    if (JSON.stringify(this.col(collection).get(id)) !== JSON.stringify(expected)) return false;
    this.col(collection).set(id, structuredClone(doc));
    return true;
  }

  async close(): Promise<void> {}
}
