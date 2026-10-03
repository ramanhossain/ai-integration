import { randomUUID } from "node:crypto";
import type { Integration } from "./types";
import { audit } from "../audit/auditLog";
import { bus } from "../events/bus";
import { persistence } from "../store";
import { deployments } from "./deployments";
import { scoped } from "../tenancy/context";

// In-memory registry (MVP). Later: Postgres. Houdt de door mensen én machines
// opvraagbare toestand bij: integraties, incidenten en security-findings.

export type Severity = "low" | "medium" | "high" | "critical";

export interface StoredIncident {
  schema: "incident/v1";
  id: string;
  integration: string;
  severity: Severity;
  problem: string;
  failedRequests?: number;
  rootCause?: Record<string, unknown>;
  impact?: string;
  proposedAction?: Record<string, unknown>;
  detectedAt?: string;
}

export interface StoredFinding {
  schema: "finding/v1";
  id: string;
  integration: string;
  severity: Severity;
  finding: string;
  category?: string;
  remediation?: string;
  proposedAction?: Record<string, unknown>;
  detectedAt?: string;
}

class Registry {
  private integrations = new Map<string, Integration>();
  private incidents = new Map<string, StoredIncident>();
  private findings = new Map<string, StoredFinding>();

  async hydrate(): Promise<void> {
    for (const { doc } of await persistence.loadAll("integrations")) {
      const d = doc as Integration;
      this.integrations.set(d.integration, d);
    }
    for (const { doc } of await persistence.loadAll("incidents")) {
      const d = doc as StoredIncident;
      this.incidents.set(d.id, d);
    }
    for (const { doc } of await persistence.loadAll("findings")) {
      const d = doc as StoredFinding;
      this.findings.set(d.id, d);
    }
  }

  // Opslaan = nieuwe versie op DEV. Promotie naar test/acc/prod loopt via approvals.
  upsertIntegration(input: Integration, extra: { note?: string; restoredFrom?: number } = {}): Integration {
    const state = deployments.recordNewVersion(input, extra);
    const def: Integration = { ...input, version: String(state.latestVersion) };
    this.integrations.set(def.integration, def);
    persistence.put("integrations", def.integration, def);
    audit.append({ actor: def.owner ?? "system", event: "integration.upserted", subject: def.integration });
    bus.publish("integration.upserted", { integration: def.integration, version: def.version ?? "1" });
    return def;
  }
  deleteIntegration(name: string, actor = "system"): boolean {
    if (!this.integrations.has(name)) return false;
    this.integrations.delete(name);
    persistence.delete("integrations", name);
    deployments.remove(name);
    audit.append({ actor, event: "integration.deleted", subject: name });
    bus.publish("integration.deleted", { integration: name });
    return true;
  }
  getIntegration(name: string): Integration | undefined {
    return this.integrations.get(name);
  }
  listIntegrations(): Integration[] {
    return [...this.integrations.values()];
  }

  addIncident(input: Omit<StoredIncident, "id" | "schema"> & { schema?: "incident/v1" }): StoredIncident {
    const inc: StoredIncident = {
      ...input,
      schema: "incident/v1",
      id: randomUUID(),
      integration: input.integration,
      severity: input.severity,
      problem: input.problem
    };
    this.incidents.set(inc.id, inc);
    persistence.put("incidents", inc.id, inc);
    audit.append({ actor: "monitoring-agent", event: "incident.reported", subject: inc.id, data: { severity: inc.severity } });
    bus.publish("incident.reported", { id: inc.id, integration: inc.integration, severity: inc.severity });
    return inc;
  }
  listIncidents(): StoredIncident[] {
    return [...this.incidents.values()];
  }

  addFinding(input: Omit<StoredFinding, "id" | "schema"> & { schema?: "finding/v1" }): StoredFinding {
    const f: StoredFinding = {
      ...input,
      schema: "finding/v1",
      id: randomUUID(),
      integration: input.integration,
      severity: input.severity,
      finding: input.finding
    };
    this.findings.set(f.id, f);
    persistence.put("findings", f.id, f);
    audit.append({ actor: "security-agent", event: "finding.reported", subject: f.id, data: { severity: f.severity } });
    bus.publish("finding.reported", { id: f.id, integration: f.integration, severity: f.severity });
    return f;
  }
  listFindings(): StoredFinding[] {
    return [...this.findings.values()];
  }
}

export const registry = scoped("registry", () => new Registry());
