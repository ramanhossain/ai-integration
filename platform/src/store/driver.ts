// Persistentie-abstractie. De engines houden hun werkstatus in-memory (snelle,
// synchrone reads) en schrijven door naar een driver. Bij startup wordt de status
// gehydrateerd uit de driver. Zo blijft de engine-code eenvoudig terwijl de opslag
// pluggable is: in-memory (default) of Postgres (via DATABASE_URL).

export interface PersistenceDriver {
  init(): Promise<void>;
  loadAll(collection: string): Promise<Array<{ id: string; doc: unknown }>>;
  put(collection: string, id: string, doc: unknown): Promise<void>;
  // Atomic, awaited writes for protocol receipts and durable message ownership.
  create(collection: string, id: string, doc: unknown): Promise<boolean>;
  replace(collection: string, id: string, expected: unknown, doc: unknown): Promise<boolean>;
  delete(collection: string, id: string): Promise<void>;
  close(): Promise<void>;
  readonly kind: string;
}
