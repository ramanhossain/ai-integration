import { AsyncLocalStorage } from "node:async_hooks";

// Multi-tenancy (iPaaS): elke organisatie heeft haar eigen, afgeschermde gegevens
// (processen, versies, koppelingen, queues, datatabellen, triggers, runs, goedkeuringen,
// audit, agentgroepen, events) — elk met DEV/TEST/ACC/PROD.
//
// De actieve organisatie staat in een AsyncLocalStorage-context: per HTTP-request (na
// authenticatie), en voor achtergrondwerk (timers, triggers, queues) blijft de context
// van de organisatie die het werk startte behouden. Domeinobjecten zijn per organisatie
// een eigen instantie (zie scoped()); opslag krijgt per organisatie een eigen collectie.
//
// De organisatie "default" bevat de gegevens van vóór multi-tenancy (zonder voorvoegsel),
// zodat bestaande installaties niets verliezen.

export const DEFAULT_ORG = "default";
const als = new AsyncLocalStorage<{ org: string }>();

export function currentOrg(): string {
  return als.getStore()?.org ?? DEFAULT_ORG;
}

export function runInOrg<T>(org: string, fn: () => T): T {
  return als.run({ org }, fn);
}

// Opslagcollectie voor de actieve organisatie. Collecties die met "_" beginnen zijn
// platformbreed (accounts, organisaties, sessies, …).
export function scopeCollection(collection: string): string {
  if (collection.startsWith("_")) return collection;
  const org = currentOrg();
  return org === DEFAULT_ORG ? collection : `${org}~${collection}`;
}

// Publieke URL-prefix voor webhooks/API-endpoints van de actieve organisatie.
export function orgPathPrefix(org = currentOrg()): string {
  return org === DEFAULT_ORG ? "" : `/o/${org}`;
}

// Eén instantie per organisatie, lui aangemaakt in de context van die organisatie.
// Het geëxporteerde object is een proxy die altijd de instantie van de actieve
// organisatie gebruikt; bestaande code (registry.get(...), bus.publish(...)) blijft werken.
const instances = new Map<string, Map<string, object>>();
export function scoped<T extends object>(name: string, factory: () => T): T {
  const resolve = (): T => {
    const org = currentOrg();
    let byName = instances.get(org);
    if (!byName) { byName = new Map(); instances.set(org, byName); }
    let inst = byName.get(name) as T | undefined;
    if (!inst) { inst = factory(); byName.set(name, inst); }
    return inst;
  };
  return new Proxy({} as T, {
    get(_t, prop) {
      const inst = resolve();
      const v = Reflect.get(inst, prop, inst);
      return typeof v === "function" ? v.bind(inst) : v;
    },
    set(_t, prop, value) { return Reflect.set(resolve(), prop, value); },
    has(_t, prop) { return Reflect.has(resolve(), prop); }
  });
}

// Bij verwijderen van een organisatie: instanties loslaten.
export function dropOrgInstances(org: string): void {
  instances.delete(org);
}
