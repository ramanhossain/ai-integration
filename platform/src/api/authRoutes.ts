import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { accounts, PASSWORD_MIN, type User, type Role, type EnvAccess } from "../auth/accounts";
import { mailer } from "../auth/mailer";
import { AUTH_ENABLED, setSessionCookie, readCookie, SESSION_COOKIE } from "../auth/guard";
import { runInOrg, DEFAULT_ORG, orgPathPrefix } from "../tenancy/context";
import { bootOrg } from "../tenancy/boot";
import { registry } from "../domain/registry";
import { deployments } from "../domain/deployments";
import { engine } from "../engine/engine";
import { audit } from "../audit/auditLog";
import { ENVIRONMENTS } from "../domain/environments";

// Accounts: aanmelden, inloggen, wachtwoord vergeten, gebruikersbeheer per organisatie,
// API-sleutels en platformbeheer (hoofdaccount).

// Basis-URL voor links in mails. Altijd AIP_PUBLIC_URL als die gezet is; anders alleen de
// Host-header als dat een lokaal adres is (anders kan een aanvaller via een vervalste
// Host-header een resetlink naar zijn eigen domein laten mailen).
const publicUrl = (req: FastifyRequest) => {
  if (process.env.AIP_PUBLIC_URL) return process.env.AIP_PUBLIC_URL.replace(/\/$/, "");
  const host = String(req.headers.host || "");
  const local = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(host);
  return local ? `${req.protocol}://${host}` : `http://localhost:${process.env.PORT || 3001}`;
};
const meta = (req: FastifyRequest) => ({ ip: req.ip, ua: String(req.headers["user-agent"] || "") });
const fail = (reply: FastifyReply, err: unknown, code = 400) => reply.code((err as { status?: number }).status ?? code).send({ error: (err as Error).message });
const accessSchema = { type: "object", additionalProperties: false, properties: Object.fromEntries(ENVIRONMENTS.map((e) => [e, { type: "string", enum: ["none", "view", "edit"] }])) };

// Processen per maker (oudste bewaarde versie) in een organisatie.
function processStats(org: string): { total: number; byUser: Map<string, number>; runs: number; lastRun?: string } {
  return runInOrg(org, () => {
    const byUser = new Map<string, number>();
    const list = registry.listIntegrations();
    for (const i of list) {
      const vs = deployments.listVersions(i.integration);
      const creator = String((vs[vs.length - 1]?.createdBy ?? i.owner ?? "")).toLowerCase();
      if (creator) byUser.set(creator, (byUser.get(creator) || 0) + 1);
    }
    const runs = engine.list({ limit: 1 });
    return { total: list.length, byUser, runs: engine.list({ limit: 100000 }).length, lastRun: runs[0]?.startedAt };
  });
}

function me(u: User) {
  const org = accounts.getOrg(u.orgId);
  return { user: accounts.view(u), org: org ? { id: org.id, name: org.name, pathPrefix: orgPathPrefix(org.id) } : null };
}

async function sendLink(req: FastifyRequest, u: User, kind: "reset" | "invite", by?: string): Promise<{ delivered: boolean; smtp: boolean }> {
  const t = accounts.issueToken(u.id, kind);
  const link = `${publicUrl(req)}/app/#reset/${encodeURIComponent(t)}`;
  const org = accounts.getOrg(u.orgId);
  const subject = kind === "invite" ? `Uitnodiging voor ${org?.name ?? "het integratieplatform"}` : "Wachtwoord opnieuw instellen";
  const text = kind === "invite"
    ? `Hallo ${u.name},\n\n${by ? by + " heeft" : "Je bent"} je uitgenodigd voor ${org?.name ?? "het integratieplatform"} op het AIP-integratieplatform.\n\nKies via deze link een wachtwoord (geldig 72 uur):\n${link}\n\nJe e-mailadres om in te loggen: ${u.email}\n`
    : `Hallo ${u.name},\n\nEr is gevraagd om het wachtwoord van je account (${u.email}) opnieuw in te stellen.\n\nKies via deze link een nieuw wachtwoord (geldig 1 uur):\n${link}\n\nHeb je dit niet zelf aangevraagd? Dan kun je deze mail negeren; je wachtwoord blijft ongewijzigd.\n`;
  const m = await mailer.send(u.email, subject, text, kind);
  return { delivered: m.delivered, smtp: mailer.smtp };
}

function userRow(u: User, counts: Map<string, number>) {
  const org = accounts.getOrg(u.orgId);
  return { ...accounts.view(u), orgName: org?.name, processes: counts.get(u.email) || 0 };
}

// Eenvoudige limiet per sleutel (IP of e-mail) binnen een tijdvenster.
const hits = new Map<string, number[]>();
function tooMany(key: string, max: number, windowMs: number): boolean {
  const t = Date.now();
  const list = (hits.get(key) || []).filter((x) => t - x < windowMs);
  list.push(t);
  hits.set(key, list);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((x) => t - x < windowMs)) hits.delete(k);
  return list.length > max;
}

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  // ---------------------------------------------------------------- publiek
  app.get("/api/v1/auth/status", { schema: { tags: ["auth"], summary: "Is inloggen nodig, is er al een hoofdaccount, mag iedereen zich aanmelden?" } }, async () => ({
    authEnabled: AUTH_ENABLED, setupRequired: AUTH_ENABLED && accounts.count() === 0, signupOpen: accounts.getPlatform().signupOpen, smtp: mailer.smtp, passwordMin: PASSWORD_MIN
  }));

  // Eerste start: hoofdaccount aanmaken. Bestaande gegevens horen bij de hoofdorganisatie.
  app.post<{ Body: { name: string; email: string; password: string; orgName?: string } }>(
    "/api/v1/auth/setup",
    { schema: { tags: ["auth"], summary: "Eerste start: hoofdaccount aanmaken", body: { type: "object", required: ["name", "email", "password"], properties: { name: { type: "string" }, email: { type: "string" }, password: { type: "string" }, orgName: { type: "string" } } } } },
    async (req, reply) => {
      if (!AUTH_ENABLED) return reply.code(400).send({ error: "Accounts staan uit (AIP_AUTH=off)" });
      if (accounts.count() > 0) return reply.code(409).send({ error: "Er is al een hoofdaccount" });
      try {
        accounts.ensureDefaultOrg(req.body.orgName || "Hoofdorganisatie", req.body.email);
        const u = await accounts.createUser({ ...req.body, orgId: DEFAULT_ORG, role: "beheerder", superAdmin: true }, "setup");
        setSessionCookie(req, reply, accounts.startSession(u, meta(req)));
        runInOrg(DEFAULT_ORG, () => audit.append({ actor: u.email, event: "account.setup", subject: u.email }));
        return me(u);
      } catch (err) { return fail(reply, err); }
    }
  );

  // Aanmelden: nieuwe organisatie met de aanmelder als beheerder.
  app.post<{ Body: { orgName: string; name: string; email: string; password: string } }>(
    "/api/v1/auth/signup",
    { schema: { tags: ["auth"], summary: "Aanmelden: nieuwe organisatie + beheerdersaccount", body: { type: "object", required: ["orgName", "name", "email", "password"], properties: { orgName: { type: "string" }, name: { type: "string" }, email: { type: "string" }, password: { type: "string" } } } } },
    async (req, reply) => {
      if (!AUTH_ENABLED) return reply.code(400).send({ error: "Accounts staan uit (AIP_AUTH=off)" });
      if (accounts.count() === 0) return reply.code(409).send({ error: "Maak eerst het hoofdaccount aan" });
      if (tooMany(`signup:${req.ip}`, 5, 60 * 60_000)) return reply.code(429).send({ error: "Te veel aanmeldingen vanaf dit adres. Probeer het later opnieuw." });
      if (!accounts.getPlatform().signupOpen) return reply.code(403).send({ error: "Aanmelden is gesloten. Vraag de beheerder van het platform om een account." });
      if (accounts.byEmail(req.body.email)) return reply.code(409).send({ error: "Er bestaat al een account met dit e-mailadres" });
      let org;
      try {
        accounts.validateNewUser(req.body);
        org = accounts.createOrg(req.body.orgName, req.body.email);
        const u = await accounts.createUser({ ...req.body, orgId: org.id, role: "beheerder" }, "aanmelding").catch((e) => { accounts.discardOrg(org!.id); throw e; });
        await bootOrg(org.id);
        runInOrg(org.id, () => audit.append({ actor: u.email, event: "org.created", subject: org!.id, data: { name: org!.name } }));
        setSessionCookie(req, reply, accounts.startSession(u, meta(req)));
        return me(u);
      } catch (err) { return fail(reply, err); }
    }
  );

  app.post<{ Body: { email: string; password: string } }>(
    "/api/v1/auth/login",
    { schema: { tags: ["auth"], body: { type: "object", required: ["email", "password"], properties: { email: { type: "string" }, password: { type: "string" } } } } },
    async (req, reply) => {
      try {
        const { user, token } = await accounts.login(req.body.email, req.body.password, meta(req));
        setSessionCookie(req, reply, token);
        runInOrg(user.orgId, () => audit.append({ actor: user.email, event: "account.login", subject: user.email, data: { ip: req.ip } }));
        return me(user);
      } catch (err) { return fail(reply, err, 401); }
    }
  );
  app.post("/api/v1/auth/logout", { schema: { tags: ["auth"] } }, async (req, reply) => {
    accounts.endSession(readCookie(req, SESSION_COOKIE));
    setSessionCookie(req, reply, null);
    return { ok: true };
  });

  // Wachtwoord vergeten: altijd hetzelfde antwoord (verraadt niet of een account bestaat).
  app.post<{ Body: { email: string } }>(
    "/api/v1/auth/forgot",
    { schema: { tags: ["auth"], body: { type: "object", required: ["email"], properties: { email: { type: "string" } } } } },
    async (req, reply) => {
      if (tooMany(`forgot-ip:${req.ip}`, 10, 15 * 60_000)) return reply.code(429).send({ error: "Te veel aanvragen. Probeer het later opnieuw." });
      const u = accounts.byEmail(req.body.email);
      // Max. 3 mails per account per uur (geen mailbom); het antwoord blijft hetzelfde.
      if (u && !u.disabled && !tooMany(`forgot-mail:${u.id}`, 3, 60 * 60_000)) await sendLink(req, u, "reset");
      return { ok: true, message: "Als dit e-mailadres bij ons bekend is, is er een mail met een link verstuurd." };
    }
  );
  app.get<{ Params: { token: string } }>("/api/v1/auth/reset/:token", { schema: { tags: ["auth"] } }, async (req, reply) => {
    const hit = accounts.peekToken(req.params.token);
    if (!hit) return reply.code(404).send({ error: "Deze link is ongeldig of verlopen" });
    return { email: hit.user.email, name: hit.user.name, kind: hit.kind, org: accounts.getOrg(hit.user.orgId)?.name };
  });
  app.post<{ Body: { token: string; password: string } }>(
    "/api/v1/auth/reset",
    { schema: { tags: ["auth"], body: { type: "object", required: ["token", "password"], properties: { token: { type: "string" }, password: { type: "string" } } } } },
    async (req, reply) => {
      try {
        const u = await accounts.useToken(req.body.token, req.body.password);
        setSessionCookie(req, reply, accounts.startSession(u, meta(req)));
        runInOrg(u.orgId, () => audit.append({ actor: u.email, event: "account.password_set", subject: u.email }));
        return me(u);
      } catch (err) { return fail(reply, err); }
    }
  );

  // ---------------------------------------------------------------- ingelogd
  app.get("/api/v1/auth/me", { schema: { tags: ["auth"] } }, async (req, reply) => {
    if (!AUTH_ENABLED) return { authEnabled: false, user: { name: "Ontwikkelaar", email: "", role: "beheerder", superAdmin: true, envAccess: { dev: "edit", test: "edit", acc: "edit", prod: "edit" } }, org: { id: DEFAULT_ORG, name: "Ontwikkeling", pathPrefix: "" } };
    const a = req.auth;
    if (!a) return reply.code(401).send({ error: "Niet ingelogd" });
    if (a.apiKey) return { apiKey: a.apiKey, org: { id: a.org, name: accounts.getOrg(a.org)?.name, pathPrefix: orgPathPrefix(a.org) } };
    return { authEnabled: true, ...me(a.user!) };
  });
  app.put<{ Body: { name?: string } }>("/api/v1/auth/me", { schema: { tags: ["auth"], body: { type: "object", additionalProperties: false, properties: { name: { type: "string" } } } } }, async (req, reply) => {
    if (!req.auth?.user) return reply.code(401).send({ error: "Niet ingelogd" });
    try { return me(accounts.updateUser(req.auth.user.id, { name: req.body.name })); } catch (err) { return fail(reply, err); }
  });
  app.post<{ Body: { current: string; password: string } }>(
    "/api/v1/auth/password",
    { schema: { tags: ["auth"], body: { type: "object", required: ["current", "password"], properties: { current: { type: "string" }, password: { type: "string" } } } } },
    async (req, reply) => {
      if (!req.auth?.user) return reply.code(401).send({ error: "Niet ingelogd" });
      try {
        await accounts.changePassword(req.auth.user.id, req.body.current, req.body.password);
        setSessionCookie(req, reply, accounts.startSession(req.auth.user, meta(req)));
        audit.append({ actor: req.auth.identity, event: "account.password_changed", subject: req.auth.identity });
        return { ok: true };
      } catch (err) { return fail(reply, err); }
    }
  );

  // ---------------------------------------------------------------- organisatie (beheerder)
  app.get("/api/v1/org", { schema: { tags: ["org"], summary: "Organisatie met accounts, rechten per omgeving en API-sleutels" } }, async (req) => {
    const org = req.auth!.org;
    const st = processStats(org);
    return { org: accounts.getOrg(org), processes: st.total, users: accounts.listUsers(org).map((u) => userRow(u, st.byUser)), apiKeys: accounts.listKeys(org), smtp: mailer.smtp };
  });
  app.put<{ Body: { name: string } }>("/api/v1/org", { schema: { tags: ["org"], body: { type: "object", required: ["name"], properties: { name: { type: "string" } } } } }, async (req, reply) => {
    try { const o = accounts.updateOrg(req.auth!.org, { name: req.body.name }); audit.append({ actor: req.auth!.identity, event: "org.renamed", subject: o.id, data: { name: o.name } }); return o; } catch (err) { return fail(reply, err); }
  });
  app.post<{ Body: { name: string; email: string; role?: Role; envAccess?: Partial<EnvAccess> } }>(
    "/api/v1/org/users",
    { schema: { tags: ["org"], summary: "Account toevoegen; krijgt een uitnodiging om een wachtwoord te kiezen", body: { type: "object", required: ["name", "email"], additionalProperties: false, properties: { name: { type: "string" }, email: { type: "string" }, role: { type: "string", enum: ["beheerder", "gebruiker"] }, envAccess: accessSchema } } } },
    async (req, reply) => {
      try {
        const u = await accounts.createUser({ ...req.body, orgId: req.auth!.org }, req.auth!.identity);
        const sent = await sendLink(req, u, "invite", req.auth!.user?.name);
        audit.append({ actor: req.auth!.identity, event: "account.invited", subject: u.email, data: { role: u.role, envAccess: u.envAccess } });
        return { user: accounts.view(u), mail: sent };
      } catch (err) { return fail(reply, err); }
    }
  );
  const ownUser = (req: FastifyRequest<{ Params: { id: string } }>) => { const u = accounts.getUser(req.params.id); return u && u.orgId === req.auth!.org ? u : undefined; };
  app.put<{ Params: { id: string }; Body: { name?: string; role?: Role; envAccess?: Partial<EnvAccess>; disabled?: boolean } }>(
    "/api/v1/org/users/:id",
    { schema: { tags: ["org"], body: { type: "object", additionalProperties: false, properties: { name: { type: "string" }, role: { type: "string", enum: ["beheerder", "gebruiker"] }, envAccess: accessSchema, disabled: { type: "boolean" } } } } },
    async (req, reply) => {
      if (!ownUser(req)) return reply.code(404).send({ error: "Account niet gevonden" });
      try { const u = accounts.updateUser(req.params.id, req.body, req.auth!.user?.id); audit.append({ actor: req.auth!.identity, event: "account.updated", subject: u.email, data: req.body as Record<string, unknown> }); return accounts.view(u); } catch (err) { return fail(reply, err); }
    }
  );
  app.delete<{ Params: { id: string } }>("/api/v1/org/users/:id", { schema: { tags: ["org"] } }, async (req, reply) => {
    const u = ownUser(req);
    if (!u) return reply.code(404).send({ error: "Account niet gevonden" });
    try { accounts.deleteUser(u.id, req.auth!.user?.id); audit.append({ actor: req.auth!.identity, event: "account.deleted", subject: u.email }); return { deleted: true }; } catch (err) { return fail(reply, err); }
  });
  app.post<{ Params: { id: string } }>("/api/v1/org/users/:id/reset", { schema: { tags: ["org"], summary: "Mail met link om het wachtwoord (opnieuw) in te stellen" } }, async (req, reply) => {
    const u = ownUser(req);
    if (!u) return reply.code(404).send({ error: "Account niet gevonden" });
    const sent = await sendLink(req, u, u.passwordHash ? "reset" : "invite", req.auth!.user?.name);
    audit.append({ actor: req.auth!.identity, event: "account.reset_sent", subject: u.email });
    return { mail: sent };
  });
  app.post<{ Body: { name: string } }>("/api/v1/org/api-keys", { schema: { tags: ["org"], summary: "API-sleutel maken (eenmalig getoond); voor MCP, scripts en CI", body: { type: "object", required: ["name"], properties: { name: { type: "string" } } } } }, async (req, reply) => {
    try { const r = accounts.createKey(req.auth!.org, req.body.name, req.auth!.identity); audit.append({ actor: req.auth!.identity, event: "apikey.created", subject: r.info.name }); return r; } catch (err) { return fail(reply, err); }
  });
  app.delete<{ Params: { id: string } }>("/api/v1/org/api-keys/:id", { schema: { tags: ["org"] } }, async (req, reply) => {
    if (!accounts.deleteKey(req.auth!.org, req.params.id)) return reply.code(404).send({ error: "Sleutel niet gevonden" });
    audit.append({ actor: req.auth!.identity, event: "apikey.deleted", subject: req.params.id });
    return { deleted: true };
  });

  // ---------------------------------------------------------------- platformbeheer (hoofdaccount)
  app.get("/api/v1/admin/overview", { schema: { tags: ["admin"], summary: "Alle organisaties en accounts met statistieken" } }, async () => {
    const orgs = accounts.orgIds().map((id) => ({ id, org: accounts.getOrg(id), st: processStats(id) })).filter((x) => x.org);
    const counts = new Map<string, number>();
    for (const o of orgs) for (const [k, v] of o.st.byUser) counts.set(k, (counts.get(k) || 0) + v);
    const users = accounts.listUsers();
    return {
      settings: accounts.getPlatform(), smtp: mailer.smtp,
      orgs: orgs.map(({ org, st }) => {
        const us = users.filter((u) => u.orgId === org!.id);
        const last = us.map((u) => u.lastSeenAt || u.lastLoginAt || "").sort().pop() || undefined;
        return { ...org!, users: us.length, processes: st.total, runs: st.runs, lastRun: st.lastRun, lastActive: last };
      }),
      users: users.map((u) => userRow(u, counts))
    };
  });
  app.post<{ Body: { name: string; ownerName: string; ownerEmail: string } }>(
    "/api/v1/admin/orgs",
    { schema: { tags: ["admin"], summary: "Organisatie aanmaken met een beheerder (krijgt uitnodiging)", body: { type: "object", required: ["name", "ownerName", "ownerEmail"], properties: { name: { type: "string" }, ownerName: { type: "string" }, ownerEmail: { type: "string" } } } } },
    async (req, reply) => {
      if (accounts.byEmail(req.body.ownerEmail)) return reply.code(409).send({ error: "Er bestaat al een account met dit e-mailadres" });
      try {
        accounts.validateNewUser({ name: req.body.ownerName, email: req.body.ownerEmail });
        const org = accounts.createOrg(req.body.name, req.auth!.identity);
        const u = await accounts.createUser({ name: req.body.ownerName, email: req.body.ownerEmail, orgId: org.id, role: "beheerder" }, req.auth!.identity).catch((e) => { accounts.discardOrg(org.id); throw e; });
        await bootOrg(org.id);
        const sent = await sendLink(req, u, "invite", req.auth!.user?.name);
        return { org, user: accounts.view(u), mail: sent };
      } catch (err) { return fail(reply, err); }
    }
  );
  app.put<{ Params: { id: string }; Body: { name?: string; disabled?: boolean } }>(
    "/api/v1/admin/orgs/:id",
    { schema: { tags: ["admin"], body: { type: "object", additionalProperties: false, properties: { name: { type: "string" }, disabled: { type: "boolean" } } } } },
    async (req, reply) => { try { return accounts.updateOrg(req.params.id, req.body); } catch (err) { return fail(reply, err); } }
  );
  app.put<{ Params: { id: string }; Body: { disabled?: boolean; superAdmin?: boolean; role?: Role } }>(
    "/api/v1/admin/users/:id",
    { schema: { tags: ["admin"], body: { type: "object", additionalProperties: false, properties: { disabled: { type: "boolean" }, superAdmin: { type: "boolean" }, role: { type: "string", enum: ["beheerder", "gebruiker"] } } } } },
    async (req, reply) => { try { return accounts.view(accounts.updateUser(req.params.id, req.body, req.auth!.user?.id)); } catch (err) { return fail(reply, err); } }
  );
  app.delete<{ Params: { id: string } }>("/api/v1/admin/users/:id", { schema: { tags: ["admin"] } }, async (req, reply) => {
    try { accounts.deleteUser(req.params.id, req.auth!.user?.id); return { deleted: true }; } catch (err) { return fail(reply, err); }
  });
  app.post<{ Params: { id: string } }>("/api/v1/admin/users/:id/reset", { schema: { tags: ["admin"], summary: "Wachtwoord-vergeten-mail sturen" } }, async (req, reply) => {
    const u = accounts.getUser(req.params.id);
    if (!u) return reply.code(404).send({ error: "Account niet gevonden" });
    return { mail: await sendLink(req, u, u.passwordHash ? "reset" : "invite", req.auth!.user?.name) };
  });
  app.put<{ Body: { signupOpen?: boolean } }>("/api/v1/admin/settings", { schema: { tags: ["admin"], body: { type: "object", additionalProperties: false, properties: { signupOpen: { type: "boolean" } } } } }, async (req) => accounts.setPlatform(req.body));
  // Outbox: zonder SMTP (ontwikkeling) inclusief de tekst, zodat links bruikbaar zijn.
  app.get("/api/v1/admin/mail", { schema: { tags: ["admin"], summary: "Laatst verstuurde systeemmails" } }, async () => ({
    smtp: mailer.smtp,
    items: mailer.list().map((m) => (mailer.smtp ? { ...m, text: undefined } : m))
  }));
}
