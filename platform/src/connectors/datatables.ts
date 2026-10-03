import { ENVIRONMENTS, type EnvName } from "../domain/environments";
import { persistence } from "../store";
import { audit } from "../audit/auditLog";
import { bus } from "../events/bus";
import { scoped } from "../tenancy/context";

// Ingebouwde datatabellen: eenvoudige tabellen met getypeerde
// kolommen om gegevens tussen uitvoeringen op te slaan (status, koppeltabellen, tijdelijke
// buffers). De tabel zelf (naam, kolommen) bestaat altijd op álle omgevingen (DEV, TEST,
// ACC, PROD) en is overal gelijk; de rijen zijn per omgeving gescheiden: DEV-data raakt PROD nooit.

export type ColType = "string" | "number" | "boolean" | "date" | "json";
export interface Column { name: string; type: ColType }
export interface TableDef { env: EnvName; name: string; description?: string; columns: Column[]; createdAt: string; seq: number }
export type Row = { id: number; createdAt: string; updatedAt: string } & Record<string, unknown>;

export type Op = "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "contains" | "empty" | "notEmpty";
export interface Condition { column: string; op?: Op; value?: unknown }

const MAX_ROWS = Number(process.env.AIP_DATATABLE_MAX_ROWS ?? 10000);
const NAME_RE = /^[A-Za-z][A-Za-z0-9_]{0,62}$/;
const key = (env: EnvName, name: string) => `${env}:${name}`;
const SYSTEM = new Set(["id", "createdAt", "updatedAt"]);

function coerce(type: ColType, v: unknown, col: string): unknown {
  if (v === undefined || v === null || v === "") return null;
  switch (type) {
    case "number": { const n = Number(v); if (Number.isNaN(n)) throw new Error(`Kolom ${col}: '${v}' is geen getal`); return n; }
    case "boolean": return v === true || v === "true" || v === 1 || v === "1";
    case "date": { const d = new Date(String(v)); if (Number.isNaN(d.getTime())) throw new Error(`Kolom ${col}: '${v}' is geen datum`); return d.toISOString(); }
    case "json": return typeof v === "string" ? (() => { try { return JSON.parse(v); } catch { return v; } })() : v;
    default: return typeof v === "object" ? JSON.stringify(v) : String(v);
  }
}

function matches(row: Row, conds: Condition[]): boolean {
  return conds.every(({ column, op = "eq", value }) => {
    const v = row[column];
    switch (op) {
      case "ne": return String(v ?? "") !== String(value ?? "");
      case "gt": return Number(v) > Number(value);
      case "gte": return Number(v) >= Number(value);
      case "lt": return Number(v) < Number(value);
      case "lte": return Number(v) <= Number(value);
      case "contains": return String(v ?? "").toLowerCase().includes(String(value ?? "").toLowerCase());
      case "empty": return v === null || v === undefined || v === "";
      case "notEmpty": return !(v === null || v === undefined || v === "");
      default: return String(v ?? "") === String(value ?? "");
    }
  });
}

// Filter mag een object ({kolom: waarde}) of een lijst voorwaarden zijn.
export function toConditions(filter: unknown): Condition[] {
  if (!filter) return [];
  if (Array.isArray(filter)) return filter as Condition[];
  return Object.entries(filter as Record<string, unknown>).map(([column, value]) => ({ column, op: "eq" as Op, value }));
}

class DataTables {
  private tables = new Map<string, TableDef>();
  private rows = new Map<string, Row[]>();

  async hydrate(): Promise<void> {
    for (const { doc } of await persistence.loadAll("datatables")) {
      const t = doc as TableDef;
      this.tables.set(key(t.env, t.name), t);
      this.rows.set(key(t.env, t.name), []);
    }
    for (const { id, doc } of await persistence.loadAll("datatable-rows")) {
      const [env, name] = id.split(":");
      this.rows.get(`${env}:${name}`)?.push(doc as Row);
    }
    for (const list of this.rows.values()) list.sort((a, b) => a.id - b.id);
    this.syncAllEnvs();
  }

  // Oudere data: tabellen die niet op elke omgeving bestaan aanvullen, en kolommen gelijk
  // trekken (samenvoegen; nooit kolommen weghalen, dat zou gegevens wissen).
  private syncAllEnvs(): void {
    const names = new Set([...this.tables.values()].map((t) => t.name));
    for (const name of names) {
      const defs = ENVIRONMENTS.map((e) => this.tables.get(key(e, name))).filter(Boolean) as TableDef[];
      const base = defs.find((t) => t.env === "dev") ?? defs[0];
      const cols: Column[] = [...base.columns];
      for (const d of defs) for (const c of d.columns) if (!cols.some((x) => x.name === c.name)) cols.push(c);
      for (const env of ENVIRONMENTS) {
        const t = this.tables.get(key(env, name));
        if (!t) {
          const nt: TableDef = { env, name, description: base.description, columns: cols.map((c) => ({ ...c })), createdAt: base.createdAt, seq: 0 };
          this.tables.set(key(env, name), nt);
          this.rows.set(key(env, name), []);
          this.save(nt);
        } else if (t.columns.length !== cols.length) {
          t.columns = cols.map((c) => ({ ...c }));
          this.save(t);
        }
      }
    }
  }

  private t(env: EnvName, name: string): TableDef {
    const t = this.tables.get(key(env, name));
    if (!t) throw new Error(`Tabel '${name}' bestaat niet op ${env.toUpperCase()}`);
    return t;
  }
  private save(t: TableDef) { persistence.put("datatables", key(t.env, t.name), t); }
  private saveRow(t: TableDef, r: Row) { persistence.put("datatable-rows", `${t.env}:${t.name}:${r.id}`, r); }

  list(env: EnvName) {
    return [...this.tables.values()].filter((t) => t.env === env).sort((a, b) => a.name.localeCompare(b.name))
      .map((t) => ({ ...t, rowCount: this.rows.get(key(env, t.name))?.length ?? 0 }));
  }
  get(env: EnvName, name: string) {
    const t = this.t(env, name);
    const rowCounts = Object.fromEntries(ENVIRONMENTS.map((e) => [e, this.rows.get(key(e, name))?.length ?? 0]));
    return { ...t, rowCount: this.rows.get(key(env, name))!.length, rowCounts, envs: ENVIRONMENTS.filter((e) => this.tables.has(key(e, name))) };
  }

  // Aanmaken gebeurt altijd op alle omgevingen, met dezelfde kolommen.
  create(env: EnvName, name: string, columns: Column[], description: string | undefined, actor: string) {
    if (!NAME_RE.test(name)) throw new Error("Tabelnaam: begin met een letter; letters, cijfers en _ (max 63).");
    if (ENVIRONMENTS.some((e) => this.tables.has(key(e, name)))) throw new Error(`Tabel '${name}' bestaat al`);
    const cols = this.validateColumns(columns);
    const createdAt = new Date().toISOString();
    for (const e of ENVIRONMENTS) {
      const t: TableDef = { env: e, name, description, columns: cols.map((c) => ({ ...c })), createdAt, seq: 0 };
      this.tables.set(key(e, name), t);
      this.rows.set(key(e, name), []);
      this.save(t);
    }
    audit.append({ actor, event: "datatable.created", subject: name, data: { columns: cols.map((c) => c.name), envs: [...ENVIRONMENTS] } });
    bus.publish("datatable.changed", { env, table: name, envs: [...ENVIRONMENTS] });
    return this.get(env, name);
  }

  private validateColumns(columns: Column[]): Column[] {
    const seen = new Set<string>();
    return (columns ?? []).map((c) => {
      if (!NAME_RE.test(c.name) || SYSTEM.has(c.name)) throw new Error(`Ongeldige kolomnaam: ${c.name}`);
      if (seen.has(c.name)) throw new Error(`Kolom ${c.name} komt dubbel voor`);
      if (!["string", "number", "boolean", "date", "json"].includes(c.type)) throw new Error(`Onbekend kolomtype: ${c.type}`);
      seen.add(c.name);
      return { name: c.name, type: c.type };
    });
  }

  // Kolommen wijzigen geldt voor de tabel op alle omgevingen (de structuur blijft overal gelijk).
  setColumns(env: EnvName, name: string, columns: Column[], actor: string) {
    const base = this.t(env, name);
    const cols = this.validateColumns(columns);
    const removed = base.columns.filter((c) => !cols.some((x) => x.name === c.name)).map((c) => c.name);
    for (const e of ENVIRONMENTS) {
      let t = this.tables.get(key(e, name));
      if (!t) { t = { env: e, name, description: base.description, columns: [], createdAt: base.createdAt, seq: 0 }; this.tables.set(key(e, name), t); this.rows.set(key(e, name), []); }
      const gone = t.columns.filter((c) => !cols.some((x) => x.name === c.name)).map((c) => c.name);
      t.columns = cols.map((c) => ({ ...c }));
      this.save(t);
      for (const r of this.rows.get(key(e, name))!) {
        let changed = false;
        for (const c of gone) if (c in r) { delete r[c]; changed = true; }
        if (changed) this.saveRow(t, r);
      }
    }
    audit.append({ actor, event: "datatable.columns", subject: name, data: { columns: cols.map((c) => c.name), removed, envs: [...ENVIRONMENTS] } });
    bus.publish("datatable.changed", { env, table: name, envs: [...ENVIRONMENTS] });
    return this.get(env, name);
  }

  // Verwijderen haalt de tabel (met rijen) van alle omgevingen, zodat ze overal gelijk blijven.
  drop(env: EnvName, name: string, actor: string): Record<string, number> {
    this.t(env, name);
    const removedRows: Record<string, number> = {};
    for (const e of ENVIRONMENTS) {
      const rows = this.rows.get(key(e, name)) ?? [];
      removedRows[e] = rows.length;
      for (const r of rows) persistence.delete("datatable-rows", `${e}:${name}:${r.id}`);
      this.tables.delete(key(e, name));
      this.rows.delete(key(e, name));
      persistence.delete("datatables", key(e, name));
    }
    audit.append({ actor, event: "datatable.dropped", subject: name, data: { envs: [...ENVIRONMENTS], rows: removedRows } });
    bus.publish("datatable.changed", { env, table: name, dropped: true, envs: [...ENVIRONMENTS] });
    return removedRows;
  }

  private clean(t: TableDef, values: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(values ?? {})) {
      if (SYSTEM.has(k)) continue;
      const col = t.columns.find((c) => c.name === k);
      if (!col) throw new Error(`Tabel '${t.name}' heeft geen kolom '${k}' (kolommen: ${t.columns.map((c) => c.name).join(", ") || "geen"})`);
      out[k] = coerce(col.type, v, k);
    }
    return out;
  }

  insert(env: EnvName, name: string, values: Record<string, unknown> | Record<string, unknown>[]): Row[] {
    const t = this.t(env, name);
    const list = this.rows.get(key(env, name))!;
    const items = Array.isArray(values) ? values : [values];
    if (list.length + items.length > MAX_ROWS) throw new Error(`Tabel '${name}' zit vol (max ${MAX_ROWS} rijen)`);
    const now = new Date().toISOString();
    const created = items.map((v) => {
      const r = { ...this.clean(t, v), id: ++t.seq, createdAt: now, updatedAt: now } as Row;
      list.push(r);
      this.saveRow(t, r);
      return r;
    });
    this.save(t);
    bus.publish("datatable.rows", { env, table: name, inserted: created.length });
    return created.map((r) => ({ ...r }));
  }

  find(env: EnvName, name: string, filter?: unknown, opts: { limit?: number; offset?: number; sortBy?: string; desc?: boolean } = {}) {
    this.t(env, name);
    const conds = toConditions(filter);
    let res = this.rows.get(key(env, name))!.filter((r) => matches(r, conds));
    if (opts.sortBy) {
      const s = opts.sortBy;
      res = [...res].sort((a, b) => { const x = a[s] as never, y = b[s] as never; return (x > y ? 1 : x < y ? -1 : 0) * (opts.desc ? -1 : 1); });
    }
    const total = res.length;
    const offset = Math.max(0, opts.offset ?? 0);
    // Kopieën teruggeven: latere wijzigingen mogen eerdere uitkomsten niet veranderen.
    return { total, rows: res.slice(offset, offset + Math.min(opts.limit ?? 100, 1000)).map((r) => ({ ...r })) };
  }

  update(env: EnvName, name: string, filter: unknown, values: Record<string, unknown>): Row[] {
    const t = this.t(env, name);
    const conds = toConditions(filter);
    if (!conds.length) throw new Error("Update zonder filter is niet toegestaan");
    const clean = this.clean(t, values);
    const now = new Date().toISOString();
    const hit = this.rows.get(key(env, name))!.filter((r) => matches(r, conds));
    for (const r of hit) { Object.assign(r, clean, { updatedAt: now }); this.saveRow(t, r); }
    bus.publish("datatable.rows", { env, table: name, updated: hit.length });
    return hit.map((r) => ({ ...r }));
  }

  upsert(env: EnvName, name: string, filter: unknown, values: Record<string, unknown>): { row: Row; created: boolean } {
    const conds = toConditions(filter);
    if (!conds.length) throw new Error("Upsert heeft een filter (sleutelkolommen) nodig");
    const updated = this.update(env, name, conds, values);
    if (updated.length) return { row: updated[0], created: false };
    const keys = Object.fromEntries(conds.filter((c) => (c.op ?? "eq") === "eq").map((c) => [c.column, c.value]));
    return { row: this.insert(env, name, { ...keys, ...values })[0], created: true };
  }

  remove(env: EnvName, name: string, filter: unknown): number {
    const t = this.t(env, name);
    const conds = toConditions(filter);
    if (!conds.length) throw new Error("Verwijderen zonder filter is niet toegestaan (gebruik 'Tabel leegmaken')");
    const list = this.rows.get(key(env, name))!;
    const keep = list.filter((r) => !matches(r, conds));
    const gone = list.filter((r) => matches(r, conds));
    for (const r of gone) persistence.delete("datatable-rows", `${env}:${name}:${r.id}`);
    this.rows.set(key(env, name), keep);
    bus.publish("datatable.rows", { env, table: t.name, deleted: gone.length });
    return gone.length;
  }

  clear(env: EnvName, name: string, actor: string): number {
    const list = this.rows.get(key(env, name)) ?? [];
    this.t(env, name);
    for (const r of list) persistence.delete("datatable-rows", `${env}:${name}:${r.id}`);
    this.rows.set(key(env, name), []);
    audit.append({ actor, event: "datatable.cleared", subject: key(env, name), data: { rows: list.length } });
    bus.publish("datatable.rows", { env, table: name, cleared: list.length });
    return list.length;
  }
}

export const datatables = scoped("datatables", () => new DataTables());
