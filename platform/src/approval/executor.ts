import type { Action } from "../domain/types";
import { deployments } from "../domain/deployments";
import { runDeployed } from "../runtime/dispatch";
import { agentGroups, type Targets } from "../runtime/agentGroups";
import { registry } from "../domain/registry";
import { isEnv, type EnvName } from "../domain/environments";

// Voert een goedgekeurde (of GREEN) actie deterministisch uit via de eigen engine
// en het deployment-model. Geen externe runtime meer.

export type ActionHandler = (action: Action) => Promise<Record<string, unknown>>;

function integrationName(a: Action): string {
  const name = a.target?.integration ?? (a.payload?.integration as string | undefined);
  if (!name) throw new Error("Actie mist target.integration");
  return name;
}

async function promoteTo(a: Action, env: EnvName): Promise<Record<string, unknown>> {
  const name = integrationName(a);
  const t = a.payload?.targets as Targets | undefined;
  if (t) { const err = agentGroups.validateTargets(env, t.groups || []); if (err) throw new Error(err); }
  // De versie ligt vast bij het voorstel (zodat de goedkeurder weet wat er live gaat);
  // zonder versie: de versie van de vorige omgeving, of anders de nieuwste op DEV.
  const version = a.payload?.version != null ? Number(a.payload.version) : undefined;
  const result = deployments.deploy(name, env, version, a.proposedBy);
  const targets = t ? agentGroups.setTargets(name, env, t, a.proposedBy) : agentGroups.getTargets(name, env);
  return { promoted: result, targets };
}

const handlers: Record<string, ActionHandler> = {
  "deploy.dev": async (a) => {
    const name = integrationName(a);
    const version = deployments.getActiveVersion(name, "dev");
    return { environment: "dev", integration: name, version, note: "DEV wordt gevuld bij bouwen." };
  },
  "deploy.test": (a) => promoteTo(a, "test"),
  "deploy.acc": (a) => promoteTo(a, "acc"),
  "deploy.prod": (a) => promoteTo(a, "prod"),
  "deploy.production": (a) => promoteTo(a, "prod"), // alias

  "integration.run": async (a) => {
    const name = integrationName(a);
    const env = (a.target?.environment && isEnv(a.target.environment) ? a.target.environment : "dev") as EnvName;
    const def = deployments.getActiveDefinition(name, env);
    if (!def) throw new Error(`Geen actieve versie van ${name} op ${env}`);
    const input = (a.payload?.input as Record<string, unknown>) ?? {};
    return { run: await runDeployed(def, env, input, { triggeredBy: a.proposedBy?.startsWith("mcp") ? "mcp" : "manual" }) };
  },

  "deployment.targets": async (a) => {
    const name = integrationName(a);
    const env = a.target?.environment;
    if (!env || !isEnv(env)) throw new Error("Omgeving ontbreekt");
    return { targets: agentGroups.setTargets(name, env, a.payload?.targets as Targets, a.proposedBy) };
  },
  "integration.delete": async (a) => {
    const name = integrationName(a);
    return { deleted: registry.deleteIntegration(name, a.proposedBy) };
  },

  "consumer.pause": async (a) => ({
    paused: true,
    integration: a.target?.integration,
    durationS: a.payload?.durationS ?? 300
  }),

  "scale.workers": async (a) => ({ scaled: true, ...(a.payload ?? {}) }),

  "mapping.update": async (a) => ({ applied: true, diff: a.diff ?? null }),

  "api.deploy": async (a) => {
    const env = a.target?.environment;
    const id = String(a.target?.resource || a.payload?.apiId || "");
    if (!env || !isEnv(env) || !id) throw new Error("API of omgeving ontbreekt");
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { apim } = require("../apim/apim") as typeof import("../apim/apim");
    return { deployed: apim.deployApi(id, env, a.payload?.version as string | undefined, a.proposedBy) };
  }
};

export function canExecute(type: string): boolean {
  return type in handlers;
}

export async function execute(action: Action): Promise<Record<string, unknown>> {
  const handler = handlers[action.type];
  if (!handler) {
    return { noop: true, note: `Geen executor voor '${action.type}'; geregistreerd zonder effect.` };
  }
  return handler(action);
}

export function registerHandler(type: string, handler: ActionHandler): void {
  handlers[type] = handler;
}
