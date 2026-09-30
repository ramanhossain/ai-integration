import { Pool } from "pg";
import type { PersistenceDriver } from "./driver";

// Postgres-driver. Eén generieke JSONB-documenttabel; per collectie gescheiden.
// Opt-in via DATABASE_URL. Volgorde bewaard via seq (o.a. voor de audit-keten).

export class PostgresDriver implements PersistenceDriver {
  readonly kind = "postgres";
  private pool: Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString });
  }

  async init(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS aip_documents (
        collection text NOT NULL,
        id text NOT NULL,
        doc jsonb NOT NULL,
        seq bigserial,
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (collection, id)
      );
      CREATE INDEX IF NOT EXISTS aip_documents_col_seq ON aip_documents (collection, seq);
    `);
  }

  async loadAll(collection: string): Promise<Array<{ id: string; doc: unknown }>> {
    const res = await this.pool.query<{ id: string; doc: unknown }>(
      "SELECT id, doc FROM aip_documents WHERE collection = $1 ORDER BY seq ASC",
      [collection]
    );
    return res.rows;
  }

  async put(collection: string, id: string, doc: unknown): Promise<void> {
    await this.pool.query(
      `INSERT INTO aip_documents (collection, id, doc) VALUES ($1, $2, $3)
       ON CONFLICT (collection, id) DO UPDATE SET doc = EXCLUDED.doc, updated_at = now()`,
      [collection, id, JSON.stringify(doc)]
    );
  }

  async delete(collection: string, id: string): Promise<void> {
    await this.pool.query("DELETE FROM aip_documents WHERE collection = $1 AND id = $2", [collection, id]);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
