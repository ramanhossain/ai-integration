import type { Action } from "../domain/types";
import type { StoredIncident } from "../domain/registry";
import { claudeAvailable, claudeJson } from "./claude";

// Monitoring/Recovery Agent. Analyseert een incident en stelt een concrete
// herstelactie voor. De actie gaat daarna door de policy/approval-laag; de agent
// voert dus nooit zelf iets destructiefs uit.

const SYSTEM = `Je bent de Recovery Agent. Gegeven een incident, stel EEN concrete herstelactie voor als JSON:
{ "type": string (bv. "consumer.pause", "scale.workers", "integration.run", "config.update"),
  "reason": string, "impact": string, "reversible": boolean,
  "payload": object (parameters), "target": {"integration": string, "environment": string} }`;

export function heuristicAnalyze(inc: StoredIncident): Action {
  const symptom = String(inc.rootCause?.symptom ?? "");
  const base = {
    proposedBy: "recovery-agent",
    target: { integration: inc.integration },
    reversible: true
  };

  if (symptom.includes("latency") || (inc.rootCause?.toMs as number) > 2000) {
    return {
      ...base,
      type: "consumer.pause",
      reason: `Latency op ${inc.rootCause?.endpoint ?? "endpoint"} opgelopen; pauzeer en behoud events in de queue.`,
      impact: `${inc.failedRequests ?? "meerdere"} berichten wachten; geen dataverlies.`,
      payload: { durationS: 300, retry: "exponential_backoff" }
    };
  }
  if (symptom.includes("queue") || symptom.includes("cpu")) {
    return {
      ...base,
      type: "scale.workers",
      reason: "Queue-depth/CPU hoog; schaal workers op.",
      impact: "Hogere doorvoer, extra kosten.",
      payload: { from: 3, to: 6 }
    };
  }
  return {
    ...base,
    type: "integration.run",
    reason: "Herverwerk de gefaalde berichten.",
    impact: "Opnieuw uitvoeren van gefaalde items.",
    payload: { mode: "replay-failed" }
  };
}

export interface AnalyzeResult {
  proposedAction: Action;
  by: "claude" | "heuristic";
}

export async function analyze(inc: StoredIncident): Promise<AnalyzeResult> {
  if (claudeAvailable()) {
    try {
      const partial = await claudeJson<Partial<Action>>({ system: SYSTEM, user: JSON.stringify(inc), maxTokens: 600 });
      if (partial?.type) {
        return { proposedAction: { proposedBy: "recovery-agent", ...partial } as Action, by: "claude" };
      }
    } catch {
      // val terug op heuristiek
    }
  }
  return { proposedAction: heuristicAnalyze(inc), by: "heuristic" };
}
