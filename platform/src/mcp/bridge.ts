// MCP-bridge. Exposeert de control-plane-tools als machine-ontdekbare descriptors,
// zodat elke agent of LLM (via het Model Context Protocol) ze kan vinden en aanroepen.
// MVP: een manifest + dispatch over de bestaande engines. Een volwaardige MCP-server
// (stdio/websocket transport) komt in een latere fase; de tooldefinities zijn hier al
// de bron van waarheid.

import { approvals } from "../approval/approvalEngine";
import { registry } from "../domain/registry";
import { agents } from "../domain/agents";
import type { Action } from "../domain/types";

export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export const tools: McpTool[] = [
  {
    name: "propose_action",
    description: "Stel een actie voor. De policy engine bepaalt het risiconiveau en of goedkeuring nodig is.",
    inputSchema: { $ref: "https://aip.local/schemas/action.json" }
  },
  {
    name: "list_approvals",
    description: "Lijst goedkeuringen, optioneel gefilterd op status of risiconiveau.",
    inputSchema: {
      type: "object",
      properties: { status: { type: "string" }, riskLevel: { type: "string", enum: ["green", "orange", "red"] } }
    }
  },
  {
    name: "decide_approval",
    description: "Keur een openstaande actie goed of af (respecteert 4-ogen).",
    inputSchema: {
      type: "object",
      required: ["id", "approver", "decision"],
      properties: {
        id: { type: "string" },
        approver: { type: "string" },
        decision: { type: "string", enum: ["approve", "reject"] },
        reason: { type: "string" }
      }
    }
  },
  {
    name: "list_integrations",
    description: "Lijst alle geregistreerde integraties (Integration-as-Code).",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "report_incident",
    description: "Rapporteer een gestructureerd incident (incident/v1).",
    inputSchema: { $ref: "https://aip.local/schemas/incident.json" }
  }
];

export function manifest(): Record<string, unknown> {
  return {
    name: "aip-control-plane",
    version: "0.1.0",
    protocol: "mcp/0.1",
    tools,
    agents: agents.map((a) => ({ id: a.id, name: a.name, capabilities: a.capabilities }))
  };
}

// Dispatch: roept een tool aan. Gedeeld door de MCP-server en de REST-API.
export async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case "propose_action":
      return approvals.propose(args as unknown as Action);
    case "list_approvals":
      return approvals.list(args as { status?: string; riskLevel?: "green" | "orange" | "red" });
    case "decide_approval":
      return approvals.decide(
        String(args.id),
        String(args.approver),
        args.decision as "approve" | "reject",
        args.reason as string | undefined
      );
    case "list_integrations":
      return registry.listIntegrations();
    case "report_incident":
      return registry.addIncident(args as never);
    default:
      throw new Error(`Onbekende tool: ${name}`);
  }
}
