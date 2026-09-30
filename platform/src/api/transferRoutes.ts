import type { FastifyInstance } from "fastify";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv from "ajv";
import { registry } from "../domain/registry";
import { deployments } from "../domain/deployments";
import { credentials } from "../connectors/credentials";
import { datatables } from "../connectors/datatables";
import { broker } from "../connectors/queue";
import { audit } from "../audit/auditLog";
import type { Integration } from "../domain/types";

// Export/import van processen als bestand (Integration-as-Code + metadata).
// Een export bevat nooit geheimen: koppelingen, tabellen en queues staan er alleen
// bij naam in (onder "requires"), zodat de doelomgeving kan melden wat ontbreekt.

export const EXPORT_FORMAT = "aip.process-export";
export const EXPORT_FORMAT_VERSION = 1;

export interface ProcessExport {
  format: typeof EXPORT_FORMAT;
  formatVersion: number;
  exportedAt: string;
  exportedBy?: string;
  source: { integration: string; version?: string; environments?: Record<string, number | null> };
  process: Integration;
  subprocesses: Integration[];
  requires: Requirements;
  testInput?: unknown;
}
interface Requirements { credentials: string[]; datatables: string[]; queues: string[]; subprocesses: string[] }

const schema = JSON.parse(readFileSync(join(__dirname, "..", "..", "schemas", "integration.schema.json"), "utf8"));
const ajv = new Ajv({ allErrors: true, strict: false, validateFormats: false });
const compiled = ajv.compile(schema);
const validateDef = (d: unknown): boolean => compiled(d) as boolean;
const errorsOf = (label: string) => (compiled.errors || []).slice(0, 8).map((e) => `${label}${e.instancePath || ""} ${e.message}${e.params && "additionalProperty" in e.params ? ` (${(e.params as { additionalProperty: string }).additionalProperty})` : ""}`);

const RUNTIME_KEYS = ["integration", "version", "description", "owner", "trigger", "steps", "connections", "layout", "retry", "monitoring", "agents", "approval"];
function clean(def: Integration): Integration {
  const out: Record<string, unknown> = {};
  for (const k of RUNTIME_KEYS) if ((def as unknown as Record<string, unknown>)[k] !== undefined) out[k] = (def as unknown as Record<string, unknown>)[k];
  return JSON.parse(JSON.stringify(out)) as Integration;
}

export function requirementsOf(defs: Integration[]): Requirements {
  const r = { credentials: new Set<string>(), datatables: new Set<string>(), queues: new Set<string>(), subprocesses: new Set<string>() };
  for (const def of defs) {
    const t = (def.trigger || {}) as Record<string, unknown>;
    if (typeof t.credential === "string" && t.credential) r.credentials.add(t.credential);
    if (t.type === "queue" && typeof t.queue === "string" && t.queue) r.queues.add(t.queue);
    for (const s of def.steps || []) {
      const c = (s.config || {}) as Record<string, unknown>;
      if (typeof c.credential === "string" && c.credential) r.credentials.add(c.credential);
      if (s.type === "datatable" && typeof c.table === "string" && c.table) r.datatables.add(c.table);
      if ((s.type === "queue" || s.type === "queue-get") && typeof c.queue === "string" && c.queue && !c.queue.includes("{{")) r.queues.add(c.queue);
      if (s.type === "subprocess" && typeof c.process === "string" && c.process) r.subprocesses.add(c.process);
    }
  }
  const sorted = (x: Set<string>) => [...x].sort();
  return { credentials: sorted(r.credentials), datatables: sorted(r.datatables), queues: sorted(r.queues), subprocesses: sorted(r.subprocesses) };
}

// Subprocessen recursief verzamelen (laatste versie op DEV).
function collectSubprocesses(root: Integration): Integration[] {
  const out = new Map<string, Integration>();
  const walk = (def: Integration) => {
    for (const name of requirementsOf([def]).subprocesses) {
      if (name === root.integration || out.has(name)) continue;
      const sub = registry.getIntegration(name);
      if (sub) { out.set(name, clean(sub)); walk(sub); }
    }
  };
  walk(root);
  return [...out.values()];
}

export function buildExport(name: string, opts: { version?: number; subprocesses?: boolean; by?: string } = {}): ProcessExport | undefined {
  const def = opts.version ? deployments.getDefinition(name, opts.version) : registry.getIntegration(name);
  return def ? exportOf(def, opts) : undefined;
}

// Ook voor een (nog niet opgeslagen) definitie uit de editor.
export function exportOf(def: Integration, opts: { subprocesses?: boolean; by?: string; testInput?: unknown } = {}): ProcessExport {
  const name = def.integration;
  const process = clean(def);
  const subs = opts.subprocesses === false ? [] : collectSubprocesses(process);
  const state = deployments.listStates().find((s) => s.integration === name);
  return {
    format: EXPORT_FORMAT,
    formatVersion: EXPORT_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    exportedBy: opts.by,
    source: { integration: name, version: process.version, environments: state?.envs },
    process,
    subprocesses: subs,
    requires: requirementsOf([process, ...subs]),
    ...(opts.testInput !== undefined ? { testInput: opts.testInput } : {})
  };
}

type Conflict = "version" | "rename" | "fail";
export interface ImportRequest { bundle: unknown; name?: string; onConflict?: Conflict; subprocesses?: "missing" | "all" | "none"; dryRun?: boolean; owner?: string; saveProcess?: boolean }

function freeName(base: string): string {
  const stem = base.replace(/_\d+$/, "");
  for (let i = 2; i < 1000; i++) { const n = `${stem}_${i}`.slice(0, 64); if (!registry.getIntegration(n)) return n; }
  return `${stem}_${Date.now()}`.slice(0, 64);
}

// Accepteert een exportbundel én een kale procesdefinitie (Integration-as-Code).
export function importProcess(req: ImportRequest): { status: number; body: Record<string, unknown> } {
  const b = req.bundle as Record<string, unknown> | null;
  if (!b || typeof b !== "object" || Array.isArray(b)) return { status: 400, body: { error: "Geen geldig JSON-object." } };
  let process: Integration, subs: Integration[] = [], meta: Record<string, unknown> = {};
  if (b.format === EXPORT_FORMAT) {
    if (Number(b.formatVersion) > EXPORT_FORMAT_VERSION) return { status: 400, body: { error: `Exportformaat v${b.formatVersion} is nieuwer dan dit platform ondersteunt (v${EXPORT_FORMAT_VERSION}).` } };
    process = b.process as Integration;
    subs = Array.isArray(b.subprocesses) ? (b.subprocesses as Integration[]) : [];
    meta = { exportedAt: b.exportedAt, exportedBy: b.exportedBy, source: b.source, testInput: b.testInput };
  } else if (typeof b.integration === "string" && Array.isArray(b.steps)) {
    process = b as unknown as Integration;
  } else {
    return { status: 400, body: { error: "Onbekend formaat: verwacht een AIP-export (format \"aip.process-export\") of een procesdefinitie met integration, trigger en steps." } };
  }
  if (!process || typeof process !== "object") return { status: 400, body: { error: "De export bevat geen proces." } };

  process = clean(process);
  delete (process as { version?: string }).version;
  const originalName = process.integration;
  if (req.name) process.integration = req.name;

  const errors: string[] = [];
  if (!validateDef(process)) errors.push(...errorsOf(`proces ${process.integration}`));
  subs = subs.map((s) => { const c = clean(s); delete (c as { version?: string }).version; return c; });
  for (const s of subs) if (!validateDef(s)) errors.push(...errorsOf(`subproces ${s.integration}`));
  if (errors.length) return { status: 400, body: { error: "De definitie voldoet niet aan het schema.", details: errors } };

  // Naamconflict
  const exists = Boolean(registry.getIntegration(process.integration));
  const onConflict: Conflict = req.onConflict || "version";
  if (exists && onConflict === "fail") return { status: 409, body: { error: `Er bestaat al een proces ${process.integration}.`, conflict: true } };
  if (exists && onConflict === "rename") process.integration = freeName(process.integration);

  const subMode = req.subprocesses || "missing";
  const subPlan = subs.map((s) => ({ name: s.integration, exists: Boolean(registry.getIntegration(s.integration)) }))
    .map((p) => ({ ...p, action: subMode === "none" ? "skip" : p.exists && subMode === "missing" ? "skip" : p.exists ? "new-version" : "create" }));

  // Wat de doelomgeving (DEV) nog mist
  const req0 = requirementsOf([process, ...subs]);
  const credNames = new Set(credentials.list().map((c) => c.name));
  const tableNames = new Set(datatables.list("dev").map((t) => t.name));
  const queueNames = new Set(broker.list("dev").map((q) => q.queue));
  const knownSubs = new Set([...registry.listIntegrations().map((i) => i.integration), ...subPlan.filter((p) => p.action !== "skip").map((p) => p.name)]);
  const missing = {
    credentials: req0.credentials.filter((n) => !credNames.has(n)),
    datatables: req0.datatables.filter((n) => !tableNames.has(n)),
    queues: req0.queues.filter((n) => !queueNames.has(n)),
    subprocesses: req0.subprocesses.filter((n) => !knownSubs.has(n))
  };
  const plan = {
    process: { name: process.integration, originalName, action: exists && onConflict === "version" ? "new-version" : "create" },
    subprocesses: subPlan,
    requires: req0,
    missing,
    meta
  };
  if (req.dryRun) return { status: 200, body: { dryRun: true, definition: process, ...plan } };

  const savedSubs = subPlan.filter((p) => p.action !== "skip").map((p) => {
    const s = subs.find((x) => x.integration === p.name)!;
    return registry.upsertIntegration({ ...s, owner: req.owner ?? s.owner });
  });
  if (req.saveProcess === false) {
    // Alleen subprocessen opslaan; het proces zelf gaat (onopgeslagen) de editor in.
    return { status: 200, body: { dryRun: false, saved: null, definition: process, savedSubprocesses: savedSubs.map((s) => ({ integration: s.integration, version: s.version })), ...plan } };
  }
  const saved = registry.upsertIntegration({ ...process, owner: req.owner ?? process.owner });
  audit.append({ actor: req.owner ?? "system", event: "integration.imported", subject: saved.integration, data: { originalName, version: saved.version, subprocesses: savedSubs.map((s) => `${s.integration}@v${s.version}`) } });
  return { status: 201, body: { dryRun: false, saved: { integration: saved.integration, version: saved.version }, savedSubprocesses: savedSubs.map((s) => ({ integration: s.integration, version: s.version })), ...plan } };
}

export async function registerTransferRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { name: string }; Querystring: { version?: number; subprocesses?: boolean; download?: boolean; by?: string } }>(
    "/api/v1/integrations/:name/export",
    {
      schema: {
        tags: ["integrations"],
        summary: "Proces exporteren (bundel met definitie, subprocessen en benodigdheden; zonder geheimen)",
        querystring: { type: "object", properties: { version: { type: "integer", minimum: 1 }, subprocesses: { type: "boolean", default: true }, download: { type: "boolean" }, by: { type: "string" } } }
      }
    },
    async (req, reply) => {
      const out = buildExport(req.params.name, { version: req.query.version, subprocesses: req.query.subprocesses, by: req.query.by });
      if (!out) return reply.code(404).send({ error: "Proces of versie niet gevonden" });
      if (req.query.download) reply.header("content-disposition", `attachment; filename="${out.process.integration}.aip.json"`);
      return out;
    }
  );

  app.post<{ Body: { definition: Integration; subprocesses?: boolean; testInput?: unknown; by?: string } }>(
    "/api/v1/integrations/export",
    {
      schema: {
        tags: ["integrations"],
        summary: "Exportbundel maken van een meegegeven (bv. nog niet opgeslagen) definitie",
        body: { type: "object", required: ["definition"], properties: { definition: { type: "object", additionalProperties: true }, subprocesses: { type: "boolean" }, testInput: {}, by: { type: "string" } } }
      }
    },
    async (req, reply) => {
      const d = req.body.definition;
      if (!d || typeof d.integration !== "string" || !Array.isArray(d.steps)) return reply.code(400).send({ error: "definition met integration en steps is verplicht" });
      return exportOf(d, { subprocesses: req.body.subprocesses, by: req.body.by, testInput: req.body.testInput });
    }
  );

  app.post<{ Body: ImportRequest }>(
    "/api/v1/integrations/import",
    {
      schema: {
        tags: ["integrations"],
        summary: "Proces importeren (AIP-export of kale definitie). dryRun=true controleert alleen.",
        body: {
          type: "object",
          required: ["bundle"],
          properties: {
            bundle: { type: "object", additionalProperties: true },
            name: { type: "string", pattern: "^[A-Za-z][A-Za-z0-9_-]{2,63}$" },
            onConflict: { type: "string", enum: ["version", "rename", "fail"] },
            subprocesses: { type: "string", enum: ["missing", "all", "none"] },
            dryRun: { type: "boolean" },
            saveProcess: { type: "boolean", default: true },
            owner: { type: "string" }
          }
        }
      }
    },
    async (req, reply) => {
      const r = importProcess(req.body);
      return reply.code(r.status).send(r.body);
    }
  );
}
