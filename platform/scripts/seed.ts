// Vult een draaiende server met demodata via de publieke API (net als een externe machine).
// Run: npm run seed   (server moet draaien op PORT, default 3001)

const BASE = process.env.AIP_URL ?? `http://localhost:${process.env.PORT ?? 3001}`;

async function call(path: string, body?: unknown): Promise<any> {
  const res = await fetch(BASE + path, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${path}: ${json.error ?? res.status}`);
  return json;
}

async function promote(name: string, env: string, approvers: string[]) {
  const a = await call(`/api/v1/integrations/${name}/deploy`, { toEnv: env, proposedBy: "builder-agent" });
  for (const who of approvers) await call(`/api/v1/approvals/${a.id}/approve`, { approver: who });
}

async function main() {
  const webshop = await call("/api/v1/agents/builder/design", {
    prompt: "Stuur iedere nieuwe webshop-order naar het ERP. Controleer duplicaten op order-id en retry drie keer, daarna naar de dead-letter queue.",
    register: true
  });
  console.log(`gebouwd: ${webshop.integration.integration} (${webshop.by})`);

  const sf = await call("/api/v1/integrations", {
    integration: "SalesforceToExact",
    description: "Nieuwe Salesforce-customer naar Exact, met duplicaatcheck op KvK-nummer.",
    owner: "team-integratie",
    trigger: { type: "webhook", source: "salesforce" },
    steps: [
      { id: "validate", type: "validate", config: { required: ["kvkNumber"] } },
      { id: "map", type: "transform", config: { mapping: { exactRelationCode: "kvkNumber" } } },
      { id: "dedupe", type: "duplicate-check", config: { key: "kvkNumber" } },
      { id: "call-exact", type: "call", config: { target: "exact", endpoint: "/customers" } }
    ],
    retry: { attempts: 3, backoff: "exponential", onExhaust: "dead-letter-queue" }
  });
  console.log(`gebouwd: ${sf.integration}`);

  await promote("SalesforceToExact", "test", ["alice"]);
  await promote("SalesforceToExact", "acc", ["alice"]);
  await promote("SalesforceToExact", "prod", ["alice", "bob"]);
  await promote("WebshopToErp", "test", ["alice"]);
  console.log("gepromoveerd: SalesforceToExact -> PROD, WebshopToErp -> TEST");

  let n = 0;
  for (let i = 1; i <= 14; i++) {
    const bad = i % 6 === 0;
    await call("/api/v1/integrations/WebshopToErp/run", { env: i % 3 ? "test" : "dev", input: bad ? { customer: {} } : { id: `ORD-${i}`, customer: { email: `klant${i}@example.nl` } }, proposedBy: "seed" });
    await call("/api/v1/integrations/SalesforceToExact/run", { env: "acc", input: { kvkNumber: String(10000000 + i) }, proposedBy: "seed" });
    n += 2;
  }
  console.log(`${n} uitvoeringen gedraaid`);

  await call("/api/v1/integrations/WebshopToErp/deploy", { toEnv: "acc", proposedBy: "builder-agent" });
  await call("/api/v1/agents/monitoring/analyze", {
    integration: "SalesforceToExact", severity: "high", problem: "37 berichten gefaald", failedRequests: 37,
    rootCause: { endpoint: "/customers", symptom: "latency_increase", fromMs: 220, toMs: 4800 }
  });
  console.log("openstaand: deploy WebshopToErp -> ACC, herstelvoorstel Recovery Agent");
  console.log(`\nKlaar. Open ${BASE}/app/`);
}

main().catch((e) => {
  console.error("Seed faalde:", e.message);
  process.exit(1);
});
