// Interne typen. Spiegelen de JSON Schemas in /schemas (de machine-leesbare bron van waarheid).

export type RiskLevel = "green" | "orange" | "red";

export type Environment = "dev" | "test" | "acc" | "prod";

export interface ActionTarget {
  integration?: string;
  environment?: Environment;
  resource?: string;
  [k: string]: unknown;
}

export interface Action {
  type: string; // bv. "deploy.production", "read.logs"
  target?: ActionTarget;
  proposedBy: string;
  reason?: string;
  diff?: string;
  impact?: string;
  reversible?: boolean;
  payload?: Record<string, unknown>;
}

export type ApprovalStatus =
  | "auto-approved"
  | "pending"
  | "approved"
  | "rejected"
  | "expired"
  | "executed"
  | "failed";

export interface ApprovalDecision {
  approver: string;
  decision: "approve" | "reject";
  reason?: string;
  at: string;
}

export interface Approval {
  id: string;
  riskLevel: RiskLevel;
  status: ApprovalStatus;
  action: Action;
  requiredApprovals: number;
  fourEyes?: boolean; // vier-ogenprincipe gold bij dit verzoek
  approvals: ApprovalDecision[];
  expiresAt?: string;
  createdAt: string;
  resolvedAt?: string;
  result?: Record<string, unknown>;
}

export interface Integration {
  integration: string;
  version?: string;
  description?: string;
  owner?: string;
  trigger: { type: string; source?: string; cron?: string; [k: string]: unknown };
  steps: Array<{ id: string; type: string; name?: string; config?: Record<string, unknown>; position?: { x: number; y: number }; [k: string]: unknown }>;
  connections?: Array<{ from: string; to: string; port?: string }>;
  layout?: { start?: { x: number; y: number }; [k: string]: unknown };
  retry?: { attempts?: number; backoff?: string; onExhaust?: string };
  monitoring?: { enabled?: boolean };
  agents?: { monitoring?: boolean; testing?: boolean; security?: boolean };
  approval?: { productionDeployment?: "auto" | "required" };
}

export interface AuditEntry {
  seq: number;
  at: string;
  actor: string;
  event: string;
  subject?: string;
  data?: Record<string, unknown>;
  prevHash: string;
  hash: string;
}
