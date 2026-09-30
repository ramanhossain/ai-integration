import type { Integration } from "../domain/types";
import type { EnvName } from "../domain/environments";
import { deployments } from "../domain/deployments";
import { engine, type Run } from "../engine/engine";
import { credentials } from "../connectors/credentials";
import { requirementsOf } from "../api/transferRoutes";
import { agentGroups, BUILTIN } from "./agentGroups";

// Eén plek die bepaalt WAAR een proces draait. Een proces heeft per omgeving deploydoelen:
// één of meer agentgroepen (omgevingsvarianten, bv. PROD-platform, PROD-AWS, PROD-Azure).
// - failover: de eerste gezonde groep in de volgorde voert uit
// - all: elke gezonde groep voert uit (bv. actief-actief in twee clouds)
// De ingebouwde groep draait in het portaal; externe groepen krijgen een job die hun agent ophaalt.

type Opts = { triggeredBy?: string };

function subprocessesFor(def: Integration, env: EnvName): Integration[] {
  const out = new Map<string, Integration>();
  const walk = (d: Integration) => {
    for (const name of requirementsOf([d]).subprocesses) {
      if (out.has(name) || name === def.integration) continue;
      const sub = deployments.getActiveDefinition(name, env);
      if (sub) { out.set(name, sub); walk(sub); }
    }
  };
  walk(def);
  return [...out.values()];
}

function credentialsFor(defs: Integration[], env: EnvName) {
  const out: Record<string, { type: string; values: Record<string, string> }> = {};
  for (const name of requirementsOf(defs).credentials) {
    try { out[name] = credentials.resolve(name, env); } catch { /* ontbreekt: de stap faalt op de agent met een duidelijke fout */ }
  }
  return out;
}

function failedRun(def: Integration, env: EnvName, group: string, error: string, opts: Opts): Run {
  const now = new Date().toISOString();
  return engine.record({
    id: "", integration: def.integration, env, version: def.version ? Number(def.version) : null, status: "error", startedAt: now, finishedAt: now, durationMs: 0,
    steps: [], deadLettered: false, error, triggeredBy: opts.triggeredBy ?? "manual", agentGroup: group
  });
}

async function runOn(group: string, def: Integration, env: EnvName, input: Record<string, unknown>, opts: Opts): Promise<Run> {
  if (agentGroups.isBuiltin(group)) return engine.run(def, env, input, { triggeredBy: opts.triggeredBy, agentGroup: group });
  const subs = subprocessesFor(def, env);
  const { result } = agentGroups.enqueue<Run>({
    group, env, definition: def, subprocesses: subs, credentials: credentialsFor([def, ...subs], env), input, triggeredBy: opts.triggeredBy
  });
  try {
    const r = await result;
    return engine.record({ ...r, integration: def.integration, env, version: def.version ? Number(def.version) : null, agentGroup: group, triggeredBy: opts.triggeredBy ?? r.triggeredBy });
  } catch (err) {
    return failedRun(def, env, group, (err as Error).message, opts);
  }
}

// Voert een gedeployde versie uit volgens de deploydoelen. Geeft de run van de
// (eerste) groep terug; bij mode "all" draaien de andere groepen parallel mee.
export async function runDeployed(def: Integration, env: EnvName, input: Record<string, unknown>, opts: Opts = {}): Promise<Run> {
  if (!def.version) return engine.run(def, env, input, { triggeredBy: opts.triggeredBy, agentGroup: BUILTIN(env) }); // testrun uit de editor
  const t = agentGroups.getTargets(def.integration, env);
  const healthy = t.groups.filter((g) => agentGroups.healthy(g));
  if (!healthy.length) {
    const names = t.groups.join(", ");
    return failedRun(def, env, t.groups[0], `Geen agent online in ${t.groups.length === 1 ? "agentgroep" : "agentgroepen"} ${names}. Start de agent of kies een andere omgevingsvariant.`, opts);
  }
  if (t.mode === "all" && healthy.length > 1) {
    const runs = healthy.map((g) => runOn(g, def, env, input, opts));
    return runs[0];
  }
  // Failover: valt een externe groep weg (time-out), dan de volgende gezonde groep.
  let run = await runOn(healthy[0], def, env, input, opts);
  for (const g of healthy.slice(1)) {
    if (!(run.status === "error" && /^Geen resultaat van agentgroep/.test(run.error || ""))) break;
    run = await runOn(g, def, env, input, opts);
  }
  return run;
}
