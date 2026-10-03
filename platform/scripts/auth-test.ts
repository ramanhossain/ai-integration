// Test: accounts en multi-tenancy (iPaaS). Start de server in-process (geheugenopslag,
// accounts aan) en test via HTTP-injectie: eerste start, aanmelden, afscherming tussen
// organisaties, uitnodigen + wachtwoord instellen, rechten per omgeving, beheerdersrechten,
// API-sleutels, webhooks per organisatie, platformbeheer en uitschakelen.
process.env.AIP_STORAGE = "memory";
delete process.env.AIP_AUTH;
process.env.LOG_LEVEL = "error";

type Res = { status: number; body: any; cookie?: string };
let failures = 0;
function ok(cond: unknown, label: string, extra?: unknown): void {
  if (cond) console.log(`  ok   ${label}`);
  else { failures++; console.log(`  FOUT ${label}`, extra === undefined ? "" : JSON.stringify(extra).slice(0, 300)); }
}

async function main() {
  // Pas na het zetten van de omgevingsvariabelen laden.
  const { buildServer } = require("../src/index") as typeof import("../src/index");
  const { startOrg } = require("../src/tenancy/boot") as typeof import("../src/tenancy/boot");
  const { accounts } = require("../src/auth/accounts") as typeof import("../src/auth/accounts");
  const app = await buildServer();
  for (const org of accounts.orgIds()) startOrg(org);

  async function req(method: string, url: string, body?: unknown, cookie?: string, headers: Record<string, string> = {}): Promise<Res> {
    const r = await app.inject({ method: method as "GET", url, payload: body === undefined ? undefined : JSON.stringify(body), headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}), ...headers } });
    const set = r.headers["set-cookie"];
    const c = (Array.isArray(set) ? set[0] : set)?.split(";")[0];
    let b: any = r.body;
    try { b = JSON.parse(r.body); } catch { /* tekst */ }
    return { status: r.statusCode, body: b, cookie: c };
  }
  const def = (name: string) => ({ integration: name, version: "1", description: "test", trigger: { type: "webhook", path: name }, steps: [{ id: "set", type: "transform", config: { set: { done: true } } }] });
  const linkFor = (email: string) => {
    const { mailer } = require("../src/auth/mailer");
    const m = mailer.list().find((x: { to: string }) => x.to === email);
    return decodeURIComponent(m.text.match(/#reset\/(\S+)/)[1]);
  };

  console.log("=== Eerste start ===");
  let r = await req("GET", "/api/v1/auth/status");
  ok(r.body.setupRequired === true && r.body.authEnabled, "setup nodig");
  r = await req("GET", "/api/v1/integrations");
  ok(r.status === 401, "API zonder login: 401");
  r = await req("POST", "/api/v1/auth/signup", { orgName: "X", name: "Xx", email: "x@x.nl", password: "Geheim12345" });
  ok(r.status === 409, "aanmelden vóór hoofdaccount geweigerd");
  r = await req("POST", "/api/v1/auth/setup", { name: "Hoofd Beheer", email: "admin@aip.test", password: "Admin12345x", orgName: "AIP" });
  ok(r.status === 200 && r.body.user.superAdmin, "hoofdaccount aangemaakt", r.body);
  const A = r.cookie!;
  r = await req("POST", "/api/v1/auth/setup", { name: "Twee", email: "twee@aip.test", password: "Admin12345x" });
  ok(r.status === 409, "tweede setup geweigerd");

  console.log("=== Aanmelden en afscherming ===");
  r = await req("POST", "/api/v1/auth/signup", { orgName: "Klant B", name: "Bea", email: "bea@b.test", password: "kort" });
  ok(r.status === 400, "zwak wachtwoord geweigerd");
  r = await req("POST", "/api/v1/auth/signup", { orgName: "Klant B", name: "Bea Klant", email: "bea@b.test", password: "KlantB12345" });
  ok(r.status === 200 && r.body.org.id === "klant-b" && r.body.user.role === "beheerder", "organisatie B aangemaakt", r.body);
  const Bc = r.cookie!;
  r = await req("POST", "/api/v1/auth/signup", { orgName: "Dubbel", name: "Bea", email: "BEA@b.test", password: "KlantB12345" });
  ok(r.status === 409, "e-mailadres is uniek (hoofdletterongevoelig)");
  r = await req("POST", "/api/v1/integrations", def("OrderSync"), A);
  ok(r.status === 200 && r.body.owner === "admin@aip.test", "A slaat proces op (eigenaar = ingelogde gebruiker)");
  r = await req("GET", "/api/v1/integrations", undefined, Bc);
  ok(Array.isArray(r.body) && r.body.length === 0, "B ziet de processen van A niet");
  r = await req("GET", "/api/v1/integrations/OrderSync", undefined, Bc);
  ok(r.status === 404, "B kan proces van A niet openen");
  r = await req("POST", "/api/v1/integrations", def("OrderSync"), Bc);
  ok(r.status === 200 && r.body.version === "1", "B heeft een eigen OrderSync (v1)");
  r = await req("POST", "/api/v1/queues/dev", { queue: "orders" }, Bc);
  r = await req("GET", "/api/v1/queues?env=dev", undefined, A);
  ok(Array.isArray(r.body) && !r.body.some((q: { queue: string }) => q.queue === "orders"), "queues gescheiden");

  console.log("=== Uitnodigen en rechten per omgeving ===");
  r = await req("POST", "/api/v1/org/users", { name: "Dirk Dev", email: "dirk@b.test", role: "gebruiker", envAccess: { dev: "edit", test: "view", acc: "none", prod: "none" } }, Bc);
  ok(r.status === 200 && !r.body.user.hasPassword, "Dirk uitgenodigd");
  const tok = linkFor("dirk@b.test");
  r = await req("GET", `/api/v1/auth/reset/${encodeURIComponent(tok)}`);
  ok(r.body.kind === "invite" && r.body.org === "Klant B", "uitnodigingslink geldig");
  r = await req("POST", "/api/v1/auth/reset", { token: tok, password: "Dirk12345abc" });
  ok(r.status === 200, "wachtwoord gekozen");
  const D = r.cookie!;
  r = await req("POST", "/api/v1/auth/reset", { token: tok, password: "Dirk12345abc" });
  ok(r.status === 400, "link maar één keer bruikbaar");
  r = await req("POST", "/api/v1/integrations", def("DirkFlow"), D);
  ok(r.status === 200, "Dirk mag op DEV bouwen");
  r = await req("POST", "/api/v1/integrations/DirkFlow/deploy", { toEnv: "test" }, D);
  ok(r.status === 403, "Dirk mag niet naar TEST deployen (alleen lezen)");
  r = await req("GET", "/api/v1/datatables/test", undefined, D);
  ok(r.status === 200, "Dirk mag TEST lezen");
  r = await req("GET", "/api/v1/datatables/prod", undefined, D);
  ok(r.status === 403, "Dirk mag PROD niet lezen");
  r = await req("PUT", "/api/v1/settings", { fourEyes: false }, D);
  ok(r.status === 403, "Dirk mag instellingen niet wijzigen");
  r = await req("GET", "/api/v1/org", undefined, D);
  ok(r.status === 403, "Dirk mag geen accounts beheren");
  r = await req("GET", "/api/v1/admin/overview", undefined, Bc);
  ok(r.status === 403, "beheerder B is geen hoofdaccount");
  r = await req("POST", "/api/v1/integrations/DirkFlow/deploy", { toEnv: "test", proposedBy: "iemand-anders" }, Bc);
  ok(r.status === 200 && r.body.action.proposedBy === "bea@b.test", "indiener = ingelogde gebruiker (niet te vervalsen)");
  r = await req("POST", `/api/v1/approvals/${r.body.id}/approve`, { approver: "bea@b.test" }, D);
  ok(r.status === 403, "Dirk mag TEST niet goedkeuren");

  console.log("=== Wachtwoord vergeten en inloggen ===");
  r = await req("POST", "/api/v1/auth/forgot", { email: "onbekend@x.nl" });
  ok(r.status === 200, "vergeten: geen verschil voor onbekend adres");
  r = await req("POST", "/api/v1/auth/forgot", { email: "dirk@b.test" });
  const rt = linkFor("dirk@b.test");
  r = await req("POST", "/api/v1/auth/reset", { token: rt, password: "Nieuw12345xyz" });
  ok(r.status === 200, "nieuw wachtwoord via resetlink");
  r = await req("GET", "/api/v1/integrations", undefined, D);
  ok(r.status === 401, "oude sessies zijn beëindigd na wachtwoordwijziging");
  r = await req("POST", "/api/v1/auth/login", { email: "dirk@b.test", password: "Dirk12345abc" });
  ok(r.status === 401, "oud wachtwoord werkt niet meer");
  r = await req("POST", "/api/v1/auth/login", { email: "Dirk@B.test", password: "Nieuw12345xyz" });
  ok(r.status === 200, "inloggen met nieuw wachtwoord");

  console.log("=== API-sleutels, MCP en webhooks per organisatie ===");
  r = await req("POST", "/api/v1/org/api-keys", { name: "CI" }, Bc);
  const key = r.body.key as string;
  ok(key && key.startsWith("aip_"), "API-sleutel gemaakt");
  r = await req("GET", "/api/v1/integrations", undefined, undefined, { authorization: `Bearer ${key}` });
  ok(Array.isArray(r.body) && r.body.length === 2, "API-sleutel ziet processen van B", r.body);
  r = await req("GET", "/api/v1/integrations", undefined, undefined, { authorization: "Bearer aip_onzin" });
  ok(r.status === 401, "ongeldige sleutel geweigerd");
  r = await req("POST", "/o/klant-b/hooks/dev/OrderSync", { orderId: 1 });
  ok(r.status === 200 && r.body.status === "success", "webhook van B via /o/klant-b/", r.body);
  r = await req("GET", "/api/v1/runs?limit=10", undefined, A);
  const runsA = (r.body.items || r.body) as Array<unknown>;
  ok(runsA.length === 0, "run van B is niet zichtbaar voor A");
  r = await req("POST", "/o/bestaat-niet/hooks/dev/OrderSync", {});
  ok(r.status === 404, "onbekende organisatie: 404");

  console.log("=== Beveiliging: code-stap en uitgaand verkeer ===");
  r = await req("POST", "/api/v1/engine/execute-step", { type: "code", config: { code: "return { p: typeof process, x: console.log.constructor('return typeof process')() };" }, input: {} }, Bc);
  ok(r.status === 200 && JSON.stringify(r.body).includes('"p":"undefined"') && JSON.stringify(r.body).includes('"x":"undefined"'), "code-stap kan niet uit de sandbox (geen process/require)", r.body);
  r = await req("POST", "/api/v1/engine/execute-step", { type: "call", config: { url: "http://169.254.169.254/latest/meta-data/", method: "GET" }, input: {} }, A);
  ok(/niet toegestaan/.test(JSON.stringify(r.body)), "metadata-adres altijd geblokkeerd (ook hoofdorganisatie)", r.body);
  r = await req("POST", "/api/v1/engine/execute-step", { type: "call", config: { url: "http://127.0.0.1:1/x", method: "GET" }, input: {} }, Bc);
  ok(/intern netwerk is afgeschermd/.test(JSON.stringify(r.body)), "klantorganisatie kan intern netwerk niet bereiken", r.body);
  r = await req("POST", "/api/v1/engine/execute-step", { type: "call", config: { url: "http://127.0.0.1:1/x", method: "GET" }, input: {} }, A);
  ok(!/niet toegestaan/.test(JSON.stringify(r.body)), "hoofdorganisatie mag intern netwerk (eigen installatie)", r.body);

  console.log("=== Platformbeheer ===");
  r = await req("GET", "/api/v1/admin/overview", undefined, A);
  ok(r.status === 200 && r.body.orgs.length === 2 && r.body.users.length === 3, "hoofdaccount ziet alle organisaties en accounts", { s: r.status, orgs: r.body.orgs?.map((o: { id: string }) => o.id), users: r.body.users?.map((u: { email: string }) => u.email), e: r.body.error });
  const dirk = r.body.users.find((u: { email: string }) => u.email === "dirk@b.test");
  ok(dirk && dirk.processes === 1 && dirk.lastLoginAt, "processen per gebruiker en laatst ingelogd", dirk);
  r = await req("POST", `/api/v1/admin/users/${dirk.id}/reset`, {}, A);
  ok(r.status === 200, "hoofdaccount stuurt wachtwoordmail");
  r = await req("PUT", "/api/v1/admin/orgs/klant-b", { disabled: true }, A);
  r = await req("POST", "/api/v1/auth/login", { email: "bea@b.test", password: "KlantB12345" });
  ok(r.status === 403, "uitgeschakelde organisatie kan niet inloggen", r);
  r = await req("POST", "/o/klant-b/hooks/dev/OrderSync", {});
  ok(r.status === 404, "webhooks van uitgeschakelde organisatie reageren niet");
  r = await req("PUT", "/api/v1/admin/settings", { signupOpen: false }, A);
  r = await req("POST", "/api/v1/auth/signup", { orgName: "Nog een", name: "Nog Een", email: "n@n.test", password: "Nog12345abc" });
  ok(r.status === 403, "aanmelden dicht");
  r = await req("DELETE", `/api/v1/admin/users/${(await req("GET", "/api/v1/auth/me", undefined, A)).body.user.id}`, undefined, A);
  ok(r.status === 400, "hoofdaccount kan zichzelf niet verwijderen");

  await app.close();
  console.log(failures ? `\n${failures} TEST(S) MISLUKT ✗` : "\nALLE ACCOUNTTESTS GESLAAGD ✓");
  process.exit(failures ? 1 : 0);
}
main().catch((err) => { console.error(err); process.exit(1); });
