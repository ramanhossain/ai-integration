// Test van het plugin-framework zonder echte accounts:
// 1) aanvragen naar een lokale nepserver: authenticatie, body-codering, fouten, OAuth-verversing
// 2) sweep over ALLE operaties van alle plugins met een gesimuleerde fetch: geldige URL's en bodies
// Run: npm run test:plugins
process.env.AIP_STORAGE = "memory";
process.env.AIP_DRIVER_CONNECT_MS = "3000";
import { createHmac } from "node:crypto";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { credentials } from "../src/connectors/credentials";
import { plugins } from "../src/plugins/registry";
import { executePlugin } from "../src/plugins/runtime";
import type { PluginDef } from "../src/plugins/types";

let failures = 0;
const ok = (c: unknown, m: string, extra?: unknown) => { if (c) console.log(`  ok   ${m}`); else { failures++; console.log(`FAIL  ${m}${extra !== undefined ? ` -> ${JSON.stringify(extra).slice(0, 400)}` : ""}`); } };
const line = (t: string) => console.log(`\n=== ${t} ===`);

type Seen = { method: string; url: string; headers: IncomingMessage["headers"]; body: string };
const seen: Seen[] = [];
const server = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    seen.push({ method: req.method!, url: req.url!, headers: req.headers, body });
    const u = req.url!;
    const send = (code: number, data: unknown, type = "application/json") => { res.writeHead(code, { "content-type": type }); res.end(typeof data === "string" ? data : JSON.stringify(data)); };
    if (u.startsWith("/token")) return send(200, { access_token: "vers-token", refresh_token: "nieuw-refresh", expires_in: 3600, instance_url: "https://inst.example" });
    if (u.startsWith("/slack-fout")) return send(200, { ok: false, error: "channel_not_found" });
    if (u.startsWith("/gql")) return send(200, { data: null, errors: [{ message: "Veld bestaat niet" }] });
    if (u.startsWith("/fout")) return send(422, { error: { message: "Ongeldige invoer" } });
    if (u.startsWith("/xml")) return send(200, "<Result><Item><Name>a</Name></Item><Item><Name>b</Name></Item></Result>", "application/xml");
    if (u.startsWith("/sheet")) return send(200, { values: [["naam", "bedrag"], ["Jan", "10"], ["Piet", "20"]] });
    if (u.startsWith("/leeg")) { res.writeHead(204); return res.end(); }
    if (u.startsWith("/rss")) return send(200, `<?xml version="1.0"?><rss version="2.0"><channel><title>T</title><item><title>Eerste</title><link>https://x.nl/1</link><guid>g1</guid><pubDate>Tue, 29 Sep 2026 10:00:00 GMT</pubDate></item><item><title>Tweede</title><link>https://x.nl/2</link></item></channel></rss>`, "application/rss+xml");
    if (u.startsWith("/atom")) return send(200, `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Atoom</title><id>urn:1</id><updated>2026-09-29T10:00:00Z</updated><link rel="alternate" href="https://x.nl/a"/></entry></feed>`, "application/atom+xml");
    if (u.startsWith("/api/v2.1/dtable/app-access-token/")) return send(200, { access_token: "base-token", dtable_uuid: "uuid-42" });
    if (u.startsWith("/jsonrpc")) { const b = JSON.parse(body); return send(200, { jsonrpc: "2.0", id: b.id, result: b.params.method === "authenticate" ? 7 : b.params.method === "execute_kw" ? [{ id: 1, name: "Jan" }] : null }); }
    send(200, { ok: true, echo: true });
  });
});

async function main() {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const cred = (name: string, plugin: string, values: Record<string, string>) => credentials.upsert({ name, type: "plugin", plugin, values: { dev: values } }, "test");
  const last = () => seen[seen.length - 1];
  const P = (over: Partial<PluginDef>): PluginDef => ({ id: "t", name: "Test", category: "Overig", description: "", baseUrl: base, auth: { type: "none" }, operations: [], ...over });

  line("Authenticatie en opbouw van aanvragen");
  cred("bear", "t", { token: "abc" });
  await executePlugin({ plugin: P({ auth: { type: "bearer", prefix: "Bot" }, operations: [{ id: "o", resource: "r", label: "l", method: "POST", path: "/chan/{{id}}/msg", params: [{ name: "id", label: "id", in: "path", required: true }, { name: "text", label: "t", in: "body" }, { name: "fields.a", label: "a", in: "body" }] }] }), operation: "o", credential: "bear", params: { id: "a b/c", text: "hoi", "fields.a": "x" }, env: "dev" });
  ok(last().headers.authorization === "Bot abc", "bearer met prefix", last().headers.authorization);
  ok(last().url === "/chan/a%20b%2Fc/msg", "padparameter gecodeerd", last().url);
  ok(JSON.parse(last().body).fields.a === "x" && JSON.parse(last().body).text === "hoi", "body-parameters met punt worden genest", last().body);

  cred("basic", "t", { user: "jan@x.nl/token", password: "geheim" });
  await executePlugin({ plugin: P({ auth: { type: "basic" }, operations: [{ id: "o", resource: "r", label: "l", method: "POST", path: "/issue", params: [{ name: "fields.description", label: "d", format: "adf" }, { name: "labels", label: "l", format: "list" }] }] }), operation: "o", credential: "basic", params: { "fields.description": "Regel 1\n\nRegel 2", labels: "a, b" }, env: "dev" });
  const jb = JSON.parse(last().body);
  ok(last().headers.authorization === `Basic ${Buffer.from("jan@x.nl/token:geheim").toString("base64")}`, "basic auth");
  ok(jb.fields.description.type === "doc" && jb.fields.description.content.length === 2 && jb.fields.description.content[1].content[0].text === "Regel 2", "tekst naar Atlassian Document Format", jb.fields.description);
  ok(JSON.stringify(jb.labels) === '["a","b"]', "komma-lijst naar array", jb.labels);

  await executePlugin({ plugin: P({ operations: [{ id: "o", resource: "r", label: "l", method: "POST", path: "/pay", bodyType: "form", params: [{ name: "amount", label: "a", type: "number" }, { name: "metadata", label: "m", type: "json" }, { name: "methods", label: "pm", format: "list" }] }] }), operation: "o", params: { amount: "1250", metadata: '{"order":"A1"}', methods: "card,ideal" }, env: "dev" });
  ok(last().headers["content-type"] === "application/x-www-form-urlencoded" && decodeURIComponent(last().body) === "amount=1250&metadata[order]=A1&methods[0]=card&methods[1]=ideal", "formulier-codering zoals Stripe", decodeURIComponent(last().body));

  cred("supa", "t", { serviceKey: "sk" });
  await executePlugin({ plugin: P({ auth: { type: "headers", headers: { apikey: "{{serviceKey}}", Authorization: "Bearer {{serviceKey}}" }, fields: [] }, operations: [{ id: "o", resource: "r", label: "l", method: "PATCH", path: "/orders", bodyParam: "v", params: [{ name: "filter", label: "f", in: "rawQuery" }, { name: "v", label: "v", type: "json" }, { name: "Prefer", label: "p", in: "header", default: "return=representation" }] }] }), operation: "o", credential: "supa", params: { filter: "id=eq.5&status=neq.klaar", v: { status: "klaar" } }, env: "dev" });
  ok(last().url === "/orders?id=eq.5&status=neq.klaar" && last().headers.prefer === "return=representation" && last().headers.apikey === "sk", "PostgREST-filter, headerparameter en headers uit koppeling", { url: last().url, prefer: last().headers.prefer });

  await executePlugin({ plugin: P({ operations: [{ id: "o", resource: "r", label: "l", method: "GET", path: "/file/{{p}}", params: [{ name: "p", label: "p", in: "path", format: "raw", required: true }, { name: "q", label: "q", in: "query" }] }] }), operation: "o", params: { p: "map met spatie/bestand.json", q: "a&b" }, env: "dev" });
  ok(last().url === "/file/map%20met%20spatie/bestand.json?q=a%26b", "raw pad behoudt schuine strepen; query gecodeerd", last().url);

  cred("qk", "t", { apiKey: "K1", token: "T1" });
  const r1 = await executePlugin({ plugin: P({ auth: { type: "query", query: { key: "{{apiKey}}", token: "{{token}}" }, fields: [] }, operations: [{ id: "o", resource: "r", label: "l", method: "GET", path: "/cards" }] }), operation: "o", credential: "qk", params: {}, env: "dev" });
  ok(last().url === "/cards?key=K1&token=T1" && !r1.request.url.includes("K1") && !r1.request.url.includes("T1"), "auth in query; geheimen gemaskeerd in de log-URL", r1.request.url);

  await executePlugin({ plugin: P({ operations: [{ id: "o", resource: "r", label: "l", method: "POST", path: "/chat", body: { messages: [{ $if: "{{system}}", role: "system", content: "{{system}}" }, { role: "user", content: "{{prompt}}" }], temperature: "{{temperature}}" }, params: [{ name: "prompt", label: "p" }, { name: "system", label: "s" }, { name: "temperature", label: "t", type: "number" }] }] }), operation: "o", params: { prompt: "Hallo", temperature: "0.2" }, env: "dev" });
  const cb = JSON.parse(last().body);
  ok(cb.messages.length === 1 && cb.messages[0].role === "user" && cb.temperature === 0.2, "$if laat een lege systeeminstructie weg; getal blijft getal", cb);

  line("Fouten en antwoorden");
  const tryErr = async (p: PluginDef) => { try { await executePlugin({ plugin: p, operation: "o", params: {}, env: "dev" }); return ""; } catch (e) { return (e as Error).message; } };
  ok(/422: Ongeldige invoer/.test(await tryErr(P({ operations: [{ id: "o", resource: "r", label: "l", method: "POST", path: "/fout" }] }))), "HTTP-fout met melding uit error.message");
  ok(/channel_not_found/.test(await tryErr(P({ okField: "ok", errorPath: "error", operations: [{ id: "o", resource: "r", label: "l", method: "POST", path: "/slack-fout" }] }))), "200 met ok:false (Slack) is een fout");
  ok(/Veld bestaat niet/.test(await tryErr(P({ graphqlErrors: true, operations: [{ id: "o", resource: "r", label: "l", method: "POST", path: "/gql" }] }))), "GraphQL-fouten in een 200-antwoord");
  ok(/verplicht/.test(await tryErr(P({ operations: [{ id: "o", resource: "r", label: "l", method: "GET", path: "/x", params: [{ name: "a", label: "Naam", in: "query", required: true }] }] }))), "verplichte parameter wordt gecontroleerd");
  const x = await executePlugin({ plugin: P({ operations: [{ id: "o", resource: "r", label: "l", method: "GET", path: "/xml", output: "Result.Item" }] }), operation: "o", params: {}, env: "dev" });
  ok(Array.isArray(x.data) && (x.data as Array<{ Name: string }>)[1].Name === "b", "XML-antwoord wordt JSON (AWS)", x.data);
  const sh = await executePlugin({ plugin: P({ operations: [{ id: "o", resource: "r", label: "l", method: "GET", path: "/sheet", transform: "sheet-rows" }] }), operation: "o", params: {}, env: "dev" });
  ok(JSON.stringify(sh.data) === '[{"_row":2,"naam":"Jan","bedrag":"10"},{"_row":3,"naam":"Piet","bedrag":"20"}]', "Google Sheets-rijen als objecten", sh.data);
  const e204 = await executePlugin({ plugin: P({ operations: [{ id: "o", resource: "r", label: "l", method: "DELETE", path: "/leeg" }] }), operation: "o", params: {}, env: "dev" });
  ok((e204.data as { ok: boolean }).ok === true, "leeg antwoord (204) geeft ok");

  line("OAuth2: token verversen");
  cred("oauth", "t", { clientId: "cid", clientSecret: "cs", accessToken: "oud", refreshToken: "r1", expiresAt: String(Date.now() - 1000) });
  await executePlugin({ plugin: P({ auth: { type: "oauth2", authUrl: `${base}/auth`, tokenUrl: `${base}/token`, scopes: [] }, operations: [{ id: "o", resource: "r", label: "l", method: "GET", path: "/me" }] }), operation: "o", credential: "oauth", params: {}, env: "dev" });
  const tokReq = seen[seen.length - 2];
  ok(tokReq.url === "/token" && /grant_type=refresh_token/.test(tokReq.body) && /refresh_token=r1/.test(tokReq.body), "verlopen token wordt ververst met de refresh token", tokReq.body);
  ok(last().headers.authorization === "Bearer vers-token", "aanvraag gebruikt het nieuwe token");
  const after = credentials.resolve("oauth", "dev").values;
  ok(after.accessToken === "vers-token" && after.refreshToken === "nieuw-refresh" && Number(after.expiresAt) > Date.now(), "nieuwe tokens (versleuteld) opgeslagen in de koppeling");
  ok(!JSON.stringify(credentials.get("oauth")).includes("vers-token"), "tokens nooit zichtbaar via de API-weergave");
  cred("ccred", "t", { clientId: "cid", clientSecret: "cs" });
  await executePlugin({ plugin: P({ auth: { type: "oauth2-client", tokenUrl: `${base}/token`, tokenAuth: "basic" }, operations: [{ id: "o", resource: "r", label: "l", method: "GET", path: "/me" }] }), operation: "o", credential: "ccred", params: {}, env: "dev" });
  ok(/grant_type=client_credentials/.test(seen[seen.length - 2].body) && seen[seen.length - 2].headers.authorization?.startsWith("Basic ") && last().headers.authorization === "Bearer vers-token", "client credentials (PayPal, Help Scout)");

  line("AWS Signature V4");
  cred("aws", "t", { accessKeyId: "AKIDEXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY", region: "eu-west-1" });
  await executePlugin({ plugin: P({ auth: { type: "aws", service: "sqs" }, operations: [{ id: "o", resource: "r", label: "l", method: "POST", path: "/", target: "AmazonSQS.ListQueues", contentType: "application/x-amz-json-1.0" }] }), operation: "o", credential: "aws", params: {}, env: "dev" });
  const au = String(last().headers.authorization);
  ok(/^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/\d{8}\/eu-west-1\/sqs\/aws4_request, SignedHeaders=[a-z0-9;-]*host[a-z0-9;-]*x-amz-date[a-z0-9;-]*, Signature=[0-9a-f]{64}$/.test(au) && last().headers["x-amz-target"] === "AmazonSQS.ListQueues" && last().body === "{}", "handtekening, target en lege JSON-body", au);

  line("Eigen ondertekening (Ghost, Azure, SeaTable) en drivers");
  cred("ghost", "t", { adminKey: "6489:0a1b2c3d" });
  await executePlugin({ plugin: P({ auth: { type: "custom", signer: "ghost", fields: [] }, operations: [{ id: "o", resource: "r", label: "l", method: "GET", path: "/posts" }] }), operation: "o", credential: "ghost", params: {}, env: "dev" });
  const [gh, gp, gs] = String(last().headers.authorization).replace(/^Ghost /, "").split(".");
  const gHead = JSON.parse(Buffer.from(gh, "base64url").toString());
  ok(gHead.kid === "6489" && JSON.parse(Buffer.from(gp, "base64url").toString()).aud === "/admin/" && gs === createHmac("sha256", Buffer.from("0a1b2c3d", "hex")).update(`${gh}.${gp}`).digest("base64url"), "Ghost Admin-JWT (HS256, kid, aud)", gHead);

  const key = Buffer.from("geheime-sleutel").toString("base64");
  cred("azs", "t", { account: "acct", accountKey: key });
  await executePlugin({ plugin: P({ auth: { type: "custom", signer: "azure-storage", fields: [] }, operations: [{ id: "o", resource: "r", label: "l", method: "GET", path: "/?comp=list" }] }), operation: "o", credential: "azs", params: {}, env: "dev" });
  const azH = last().headers;
  const sts = `GET\n\n\n\n\n\n\n\n\n\n\n\nx-ms-date:${azH["x-ms-date"]}\nx-ms-version:2021-08-06\n/acct/\ncomp:list`;
  ok(azH.authorization === `SharedKey acct:${createHmac("sha256", Buffer.from(key, "base64")).update(sts).digest("base64")}`, "Azure Storage Shared Key volgens de specificatie", azH.authorization);

  cred("cosmos", "t", { accountKey: key });
  await executePlugin({ plugin: P({ auth: { type: "custom", signer: "azure-cosmos", fields: [] }, operations: [{ id: "o", resource: "r", label: "l", method: "GET", path: "/dbs/{{db}}/colls/{{c}}/docs/{{id}}", headers: { "x-ms-documentdb-partitionkey": '["{{pk}}"]' }, params: [{ name: "db", label: "d", in: "path" }, { name: "c", label: "c", in: "path" }, { name: "id", label: "i", in: "path" }, { name: "pk", label: "p", in: "template" }] }] }), operation: "o", credential: "cosmos", params: { db: "shop", c: "orders", id: "7", pk: "klant-1" }, env: "dev" });
  const ch = last().headers;
  const ctext = `get\ndocs\ndbs/shop/colls/orders/docs/7\n${String(ch["x-ms-date"]).toLowerCase()}\n\n`;
  ok(decodeURIComponent(String(ch.authorization)) === `type=master&ver=1.0&sig=${createHmac("sha256", Buffer.from(key, "base64")).update(ctext).digest("base64")}`, "Cosmos DB master-key-token (resource link uit het pad)", ch.authorization);
  ok(ch["x-ms-documentdb-partitionkey"] === '["klant-1"]' && ch.pk === undefined, "operatieheader uit sjabloonparameter (niet als losse header)", ch["x-ms-documentdb-partitionkey"]);

  cred("seat", "t", { url: base, apiToken: "api-tok" });
  await executePlugin({ plugin: P({ baseUrl: `${base}/api-gateway/api/v2/dtables/BASE_UUID`, auth: { type: "custom", signer: "seatable", fields: [] }, operations: [{ id: "o", resource: "r", label: "l", method: "GET", path: "/rows/" }] }), operation: "o", credential: "seat", params: {}, env: "dev" });
  ok(seen[seen.length - 2].headers.authorization === "Token api-tok" && last().url === "/api-gateway/api/v2/dtables/uuid-42/rows/" && last().headers.authorization === "Bearer base-token", "SeaTable: API-token wordt base-token, base-ID in het pad", last().url);

  const feed = await executePlugin({ plugin: plugins.get("rss")!, operation: "read", params: { feedUrl: `${base}/rss` }, env: "dev" });
  const fi = feed.data as Array<{ title: string; link: string; id: string }>;
  ok(fi.length === 2 && fi[0].title === "Eerste" && fi[0].id === "g1" && fi[1].link === "https://x.nl/2", "RSS-feed naar items", fi);
  const atom = await executePlugin({ plugin: plugins.get("rss")!, operation: "read", params: { feedUrl: `${base}/atom` }, env: "dev" });
  ok((atom.data as Array<{ link: string }>)[0].link === "https://x.nl/a", "Atom-feed naar items", atom.data);

  cred("odoo", "odoo", { url: base, database: "prod", user: "jan", apiKey: "k" });
  const od = await executePlugin({ plugin: plugins.get("odoo")!, operation: "search", credential: "odoo", params: { domain: '[["is_company","=",true]]', fields: "name,email", limit: "5" }, env: "dev" });
  const odReq = JSON.parse(last().body);
  ok(JSON.stringify(odReq.params.args.slice(0, 5)) === '["prod",7,"k","res.partner","search_read"]' && odReq.params.args[6].limit === 5 && (od.data as Array<{ name: string }>)[0].name === "Jan", "Odoo: aanmelden (uid) en execute_kw search_read", odReq.params.args);

  // Drivers: laden en verbinden (naar een gesloten poort) moet een nette verbindingsfout geven
  const refused: Record<string, Record<string, string>> = {
    mysql: { host: "127.0.0.1", port: "1", user: "u", password: "p", database: "d" }, "microsoft-sql": { host: "127.0.0.1", port: "1", user: "u", password: "p", database: "d" },
    "oracle-sql": { host: "127.0.0.1", port: "1", user: "u", password: "p", database: "XE" }, timescaledb: { host: "127.0.0.1", port: "1", user: "u", password: "p", database: "d" },
    mongodb: { connectionString: "mongodb://127.0.0.1:1/?directConnection=true" }, redis: { url: "redis://127.0.0.1:1" }, kafka: { brokers: "127.0.0.1:1" }, mqtt: { url: "mqtt://127.0.0.1:1" },
    rabbitmq: { url: "amqp://127.0.0.1:1" }, amqp: { host: "127.0.0.1", port: "1" }, ldap: { url: "ldap://127.0.0.1:1" }, imap: { host: "127.0.0.1", port: "1", ssl: "nee", user: "u", password: "p" }, ssh: { host: "127.0.0.1", port: "1", user: "u", password: "p" }
  };
  for (const [id, values] of Object.entries(refused)) {
    const def = plugins.get(id)!;
    const op = def.operations.find((o) => o.id === def.test) ?? def.operations[0];
    const params: Record<string, unknown> = {};
    for (const p of op.params ?? []) if (p.required) params[p.name] = p.type === "json" ? '{"a":1}' : "x";
    cred(`drv-${id}`, id, values);
    let msg = "";
    const t0 = Date.now();
    try { await executePlugin({ plugin: def, operation: op.id, credential: `drv-${id}`, params, env: "dev" }); } catch (e) { msg = (e as Error).message; }
    ok(msg !== "" && !/is not a (function|constructor)|Cannot read|niet geïnstalleerd/.test(msg) && Date.now() - t0 < 15000, `${def.name}: driver laadt en meldt verbindingsfout netjes`, msg.slice(0, 160));
  }

  line("Sweep: alle operaties van alle plugins");
  const realFetch = globalThis.fetch;
  let calls: Array<{ url: string; init: RequestInit }> = [];
  globalThis.fetch = (async (u: string | URL, init: RequestInit = {}) => { calls.push({ url: String(u), init }); return new Response(JSON.stringify({ access_token: "t", ok: true, data: {}, value: [], dtable_uuid: "uuid", token: "t", id: "u1", response: { token: "t" }, result: 1 }), { status: 200, headers: { "content-type": "application/json" } }); }) as typeof fetch;
  const dummy = (key: string) => (key === "adminKey" ? "id1:00ff" : /url|endpoint|host$|databaseUrl|webhookUrl/i.test(key) ? (/host$/i.test(key) ? "api.voorbeeld.nl" : "https://voorbeeld.nl") : `x-${key}`);
  let drivers = 0;
  let ops = 0, bad = 0;
  const problems: string[] = [];
  for (const def of plugins.all()) {
    const keys = new Set(["token", "user", "password", "apiKey", "clientId", "clientSecret", "accessToken", ...(def.fields ?? []).map((f) => f.key), ...((def.auth as { fields?: Array<{ key: string }> }).fields ?? []).map((f) => f.key)]);
    const values: Record<string, string> = Object.fromEntries([...keys].map((k) => [k, dummy(k)]));
    values.expiresAt = String(Date.now() + 3600000);
    for (const k of Object.values(def.tokenFields ?? {})) values[k] = "https://instance.voorbeeld.nl";
    if (def.auth.type === "aws") values.region = "eu-west-1";
    cred(`sweep-${def.id}`, def.id, values);
    for (const op of def.operations) {
      ops++;
      if (op.driver && !op.driver.startsWith("odoo:")) { drivers++; continue; } // socket-drivers: zie hierboven
      const params: Record<string, unknown> = {};
      for (const p of op.params ?? []) if (p.required) params[p.name] = p.type === "number" ? 1 : p.type === "json" ? {} : p.type === "boolean" ? true : /url$/i.test(p.name) ? "https://voorbeeld.nl/feed" : "waarde";
      calls = [];
      try {
        await executePlugin({ plugin: def, operation: op.id, credential: def.auth.type === "none" ? undefined : `sweep-${def.id}`, params, env: "dev" });
        const c = calls[calls.length - 1];
        const u = new URL(c.url);
        if (!/^https?:$/.test(u.protocol) || c.url.includes("{{") || c.url.includes("undefined")) throw new Error(`rare URL ${c.url}`);
        const hdrs = c.init.headers as Record<string, string>;
        for (const [k, v] of Object.entries(hdrs)) if (String(v).includes("{{") || String(v).includes("undefined")) throw new Error(`header ${k}=${v}`);
        if (typeof c.init.body === "string" && (c.init.body.includes("{{") || c.init.body.includes('"undefined"'))) throw new Error(`body ${c.init.body.slice(0, 120)}`);
      } catch (e) { bad++; problems.push(`${def.id} · ${op.id}: ${(e as Error).message}`); }
    }
  }
  globalThis.fetch = realFetch;
  ok(bad === 0, `${ops - drivers} HTTP-operaties van ${plugins.all().length} plugins bouwen een geldige aanvraag (+ ${drivers} driver-operaties)`, problems.slice(0, 60));

  server.close();
  console.log(`\n${failures === 0 ? "ALLE PLUGINTESTS GESLAAGD ✓" : `${failures} TEST(S) GEFAALD ✗`}`);
  process.exit(failures ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
