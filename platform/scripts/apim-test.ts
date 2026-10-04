// Test: API-beheer. Server in-process (geheugen, accounts uit), aanroepen via injectie.
// Specificatie → koppelen → beleid (geen beleid = geen toegang) → API-sleutel (per omgeving),
// OAuth/JWT (HS256 via de gateway, RS256 via JWKS), claim-regels, throttling, CORS, IP-lijst,
// passthrough, deploy met goedkeuring en publicatie, monitoring-velden.
process.env.AIP_STORAGE = "memory";
process.env.AIP_AUTH = "off";
process.env.LOG_LEVEL = "error";
import { createServer } from "node:http";
import { createHmac, generateKeyPairSync, sign } from "node:crypto";

let failures = 0;
const ok = (c: unknown, label: string, extra?: unknown) => { if (c) console.log(`  ok   ${label}`); else { failures++; console.log(`  FOUT ${label}`, extra === undefined ? "" : JSON.stringify(extra).slice(0, 300)); } };
const b64u = (b: Buffer | string) => Buffer.from(b).toString("base64url");

async function main() {
  const { buildServer } = require("../src/index") as typeof import("../src/index");
  const { verifyJwt } = require("../src/apim/jwt") as typeof import("../src/apim/jwt");
  const app = await buildServer();
  const req = async (method: string, url: string, body?: unknown, headers: Record<string, string> = {}) => {
    const r = await app.inject({ method: method as "GET", url, payload: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body), headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), "x-aip-user": "alice", ...headers } });
    let b: any = r.body; try { b = JSON.parse(r.body); } catch { /* tekst */ }
    return { status: r.statusCode, body: b, headers: r.headers };
  };

  // Achterliggende API voor passthrough.
  const backend = createServer((rq, rs) => { rs.setHeader("content-type", "application/json"); rs.end(JSON.stringify({ path: rq.url, auth: rq.headers["x-backend"] || null, apiKeyForwarded: Boolean(rq.headers["x-api-key"]) })); });
  await new Promise<void>((r) => backend.listen(0, "127.0.0.1", () => r()));
  const bport = (backend.address() as { port: number }).port;

  console.log("=== API maken en koppelen ===");
  const spec = { openapi: "3.0.1", info: { title: "Klanten API", version: "1" }, servers: [{ url: "/klanten/v1" }], paths: { "/klanten/{id}": { get: { operationId: "getKlant", parameters: [{ name: "id", in: "path", required: true }] } }, "/legacy/{x}": { get: { operationId: "legacy" } } } };
  let r = await req("POST", "/api/v1/apim/apis", { specText: JSON.stringify(spec) });
  ok(r.status === 200 && r.body.basePath === "/klanten/v1" && r.body.operations.length === 2, "API uit OpenAPI (basispad uit servers)", r.body);
  const id = r.body.id;
  r = await req("POST", "/api/v1/apim/apis", { specText: JSON.stringify({ ...spec, info: { title: "Dubbel" } }) });
  ok(r.status === 400, "overlappend basispad geweigerd");
  r = await req("POST", "/api/v1/apim/apis", { specText: "geen: openapi" });
  ok(r.status === 400, "ongeldige specificatie geweigerd");
  r = await req("POST", `/api/v1/apim/apis/${id}/link-new-process`, { operation: "GET /klanten/{id}" });
  ok(r.status === 200 && r.body.process === "getKlant", "nieuw proces gekoppeld");
  r = await req("PUT", `/api/v1/apim/apis/${id}`, { links: { "GET /klanten/{id}": { mode: "process", process: "getKlant" }, "GET /legacy/{x}": { mode: "passthrough", target: `http://127.0.0.1:${bport}/old`, setHeaders: { "x-backend": "geheim" } } } });
  ok(r.status === 200 && r.body.version === "1.0.2", "koppelingen opgeslagen (patchversie)", r.body.version);

  console.log("=== Beleid en API-sleutels ===");
  r = await req("GET", "/apis/dev/klanten/v1/klanten/1");
  ok(r.status === 401 && /geen API-beleid/.test(r.body.error), "zonder beleid geen toegang");
  const kDev = (await req("POST", "/api/v1/apim/keys", { name: "Partner", env: "dev" })).body;
  const kTest = (await req("POST", "/api/v1/apim/keys", { name: "Partner", env: "test" })).body;
  r = await req("POST", "/api/v1/apim/policies", { name: "Partners", envs: ["dev", "test"], endpoints: [{ method: "GET", path: "/klanten/v1", throttle: { limit: 50, windowSec: 60 } }], identities: [{ type: "apikey", name: "Partner", keyName: "x-api-key", location: "header", keys: [kDev.info.id, kTest.info.id], throttle: { limit: 4, windowSec: 60 } }], logging: { fields: ["identity", "query", "requestHeaders", "responseBody"], bodyMaxKb: 1, ip: "xff-first" }, cors: { origins: ["https://app.partner.nl"] } });
  ok(r.status === 200, "beleid aangemaakt", r.body);
  r = await req("POST", "/api/v1/apim/policies", { name: "Dubbel", envs: ["dev"], endpoints: [{ method: "GET", path: "/klanten/v1" }], identities: [{ type: "public" }] });
  ok(r.status === 400 && /valt al onder/.test(r.body.error), "zelfde endpoint+omgeving maar in één beleid");
  r = await req("GET", "/apis/dev/klanten/v1/klanten/1");
  ok(r.status === 401, "zonder sleutel geweigerd");
  r = await req("GET", "/apis/dev/klanten/v1/klanten/1", undefined, { "x-api-key": kTest.key });
  ok(r.status === 401, "TEST-sleutel werkt niet op DEV");
  r = await req("GET", "/apis/dev/klanten/v1/klanten/42?veld=a", undefined, { "x-api-key": kDev.key, "x-forwarded-for": "198.51.100.7, 10.0.0.1" });
  ok(r.status === 200 && r.body.id === "42", "met sleutel: proces antwoordt", r.body);
  r = await req("GET", "/apis/dev/klanten/v1/legacy/abc?q=1", undefined, { "x-api-key": kDev.key });
  ok(r.status === 200 && r.body.path === "/old/legacy/abc?q=1" && r.body.auth === "geheim" && r.body.apiKeyForwarded === false, "passthrough: pad, query, extra header; sleutel niet doorgestuurd", r.body);
  r = await req("OPTIONS", "/apis/dev/klanten/v1/klanten/1", undefined, { origin: "https://app.partner.nl", "access-control-request-method": "GET" });
  ok(r.status === 204 && r.headers["access-control-allow-origin"] === "https://app.partner.nl", "CORS-preflight voor toegestane origin");
  r = await req("OPTIONS", "/apis/dev/klanten/v1/klanten/1", undefined, { origin: "https://evil.example", "access-control-request-method": "GET" });
  ok(r.status === 403, "CORS geweigerd voor andere origin");
  let codes: number[] = [];
  for (let i = 0; i < 3; i++) codes.push((await req("GET", "/apis/dev/klanten/v1/klanten/1", undefined, { "x-api-key": kDev.key })).status);
  ok(codes.includes(429), "throttle per sleutel (4/min)", codes);
  r = await req("GET", "/apis/test/klanten/v1/klanten/1", undefined, { "x-api-key": kTest.key });
  ok(r.status === 404, "nog niet gedeployed op TEST");

  console.log("=== Monitoring ===");
  r = await req("GET", "/api/v1/apim/logs?limit=50");
  const okLog = r.body.items.find((l: any) => l.status === 200 && l.path.endsWith("/klanten/42"));
  ok(okLog && okLog.identity === "Partner: Partner" && okLog.query === "veld=a" && okLog.ip === "198.51.100.7" && okLog.reqHeaders && okLog.reqHeaders["x-api-key"] === "•••" && okLog.resBody, "logvelden volgens beleid (identiteit, query, IP uit XFF, headers, body)", okLog);
  ok(!okLog.reqHeaders?.authorization && !okLog.reqHeaders?.cookie, "authorization/cookie nooit gelogd");
  r = await req("GET", "/api/v1/apim/logs?status=429");
  ok(r.body.total >= 1, "filter op statuscode");

  console.log("=== OAuth / JWT ===");
  r = await req("POST", "/api/v1/apim/issuers", { name: "Test IdP", issuer: "https://idp.test", audience: "api://klanten", hsSecret: "supergeheim-123" });
  ok(r.status === 200 && r.body.hasSecret, "uitgever met gedeeld geheim", r.body);
  const iss = r.body.id;
  const pid = (await req("GET", "/api/v1/apim/policies")).body[0].id;
  const cur = (await req("GET", "/api/v1/apim/policies")).body[0];
  r = await req("PUT", `/api/v1/apim/policies/${pid}`, { ...cur, identities: [...cur.identities, { type: "oauth", name: "Apps", issuers: [iss], rules: [{ claim: "roles", op: "exact", value: "klanten.lezen" }], throttleClaim: "azp", throttle: { limit: 100, windowSec: 60 } }] });
  ok(r.status === 200, "OAuth-identiteit toegevoegd", r.body);
  const hs = (payload: object) => { const h = b64u(JSON.stringify({ alg: "HS256", typ: "JWT" })); const p = b64u(JSON.stringify(payload)); return `${h}.${p}.${b64u(createHmac("sha256", "supergeheim-123").update(`${h}.${p}`).digest())}`; };
  const exp = Math.floor(Date.now() / 1000) + 600;
  r = await req("GET", "/apis/dev/klanten/v1/klanten/7", undefined, { authorization: `Bearer ${hs({ iss: "https://idp.test", aud: "api://klanten", exp, azp: "crm", roles: ["klanten.lezen"] })}` });
  ok(r.status === 200, "geldig JWT met juiste rol", r.body);
  r = await req("GET", "/apis/dev/klanten/v1/klanten/7", undefined, { authorization: `Bearer ${hs({ iss: "https://idp.test", aud: "api://klanten", exp, roles: ["iets.anders"] })}` });
  ok(r.status === 401 && /niet de vereiste waarde/.test(r.body.error), "claim-regel weigert verkeerde rol", r.body);
  r = await req("GET", "/apis/dev/klanten/v1/klanten/7", undefined, { authorization: `Bearer ${hs({ iss: "https://idp.test", aud: "api://ander", exp, roles: ["klanten.lezen"] })}` });
  ok(r.status === 401, "verkeerde audience geweigerd");
  r = await req("GET", "/apis/dev/klanten/v1/klanten/7", undefined, { authorization: `Bearer ${hs({ iss: "https://idp.test", aud: "api://klanten", exp: 1000, roles: ["klanten.lezen"] })}` });
  ok(r.status === 401 && /verlopen/.test(r.body.error), "verlopen token geweigerd");
  const forged = hs({ iss: "https://idp.test", aud: "api://klanten", exp, roles: ["klanten.lezen"] }).replace(/\.[^.]+$/, ".AAAA");
  r = await req("GET", "/apis/dev/klanten/v1/klanten/7", undefined, { authorization: `Bearer ${forged}` });
  ok(r.status === 401, "vervalste handtekening geweigerd");
  // RS256 via JWKS (direct, met een lokale JWKS-server).
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: "jwk" }), kid: "k1", use: "sig", alg: "RS256" };
  const jwksSrv = createServer((_q, s) => { s.setHeader("content-type", "application/json"); s.end(JSON.stringify({ keys: [jwk] })); });
  await new Promise<void>((res) => jwksSrv.listen(0, "127.0.0.1", () => res()));
  const jport = (jwksSrv.address() as { port: number }).port;
  const h = b64u(JSON.stringify({ alg: "RS256", kid: "k1" })), p = b64u(JSON.stringify({ iss: "https://rs.test", exp, sub: "u1" }));
  const tok = `${h}.${p}.${b64u(sign("sha256", Buffer.from(`${h}.${p}`), privateKey))}`;
  const issRs = { id: "x", name: "RS", issuer: "https://rs.test", jwksUri: `http://127.0.0.1:${jport}/jwks` };
  const v = await verifyJwt(tok, [issRs]).catch((e) => e);
  ok(v && v.claims && v.claims.sub === "u1", "RS256 via JWKS geverifieerd", v?.message);
  const bad = await verifyJwt(tok.slice(0, -4) + "AAAA", [issRs]).catch((e) => e);
  ok(bad instanceof Error, "RS256 met kapotte handtekening geweigerd");
  jwksSrv.close();

  console.log("=== Deploy en versies ===");
  r = await req("POST", `/api/v1/apim/apis/${id}/deploy`, { env: "test" });
  ok(r.status === 200 && r.body.status === "pending", "deploy naar TEST is een goedkeuringsverzoek", r.body);
  r = await req("POST", `/api/v1/approvals/${r.body.id}/approve`, { approver: "bob" }, { "x-aip-user": "bob" });
  ok(r.body.status === "executed" && r.body.result.deployed.version === "2.0.0", "na goedkeuring gepubliceerd als 2.0.0", r.body.result);
  const pd = await req("POST", "/api/v1/integrations/getKlant/deploy", { toEnv: "test" });
  await req("POST", `/api/v1/approvals/${pd.body.id}/approve`, { approver: "bob" }, { "x-aip-user": "bob" });
  r = await req("GET", "/apis/test/klanten/v1/klanten/9", undefined, { "x-api-key": kTest.key });
  ok(r.status === 200 && r.body.id === "9", "API werkt op TEST met TEST-sleutel", r.body);
  r = await req("PUT", `/api/v1/apim/apis/${id}`, { description: "gewijzigd op DEV" });
  ok(r.body.version === "2.0.1", "verder werken op DEV na publicatie (2.0.1)", r.body.version);
  r = await req("GET", `/api/v1/apim/apis/${id}`);
  ok(r.body.deployed.test.version === "2.0.0", "TEST blijft op gepubliceerde versie");
  r = await req("GET", "/apis/test/klanten/v1/openapi.json");
  ok(r.status === 200 && r.body.servers[0].url.endsWith("/apis/test/klanten/v1") && r.body.info.version === "2.0.0", "openapi.json per omgeving met server-URL en versie");
  r = await req("GET", "/apis/dev/getKlant");
  ok(r.status === 404, "gekoppeld proces niet via losse API-endpoints bereikbaar (geen omzeiling van beleid)");

  console.log("=== IP-beperking en publiek ===");
  r = await req("POST", "/api/v1/apim/policies", { name: "Alleen intern", envs: ["acc"], endpoints: [{ method: "ALL", path: "/klanten/v1" }], identities: [{ type: "public" }], ipAllow: ["10.0.0.0/8"] });
  const ad = await req("POST", `/api/v1/apim/apis/${id}/deploy`, { env: "acc", version: "2.0.0" });
  await req("POST", `/api/v1/approvals/${ad.body.id}/approve`, { approver: "bob" }, { "x-aip-user": "bob" });
  r = await req("GET", "/apis/acc/klanten/v1/legacy/z");
  ok(r.status === 403 && /IP/.test(r.body.error), "IP buiten de lijst geweigerd (inject-IP 127.0.0.1)", r.body);

  await app.close();
  backend.close();
  console.log(failures ? `\n${failures} TEST(S) MISLUKT ✗` : "\nALLE API-BEHEERTESTS GESLAAGD ✓");
  process.exit(failures ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
