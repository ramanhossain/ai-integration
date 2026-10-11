import { runInOrg } from "./context";
import { audit } from "../audit/auditLog";
import { deployments } from "../domain/deployments";
import { agentGroups } from "../runtime/agentGroups";
import { engine } from "../engine/engine";
import { registry } from "../domain/registry";
import { settings } from "../domain/settings";
import { drafts, pluginActivation } from "../domain/workspace";
import { approvals } from "../approval/approvalEngine";
import { credentials } from "../connectors/credentials";
import { broker } from "../connectors/queue";
import { datatables } from "../connectors/datatables";
import { triggers } from "../triggers/manager";
import { apim } from "../apim/apim";
import { as4 } from "../plugins/as4/manager";
import { ebms } from "../plugins/ebms/manager";

// Gegevens van één organisatie laden (in haar eigen context) en haar achtergrondwerk
// (queues, triggers) starten. Timers die hier ontstaan houden de context van de organisatie.
const hydrated = new Set<string>();
const started = new Set<string>();

export async function hydrateOrg(org: string): Promise<void> {
  if (hydrated.has(org)) return;
  hydrated.add(org);
  await runInOrg(org, async () => {
    await audit.hydrate();
    await deployments.hydrate();
    await agentGroups.hydrate();
    await engine.hydrate();
    await registry.hydrate();
    await settings.hydrate();
    await drafts.hydrate();
    await pluginActivation.hydrate();
    await approvals.hydrate();
    await credentials.hydrate();
    await broker.hydrate();
    await datatables.hydrate();
    await triggers.hydrate();
    await apim.hydrate();
    await ebms.hydrate();
    await as4.hydrate();
  });
}

export function startOrg(org: string): void {
  if (started.has(org)) return;
  started.add(org);
  runInOrg(org, () => {
    broker.start();
    triggers.start();
    ebms.start();
    as4.start();
  });
}

// Nieuwe organisatie (aanmelden): meteen bruikbaar.
export async function bootOrg(org: string): Promise<void> {
  await hydrateOrg(org);
  startOrg(org);
}
