import { randomUUID } from "node:crypto";
import type { Action, Approval, RiskLevel } from "../domain/types";
import { evaluate, defaultPolicy, type PolicyConfig } from "../policy/policyEngine";
import { audit } from "../audit/auditLog";
import { bus } from "../events/bus";
import { execute } from "./executor";
import { persistence } from "../store";
import { settings } from "../domain/settings";
import { scoped } from "../tenancy/context";

// De approval-engine is het hart van de Human Approval Layer.
// - GREEN  : direct auto-approved en uitgevoerd.
// - ORANGE : 1 goedkeurder nodig.
// - RED    : met vier-ogenprincipe 2 verschillende goedkeurders binnen een tijdslot, anders 1.
// Met het vier-ogenprincipe aan mag de indiener nooit de eigen actie goedkeuren.
// Het vier-ogenprincipe is een platforminstelling (standaard aan).
// Alles gaat naar het audit log en de event-bus.

const RED_WINDOW_MS = 30 * 60 * 1000; // tijdslot voor RED-goedkeuringen

export function requiredApprovals(level: RiskLevel, fourEyes = settings.fourEyes): number {
  if (level === "green") return 0;
  if (level === "red") return fourEyes ? 2 : 1;
  return 1;
}

export class ApprovalEngine {
  private store = new Map<string, Approval>();

  constructor(private policy: PolicyConfig = defaultPolicy) {
    // Instelling gewijzigd: openstaande verzoeken zonder goedkeuringen volgen de nieuwe regel.
    // Verzoeken waar al iemand over besliste houden hun oorspronkelijke eis.
    settings.onChange((s) => {
      for (const a of this.store.values()) {
        if (a.status !== "pending" || a.approvals.length) continue;
        a.fourEyes = s.fourEyes;
        a.requiredApprovals = requiredApprovals(a.riskLevel, s.fourEyes);
        this.emit(a, "approval.policy_changed", { actor: "settings", fourEyes: s.fourEyes, requiredApprovals: a.requiredApprovals });
      }
    });
  }

  private emit(approval: Approval, event: string, extra: Record<string, unknown> = {}): void {
    persistence.put("approvals", approval.id, approval);
    audit.append({ actor: extra.actor as string ?? approval.action.proposedBy, event, subject: approval.id, data: { riskLevel: approval.riskLevel, status: approval.status, ...extra } });
    bus.publish(event, { approvalId: approval.id, riskLevel: approval.riskLevel, status: approval.status, ...extra });
  }

  async hydrate(): Promise<void> {
    for (const { doc } of await persistence.loadAll("approvals")) {
      const a = doc as Approval;
      this.store.set(a.id, a);
    }
  }

  // Dient een actie in. Bepaalt risico, en handelt GREEN meteen af.
  async propose(action: Action): Promise<Approval> {
    const { level, reason } = evaluate(action, this.policy);
    const now = new Date();
    const approval: Approval = {
      id: randomUUID(),
      riskLevel: level,
      status: level === "green" ? "auto-approved" : "pending",
      action,
      requiredApprovals: requiredApprovals(level),
      fourEyes: settings.fourEyes,
      approvals: [],
      createdAt: now.toISOString(),
      expiresAt: level === "red" ? new Date(now.getTime() + RED_WINDOW_MS).toISOString() : undefined
    };
    this.store.set(approval.id, approval);
    this.emit(approval, "approval.created", { actionType: action.type, policyReason: reason });

    if (level === "green") {
      await this.runAction(approval);
    }
    return approval;
  }

  private expireIfNeeded(approval: Approval): boolean {
    if (approval.status === "pending" && approval.expiresAt && Date.now() > Date.parse(approval.expiresAt)) {
      approval.status = "expired";
      approval.resolvedAt = new Date().toISOString();
      this.emit(approval, "approval.expired");
      return true;
    }
    return false;
  }

  // Registreert een beslissing. Met het vier-ogenprincipe mag de indiener niet goedkeuren.
  // Dezelfde persoon telt altijd maar één keer.
  async decide(id: string, approver: string, decision: "approve" | "reject", reason?: string): Promise<Approval> {
    const approval = this.store.get(id);
    if (!approval) throw new Error("Approval niet gevonden");
    if (this.expireIfNeeded(approval)) return approval;
    if (approval.status !== "pending") throw new Error(`Approval is al '${approval.status}'`);

    const fourEyes = approval.fourEyes ?? true;
    if (fourEyes && decision === "approve" && approver === approval.action.proposedBy) {
      throw new Error("Vier-ogenprincipe: de indiener mag de eigen actie niet goedkeuren.");
    }
    if (approval.approvals.some((a) => a.approver === approver)) {
      throw new Error("Deze goedkeurder heeft al beslist.");
    }

    approval.approvals.push({ approver, decision, reason, at: new Date().toISOString() });

    if (decision === "reject") {
      approval.status = "rejected";
      approval.resolvedAt = new Date().toISOString();
      this.emit(approval, "approval.rejected", { actor: approver, reason });
      return approval;
    }

    this.emit(approval, "approval.approved", { actor: approver });

    const approvals = approval.approvals.filter((a) => a.decision === "approve").length;
    if (approvals >= approval.requiredApprovals) {
      approval.status = "approved";
      approval.resolvedAt = new Date().toISOString();
      this.emit(approval, "approval.satisfied", { actor: approver });
      await this.runAction(approval);
    }
    return approval;
  }

  private async runAction(approval: Approval): Promise<void> {
    try {
      approval.result = await execute(approval.action);
      approval.status = "executed";
      this.emit(approval, "action.executed", { result: approval.result });
    } catch (err) {
      approval.status = "failed";
      approval.result = { error: (err as Error).message };
      this.emit(approval, "action.failed", { error: (err as Error).message });
    }
  }

  get(id: string): Approval | undefined {
    const a = this.store.get(id);
    if (a) this.expireIfNeeded(a);
    return a;
  }

  list(filter?: { status?: string; riskLevel?: RiskLevel }): Approval[] {
    let items = [...this.store.values()];
    items.forEach((a) => this.expireIfNeeded(a));
    if (filter?.status) items = items.filter((a) => a.status === filter.status);
    if (filter?.riskLevel) items = items.filter((a) => a.riskLevel === filter.riskLevel);
    return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}

export const approvals = scoped("approvals", () => new ApprovalEngine());
