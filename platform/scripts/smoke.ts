// Smoke-test van de core, zonder HTTP. Run: npm run smoke

import { approvals } from "../src/approval/approvalEngine";
import { registry } from "../src/domain/registry";
import { deployments } from "../src/domain/deployments";
import { engine } from "../src/engine/engine";
import { audit } from "../src/audit/auditLog";
import { settings } from "../src/domain/settings";
import { heuristicEdit } from "../src/agents/editor";
import type { Action, Integration } from "../src/domain/types";

let failures = 0;
const line = (t: string) => console.log(`\n=== ${t} ===`);
function assert(cond: boolean, msg: string) {
  console.log(`${cond ? "  ok " : "FAIL"}  ${msg}`);
  if (!cond) failures++;
}
async function expectThrow(fn: () => Promise<unknown>, msg: string) {
  try {
    await fn();
    assert(false, msg);
  } catch {
    assert(true, msg);
  }
}

const def: Integration = {
  integration: "WebshopToErp",
  trigger: { type: "webhook", source: "webshop" },
  steps: [
    { id: "validate", type: "validate", config: { required: ["orderId", "customer.email"] } },
    { id: "map", type: "transform", config: { mapping: { erpOrder: "orderId", email: "customer.email" } } },
    { id: "dedupe", type: "duplicate-check", config: { key: "orderId" } },
    { id: "call-erp", type: "call", config: { target: "erp" } }
  ],
  retry: { attempts: 2, backoff: "exponential", onExhaust: "dead-letter-queue" }
};

async function run() {
  line("Policy: GREEN / ORANGE / RED");
  const green = await approvals.propose({ type: "read.logs", proposedBy: "monitoring-agent" } as Action);
  assert(green.riskLevel === "green" && green.status === "executed", "read.logs => GREEN, direct uitgevoerd");
  const orange = await approvals.propose({ type: "mapping.update", proposedBy: "builder-agent" } as Action);
  await expectThrow(() => approvals.decide(orange.id, "builder-agent", "approve"), "4-ogen: indiener mag niet zelf goedkeuren");
  assert((await approvals.decide(orange.id, "alice", "approve")).status === "executed", "ORANGE uitgevoerd na 1 goedkeuring");

  line("Bouwen = nieuwe versie op DEV");
  registry.upsertIntegration(def);
  let s = deployments.getState("WebshopToErp")!;
  assert(s.latestVersion === 1 && s.envs.dev === 1, "v1 staat op DEV");
  assert(s.envs.test === null && s.envs.prod === null, "test/prod nog leeg");
  assert(JSON.stringify(deployments.promotableEnvs("WebshopToErp")) === '["test"]', "alleen TEST is promoveerbaar");

  line("Overslaan mag: DEV -> PROD (RED, 4-ogen), en terugzetten");
  registry.upsertIntegration({ ...def, integration: "SkipTest" });
  registry.upsertIntegration({ ...def, integration: "SkipTest", description: "v2" });
  const skip = await approvals.propose({ type: "deploy.prod", proposedBy: "builder-agent", target: { integration: "SkipTest", environment: "prod" }, payload: { version: 2 } } as Action);
  await approvals.decide(skip.id, "alice", "approve");
  const skipDone = await approvals.decide(skip.id, "bob", "approve");
  assert(skipDone.status === "executed" && deployments.getActiveVersion("SkipTest", "prod") === 2 && deployments.getActiveVersion("SkipTest", "test") === null, "DEV -> PROD met overslaan van TEST en ACC na 2 goedkeuringen");
  const back = await approvals.propose({ type: "deploy.prod", proposedBy: "builder-agent", target: { integration: "SkipTest", environment: "prod" }, payload: { version: 1 } } as Action);
  await approvals.decide(back.id, "alice", "approve");
  await approvals.decide(back.id, "bob", "approve");
  assert(deployments.getActiveVersion("SkipTest", "prod") === 1 && deployments.getState("SkipTest")!.history!.slice(-1)[0].kind === "rollback", "PROD terugzetten naar v1 (rollback in de geschiedenis)");

  line("DEV -> TEST (ORANGE)");
  const toTest = await approvals.propose({ type: "deploy.test", proposedBy: "builder-agent", target: { integration: "WebshopToErp", environment: "test" } } as Action);
  assert(toTest.riskLevel === "orange", "deploy.test => ORANGE");
  await approvals.decide(toTest.id, "alice", "approve");
  assert(deployments.getActiveVersion("WebshopToErp", "test") === 1, "v1 op TEST");

  line("TEST -> ACC (ORANGE)");
  const toAcc = await approvals.propose({ type: "deploy.acc", proposedBy: "builder-agent", target: { integration: "WebshopToErp", environment: "acc" } } as Action);
  await approvals.decide(toAcc.id, "alice", "approve");
  assert(deployments.getActiveVersion("WebshopToErp", "acc") === 1, "v1 op ACC");

  line("ACC -> PROD (RED, 4-ogen)");
  const toProd = await approvals.propose({ type: "deploy.prod", proposedBy: "builder-agent", target: { integration: "WebshopToErp", environment: "prod" } } as Action);
  assert(toProd.riskLevel === "red" && toProd.requiredApprovals === 2, "deploy.prod => RED, 2 goedkeuringen");
  await approvals.decide(toProd.id, "alice", "approve");
  assert(deployments.getActiveVersion("WebshopToErp", "prod") === null, "na 1 goedkeuring nog niet op PROD");
  await expectThrow(() => approvals.decide(toProd.id, "alice", "approve"), "dubbele goedkeurder geweigerd");
  await approvals.decide(toProd.id, "bob", "approve");
  assert(deployments.getActiveVersion("WebshopToErp", "prod") === 1, "v1 op PROD na 2 goedkeuringen");

  line("Nieuwe versie raakt alleen DEV");
  registry.upsertIntegration({ ...def, description: "v2" });
  s = deployments.getState("WebshopToErp")!;
  assert(s.envs.dev === 2 && s.envs.prod === 1, "v2 op DEV, PROD blijft v1");

  line("Engine: uitvoeren op PROD");
  const prodDef = deployments.getActiveDefinition("WebshopToErp", "prod")!;
  const ok = await engine.run(prodDef, "prod", { orderId: "TEST-ORDER-93822", customer: { email: "a@b.nl" } });
  assert(ok.status === "success" && ok.steps.length === 4, "run succesvol, 4 stappen");
  assert(ok.output?.erpOrder === "TEST-ORDER-93822", "transform-mapping toegepast");
  const bad = await engine.run(prodDef, "prod", { customer: { email: "a@b.nl" } });
  assert(bad.status === "error" && bad.steps[0].status === "failed", "validatie faalt zonder orderId");
  const m = engine.metrics();
  assert(m.totalRuns === 2 && m.successRate === 50, "metrics: 2 runs, 50% succes");

  line("Vier-ogenprincipe als instelling");
  assert(settings.fourEyes === true, "standaard staat het vier-ogenprincipe aan");
  const pendingBefore = await approvals.propose({ type: "deploy.prod", proposedBy: "builder-agent", target: { integration: "WebshopToErp", environment: "prod" } } as Action);
  const halfway = await approvals.propose({ type: "deploy.prod", proposedBy: "builder-agent", target: { integration: "WebshopToErp", environment: "prod" } } as Action);
  await approvals.decide(halfway.id, "alice", "approve");
  settings.update({ fourEyes: false }, "smoke-test");
  assert(approvals.get(pendingBefore.id)!.requiredApprovals === 1, "openstaand verzoek zonder beslissing volgt de nieuwe instelling (1 goedkeuring)");
  assert(approvals.get(halfway.id)!.requiredApprovals === 2, "verzoek met al een goedkeuring houdt de oorspronkelijke eis (2)");
  const solo = await approvals.propose({ type: "mapping.update", proposedBy: "carol" } as Action);
  const soloDone = await approvals.decide(solo.id, "carol", "approve");
  assert(soloDone.status === "executed", "uit: de indiener mag zelf goedkeuren");
  const redSolo = await approvals.propose({ type: "config.update", proposedBy: "carol", target: { environment: "prod" } } as Action);
  assert(redSolo.requiredApprovals === 1 && redSolo.fourEyes === false, "uit: nieuw verzoek vraagt 1 goedkeuring");
  settings.update({ fourEyes: true }, "smoke-test");
  const again = await approvals.propose({ type: "mapping.update", proposedBy: "carol" } as Action);
  await expectThrow(() => approvals.decide(again.id, "carol", "approve"), "weer aan: indiener mag niet zelf goedkeuren");
  const redAgain = await approvals.propose({ type: "deploy.prod", proposedBy: "carol", target: { integration: "WebshopToErp", environment: "prod" } } as Action);
  assert(redAgain.requiredApprovals === 2, "weer aan: PROD vraagt 2 goedkeuringen");

  line("BPMN-graaf: beslissing met true/false-pad");
  const graph: Integration = {
    integration: "OrderRouting",
    trigger: { type: "webhook" },
    steps: [
      { id: "check", type: "validate", config: { required: ["orderId"] } },
      { id: "isPrio", type: "branch", config: { when: "priority" } },
      { id: "spoed", type: "enrich", config: { set: { lane: "spoed" } } },
      { id: "normaal", type: "enrich", config: { set: { lane: "normaal" } } },
      { id: "klaar", type: "end" }
    ],
    connections: [
      { from: "start", to: "check" },
      { from: "check", to: "isPrio" },
      { from: "isPrio", to: "spoed", port: "true" },
      { from: "isPrio", to: "normaal", port: "false" },
      { from: "spoed", to: "klaar" },
      { from: "normaal", to: "klaar" }
    ]
  };
  const prio = await engine.run(graph, "dev", { orderId: "A1", priority: true });
  assert(prio.output?.lane === "spoed" && !prio.steps.some((s) => s.id === "normaal"), "priority=true volgt het true-pad");
  const norm = await engine.run(graph, "dev", { orderId: "A2", priority: false });
  assert(norm.output?.lane === "normaal" && norm.steps.find((s) => s.id === "isPrio")?.port === "false", "priority=false volgt het false-pad");
  assert(norm.steps.every((s) => s.input !== undefined), "input per stap vastgelegd");
  const single = await engine.executeStep("transform", { mapping: { b: "a" } }, { a: 1 });
  assert(single.ok && (single.output as any).b === 1, "losse stap uitvoeren werkt");
  const loop = await engine.run(
    { ...graph, integration: "Lus", steps: [{ id: "x", type: "custom" }], connections: [{ from: "start", to: "x" }, { from: "x", to: "x" }] },
    "dev",
    {}
  );
  assert(loop.status === "error" && /lus/.test(loop.error ?? ""), "oneindige lus wordt afgebroken");

  line("Stap deactiveren en output vastzetten");
  const flagDef: any = { integration: "Flags", trigger: { type: "manual" }, steps: [
    { id: "check", type: "validate", config: { required: ["bestaatNiet"] }, disabled: true },
    { id: "calc", type: "code", config: { code: "return { ...input, berekend: 1 };" }, pinData: { vast: true } },
    { id: "set", type: "enrich", config: { set: { klaar: true } } }
  ], connections: [{ from: "start", to: "check" }, { from: "check", to: "calc" }, { from: "calc", to: "set" }] };
  const flagRun = await engine.run(flagDef, "dev", { a: 1 });
  assert(flagRun.status === "success" && flagRun.steps[0].status === "skipped", "gedeactiveerde validatie wordt overgeslagen (anders faalde hij)");
  assert(flagRun.output?.vast === true && flagRun.output?.berekend === undefined && flagRun.output?.klaar === true, "vastgezette output gebruikt in test-run");
  const flagProd = await engine.run({ ...flagDef, version: "3" }, "prod", { a: 1 });
  assert(flagProd.output?.berekend === 1, "vastgezette output geldt niet voor echte (versie-)runs");

  line("AI-bewerken van een proces (heuristiek)");
  let ed: any = { integration: "EditTest", trigger: { type: "manual" }, steps: [{ id: "validate", type: "validate", name: "Validatie", config: { required: [] } }, { id: "end", type: "end", name: "Einde", config: {} }], connections: [{ from: "start", to: "validate" }, { from: "validate", to: "end" }] };
  const pathOf = (d: any) => { const out: string[] = []; let cur = "start"; for (let i = 0; i < 20; i++) { const c = d.connections.find((x: any) => x.from === cur && x.port !== "false"); if (!c) break; out.push(d.steps.find((x: any) => x.id === c.to).type); cur = c.to; } return out.join(">"); };
  let r = heuristicEdit(ed, "voeg een duplicaatcheck op orderId toe, stuur daarna een e-mail naar ops@bedrijf.nl");
  assert(r.understood && pathOf(r.definition) === "validate>duplicate-check>email>end", "twee stappen toegevoegd vóór het eindevent");
  ed = r.definition;
  r = heuristicEdit(ed, "voeg een HTTP-aanroep toe naar https://erp.example.nl/orders na de duplicaatcheck");
  assert(pathOf(r.definition) === "validate>duplicate-check>call>email>end" && (r.definition.steps.find((x: any) => x.type === "call") as any)?.config?.url === "https://erp.example.nl/orders", "stap ingevoegd op de gevraagde plek met URL");
  ed = r.definition;
  r = heuristicEdit(ed, "zet de trigger op elke 5 minuten en verwijder de e-mail");
  assert(r.definition.trigger.cron === "*/5 * * * *" && pathOf(r.definition) === "validate>duplicate-check>call>end", "trigger gezet en e-mail verwijderd (verbinding doorgekoppeld)");
  r = heuristicEdit(r.definition, "3 keer opnieuw proberen en daarna dead-letter");
  assert(r.definition.retry?.attempts === 3 && r.definition.retry?.onExhaust === "dead-letter-queue", "retry en dead-letter ingesteld");
  assert(!heuristicEdit(r.definition, "blablabla").understood, "onbegrijpelijke opdracht verandert niets");
  const ask = heuristicEdit(ed, "verander de trigger");
  assert(!ask.understood && ask.ask === "trigger", "'verander de trigger' zonder soort: agent vraagt welke trigger");
  assert(heuristicEdit(ed, "wijzig de trigger naar API-endpoint").definition.trigger.type === "api", "trigger naar API-endpoint");
  assert(heuristicEdit(ed, "start dagelijks om 7 uur").definition.trigger.cron === "0 7 * * *", "trigger: dagelijks om 7 uur");
  assert(heuristicEdit(ed, "stuur een e-mail naar a@b.nl als het proces start").definition.steps.some((x: any) => x.type === "email"), "stap met het woord 'start' wordt geen triggervraag");
  const whole = heuristicEdit({ ...ed, steps: [{ id: "validate", type: "validate", config: { required: [] } }], connections: [{ from: "start", to: "validate" }] }, "Maak een integratie die iedere nieuwe Salesforce-customer naar Exact stuurt met duplicaatcheck op KvK-nummer");
  assert(whole.definition.integration === "EditTest" && whole.definition.steps.length >= 4, "leeg proces + beschrijving: volledig opgebouwd, naam behouden");

  line("Audit-integriteit");
  assert(audit.verify().valid, "audit-keten geldig");

  console.log(`\n${failures === 0 ? "ALLE CHECKS GESLAAGD ✓" : `${failures} CHECK(S) GEFAALD ✗`}`);
  process.exit(failures === 0 ? 0 : 1);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
