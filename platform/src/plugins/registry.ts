import { CATALOG, CATEGORIES } from "./catalog";
import type { PluginDef } from "./types";
import { GOOGLE } from "./defs/google";
import { MICROSOFT } from "./defs/microsoft";
import { COMMUNICATION } from "./defs/communication";
import { WORK } from "./defs/work";
import { CRM } from "./defs/crm";
import { COMMERCE } from "./defs/commerce";
import { MORE } from "./defs/more";
import { AWS } from "./defs/aws";
import { DATA } from "./defs/data";
import { SALES } from "./defs/sales";
import { CONTENT } from "./defs/content";
import { OPS } from "./defs/ops";

// Register van alle plugins: de catalogus (overzicht) plus de uitgewerkte definities.
const DEFS: PluginDef[] = [...GOOGLE, ...MICROSOFT, ...COMMUNICATION, ...WORK, ...CRM, ...COMMERCE, ...MORE, ...AWS, ...DATA, ...SALES, ...CONTENT, ...OPS];

const byId = new Map<string, PluginDef>();
for (const d of DEFS) {
  if (byId.has(d.id)) throw new Error(`Plugin ${d.id} is dubbel gedefinieerd`);
  const ops = new Set<string>();
  for (const o of d.operations) { if (ops.has(o.id)) throw new Error(`Plugin ${d.id}: operatie ${o.id} dubbel`); ops.add(o.id); }
  if (d.test && !ops.has(d.test)) throw new Error(`Plugin ${d.id}: testoperatie ${d.test} bestaat niet`);
  byId.set(d.id, d);
}

export type PluginSummary = { id: string; name: string; category: string; description: string; website?: string; status: "beschikbaar" | "gepland"; operations: number; auth?: string; color?: string; hasTrigger?: boolean };

export const plugins = {
  get(id: string): PluginDef | undefined { return byId.get(id); },
  all(): PluginDef[] { return [...byId.values()]; },
  categories: CATEGORIES,
  // Overzicht: elke catalogusregel, met status en (bij beschikbaar) het aantal operaties.
  catalog(): PluginSummary[] {
    const seen = new Set<string>();
    const rows: PluginSummary[] = CATALOG.map((c) => {
      seen.add(c.id);
      const d = byId.get(c.id);
      return { id: c.id, name: d?.name ?? c.name, category: d?.category ?? c.category, description: d?.description ?? c.description, website: d?.website ?? c.website, status: d ? "beschikbaar" : "gepland", operations: d?.operations.length ?? 0, auth: d?.auth.type, color: d?.color, hasTrigger: c.hasTrigger };
    });
    for (const d of byId.values()) if (!seen.has(d.id)) rows.push({ id: d.id, name: d.name, category: d.category, description: d.description, website: d.website, status: "beschikbaar", operations: d.operations.length, auth: d.auth.type, color: d.color });
    return rows.sort((a, b) => a.name.localeCompare(b.name, "nl"));
  },
  stats() {
    const cat = this.catalog();
    return { total: cat.length, available: cat.filter((c) => c.status === "beschikbaar").length, planned: cat.filter((c) => c.status === "gepland").length, operations: DEFS.reduce((n, d) => n + d.operations.length, 0) };
  }
};
