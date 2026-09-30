// End-to-end test van koppelingen, triggers en MCP tegen een draaiende server.
// Start zelf een FTP-server (ftp-srv) om FTP-stappen en de FTP-trigger echt te testen.
// Run: npm run dev (in een andere terminal), daarna: npm run test:integration

import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const BASE = process.env.AIP_URL ?? "http://localhost:3001";
const RUN = Date.now().toString(36);
let failures = 0;
const line = (t: string) => console.log(`\n=== ${t} ===`);
function assert(cond: unknown, msg: string, extra?: unknown) {
  console.log(`${cond ? "  ok " : "FAIL"}  ${msg}${!cond && extra !== undefined ? `  -> ${JSON.stringify(extra).slice(0, 300)}` : ""}`);
  if (!cond) failures++;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function api(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; data: any }> {
  const res = await fetch(BASE + path, { method, headers: { "content-type": "application/json", "x-aip-user": "integration-test", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let data: any = text;
  try { data = JSON.parse(text); } catch { /* tekst */ }
  return { status: res.status, data };
}
const testRun = async (definition: any, input: any) => (await api("POST", "/api/v1/engine/test-run", { definition, input })).data;
const save = async (def: any) => (await api("POST", "/api/v1/integrations", def)).data;
async function waitFor<T>(fn: () => Promise<T | undefined | null | false>, ms = 15000): Promise<T | undefined> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v as T;
    await sleep(300);
  }
  return undefined;
}
const linear = (name: string, trigger: any, steps: any[]) => ({
  integration: name,
  trigger,
  steps,
  connections: steps.map((s, i) => ({ from: i === 0 ? "start" : steps[i - 1].id, to: s.id })),
  retry: { attempts: 1, backoff: "none", onExhaust: "dead-letter-queue" }
});

async function main() {
  line("Catalogus");
  const cat = (await api("GET", "/api/v1/step-types")).data;
  assert(cat.steps.length >= 18 && cat.triggers.length === 7, `${cat.steps.length} staptypes, ${cat.triggers.length} triggertypes`);

  line("Koppelingen: per omgeving, geheimen versleuteld en gemaskeerd");
  const cred = await api("PUT", "/api/v1/credentials/partner-api", { type: "api-key", description: "Test", values: { dev: { header: "x-api-key", key: "dev-geheim-123" }, test: { header: "x-api-key", key: "test-geheim-456" } } });
  assert(cred.status === 200 && cred.data.values.dev.key === "••••••", "sleutel gemaskeerd in API-response", cred.data);
  assert(JSON.stringify(cred.data.envs) === '["dev","test"]', "waarden voor DEV en TEST");
  const keep = await api("PUT", "/api/v1/credentials/partner-api", { type: "api-key", values: { dev: { header: "x-api-key", key: "••••••" } } });
  assert(keep.status === 200 && keep.data.values.dev.key === "••••••", "masker bij opslaan behoudt het geheim");
  await api("PUT", "/api/v1/credentials/own-api", { type: "http-bearer", values: { dev: { token: "abc" } } });

  line("Data-stappen: code, CSV, XML, templates, beslissing met operator");
  const data = await testRun(linear("DataTest", { type: "manual" }, [
    { id: "csv", type: "csv", config: { mode: "parse", field: "content", target: "rows" } },
    { id: "code", type: "code", config: { code: "const total = input.rows.reduce((s, r) => s + Number(r.bedrag), 0); console.log('totaal', total); return { ...input, total };" } },
    { id: "set", type: "enrich", config: { set: { "meta.bestand": "export-{{klant}}-{{$date}}.xml", "meta.aantal": "{{total}}" } } },
    { id: "xml", type: "xml", config: { mode: "build", field: "rows", target: "xml", root: "orders" } },
    { id: "groot", type: "branch", config: { when: "total", op: "gt", value: 100 } },
    { id: "einde", type: "end" }
  ]), { klant: "acme", content: 'nr,bedrag\n1,40\n2,"75"\n' });
  assert(data.status === "success", "run geslaagd", data.error);
  assert(data.output?.total === 115, "code-stap berekent totaal 115", data.output);
  assert(data.output?._logs?.[0] === "totaal 115", "console.log uit code-stap vastgelegd");
  assert(/^export-acme-\d{4}-\d{2}-\d{2}\.xml$/.test(data.output?.meta?.bestand) && data.output?.meta?.aantal === 115, "templates: tekst en type behouden", data.output?.meta);
  assert(String(data.output?.xml).includes("<orders>") && String(data.output?.xml).includes("<bedrag>75</bedrag>"), "XML opgebouwd");
  assert(data.steps.find((s: any) => s.id === "groot")?.port === "true", "beslissing gt 100 -> ja-pad");

  line("HTTP-aanroep met koppeling + e-mail (gesimuleerd) + Teams (gesimuleerd)");
  const http = await testRun(linear("HttpTest", { type: "manual" }, [
    { id: "health", type: "call", config: { method: "GET", url: `${BASE}/health`, credential: "own-api", target: "health" } },
    { id: "mail", type: "email", config: { to: "ops@example.nl", subject: "Status {{health.body.status}}", text: "Platform is {{health.body.status}}" } },
    { id: "teams", type: "notify", config: { kind: "teams", title: "AIP", text: "Klaar: {{health.status}}" } }
  ]), {});
  assert(http.status === "success" && http.output?.health?.status === 200 && http.output?.health?.body?.status === "ok", "GET /health via HTTP-stap", http.error ?? http.output);
  assert(http.output?._email?.simulated && http.output?._email?.preview?.subject === "Status ok", "e-mail gesimuleerd met template", http.output?._email);
  assert(http.output?._notify?.simulated && http.output?._notify?.body?.text === "Klaar: 200", "Teams-bericht gesimuleerd");

  line("Bestanden + map-trigger (DEV)");
  const inboxName = `FileIn${RUN}`;
  await save(linear(inboxName, { type: "file", dir: `in-${RUN}`, pattern: "*.csv", intervalSeconds: 2, format: "csv", after: "move", archiveDir: `archief-${RUN}` }, [
    { id: "check", type: "validate", config: { required: ["file.data"] } },
    { id: "schrijf", type: "file", config: { operation: "write", path: `uit-${RUN}/{{file.name}}.json`, contentField: "file.data", format: "json" } }
  ]));
  await api("POST", "/api/v1/files/dev", { path: `in-${RUN}/klanten.csv`, content: "id,naam\n1,Jansen\n2,De Vries\n" });
  const fileRun = await waitFor(async () => (await api("GET", `/api/v1/runs?integration=${inboxName}&limit=5`)).data.find((r: any) => r.triggeredBy === "file"));
  assert(fileRun?.status === "success", "map-trigger heeft het bestand verwerkt", fileRun);
  const out = (await api("GET", `/api/v1/files/dev?dir=uit-${RUN}`)).data.items;
  assert(out.some((f: any) => f.name === "klanten.csv.json"), "resultaat geschreven als JSON", out);
  const arch = (await api("GET", `/api/v1/files/dev?dir=archief-${RUN}`)).data.items;
  assert(arch.some((f: any) => f.name === "klanten.csv"), "origineel naar archiefmap verplaatst");
  const traversal = await testRun(linear("Traversal", { type: "manual" }, [{ id: "lees", type: "file", config: { operation: "read", path: "../../../../etc/passwd" } }]), {});
  assert(traversal.status === "success" ? !String(traversal.output?.file?.content).includes("root:") : true, "pad buiten de omgevingsmap is niet leesbaar", traversal.output);

  line("Queues: publiceren, queue-trigger, retry en dead-letter");
  const qName = `orders-${RUN}`;
  const consumer = `QueueIn${RUN}`;
  await save(linear(consumer, { type: "queue", queue: qName }, [
    { id: "check", type: "validate", config: { required: ["orderId"] } },
    { id: "ok", type: "enrich", config: { set: { verwerkt: true } } }
  ]));
  await save(linear(`QueueOut${RUN}`, { type: "manual" }, [{ id: "pub", type: "queue-publish", config: { queue: qName } }]));
  const pub = (await api("POST", `/api/v1/integrations/QueueOut${RUN}/run`, { env: "dev", input: { orderId: "Q-1" } })).data;
  assert(pub.result?.run?.output?._queue?.queue === qName, "queue-publish stap zet bericht op de queue", pub.result?.run?.error);
  const qRun = await waitFor(async () => (await api("GET", `/api/v1/runs?integration=${consumer}&limit=5`)).data.find((r: any) => r.triggeredBy === "queue" && r.status === "success"));
  assert(qRun, "queue-trigger startte het proces");
  await api("POST", `/api/v1/queues/dev/${qName}/messages`, { body: { geenOrderId: true } });
  const dlq = await waitFor(async () => (await api("GET", "/api/v1/queues?env=dev")).data.find((q: any) => q.queue === `${qName}.dlq` && q.depth === 1), 20000);
  assert(dlq, "fout bericht na 3 pogingen in dead-letter queue", (await api("GET", "/api/v1/queues?env=dev")).data.filter((q: any) => q.queue.startsWith(qName)));
  const redrive = (await api("POST", `/api/v1/queues/dev/${qName}.dlq/redrive`)).data;
  assert(redrive.moved === 1, "redrive zet het bericht terug");

  line("Queue aanmaken, als buffer gebruiken (pull) en verwijderen");
  const buf = `buffer-${RUN}`;
  const decl = await api("POST", "/api/v1/queues/dev", { queue: buf, description: "tijdelijke opslag" });
  assert(decl.status === 200 && (await api("GET", "/api/v1/queues?env=dev")).data.some((q: any) => q.queue === buf && q.declared && q.depth === 0), "lege queue aangemaakt en zichtbaar");
  const allQ = (await api("GET", "/api/v1/queues")).data.filter((q: any) => q.queue === buf);
  assert(["dev", "test", "acc", "prod"].every((e) => allQ.some((q: any) => q.env === e && q.declared)), "queue bestaat op DEV, TEST, ACC en PROD", allQ);
  await api("POST", "/api/v1/queues/prod/" + buf + "/messages", { body: { alleen: "prod" } });
  assert((await api("GET", "/api/v1/queues?env=dev")).data.find((q: any) => q.queue === buf)?.depth === 0, "berichten blijven per omgeving gescheiden");
  await api("POST", "/api/v1/queues/prod/" + buf + "/purge", {});
  const impl = `impliciet-${RUN}`;
  await api("POST", `/api/v1/queues/test/${impl}/messages`, { body: { x: 1 } });
  assert((await api("GET", "/api/v1/queues")).data.filter((q: any) => q.queue === impl && q.declared).length === 4, "queue die ontstaat door publiceren komt ook op alle omgevingen");
  await api("DELETE", `/api/v1/queues/test/${impl}`);
  assert((await api("POST", "/api/v1/queues/dev", { queue: "ongeldig naam!" })).status === 400, "ongeldige queuenaam geweigerd");
  const pull = await testRun(linear("QueueBuffer", { type: "manual" }, [
    { id: "zet1", type: "queue-publish", config: { queue: buf } },
    { id: "zet2", type: "queue-publish", config: { queue: buf, bodyField: "extra" } },
    { id: "haal", type: "queue-get", config: { queue: buf, max: 10, target: "gebufferd" } }
  ]), { orderId: "B-1", extra: { orderId: "B-2" } });
  assert(pull.status === "success" && pull.output?.gebufferd?.length === 2 && pull.output.gebufferd[1].orderId === "B-2", "queue-get haalt beide berichten op", pull.output?.gebufferd ?? pull.error);
  assert((await api("GET", "/api/v1/queues?env=dev")).data.find((q: any) => q.queue === buf)?.depth === 0, "opgehaalde berichten zijn van de queue af");
  const delQ = (await api("DELETE", `/api/v1/queues/dev/${buf}`)).data;
  assert(delQ.deleted && delQ.envs.length === 4 && !(await api("GET", "/api/v1/queues")).data.some((q: any) => q.queue === buf), "queue verwijderd op alle omgevingen", delQ);

  line("Datatabellen: aanmaken, stap insert/upsert/find/update/delete, per omgeving");
  const tbl = `klanten_${RUN}`;
  const mk = await api("POST", "/api/v1/datatables/dev", { name: tbl, columns: [{ name: "klantnr", type: "string" }, { name: "naam", type: "string" }, { name: "omzet", type: "number" }, { name: "actief", type: "boolean" }] });
  assert(mk.status === 200 && mk.data.columns.length === 4, "tabel met 4 kolommen aangemaakt", mk.data);
  assert((await api("POST", "/api/v1/datatables/dev", { name: tbl, columns: [] })).status === 400, "dubbele tabel geweigerd");
  for (const e of ["test", "acc", "prod"]) {
    const other = await api("GET", `/api/v1/datatables/${e}/${tbl}`);
    assert(other.status === 200 && other.data.columns.map((c: any) => c.name).join() === "klantnr,naam,omzet,actief" && other.data.rowCount === 0, `tabel ook op ${e.toUpperCase()} met dezelfde kolommen, zonder rijen`, other.data);
  }
  assert((await api("POST", "/api/v1/datatables/prod", { name: tbl, columns: [] })).status === 400, "dezelfde tabel via een andere omgeving aanmaken wordt geweigerd");
  const dt = await testRun(linear("DataTableTest", { type: "manual" }, [
    { id: "nieuw", type: "datatable", config: { table: tbl, operation: "insert", values: { klantnr: "{{nr}}", naam: "{{naam}}", omzet: "{{omzet}}", actief: true }, target: "nieuw" } },
    { id: "nogeen", type: "datatable", config: { table: tbl, operation: "upsert", conditions: [{ column: "klantnr", value: "K-2" }], values: { naam: "Bakker", omzet: 50 } } },
    { id: "bijwerken", type: "datatable", config: { table: tbl, operation: "upsert", conditions: [{ column: "klantnr", value: "{{nr}}" }], values: { omzet: 999 } } },
    { id: "groot", type: "datatable", config: { table: tbl, operation: "find", conditions: [{ column: "omzet", op: "gt", value: 100 }], target: "grote" } },
    { id: "een", type: "datatable", config: { table: tbl, operation: "get", conditions: [{ column: "naam", op: "contains", value: "bak" }], target: "bakker" } },
    { id: "weg", type: "datatable", config: { table: tbl, operation: "delete", conditions: [{ column: "klantnr", value: "K-2" }], target: "verwijderd" } }
  ]), { nr: "K-1", naam: "Jansen", omzet: "120" });
  assert(dt.status === "success", "datatabel-stappen geslaagd", dt.error);
  assert(dt.output?.nieuw?.omzet === 120 && typeof dt.output?.nieuw?.id === "number", "insert zet types om (tekst '120' -> getal) en de uitkomst blijft 120 na latere upsert", dt.output?.nieuw);
  assert(dt.output?.grote?.length === 1 && dt.output.grote[0].omzet === 999, "upsert werkte bestaande rij bij, find met gt", dt.output?.grote);
  assert(dt.output?.bakker?.naam === "Bakker" && dt.output?.verwijderd?.deleted === 1, "get met contains en delete");
  const rows = (await api("GET", `/api/v1/datatables/dev/${tbl}/rows`)).data;
  assert(rows.total === 1 && rows.rows[0].klantnr === "K-1", "rijen via API zichtbaar");
  const wrongCol = await api("POST", `/api/v1/datatables/dev/${tbl}/rows`, { bestaatNiet: 1 });
  assert(wrongCol.status === 400 && /geen kolom/.test(wrongCol.data.error), "onbekende kolom geweigerd");
  const patched = await api("PATCH", `/api/v1/datatables/dev/${tbl}/rows/${rows.rows[0].id}`, { naam: "Jansen BV" });
  assert(patched.data.naam === "Jansen BV", "rij bewerken via API");
  assert((await api("GET", `/api/v1/datatables/prod/${tbl}/rows`)).data.total === 0, "rijen van DEV staan niet op PROD");
  await api("PUT", `/api/v1/datatables/acc/${tbl}/columns`, { columns: [{ name: "klantnr", type: "string" }, { name: "naam", type: "string" }, { name: "omzet", type: "number" }, { name: "actief", type: "boolean" }, { name: "regio", type: "string" }] });
  const colsEverywhere = await Promise.all(["dev", "test", "acc", "prod"].map(async (e) => (await api("GET", `/api/v1/datatables/${e}/${tbl}`)).data.columns.map((c: any) => c.name).join()));
  assert(colsEverywhere.every((c) => c === "klantnr,naam,omzet,actief,regio"), "kolom toevoegen op ACC geldt voor alle omgevingen", colsEverywhere);
  assert((await api("GET", `/api/v1/datatables/dev/${tbl}/rows`)).data.rows[0].naam === "Jansen BV", "bestaande rijen blijven behouden bij kolomwijziging");
  const drop = (await api("DELETE", `/api/v1/datatables/test/${tbl}`)).data;
  assert(drop.dropped && drop.rows.dev === 1 && (await Promise.all(["dev", "test", "acc", "prod"].map(async (e) => (await api("GET", `/api/v1/datatables/${e}/${tbl}`)).status))).every((st) => st === 404), "tabel verwijderd op alle omgevingen (met aantal rijen per omgeving)", drop);

  line("Dashboard per omgeving");
  const dAll = (await api("GET", "/api/v1/dashboard")).data;
  const dProd = (await api("GET", "/api/v1/dashboard?env=prod")).data;
  assert(dProd.env === "prod" && dProd.runs.totalRuns <= dAll.runs.totalRuns && dProd.recentRuns.every((r: any) => r.env === "prod"), "dashboard filtert op PROD");

  line("Schema-trigger (elke 5 seconden)");
  const sched = `Sched${RUN}`;
  await save(linear(sched, { type: "schedule", everySeconds: 5 }, [{ id: "tik", type: "enrich", config: { set: { tik: "{{$now}}" } } }]));
  const sRun = await waitFor(async () => (await api("GET", `/api/v1/runs?integration=${sched}&limit=5`)).data.find((r: any) => r.triggeredBy === "schedule"), 9000);
  assert(sRun?.status === "success", "schema-trigger heeft gevuurd");
  await api("POST", `/api/v1/triggers/dev/${sched}/pause`);
  const trig = (await api("GET", "/api/v1/triggers")).data.find((t: any) => t.integration === sched && t.env === "dev");
  assert(trig?.paused === true && trig?.running === false, "trigger gepauzeerd", trig);

  line("Webhook-trigger met API-key per omgeving + eigen response + subproces");
  const hook = `Hook${RUN}`;
  await save(linear(`Sub${RUN}`, { type: "manual" }, [{ id: "dubbel", type: "code", config: { code: "return { verdubbeld: input.getal * 2 };" } }]));
  await save(linear(hook, { type: "webhook", path: `orders/${RUN}`, method: "POST", auth: "apikey", credential: "partner-api" }, [
    { id: "sub", type: "subprocess", config: { process: `Sub${RUN}`, target: "sub" } },
    { id: "antwoord", type: "enrich", config: { set: { _response: { status: 201, body: { ontvangen: "{{orderId}}", uitkomst: "{{sub.verdubbeld}}" } } } } }
  ]));
  const noKey = await fetch(`${BASE}/hooks/dev/orders/${RUN}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ orderId: "W-1", getal: 21 }) });
  assert(noKey.status === 401, "zonder API-key: 401");
  const wrongEnv = await fetch(`${BASE}/hooks/dev/orders/${RUN}`, { method: "POST", headers: { "content-type": "application/json", "x-api-key": "test-geheim-456" }, body: "{}" });
  assert(wrongEnv.status === 401, "TEST-sleutel werkt niet op DEV");
  const withKey = await fetch(`${BASE}/hooks/dev/orders/${RUN}`, { method: "POST", headers: { "content-type": "application/json", "x-api-key": "dev-geheim-123" }, body: JSON.stringify({ orderId: "W-1", getal: 21 }) });
  const whBody: any = await withKey.json();
  assert(withKey.status === 201 && whBody.ontvangen === "W-1" && whBody.uitkomst === 42, "met sleutel: 201 + eigen response + subproces-uitkomst 42", whBody);
  const notDeployed = await fetch(`${BASE}/hooks/test/orders/${RUN}`, { method: "POST", body: "{}", headers: { "content-type": "application/json" } });
  assert(notDeployed.status === 404, "webhook bestaat niet op TEST zolang het proces niet gedeployed is");

  line("API-endpoint-trigger met padparameter, API-key en OpenAPI");
  const apiName = `OrderApi${RUN}`;
  await save(linear(apiName, { type: "api", path: `orders${RUN}/{id}`, method: "GET", auth: "apikey", credential: "partner-api" }, [
    { id: "zoek", type: "enrich", config: { set: { orderId: "{{params.id}}", status: "verzonden", aantal: "{{query.aantal}}" } } }
  ]));
  const apiNoKey = await fetch(`${BASE}/apis/dev/orders${RUN}/A-77`);
  assert(apiNoKey.status === 401, "API zonder sleutel: 401");
  const apiOk = await fetch(`${BASE}/apis/dev/orders${RUN}/A-77?aantal=3`, { headers: { "x-api-key": "dev-geheim-123" } });
  const apiBody: any = await apiOk.json();
  assert(apiOk.status === 200 && apiBody.orderId === "A-77" && apiBody.status === "verzonden" && apiBody.aantal === "3" && !("_trigger" in apiBody) && !("params" in apiBody), "GET /orders/{id}: padparameter, query en schoon antwoord", apiBody);
  const apiWrongMethod = await fetch(`${BASE}/apis/dev/orders${RUN}/A-77`, { method: "POST", headers: { "x-api-key": "dev-geheim-123" } });
  assert(apiWrongMethod.status === 404, "andere methode: 404");
  const spec: any = await (await fetch(`${BASE}/apis/dev/openapi.json`)).json();
  const op = spec.paths?.[`/orders${RUN}/{id}`]?.get;
  assert(op?.operationId === apiName && op.parameters?.[0]?.name === "id" && op.security?.[0]?.apiKey, "OpenAPI-specificatie bevat het endpoint met parameter en beveiliging");
  const trigList = (await api("GET", "/api/v1/triggers")).data.find((t: any) => t.integration === apiName);
  assert(trigList?.type === "api" && String(trigList.url).includes(`/apis/dev/orders${RUN}/{id}`), "API-endpoint zichtbaar in het triggeroverzicht");

  line("FTP: echte FTP-server, stappen en FTP-trigger");
  const root = mkdtempSync(join(tmpdir(), "aip-ftp-"));
  mkdirSync(join(root, "out"));
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const FtpSrv = require("ftp-srv");
  const ftp = new FtpSrv({ url: "ftp://127.0.0.1:2121", pasv_url: "127.0.0.1", pasv_min: 30100, pasv_max: 30200, anonymous: false, greeting: "aip-test", log: { trace() {}, debug() {}, info() {}, warn() {}, error() {}, child() { return this; } } });
  ftp.on("login", ({ username, password }: any, resolve: any, reject: any) => (username === "aip" && password === "geheim" ? resolve({ root }) : reject(new Error("login"))));
  await ftp.listen();
  try {
    await api("PUT", "/api/v1/credentials/partner-ftp", { type: "ftp", values: { dev: { host: "127.0.0.1", port: "2121", user: "aip", password: "geheim" } } });
    const t = (await api("POST", "/api/v1/credentials/partner-ftp/test", { env: "dev" })).data;
    assert(t.ok, "verbindingstest FTP", t);
    const ftpRun = await testRun(linear("FtpTest", { type: "manual" }, [
      { id: "upload", type: "ftp", config: { credential: "partner-ftp", operation: "upload", path: "/in/order-{{orderId}}.json", format: "json" } },
      { id: "lijst", type: "ftp", config: { credential: "partner-ftp", operation: "list", path: "/in", pattern: "*.json" } },
      { id: "download", type: "ftp", config: { credential: "partner-ftp", operation: "download", path: "/in/order-{{orderId}}.json", format: "json", target: "terug" } }
    ]), { orderId: "F-7", bedrag: 12.5 });
    assert(ftpRun.status === "success", "FTP upload/list/download geslaagd", ftpRun.error);
    assert(existsSync(join(root, "in", "order-F-7.json")), "bestand staat echt op de FTP-server");
    assert(ftpRun.output?.files?.length === 1 && ftpRun.output?.terug?.data?.bedrag === 12.5, "lijst en download kloppen", ftpRun.output);

    const ftpIn = `FtpIn${RUN}`;
    await save(linear(ftpIn, { type: "ftp", credential: "partner-ftp", dir: "/out", pattern: "*.xml", intervalSeconds: 2, format: "xml", after: "move", archiveDir: "/out/verwerkt" }, [
      { id: "check", type: "validate", config: { required: ["file.data.factuur.nummer"] } }
    ]));
    writeFileSync(join(root, "out", "factuur-1.xml"), "<factuur><nummer>2026-001</nummer><bedrag>99.95</bedrag></factuur>");
    const ftpTrig = await waitFor(async () => (await api("GET", `/api/v1/runs?integration=${ftpIn}&limit=5`)).data.find((r: any) => r.triggeredBy === "ftp"), 15000);
    assert(ftpTrig?.status === "success", "FTP-trigger heeft het XML-bestand verwerkt", ftpTrig);
    await sleep(500);
    assert(existsSync(join(root, "out", "verwerkt", "factuur-1.xml")) && !readdirSync(join(root, "out")).includes("factuur-1.xml"), "bestand op de FTP-server naar /out/verwerkt verplaatst");
    await api("POST", `/api/v1/triggers/dev/${ftpIn}/pause`);
  } finally {
    await ftp.close();
  }

  line("Omgevingsvarianten: agentgroep, echte agent, deploydoelen, failover");
  const grp = await api("POST", "/api/v1/agent-groups", { env: "dev", name: `AWS test ${RUN}`, provider: "aws", region: "eu-west-1" });
  assert(grp.status === 201 && /^aipk_/.test(grp.data.key) && !JSON.stringify(grp.data.group).includes("keyHash"), "groep aangemaakt; sleutel eenmalig, hash niet zichtbaar", grp.data);
  const gid = grp.data.group.id;
  assert((await api("POST", "/api/v1/agent-api/heartbeat", { id: "x" }, { authorization: "Bearer fout" })).status === 401, "agent-API weigert een onbekende sleutel");
  const agentDir = mkdtempSync(join(tmpdir(), "aip-agent-"));
  const agentProc = spawn(join(__dirname, "..", "node_modules", ".bin", "tsx"), [join(__dirname, "..", "src", "agent", "main.ts")], {
    env: { ...process.env, AIP_URL: BASE, AIP_AGENT_KEY: grp.data.key, AIP_AGENT_NAME: `ec2-${RUN}`, AIP_AGENT_ID_FILE: join(agentDir, "id"), AWS_REGION: "eu-west-1" }, stdio: "ignore"
  });
  try {
    const online = await waitFor(async () => (await api("GET", `/api/v1/agent-groups/${gid}`)).data.agents?.find((a: any) => a.name === `ec2-${RUN}`), 20000);
    assert(online && online.cloud?.provider === "aws" && online.version, "agent verbindt en meldt cloud en versie", online);
    await api("POST", "/api/v1/datatables/dev", { name: `agent_${RUN}`, columns: [{ name: "orderId", type: "string" }] });
    const agentProcName = `OpAgent${RUN}`;
    await api("POST", "/api/v1/integrations", linear(agentProcName, { type: "manual" }, [
      { id: "zet", type: "enrich", config: { set: { waar: "agent" } } },
      { id: "bewaar", type: "datatable", config: { table: `agent_${RUN}`, operation: "insert", values: { orderId: "{{orderId}}" }, target: "rij" } }
    ]));
    const tg = await api("PUT", `/api/v1/integrations/${agentProcName}/targets/dev`, { groups: [gid] });
    assert(tg.data.applied === true, "deploydoel op DEV direct toegepast");
    const r1 = (await api("POST", `/api/v1/integrations/${agentProcName}/run`, { env: "dev", input: { orderId: "AG1" } })).data?.result?.run;
    assert(r1?.status === "success" && r1.agentGroup === gid && r1.agent === `ec2-${RUN}`, "proces draait op de agent in de variant", r1);
    const rows = (await api("POST", `/api/v1/datatables/dev/agent_${RUN}/query`, {})).data;
    assert((rows.rows || rows).some((x: any) => x.orderId === "AG1"), "datatabel-stap van de agent via het portaal uitgevoerd", rows);
    const leeg = await api("POST", "/api/v1/agent-groups", { env: "dev", name: `Leeg ${RUN}`, provider: "azure" });
    await api("PUT", `/api/v1/integrations/${agentProcName}/targets/dev`, { groups: [leeg.data.group.id, "dev-platform"], mode: "failover" });
    const r2 = (await api("POST", `/api/v1/integrations/${agentProcName}/run`, { env: "dev", input: { orderId: "AG2" } })).data?.result?.run;
    assert(r2?.status === "success" && r2.agentGroup === "dev-platform", "failover: variant zonder agent wordt overgeslagen", r2);
    await api("PUT", `/api/v1/integrations/${agentProcName}/targets/dev`, { groups: [leeg.data.group.id] });
    const r3 = (await api("POST", `/api/v1/integrations/${agentProcName}/run`, { env: "dev", input: {} })).data?.result?.run;
    assert(r3?.status === "error" && /Geen agent online/.test(r3.error), "zonder agent online een duidelijke fout", r3);
    assert((await api("DELETE", `/api/v1/agent-groups/${leeg.data.group.id}`)).status === 400, "groep in gebruik kan niet verwijderd worden");
    const wrongEnv = await api("PUT", `/api/v1/integrations/${agentProcName}/targets/dev`, { groups: ["prod-platform"] });
    assert(wrongEnv.status === 400, "groep van een andere omgeving geweigerd");
    const rot = await api("POST", `/api/v1/agent-groups/${gid}/rotate-key`, {});
    assert(/^aipk_/.test(rot.data.key) && (await api("POST", "/api/v1/agent-api/heartbeat", { id: "x" }, { authorization: `Bearer ${grp.data.key}` })).status === 401, "na vernieuwen werkt de oude sleutel niet meer");
    const inst = await api("GET", "/agent/install.sh");
    assert(inst.status === 200, "installatiescript beschikbaar");
    const adv = (await api("POST", "/api/v1/agents/page/advise", { view: "infra", env: "dev" })).data;
    assert(adv.findings.some((f: any) => /nog geen agent verbonden/.test(f.title) && f.level === "risk"), "pagina-advies: variant met processen zonder agent is een risico", adv.findings);
    await api("PUT", `/api/v1/integrations/${agentProcName}/targets/dev`, { groups: ["dev-platform"] });
    await api("DELETE", `/api/v1/agent-groups/${leeg.data.group.id}`);
  } finally { agentProc.kill(); }
  // Deploy met doelen via goedkeuring
  const depName = `Doelen${RUN}`;
  await api("POST", "/api/v1/integrations", linear(depName, { type: "manual" }, [{ id: "a", type: "enrich", config: { set: { x: 1 } } }]));
  const tgrp = await api("POST", "/api/v1/agent-groups", { env: "test", name: `Azure ${RUN}`, provider: "azure" });
  const depA = (await api("POST", `/api/v1/integrations/${depName}/deploy`, { toEnv: "test", proposedBy: "alice", targets: { groups: [tgrp.data.group.id, "test-platform"], mode: "all" } })).data;
  assert(depA.status === "pending", "deploy met omgevingsvarianten wacht op goedkeuring", depA);
  await api("POST", `/api/v1/approvals/${depA.id}/approve`, { approver: "bob" });
  const tt = (await api("GET", `/api/v1/integrations/${depName}/targets`)).data.test;
  assert(tt.version === 1 && tt.mode === "all" && tt.groups.includes(tgrp.data.group.id), "na goedkeuring staat het proces op TEST op beide varianten", tt);
  const chg = (await api("PUT", `/api/v1/integrations/${depName}/targets/test`, { groups: ["test-platform"] })).data;
  assert(chg.applied === false && chg.approval?.riskLevel === "orange", "doelen wijzigen op TEST gaat via goedkeuring", chg);

  line("Versies: alleen bewerken op DEV, DEV → PROD overslaan, terugzetten");
  const vName = `Versies${RUN}`;
  const v1 = (await api("POST", "/api/v1/integrations", { ...linear(vName, { type: "manual" }, [{ id: "a", type: "enrich", config: { set: { versie: 1 } } }]), owner: "alice" })).data;
  const v2 = (await api("POST", "/api/v1/integrations", { ...linear(vName, { type: "manual" }, [{ id: "a", type: "enrich", config: { set: { versie: 2 } } }]), owner: "alice" })).data;
  assert(v1.version === "1" && v2.version === "2", "opslaan maakt steeds een nieuwe versie op DEV");
  assert((await api("POST", `/api/v1/integrations/${vName}/deploy`, { toEnv: "dev", version: 1 })).status === 400, "naar DEV deployen kan niet (DEV = bouwen)");
  const skip = (await api("POST", `/api/v1/integrations/${vName}/deploy`, { toEnv: "prod", version: 2, proposedBy: "alice" })).data;
  assert(skip.status === "pending" && skip.riskLevel === "red" && /TEST en ACC overgeslagen/.test(skip.action.reason) && skip.action.payload.version === 2, "DEV → PROD: overslaan kan, met vier-ogen en melding in het verzoek", skip.action);
  await api("POST", `/api/v1/approvals/${skip.id}/approve`, { approver: "bob" });
  await api("POST", `/api/v1/approvals/${skip.id}/approve`, { approver: "carol" });
  let vs = (await api("GET", `/api/v1/integrations/${vName}/versions`)).data;
  assert(vs.envs.prod === 2 && vs.envs.test === null && vs.envs.acc === null, "v2 staat op PROD; TEST en ACC zijn overgeslagen", vs.envs);
  const runProd = (await api("POST", `/api/v1/integrations/${vName}/run`, { env: "prod", input: {}, proposedBy: "alice" })).data;
  await api("POST", `/api/v1/approvals/${runProd.id}/approve`, { approver: "bob" });
  const rp = (await api("GET", `/api/v1/approvals/${runProd.id}`)).data;
  assert(rp.result?.run?.output?.versie === 2, "PROD draait v2", rp.result?.run?.output);
  const back = (await api("POST", `/api/v1/integrations/${vName}/deploy`, { toEnv: "prod", version: 1, proposedBy: "alice" })).data;
  assert(back.action.payload.rollback === true && /Terugzetten/.test(back.action.reason), "PROD terugzetten naar v1 is een rollback-verzoek", back.action);
  await api("POST", `/api/v1/approvals/${back.id}/approve`, { approver: "bob" });
  await api("POST", `/api/v1/approvals/${back.id}/approve`, { approver: "carol" });
  vs = (await api("GET", `/api/v1/integrations/${vName}/versions`)).data;
  assert(vs.envs.prod === 1 && vs.history[0].kind === "rollback" && vs.history[0].from === 2, "PROD staat terug op v1; geschiedenis toont de rollback", vs.history[0]);
  assert((await api("POST", `/api/v1/integrations/${vName}/deploy`, { toEnv: "prod", version: 1 })).status === 409, "dezelfde versie opnieuw deployen wordt geweigerd");
  const rest = (await api("POST", `/api/v1/integrations/${vName}/versions/1/restore`, { owner: "alice" })).data;
  vs = (await api("GET", `/api/v1/integrations/${vName}/versions`)).data;
  assert(rest.version === 3 && vs.envs.dev === 3 && vs.versions[0].restoredFrom === 1 && vs.envs.prod === 1, "v1 teruggezet op DEV als nieuwe v3; PROD ongewijzigd", vs.versions[0]);
  assert((await api("GET", `/api/v1/integrations/${vName}`)).data.steps[0].config.set.versie === 1, "de editor (DEV) toont weer de inhoud van v1");

  line("Bulkacties: meerdere processen (de)activeren en verwijderen");
  const b1 = `Bulk1${RUN}`, b2 = `Bulk2${RUN}`;
  for (const n of [b1, b2]) await api("POST", "/api/v1/integrations", linear(n, { type: "schedule", everySeconds: 3600 }, [{ id: "a", type: "enrich", config: { set: { x: 1 } } }]));
  const pz = (await api("POST", "/api/v1/integrations/bulk", { action: "pause", names: [b1, b2, "BestaatNiet"], env: "dev" })).data.results;
  assert(pz.filter((x: any) => x.ok).length === 2 && pz.find((x: any) => x.name === "BestaatNiet").ok === false, "twee processen gedeactiveerd, onbekende overgeslagen", pz);
  const tr1 = (await api("GET", "/api/v1/triggers")).data.filter((t: any) => [b1, b2].includes(t.integration) && t.env === "dev");
  assert(tr1.length === 2 && tr1.every((t: any) => t.paused), "schema-triggers staan op gepauzeerd");
  await api("POST", "/api/v1/integrations/bulk", { action: "resume", names: [b1, b2], env: "dev" });
  const tr2 = (await api("GET", "/api/v1/triggers")).data.filter((t: any) => [b1, b2].includes(t.integration) && t.env === "dev");
  assert(tr2.every((t: any) => !t.paused), "weer geactiveerd");
  const del = (await api("POST", "/api/v1/integrations/bulk", { action: "delete", names: [b1, b2, depName] })).data.results;
  assert(del.find((x: any) => x.name === b1).deleted && del.find((x: any) => x.name === b2).deleted, "processen alleen op DEV direct verwijderd", del);
  assert(!del.find((x: any) => x.name === depName).deleted && del.find((x: any) => x.name === depName).approval?.status === "pending", "proces op TEST: verwijderen via goedkeuring", del);
  assert((await api("GET", `/api/v1/integrations/${b1}`)).status === 404, "verwijderd proces is weg");

  line("MCP via Streamable HTTP");
  const client = new Client({ name: "integration-test", version: "1" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`)));
  const tools = (await client.listTools()).tools.map((t) => t.name);
  assert(tools.includes("save_process") && tools.includes("run_process") && !tools.includes("decide_approval"), `${tools.length} tools; goedkeuren niet via MCP`);
  const text = (r: any) => JSON.parse(r.content[0].text);
  const listed = text(await client.callTool({ name: "list_processes", arguments: {} }));
  assert(listed.some((p: any) => p.name === hook), "list_processes ziet de processen");
  const mcpDef = linear(`Mcp${RUN}`, { type: "manual" }, [{ id: "hallo", type: "enrich", config: { set: { groet: "Hallo {{naam}}" } } }]);
  const tested = text(await client.callTool({ name: "test_process", arguments: { definition: mcpDef, input: { naam: "Claude" } } }));
  assert(tested.status === "success" && tested.output.groet === "Hallo Claude", "test_process via MCP");
  const saved = text(await client.callTool({ name: "save_process", arguments: { definition: mcpDef } }));
  assert(saved.version === "1", "save_process maakt v1 op DEV");
  const ran = text(await client.callTool({ name: "run_process", arguments: { name: `Mcp${RUN}`, env: "dev", input: { naam: "MCP" } } }));
  assert(ran.status === "executed" && ran.result.run.output.groet === "Hallo MCP", "run_process op DEV");
  const dep = text(await client.callTool({ name: "deploy_process", arguments: { name: `Mcp${RUN}`, env: "test" } }));
  assert(dep.status === "pending" && dep.riskLevel === "orange", "deploy_process maakt een goedkeuringsverzoek (mens beslist)");
  const bad = await client.callTool({ name: "save_process", arguments: { definition: { integration: "x" } } });
  assert((bad as any).isError === true, "ongeldige definitie geeft een nette fout");
  const schema = await client.readResource({ uri: "aip://schema/integration" });
  assert(String((schema.contents[0] as any).text).includes("connections"), "resource aip://schema/integration");
  // Export/import via MCP: proces met subproces en een benodigde (ontbrekende) koppeling
  const subName = `ExpSub${RUN}`, mainName = `ExpMain${RUN}`;
  await api("POST", "/api/v1/integrations", linear(subName, { type: "manual" }, [{ id: "zet", type: "enrich", config: { set: { sub: true } } }]));
  await api("POST", "/api/v1/integrations", linear(mainName, { type: "manual" }, [
    { id: "roep", type: "subprocess", config: { process: subName, merge: true } },
    { id: "mail", type: "email", config: { credential: `smtp-onbekend-${RUN}`, to: "a@b.nl", subject: "x", text: "{{orderId}}" } }
  ]));
  const exp = text(await client.callTool({ name: "export_process", arguments: { name: mainName } }));
  assert(exp.format === "aip.process-export" && exp.subprocesses?.[0]?.integration === subName, "export_process bevat het subproces", exp.subprocesses);
  assert(exp.requires?.credentials?.includes(`smtp-onbekend-${RUN}`) && !JSON.stringify(exp).includes("password"), "export noemt koppelingen alleen bij naam");
  const dry = text(await client.callTool({ name: "import_process", arguments: { bundle: exp, onConflict: "rename", dryRun: true } }));
  assert(dry.dryRun && dry.process.name === `${mainName}_2` && dry.process.action === "create", "dryRun: vrije naam bij conflict", dry.process);
  assert(dry.missing.credentials.includes(`smtp-onbekend-${RUN}`) && dry.missing.subprocesses.length === 0, "dryRun meldt ontbrekende koppeling", dry.missing);
  const imp = text(await client.callTool({ name: "import_process", arguments: { bundle: exp, onConflict: "rename" } }));
  assert(imp.saved?.integration === `${mainName}_2` && imp.saved?.version === "1" && imp.savedSubprocesses.length === 0, "import als nieuw proces; bestaand subproces overgeslagen", imp);
  const again = await api("POST", "/api/v1/integrations/import", { bundle: exp, subprocesses: "all" });
  assert(again.status === 201 && again.data.saved.version === "2" && again.data.savedSubprocesses[0]?.version === "2", "zelfde naam → nieuwe versie, subproces ook", again.data);
  const clash = await api("POST", "/api/v1/integrations/import", { bundle: exp, onConflict: "fail" });
  assert(clash.status === 409, "onConflict=fail geeft 409");
  const badImp = await api("POST", "/api/v1/integrations/import", { bundle: { integration: "Kapot", trigger: { type: "nee" }, steps: [] } });
  assert(badImp.status === 400 && badImp.data.details?.length, "schemafouten worden gemeld", badImp.data);
  const bare = await api("POST", "/api/v1/integrations/import", { bundle: exp.process, name: `ExpKaal${RUN}` });
  assert(bare.status === 201 && bare.data.saved.integration === `ExpKaal${RUN}`, "kale definitie importeren met eigen naam");
  const runImp = await api("POST", `/api/v1/integrations/${mainName}_2/run`, { env: "dev", input: { orderId: "E1" } });
  const roep = runImp.data?.result?.run?.steps?.find((x: any) => x.id === "roep");
  assert(roep?.status === "ok" && roep.output?.sub === true, "geïmporteerd proces roept het subproces aan", runImp.data?.result?.run?.steps);

  // Pagina-adviseur / review_process
  const rev = text(await client.callTool({ name: "review_process", arguments: { definition: { integration: `Rev${RUN}`, trigger: { type: "webhook", path: "x" }, steps: [{ id: "h", type: "http", config: { url: "http://example.org/a" } }, { id: "los", type: "enrich", config: {} }, { id: "end", type: "end", config: {} }], connections: [{ from: "start", to: "h" }, { from: "h", to: "end" }] }, question: "Is dit proces klaar voor PROD?" } }));
  const titles = rev.findings.map((x: any) => x.title).join(" | ");
  assert(rev.findings[0]?.level === "risk" && /zonder authenticatie/.test(titles), "review: webhook zonder authenticatie is een risico", titles);
  assert(/niet bereikbaar/.test(titles) && /onversleuteld HTTP/.test(titles) && /niet eerst gevalideerd/.test(titles), "review: onbereikbare stap, http:// en validatie gemeld", titles);
  assert(/^Nog niet/.test(rev.answer), "review beantwoordt de PROD-vraag", rev.answer);
  const failedRun = (await api("GET", "/api/v1/runs?limit=200")).data.find((r: any) => r.status === "error");
  if (failedRun) {
    const pa = (await api("POST", "/api/v1/agents/page/advise", { view: "instance", param: failedRun.id, env: "dev", question: "Waarom is dit mislukt?" })).data;
    assert(pa.findings[0]?.level === "risk" && pa.answer, "pagina-advies verklaart een mislukte uitvoering", pa.findings[0]);
  }
  const dashAdv = (await api("POST", "/api/v1/agents/page/advise", { view: "dashboard", env: "dev", text: "Dashboard" })).data;
  assert(typeof dashAdv.summary === "string" && Array.isArray(dashAdv.findings) && dashAdv.by === "heuristiek", "pagina-advies voor het dashboard");

  const prompts = (await client.listPrompts()).prompts.map((p) => p.name);
  assert(prompts.includes("integratie-bouwen"), "prompt integratie-bouwen");
  await client.close();

  line("MCP-tool stap (platform als MCP-client)");
  const mcpStep = await testRun(linear("McpClient", { type: "manual" }, [
    { id: "vraag", type: "mcp-tool", config: { url: `${BASE}/mcp`, tool: "list_queues", arguments: { env: "dev" }, target: "queues" } }
  ]), {});
  assert(mcpStep.status === "success" && Array.isArray(mcpStep.output?.queues), "proces roept een MCP-tool aan", mcpStep.error);

  line("MCP via stdio (zoals Claude Desktop)");
  const stdio = new Client({ name: "stdio-test", version: "1" });
  await stdio.connect(new StdioClientTransport({ command: join(__dirname, "..", "node_modules", ".bin", "tsx"), args: [join(__dirname, "..", "src", "mcp", "stdio.ts")], env: { ...process.env, AIP_URL: BASE } as Record<string, string>, stderr: "ignore" }));
  const dash = text(await stdio.callTool({ name: "get_dashboard", arguments: {} }));
  assert(typeof dash.runs?.totalRuns === "number", "get_dashboard via stdio");
  await stdio.close();

  console.log(`\n${failures === 0 ? "ALLE INTEGRATIETESTS GESLAAGD ✓" : `${failures} TEST(S) GEFAALD ✗`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
