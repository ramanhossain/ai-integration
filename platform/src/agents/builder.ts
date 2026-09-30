import type { Integration } from "../domain/types";
import { claudeAvailable, claudeJson } from "./claude";

// Integration Builder Agent. Zet een natuurlijke-taalopdracht om in een
// Integration-as-Code definitie. Met Claude wanneer een key aanwezig is; anders een
// deterministische heuristiek zodat AI Mode ook zonder key een bruikbare flow oplevert.

const SYSTEM = `Je bent de Integration Builder Agent van een integratieplatform.
Zet de opdracht om in een integratie-definitie die voldoet aan dit JSON Schema:
{ integration: string (PascalCase, geen spaties), description: string, trigger: {type: "webhook"|"schedule"|"event"|"manual", source?: string},
  steps: [{id: string, type: "validate"|"transform"|"duplicate-check"|"call"|"branch"|"enrich"|"custom", config?: object}],
  retry: {attempts: number, backoff: "exponential"|"fixed"|"none", onExhaust: "dead-letter-queue"|"fail"},
  monitoring: {enabled: boolean}, agents: {monitoring: boolean, testing: boolean, security: boolean},
  approval: {productionDeployment: "required"|"auto"} }`;

function titleCase(s: string): string {
  return s.replace(/[^a-zA-Z0-9]+/g, " ").trim().split(" ").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join("");
}

// Heuristische fallback: haalt bron/doel, retries en dedupe-sleutel uit de tekst.
export function heuristicDesign(prompt: string): Integration {
  const p = prompt.toLowerCase();
  const systems = ["salesforce", "exact", "sap", "afas", "webshop", "erp", "warehouse", "carrier", "hubspot"];
  const found = systems.filter((s) => p.includes(s));
  const source = found[0] ?? "source";
  const target = found[1] ?? "target";

  const retryMatch = p.match(/(\d+)\s*(x|keer|retries|retry|maal)/);
  const attempts = retryMatch ? Math.min(10, Number(retryMatch[1])) : 3;
  const dedupeKeyMatch = p.match(/(kvk|kvk-nummer|kvknummer|email|e-mail|id)/);
  const wantsDlq = /dead-?letter|dlq/.test(p);

  const dedupeKey = dedupeKeyMatch ? dedupeKeyMatch[1].replace("-", "") : null;
  const steps: Integration["steps"] = [
    { id: "validate", type: "validate", config: { required: dedupeKey ? [dedupeKey] : [] } },
    { id: "transform", type: "transform" }
  ];
  if (dedupeKey) steps.push({ id: "dedupe", type: "duplicate-check", config: { key: dedupeKey } });
  steps.push({ id: `call-${target}`, type: "call", config: { target } });

  return {
    integration: titleCase(`${source} to ${target}`),
    version: "1",
    description: prompt.trim().slice(0, 200),
    trigger: { type: "webhook", source },
    steps,
    retry: { attempts, backoff: "exponential", onExhaust: wantsDlq || attempts > 0 ? "dead-letter-queue" : "fail" },
    monitoring: { enabled: true },
    agents: { monitoring: true, testing: true, security: true },
    approval: { productionDeployment: "required" }
  };
}

export interface DesignResult {
  integration: Integration;
  by: "claude" | "heuristic";
}

export async function design(prompt: string): Promise<DesignResult> {
  if (claudeAvailable()) {
    try {
      const integration = await claudeJson<Integration>({ system: SYSTEM, user: prompt, maxTokens: 1200 });
      if (integration?.integration && Array.isArray(integration.steps)) {
        return { integration, by: "claude" };
      }
    } catch {
      // val terug op heuristiek
    }
  }
  return { integration: heuristicDesign(prompt), by: "heuristic" };
}
