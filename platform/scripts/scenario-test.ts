// End-to-end scenario's: integraties naar echte systemen bouwen, opslaan, starten en controleren.
// Vereist een draaiende testserver (AIP_AUTH=off) en lokale testsystemen:
//   SMTP 127.0.0.1:2525, MQTT 1884, PostgreSQL 5433, MongoDB 27018, mock-ERP 4010 (met /_mails en /_mqtt)
// Publieke API's (open-meteo, CoinGecko, npm, GraphQL, SOAP) worden overgeslagen als er geen internet is.
//   Testsystemen: zie scripts/test-systems.mjs. Testserver met AIP_POLL_MIN_SECONDS=1.
//   AIP_URL=http://localhost:3099 npx tsx scripts/scenario-test.ts

import { mkdtempSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const BASE = process.env.AIP_URL ?? "http://localhost:3099";
const MOCK = process.env.AIP_MOCK ?? "http://127.0.0.1:4010";
const RUN = Date.now().toString(36);
let failures = 0;
let passed = 0;
const line = (s: string) => console.log(`\n=== ${s} ===`);
const assert = (cond: unknown, msg: string, detail?: unknown) => {
  if (cond) { passed++; console.log(`  ok   ${msg}`); }
  else { failures++; console.log(`  FOUT ${msg}`, detail === undefined ? "" : JSON.stringify(detail).slice(0, 600)); }
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function api(method: string, path: string, body?: unknown): Promise<{ status: number; data: any }> {
  const res = await fetch(BASE + path, { method, headers: { "content-type": "application/json", "x-aip-user": "scenario-test" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let data: any = text;
  try { data = JSON.parse(text); } catch { /* tekst */ }
  return { status: res.status, data };
}
const testRun = async (definition: any, input: any) => (await api("POST", "/api/v1/engine/test-run", { definition, input })).data;
const save = async (def: any) => api("POST", "/api/v1/integrations", def);
const cred = (name: string, body: any) => api("PUT", `/api/v1/credentials/${name}`, body);
const linear = (name: string, trigger: any, steps: any[]) => ({
  integration: name, trigger, steps,
  connections: steps.map((s, i) => ({ from: i === 0 ? "start" : steps[i - 1].id, to: s.id })),
  retry: { attempts: 1, backoff: "none", onExhaust: "dead-letter-queue" }
});
async function waitFor<T>(fn: () => Promise<T | undefined | null | false>, ms = 15000): Promise<T | undefined> {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn(); if (v) return v as T; await sleep(300); }
  return undefined;
}
const isOnline = () => fetch("https://api.open-meteo.com/v1/forecast?latitude=52&longitude=5&current=temperature_2m", { signal: AbortSignal.timeout(5000) }).then((r) => r.ok, () => false);

async function main() {
  const online = await isOnline();
  await fetch(`${MOCK}/_reset`);

  // Koppelingen naar de testsystemen
  await cred("erp", { type: "http-bearer", values: { dev: { token: "erp-token" } } });
  await cred("smtp-lokaal", { type: "smtp", values: { dev: { host: "127.0.0.1", port: "2525", secure: "false", from: "integraties@aip.test" } } });
  await cred("pg-crm", { type: "postgres", values: { dev: { connectionString: "postgres://postgres@127.0.0.1:5433/postgres" } } });
  await cred("pg-plugin", { type: "plugin", plugin: "postgres", values: { dev: { host: "127.0.0.1", port: "5434", user: "postgres", password: "welkom", database: "postgres" } } });
  await cred("mongo", { type: "plugin", plugin: "mongodb", values: { dev: { connectionString: "mongodb://127.0.0.1:27018", database: `aip_${RUN}` } } });
  await cred("mqtt-broker", { type: "plugin", plugin: "mqtt", values: { dev: { url: "mqtt://127.0.0.1:1884", clientId: `aip-${RUN}` } } });

  line("1. Webhook-order -> ERP (REST, bearer) -> bevestiging per e-mail (SMTP)");
  const orderFlow = `OrderNaarErp${RUN}`;
  const s1 = await save(linear(orderFlow, { type: "webhook", path: `orders-${RUN}`, method: "POST" }, [
    { id: "check", type: "validate", config: { required: ["klantId", "regels"] } },
    { id: "klant", type: "call", config: { method: "GET", url: `${MOCK}/customers/{{klantId}}`, credential: "erp", target: "klant" } },
    { id: "totaal", type: "code", config: { code: "return { ...input, totaal: input.regels.reduce((s, r) => s + r.aantal * r.prijs, 0) };" } },
    { id: "order", type: "call", config: { method: "POST", url: `${MOCK}/orders`, credential: "erp", body: "custom", bodyTemplate: { customerId: "{{klantId}}", total: "{{totaal}}", lines: "{{regels}}" }, target: "erpOrder" } },
    { id: "mail", type: "email", config: { credential: "smtp-lokaal", to: "{{klant.body.email}}", subject: "Order {{erpOrder.body.id}} ontvangen", text: "Beste {{klant.body.name}}, uw order van EUR {{totaal}} is verwerkt." } }
  ]));
  assert(s1.status === 200, "proces opgeslagen", s1.data);
  const hook = await fetch(`${BASE}/hooks/dev/orders-${RUN}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ klantId: 1, regels: [{ sku: "A", aantal: 2, prijs: 12.5 }, { sku: "B", aantal: 1, prijs: 5 }] }) });
  const hookBody: any = await hook.json().catch(() => ({}));
  assert(hook.status === 200, "webhook geeft 200", hookBody);
  const erpOrders = ((await (await fetch(`${MOCK}/orders`, { headers: { authorization: "Bearer erp-token" } })).json()) as any).items;
  assert(erpOrders.length === 1 && erpOrders[0].total === 30 && erpOrders[0].customerId === 1 && Array.isArray(erpOrders[0].lines), "order staat in het ERP met totaal 30 (types behouden)", erpOrders);
  const mails: any = await (await fetch(`${MOCK}/_mails`)).json();
  assert(mails.length === 1 && mails[0].to[0] === "info@jansen.nl" && /Order 1 ontvangen/.test(mails[0].raw), "bevestiging echt verstuurd via SMTP", mails);
  const bad = await fetch(`${BASE}/hooks/dev/orders-${RUN}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ klantId: 99 }) });
  assert(bad.status === 422, "ontbrekende regels -> 422", bad.status);
  const unknownCust = await fetch(`${BASE}/hooks/dev/orders-${RUN}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ klantId: 99, regels: [] }) });
  assert(unknownCust.status >= 400, "onbekende klant in ERP (404) laat de run falen", unknownCust.status);

  line("2. PostgreSQL (SQL-stap) -> CSV -> FTP-server");
  const { FtpSrv } = await import("ftp-srv") as any;
  const root = mkdtempSync(join(tmpdir(), "aip-scn-ftp-"));
  mkdirSync(join(root, "export"));
  const ftp = new FtpSrv({ url: "ftp://127.0.0.1:2122", pasv_url: "127.0.0.1", pasv_min: 30300, pasv_max: 30400, anonymous: false, log: { trace() {}, debug() {}, info() {}, warn() {}, error() {}, child() { return this; } } });
  ftp.on("login", ({ username, password }: any, resolve: any, reject: any) => (username === "demo@demo.nl" && password === "welkom" ? resolve({ root }) : reject(new Error("login"))));
  await ftp.listen();
  await cred("ftp-partner", { type: "ftp", values: { dev: { host: "127.0.0.1", port: "2122", user: "demo@demo.nl", password: "welkom" } } });
  try {
    const r2 = await testRun(linear("KlantenExport", { type: "manual" }, [
      { id: "lees", type: "sql", config: { credential: "pg-crm", query: "select id, naam, plaats from klanten where plaats <> $1 order by id", params: ["{{uitsluiten}}"], target: "klanten" } },
      { id: "csv", type: "csv", config: { mode: "generate", field: "klanten", target: "csv", delimiter: ";" } },
      { id: "upload", type: "ftp", config: { credential: "ftp-partner", operation: "upload", path: "/export/klanten-{{$date}}.csv", contentField: "csv", format: "text" } }
    ]), { uitsluiten: "Amsterdam" });
    assert(r2.status === "success", "run geslaagd", r2.error);
    const file = existsSync(join(root, "export")) ? (await import("node:fs")).readdirSync(join(root, "export"))[0] : undefined;
    const content = file ? readFileSync(join(root, "export", file), "utf8") : "";
    assert(/Jansen BV;Utrecht/.test(content) && /Bakkerij Smit;Zwolle/.test(content), "CSV met klanten uit PostgreSQL staat op de FTP-server", content);
  } finally { await ftp.close(); }

  line("3. PostgreSQL-plugin: rij invoegen en terugzoeken");
  const r3 = await testRun(linear("PgPlugin", { type: "manual" }, [
    { id: "insert", type: "connector", config: { plugin: "postgres", operation: "insert", credential: "pg-plugin", params: { table: "klanten", rows: [{ naam: "{{naam}}", email: "{{email}}", plaats: "Delft" }] } } },
    { id: "zoek", type: "connector", config: { plugin: "postgres", operation: "query", credential: "pg-plugin", params: { sql: "select naam, plaats from klanten where email = $1", parameters: ["{{email}}"] }, target: "gevonden" } }
  ]), { naam: "Fietsen Delft", email: `delft-${RUN}@example.nl` });
  assert(r3.status === "success", "run geslaagd", r3.error ?? r3.steps?.map((s: any) => s.error).filter(Boolean));
  assert(JSON.stringify(r3.output?.gevonden).includes("Fietsen Delft"), "ingevoegde rij teruggevonden", r3.output?.gevonden);

  line("4. MongoDB: documenten invoegen en aggregeren");
  const r4 = await testRun(linear("MongoSync", { type: "manual" }, [
    { id: "insert", type: "connector", config: { plugin: "mongodb", operation: "insert", credential: "mongo", params: { collection: "orders", documents: "{{orders}}" } } },
    { id: "agg", type: "connector", config: { plugin: "mongodb", operation: "aggregate", credential: "mongo", params: { collection: "orders", pipeline: [{ $group: { _id: "$klant", omzet: { $sum: "$bedrag" } } }, { $sort: { _id: 1 } }] }, target: "omzet" } },
    { id: "tel", type: "connector", config: { plugin: "mongodb", operation: "count", credential: "mongo", params: { collection: "orders", filter: { klant: "A" } }, target: "aantalA" } }
  ]), { orders: [{ klant: "A", bedrag: 10 }, { klant: "B", bedrag: 7 }, { klant: "A", bedrag: 5 }] });
  assert(r4.status === "success", "run geslaagd", r4.error ?? r4.steps?.map((s: any) => s.error).filter(Boolean));
  const omzet = JSON.stringify(r4.output?.omzet ?? "");
  assert(/"_id":"A","omzet":15/.test(omzet) && /"_id":"B","omzet":7/.test(omzet), "aggregatie per klant klopt", r4.output?.omzet);
  assert(JSON.stringify(r4.output?.aantalA).includes("2"), "count klant A = 2", r4.output?.aantalA);

  line("5. IoT: meetwaarde -> beslissing -> MQTT-alarm");
  const iot = {
    integration: "SensorAlarm", trigger: { type: "manual" },
    steps: [
      { id: "te-warm", type: "branch", config: { when: "temperatuur", op: "gt", value: 30 } },
      { id: "alarm", type: "connector", config: { plugin: "mqtt", operation: "publish", credential: "mqtt-broker", params: { topic: "fabriek/{{lijn}}/alarm", message: "Temperatuur {{temperatuur}} C op {{lijn}}" } } },
      { id: "ok", type: "end" }
    ],
    connections: [{ from: "start", to: "te-warm" }, { from: "te-warm", to: "alarm", port: "true" }, { from: "te-warm", to: "ok", port: "false" }],
    retry: { attempts: 1, backoff: "none" }
  };
  const r5a = await testRun(iot, { lijn: "lijn1", temperatuur: 35 });
  const r5b = await testRun(iot, { lijn: "lijn2", temperatuur: 21 });
  assert(r5a.status === "success" && r5b.status === "success", "beide runs geslaagd", [r5a.error, r5b.error, r5a.steps?.map((s: any) => s.error)]);
  await sleep(300);
  const mq: any = await (await fetch(`${MOCK}/_mqtt`)).json();
  assert(mq.length === 1 && mq[0].topic === "fabriek/lijn1/alarm" && mq[0].payload.includes("35"), "alleen het alarm van lijn1 staat op de broker", mq);

  line("6. Queue-koppeling: producent -> queue -> consument -> datatabel");
  const tbl = `meldingen_${RUN}`;
  await api("POST", "/api/v1/datatables/dev", { name: tbl, columns: [{ name: "ref", type: "string" }, { name: "prioriteit", type: "string" }] });
  const q = `meldingen-${RUN}`;
  await save(linear(`MeldingConsument${RUN}`, { type: "queue", queue: q }, [
    { id: "check", type: "validate", config: { required: ["ref"] } },
    { id: "opslaan", type: "datatable", config: { table: tbl, operation: "upsert", conditions: [{ column: "ref", op: "eq", value: "{{ref}}" }], values: { ref: "{{ref}}", prioriteit: "{{prioriteit}}" } } }
  ]));
  await save(linear(`MeldingProducent${RUN}`, { type: "manual" }, [{ id: "zet", type: "queue-publish", config: { queue: q } }]));
  for (const ref of ["M-1", "M-2", "M-1"]) await api("POST", `/api/v1/integrations/MeldingProducent${RUN}/run`, { env: "dev", input: { ref, prioriteit: ref === "M-2" ? "hoog" : "laag" } });
  const rows = await waitFor(async () => { const d = (await api("GET", `/api/v1/datatables/dev/${tbl}/rows`)).data; return d.total === 2 ? d : undefined; });
  assert(rows?.total === 2, "upsert: 3 berichten, 2 unieke rijen in de datatabel", rows);

  line("7. API-endpoint: klant opvragen uit PostgreSQL (REST naar buiten)");
  const apiFlow = `KlantApi${RUN}`;
  const s7 = await save(linear(apiFlow, { type: "api", path: `klanten${RUN}/{id}`, method: "GET" }, [
    { id: "lees", type: "sql", config: { credential: "pg-crm", query: "select id, naam, email from klanten where id = $1", params: ["{{params.id}}"], single: true, target: "klant" } },
    { id: "uit", type: "transform", config: { keepOthers: false, mapping: { id: "klant.id", naam: "klant.naam", email: "klant.email" } } }
  ]));
  assert(s7.status === 200, "API-proces opgeslagen", s7.data);
  const k = await fetch(`${BASE}/apis/dev/klanten${RUN}/1`);
  const kb: any = await k.json().catch(() => ({}));
  assert(k.status === 200 && JSON.stringify(kb).includes("Jansen BV"), "GET /apis/dev/klanten/1 geeft de klant uit PostgreSQL", kb);

  line("8. Lus: per klant uit het ERP een subproces (forEach) dat de klant in MongoDB zet");
  await save(linear(`KlantNaarMongo${RUN}`, { type: "manual" }, [
    { id: "zet", type: "connector", config: { plugin: "mongodb", operation: "insert", credential: "mongo", params: { collection: "klanten", documents: [{ erpId: "{{id}}", naam: "{{name}}", bron: "{{bron}}" }] } } }
  ]));
  const r8 = await testRun(linear("KlantenSync", { type: "manual" }, [
    { id: "haal", type: "call", config: { method: "GET", url: `${MOCK}/customers`, credential: "erp", target: "erp" } },
    { id: "lus", type: "subprocess", config: { process: `KlantNaarMongo${RUN}`, forEach: "erp.body.items", with: { bron: "erp" }, concurrency: 2, target: "sync" } },
    { id: "tel", type: "connector", config: { plugin: "mongodb", operation: "count", credential: "mongo", params: { collection: "klanten", filter: { bron: "erp" } }, target: "aantal" } }
  ]), {});
  assert(r8.status === "success" && r8.output?.syncSamenvatting?.geslaagd === 2, "subproces 2x uitgevoerd", r8.error ?? r8.output?.syncSamenvatting);
  assert(JSON.stringify(r8.output?.aantal).includes("2"), "2 klanten in MongoDB", r8.output?.aantal);

  line("9. Bestanden: XML-factuur lezen -> JSON-bestand schrijven (lokale map)");
  await api("POST", "/api/v1/files/dev", { path: `facturen-${RUN}/f1.xml`, content: "<factuur><nummer>2026-17</nummer><regel><omschrijving>Advies</omschrijving><bedrag>450</bedrag></regel><regel><omschrijving>Reiskosten</omschrijving><bedrag>35.5</bedrag></regel></factuur>" });
  const r9 = await testRun(linear("FactuurXmlNaarJson", { type: "manual" }, [
    { id: "lees", type: "file", config: { operation: "read", path: `facturen-${RUN}/f1.xml`, format: "xml" } },
    { id: "som", type: "code", config: { code: "const f = input.file.data.factuur; const regels = [].concat(f.regel); return { nummer: f.nummer, totaal: regels.reduce((s, r) => s + Number(r.bedrag), 0), regels };" } },
    { id: "schrijf", type: "file", config: { operation: "write", path: `facturen-${RUN}/f1.json`, format: "json" } }
  ]), {});
  assert(r9.status === "success" && r9.output?.totaal === 485.5, "XML gelezen en totaal 485.5 berekend", r9.error ?? r9.output);
  const f9 = (await api("GET", `/api/v1/files/dev/content?path=facturen-${RUN}/f1.json`)).data;
  assert(JSON.stringify(f9).includes("485.5"), "JSON-bestand geschreven", f9);

  line("15. Overheid: melding -> ZGW Zaken API (JWT) -> zaak + status");
  await cred("openzaak", { type: "plugin", plugin: "zgw-zaken", values: { dev: { url: `${MOCK}/zaken/api/v1`, clientId: "aip-test", secret: "zgw-geheim" } } });
  const r15 = await testRun(linear("MeldingNaarZaak", { type: "manual" }, [
    { id: "datum", type: "datetime", config: { operation: "now", format: "YYYY-MM-DD", target: "vandaag" } },
    { id: "zaak", type: "connector", config: { plugin: "zgw-zaken", operation: "zaak.create", credential: "openzaak", params: { bronorganisatie: "002220647", verantwoordelijkeOrganisatie: "002220647", zaaktype: "https://catalogi.test/zaaktypen/melding", startdatum: "{{vandaag}}", omschrijving: "Melding openbare ruimte: {{omschrijving}}" }, target: "zaak" } },
    { id: "status", type: "connector", config: { plugin: "zgw-zaken", operation: "status.create", credential: "openzaak", params: { zaak: "{{zaak.url}}", statustype: "https://catalogi.test/statustypen/ontvangen", datumStatusGezet: "{{$now}}" }, target: "status" } }
  ]), { omschrijving: "losliggende stoeptegel" });
  assert(r15.status === "success" && r15.output?.zaak?.identificatie === "ZAAK-1", "zaak aangemaakt in de Zaken API", r15.error ?? r15.output);
  const zgw: any = await (await fetch(`${MOCK}/_zgw`)).json();
  assert(zgw.auth.length === 2 && zgw.auth.every((a: any) => a.ok && a.claims.client_id === "aip-test" && a.crs === "EPSG:4326"), "JWT (HS256, client_id) en Accept-Crs correct meegestuurd", zgw.auth);
  assert(zgw.zaken[0]?.status === "https://catalogi.test/statustypen/ontvangen" && /^\d{4}-\d{2}-\d{2}$/.test(zgw.zaken[0]?.startdatum), "status gezet en startdatum als YYYY-MM-DD", zgw.zaken[0]);

  line("16. SOAP-stap: envelope, SOAPAction en SOAP Fault");
  const soapDef = (n: number) => linear("SoapDubbel", { type: "manual" }, [
    { id: "soap", type: "soap", config: { url: `${MOCK}/soap`, action: "urn:test#Double", body: "<m:Double xmlns:m=\"urn:test\"><ubiNum>{{getal}}</ubiNum></m:Double>", target: "antwoord" } }
  ]);
  const r16 = await testRun(soapDef(21), { getal: 21 });
  assert(r16.status === "success" && r16.output?.antwoord?.body?.DoubleResponse?.Result === 42 && r16.output?.antwoord?.body?.DoubleResponse?.Action === '"urn:test#Double"', "SOAP-antwoord 42 met SOAPAction-header", r16.error ?? r16.output);
  const r16b = await testRun(soapDef(-1), { getal: -1 });
  assert(r16b.status === "error" && /SOAP Fault: Negatief getal/.test(r16b.error), "SOAP Fault wordt een duidelijke fout", r16b.error);

  line("17. Lijsten: filteren, sorteren, samenvatten, koppelen en vergelijken");
  const r17 = await testRun(linear("OrderAnalyse", { type: "manual" }, [
    { id: "betaald", type: "list", config: { operation: "filter", field: "orders", target: "betaald", conditions: [{ field: "status", op: "equals", value: "betaald" }] } },
    { id: "sorteer", type: "list", config: { operation: "sort", field: "betaald", by: "bedrag", desc: true } },
    { id: "top", type: "list", config: { operation: "limit", field: "betaald", target: "top2", count: 2 } },
    { id: "perKlant", type: "list", config: { operation: "summarize", field: "betaald", target: "perKlant", groupBy: "klant", metrics: [{ field: "bedrag", fn: "sum", as: "omzet" }, { fn: "count", as: "aantal" }] } },
    { id: "namen", type: "list", config: { operation: "join", field: "perKlant", with: "klanten", key: "klant", otherKey: "id", mode: "left" } },
    { id: "uniek", type: "list", config: { operation: "dedupe", field: "orders", target: "uniekeKlanten", key: "klant" } },
    { id: "diff", type: "list", config: { operation: "compare", field: "klanten", with: "crm", key: "id", target: "verschil" } }
  ]), {
    orders: [{ id: 1, klant: "A", bedrag: 50, status: "betaald" }, { id: 2, klant: "B", bedrag: 20, status: "open" }, { id: 3, klant: "A", bedrag: 30, status: "betaald" }, { id: 4, klant: "C", bedrag: 90, status: "betaald" }],
    klanten: [{ id: "A", naam: "Jansen" }, { id: "C", naam: "Smit" }, { id: "D", naam: "Nieuw" }],
    crm: [{ id: "A", naam: "Jansen" }, { id: "C", naam: "Smit BV" }, { id: "E", naam: "Oud" }]
  });
  const o17 = r17.output ?? {};
  assert(r17.status === "success", "run geslaagd", r17.error);
  assert(o17.betaald?.map((x: any) => x.id).join() === "4,1,3" && o17.top2?.length === 2, "filter + sorteren aflopend + top 2", o17.betaald);
  const pk = Object.fromEntries((o17.perKlant ?? []).map((r: any) => [r.klant, `${r.naam}:${r.omzet}:${r.aantal}`]));
  assert(o17.perKlant?.length === 2 && pk.A === "Jansen:80:2" && pk.C === "Smit:90:1", "samenvatten per klant + join met namen", o17.perKlant);
  assert(o17.uniekeKlanten?.length === 3, "ontdubbelen op klant", o17.uniekeKlanten);
  assert(o17.verschil?.telling?.gelijk === 1 && o17.verschil?.telling?.verschillend === 1 && o17.verschil?.alleenLinks?.[0]?.id === "D" && o17.verschil?.alleenRechts?.[0]?.id === "E", "datasets vergelijken", o17.verschil?.telling);

  line("18. Switch: order routeren naar land-specifiek pad");
  const sw = {
    integration: "LandRouter", trigger: { type: "manual" },
    steps: [
      { id: "land", type: "switch", config: { field: "land", rules: [{ name: "nl", op: "equals", value: "NL" }, { name: "be", op: "in", value: "BE,LU" }] } },
      { id: "nl", type: "enrich", config: { set: { kanaal: "PostNL" } } },
      { id: "be", type: "enrich", config: { set: { kanaal: "bpost" } } },
      { id: "anders", type: "enrich", config: { set: { kanaal: "DHL" } } }
    ],
    connections: [{ from: "start", to: "land" }, { from: "land", to: "nl", port: "nl" }, { from: "land", to: "be", port: "be" }, { from: "land", to: "anders", port: "default" }],
    retry: { attempts: 1, backoff: "none" }
  };
  const kan = async (land: string) => (await testRun(sw, { land })).output?.kanaal;
  assert((await kan("NL")) === "PostNL" && (await kan("LU")) === "bpost" && (await kan("DE")) === "DHL", "NL -> PostNL, LU -> bpost, DE -> default DHL");

  line("19. Beveiliging: webhook-handtekening (HMAC), JWT maken en controleren, JSON Schema");
  await cred("webhook-secret", { type: "generic", values: { dev: { secret: "s3cr3t" } } });
  const sig = (await import("node:crypto")).createHmac("sha256", "s3cr3t").update('{"a":1}').digest("hex");
  const sec = linear("Beveiliging", { type: "manual" }, [
    { id: "hmac", type: "crypto", config: { operation: "hmacVerify", field: "raw", credential: "webhook-secret", signature: "{{handtekening}}", target: "echt" } },
    { id: "schema", type: "validate", config: { schema: { type: "object", required: ["klant"], properties: { klant: { type: "object", required: ["email"], properties: { email: { type: "string", format: "email", pattern: "@" } } } } } } },
    { id: "token", type: "jwt", config: { operation: "sign", credential: "webhook-secret", claims: { sub: "{{klant.email}}", rol: "klant" }, expiresIn: 300 } },
    { id: "check", type: "jwt", config: { operation: "verify", credential: "webhook-secret", tokenField: "token", target: "jwt" } },
    { id: "hash", type: "crypto", config: { operation: "hash", value: "{{klant.email}}", algorithm: "sha256", target: "emailHash" } },
    { id: "gzip", type: "compression", config: { operation: "gzip", field: "raw", target: "ingepakt" } },
    { id: "gunzip", type: "compression", config: { operation: "gunzip", field: "ingepakt", target: "terug", parseJson: true } }
  ]);
  const r19 = await testRun(sec, { raw: '{"a":1}', handtekening: `sha256=${sig}`, klant: { email: "jan@example.nl" } });
  assert(r19.status === "success" && r19.output?.echt === true && r19.output?.jwt?.claims?.sub === "jan@example.nl" && r19.output?.emailHash?.length === 64 && r19.output?.terug?.a === 1, "HMAC klopt, JWT geldig, hash + gzip heen en terug", r19.error ?? r19.output);
  const r19b = await testRun(sec, { raw: '{"a":2}', handtekening: `sha256=${sig}`, klant: { email: "jan@example.nl" } });
  assert(r19b.status === "error" && /HMAC/.test(r19b.error), "vervalste body -> handtekening klopt niet", r19b.error);
  const r19c = await testRun(sec, { raw: '{"a":1}', handtekening: `sha256=${sig}`, klant: { naam: "x" } });
  assert(r19c.status === "error" && /email/.test(r19c.error), "JSON Schema: ontbrekend e-mailadres", r19c.error);

  line("20. XML: XSLT-transformatie (met parameter) en XPath");
  const r20 = await testRun(linear("UblNaarIntern", { type: "manual" }, [
    { id: "xslt", type: "xslt", config: { operation: "transform", field: "xml", stylesheet: '<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform"><xsl:output method="xml" omit-xml-declaration="yes"/><xsl:param name="bron"/><xsl:template match="/"><boeking bron="{$bron}"><totaal><xsl:value-of select="sum(//regel/bedrag)"/></totaal><aantal><xsl:value-of select="count(//regel)"/></aantal></boeking></xsl:template></xsl:stylesheet>', parameters: { bron: "{{bron}}" }, parse: true, target: "boeking" } },
    { id: "xpath", type: "xslt", config: { operation: "xpath", field: "xml", expressions: { factuurnr: "string(/factuur/@nr)", regels: "count(//regel)", omschrijvingen: "//regel/omschrijving" }, all: true } }
  ]), { bron: "portaal", xml: '<factuur nr="F-9"><regel><omschrijving>Uren</omschrijving><bedrag>100</bedrag></regel><regel><omschrijving>Km</omschrijving><bedrag>12.5</bedrag></regel></factuur>' });
  assert(r20.status === "success" && r20.output?.boekingData?.boeking?.totaal === 112.5 && r20.output?.boekingData?.boeking?.["@bron"] === "portaal", "XSLT: totaal 112.5 en parameter bron", r20.error ?? r20.output?.boeking);
  assert(r20.output?.factuurnr === "F-9" && r20.output?.regels === 2 && r20.output?.omschrijvingen?.join() === "Uren,Km", "XPath: attribuut, telling en lijst", r20.output);

  line("21. Foutafhandeling: fout-trigger start alarmproces bij een gefaald proces");
  const errTbl = `fouten_${RUN}`;
  await api("POST", "/api/v1/datatables/dev", { name: errTbl, columns: [{ name: "proces", type: "string" }, { name: "melding", type: "string" }] });
  await save(linear(`Foutafhandeling${RUN}`, { type: "error", integrations: `Faalt${RUN}` }, [
    { id: "log", type: "datatable", config: { table: errTbl, operation: "insert", values: { proces: "{{error.integration}}", melding: "{{error.message}}" } } },
    { id: "mail", type: "email", config: { credential: "smtp-lokaal", to: "beheer@aip.test", subject: "Fout in {{error.integration}}", text: "{{error.message}} (stap {{error.step.id}})" } }
  ]));
  await save(linear(`Faalt${RUN}`, { type: "manual" }, [{ id: "stop", type: "stop", config: { message: "Klant {{klant}} heeft geen IBAN" } }]));
  await api("POST", `/api/v1/integrations/Faalt${RUN}/run`, { env: "dev", input: { klant: "K-12" } });
  const errRows = await waitFor(async () => { const d = (await api("GET", `/api/v1/datatables/dev/${errTbl}/rows`)).data; return d.total >= 1 ? d : undefined; }, 8000);
  assert(errRows?.rows?.[0]?.proces === `Faalt${RUN}` && errRows?.rows?.[0]?.melding === "Klant K-12 heeft geen IBAN", "fout vastgelegd door het foutproces", errRows);
  const errMail = await waitFor(async () => ((await (await fetch(`${MOCK}/_mails`)).json()) as any[]).find((m) => /Fout in Faalt/.test(m.raw)), 5000);
  assert(errMail, "alarmmail verstuurd");

  line("22. Polling-trigger: nieuw RSS-item start een proces (eerste keer alleen onthouden)");
  const pollTbl = `nieuws_${RUN}`;
  await api("POST", "/api/v1/datatables/dev", { name: pollTbl, columns: [{ name: "titel", type: "string" }] });
  await save(linear(`NieuwsPoll${RUN}`, { type: "poll", plugin: "rss", operation: "read", params: { feedUrl: `${MOCK}/_feed` }, idField: "id", intervalSeconds: 2 }, [
    { id: "opslaan", type: "datatable", config: { table: pollTbl, operation: "insert", values: { titel: "{{title}}" } } }
  ]));
  await sleep(2500);
  await fetch(`${MOCK}/_feed/add`, { method: "POST", body: JSON.stringify({ guid: `n2-${RUN}`, title: "Tweede bericht" }) });
  const polled = await waitFor(async () => { const d = (await api("GET", `/api/v1/datatables/dev/${pollTbl}/rows`)).data; return d.total >= 1 ? d : undefined; }, 10000);
  await sleep(2500);
  const pollRows = (await api("GET", `/api/v1/datatables/dev/${pollTbl}/rows`)).data;
  assert(polled && pollRows.total === 1 && pollRows.rows[0].titel === "Tweede bericht", "alleen het nieuwe item verwerkt (bestaand item overgeslagen, niet dubbel)", pollRows);
  await api("POST", `/api/v1/triggers/dev/NieuwsPoll${RUN}/pause`);

  if (!online) { console.log("\n(geen internet: publieke API-scenario's overgeslagen)"); return; }

  line("10. Weer-API (open-meteo, HTTP) -> beslissing -> datatabel");
  const wt = `weer_${RUN}`;
  await api("POST", "/api/v1/datatables/dev", { name: wt, columns: [{ name: "stad", type: "string" }, { name: "temp", type: "number" }] });
  const r10 = await testRun(linear("WeerNaarTabel", { type: "manual" }, [
    { id: "weer", type: "call", config: { url: "https://api.open-meteo.com/v1/forecast", query: { latitude: "{{lat}}", longitude: "{{lon}}", current: "temperature_2m" }, target: "weer" } },
    { id: "opslaan", type: "datatable", config: { table: wt, operation: "insert", values: { stad: "{{stad}}", temp: "{{weer.body.current.temperature_2m}}" } } }
  ]), { stad: "Utrecht", lat: 52.09, lon: 5.12 });
  assert(r10.status === "success" && typeof r10.output?.row?.temp === "number", "temperatuur als getal opgeslagen", r10.error ?? r10.output?.row);

  line("11. CoinGecko-plugin -> koers -> beslissing");
  const r11 = await testRun(linear("CryptoKoers", { type: "manual" }, [
    { id: "koers", type: "connector", config: { plugin: "coingecko", operation: "price", params: { ids: "bitcoin", vs_currencies: "eur" }, target: "koers" } }
  ]), {});
  assert(r11.status === "success" && Number(r11.output?.koers?.bitcoin?.eur) > 0, "bitcoinkoers in EUR opgehaald", r11.error ?? r11.output?.koers);

  line("12. npm-plugin: pakketinfo -> e-mail met versie");
  const r12 = await testRun(linear("NpmVersie", { type: "manual" }, [
    { id: "pkg", type: "connector", config: { plugin: "npm", operation: "package.get", params: { name: "fastify" }, target: "pkg" } },
    { id: "mail", type: "email", config: { credential: "smtp-lokaal", to: "dev@aip.test", subject: "fastify {{pkg.dist-tags.latest}}", text: "Nieuwste versie: {{pkg.dist-tags.latest}}" } }
  ]), {});
  assert(r12.status === "success" && /^\d+\.\d+\.\d+/.test(String(r12.output?.pkg?.["dist-tags"]?.latest)), "versie opgehaald", r12.error ?? Object.keys(r12.output?.pkg ?? {}));

  line("13. GraphQL-plugin (publieke landen-API)");
  await cred("landen", { type: "plugin", plugin: "graphql", values: { dev: { endpoint: "https://countries.trevorblades.com/" } } });
  const r13 = await testRun(linear("LandInfo", { type: "manual" }, [
    { id: "q", type: "connector", config: { plugin: "graphql", operation: "query", credential: "landen", params: { query: "query($c: ID!) { country(code: $c) { name capital currency } }", variables: { c: "{{code}}" } }, target: "land" } }
  ]), { code: "NL" });
  assert(r13.status === "success" && JSON.stringify(r13.output?.land).includes("Amsterdam"), "hoofdstad van NL = Amsterdam", r13.error ?? r13.output?.land);

  line("14. SOAP-webservice (HTTP + XML)");
  const r14 = await testRun(linear("SoapGetal", { type: "manual" }, [
    { id: "soap", type: "call", config: { method: "POST", url: "https://www.dataaccess.com/webservicesserver/NumberConversion.wso", headers: { "content-type": "text/xml; charset=utf-8" }, body: "custom", bodyTemplate: '<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><NumberToWords xmlns="http://www.dataaccess.com/webservicesserver/"><ubiNum>{{getal}}</ubiNum></NumberToWords></soap:Body></soap:Envelope>', target: "soap" } },
    { id: "xml", type: "xml", config: { mode: "parse", field: "soap.body", target: "antwoord" } }
  ]), { getal: 42 });
  assert(r14.status === "success" && /forty two/i.test(JSON.stringify(r14.output?.antwoord)), "SOAP-antwoord 'forty two' geparsed", r14.error ?? r14.output?.soap);
}

main().catch((e) => { failures++; console.error(e); }).finally(() => {
  console.log(`\n${passed} geslaagd, ${failures} fout`);
  console.log(failures ? "SCENARIO'S MET FOUTEN ✗" : "ALLE SCENARIO'S GESLAAGD ✓");
  process.exit(failures ? 1 : 0);
});
