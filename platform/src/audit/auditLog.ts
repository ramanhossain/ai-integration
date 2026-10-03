import { createHash } from "node:crypto";
import type { AuditEntry } from "../domain/types";
import { persistence } from "../store";
import { scoped } from "../tenancy/context";

// Append-only audit log met hash-keten. Elke entry bevat de hash van de vorige,
// zodat achteraf wijzigen detecteerbaar is. Machine-verifieerbaar via verify().
// MVP: in-memory. Later: append naar Postgres/WORM-storage.

const GENESIS = "0".repeat(64);

export class AuditLog {
  private entries: AuditEntry[] = [];

  private hashEntry(e: Omit<AuditEntry, "hash">): string {
    const canonical = JSON.stringify({
      seq: e.seq,
      at: e.at,
      actor: e.actor,
      event: e.event,
      subject: e.subject ?? null,
      data: e.data ?? null,
      prevHash: e.prevHash
    });
    return createHash("sha256").update(canonical).digest("hex");
  }

  append(input: { actor: string; event: string; subject?: string; data?: Record<string, unknown> }): AuditEntry {
    const prev = this.entries[this.entries.length - 1];
    const base: Omit<AuditEntry, "hash"> = {
      seq: this.entries.length,
      at: new Date().toISOString(),
      actor: input.actor,
      event: input.event,
      subject: input.subject,
      data: input.data,
      prevHash: prev ? prev.hash : GENESIS
    };
    const entry: AuditEntry = { ...base, hash: this.hashEntry(base) };
    this.entries.push(entry);
    persistence.put("audit", String(entry.seq).padStart(12, "0"), entry);
    return entry;
  }

  async hydrate(): Promise<void> {
    const rows = await persistence.loadAll("audit");
    if (rows.length === 0) return;
    this.entries = rows
      .map((r) => r.doc as AuditEntry)
      .sort((a, b) => a.seq - b.seq);
  }

  list(limit?: number): AuditEntry[] {
    return limit ? this.entries.slice(-limit) : [...this.entries];
  }

  // Verifieert de volledige keten. Geeft de eerste kapotte seq terug, of null als geldig.
  verify(): { valid: boolean; brokenAt: number | null } {
    let prevHash = GENESIS;
    for (const e of this.entries) {
      if (e.prevHash !== prevHash) return { valid: false, brokenAt: e.seq };
      const { hash, ...rest } = e;
      if (this.hashEntry(rest) !== hash) return { valid: false, brokenAt: e.seq };
      prevHash = e.hash;
    }
    return { valid: true, brokenAt: null };
  }
}

export const audit = scoped("audit", () => new AuditLog());
