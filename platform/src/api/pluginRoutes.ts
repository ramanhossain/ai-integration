import type { FastifyInstance, FastifyRequest } from "fastify";
import { randomBytes } from "node:crypto";
import { plugins } from "../plugins/registry";
import { CATALOG } from "../plugins/catalog";
import { executePlugin, exchangeCode, oauthAuthorizeUrl } from "../plugins/runtime";
import { credentials } from "../connectors/credentials";
import { ENVIRONMENTS, isEnv, type EnvName } from "../domain/environments";
import { audit } from "../audit/auditLog";
import { currentOrg, runInOrg } from "../tenancy/context";
import { pluginLogo } from "../plugins/logos";

// Plugins (connectors): catalogus, definities, uitvoeren/testen en OAuth2-verbinden.

const publicBase = (req: FastifyRequest) => (process.env.AIP_PUBLIC_URL || `${req.protocol}://${req.headers.host}`).replace(/\/$/, "");
export const oauthRedirectUri = (req: FastifyRequest) => `${publicBase(req)}/api/v1/oauth/callback`;
const states = new Map<string, { credential: string; env: EnvName; plugin: string; at: number; by: string; org: string }>();
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export async function registerPluginRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { q?: string; category?: string; status?: string } }>("/api/v1/plugins", { schema: { tags: ["plugins"], summary: "Overzicht van alle connectors (beschikbaar en gepland)" } }, async (req) => {
    const q = (req.query.q || "").toLowerCase();
    const items = plugins.catalog().filter((p) =>
      (!q || `${p.name} ${p.description} ${p.category}`.toLowerCase().includes(q)) &&
      (!req.query.category || p.category === req.query.category) &&
      (!req.query.status || p.status === req.query.status));
    return { stats: plugins.stats(), categories: plugins.categories, items };
  });

  // Logo van de organisatie achter de plugin (merkicoon of favicon; 404 = initialen tonen).
  app.get<{ Params: { id: string } }>("/api/v1/plugins/:id/logo", { schema: { tags: ["plugins"], summary: "Logo van de dienst (SVG/PNG/ICO)" } }, async (req, reply) => {
    if (!/^[a-z0-9-]{1,60}$/.test(req.params.id)) return reply.code(404).send({ error: "Onbekend" });
    const logo = await pluginLogo(req.params.id).catch(() => null);
    if (!logo) return reply.code(404).header("cache-control", "public, max-age=86400").send({ error: "Geen logo" });
    return reply.type(logo.type).header("cache-control", "public, max-age=604800").header("content-security-policy", "default-src 'none'; style-src 'unsafe-inline'").send(logo.body);
  });
  app.get<{ Params: { id: string } }>("/api/v1/plugins/:id", { schema: { tags: ["plugins"], summary: "Volledige definitie van een connector (operaties, parameters, authenticatie)" } }, async (req, reply) => {
    const def = plugins.get(req.params.id);
    const cat = CATALOG.find((c) => c.id === req.params.id);
    if (!def && !cat) return reply.code(404).send({ error: "Plugin niet gevonden" });
    const creds = credentials.list().filter((c) => c.type === "plugin" && c.plugin === req.params.id);
    if (!def) return { ...cat, status: "gepland", operations: [], credentials: [] };
    return { ...def, status: "beschikbaar", hasTrigger: cat?.hasTrigger, credentials: creds, oauthRedirectUri: def.auth.type === "oauth2" ? oauthRedirectUri(req) : undefined };
  });

  // Een operatie direct uitvoeren (GUI "Stap uitvoeren", testen, API/MCP).
  app.post<{ Params: { id: string }; Body: { operation: string; credential?: string; params?: Record<string, unknown>; env?: string } }>(
    "/api/v1/plugins/:id/execute",
    { schema: { tags: ["plugins"], body: { type: "object", required: ["operation"], properties: { operation: { type: "string" }, credential: { type: "string" }, params: { type: "object", additionalProperties: true }, env: { type: "string", enum: [...ENVIRONMENTS] } } } } },
    async (req, reply) => {
      const def = plugins.get(req.params.id);
      if (!def) return reply.code(404).send({ error: "Plugin niet (beschikbaar) gevonden" });
      const env = (req.body.env && isEnv(req.body.env) ? req.body.env : "dev") as EnvName;
      if (env === "prod") return reply.code(403).send({ error: "Direct uitvoeren op PROD kan niet; gebruik een gedeployed proces." });
      const t0 = Date.now();
      try {
        const r = await executePlugin({ plugin: def, operation: req.body.operation, credential: req.body.credential, params: req.body.params ?? {}, env });
        return { ok: true, ms: Date.now() - t0, status: r.status, request: r.request, output: r.data };
      } catch (err) { return reply.code(200).send({ ok: false, ms: Date.now() - t0, error: (err as Error).message }); }
    }
  );

  // Koppeling testen met de testoperatie van de plugin.
  app.post<{ Params: { id: string }; Body: { credential?: string; env: string } }>(
    "/api/v1/plugins/:id/test",
    { schema: { tags: ["plugins"], body: { type: "object", required: ["env"], properties: { credential: { type: "string" }, env: { type: "string", enum: [...ENVIRONMENTS] } } } } },
    async (req, reply) => {
      const def = plugins.get(req.params.id);
      if (!def) return reply.code(404).send({ error: "Plugin niet gevonden" });
      if (!def.test) return { ok: false, error: `${def.name} heeft geen testoperatie; probeer een operatie in een proces.` };
      try {
        const r = await executePlugin({ plugin: def, operation: def.test, credential: req.body.credential, params: {}, env: req.body.env as EnvName });
        return { ok: true, operation: def.test, status: r.status, sample: JSON.stringify(r.data).slice(0, 600) };
      } catch (err) { return { ok: false, operation: def.test, error: (err as Error).message }; }
    }
  );

  // ---------------------------------------------------------------- OAuth2
  app.get<{ Querystring: { credential: string; env: string } }>("/api/v1/oauth/start", { schema: { tags: ["plugins"], summary: "OAuth2: naar de inlogpagina van de dienst" } }, async (req, reply) => {
    const { credential, env } = req.query;
    const pluginId = credential ? credentials.pluginOf(credential) : undefined;
    const def = pluginId ? plugins.get(pluginId) : undefined;
    if (!def || !isEnv(env)) return reply.code(400).type("text/html").send("<p>Onbekende koppeling of omgeving.</p>");
    let values: Record<string, string> = {};
    try { values = credentials.resolve(credential, env).values; } catch (err) { return reply.code(400).type("text/html").send(`<p>${esc((err as Error).message)}. Vul eerst Client ID en Client secret in voor ${env.toUpperCase()}.</p>`); }
    const state = randomBytes(18).toString("base64url");
    for (const [k, v] of states) if (Date.now() - v.at > 600000) states.delete(k);
    states.set(state, { credential, env, plugin: def.id, at: Date.now(), by: String(req.headers["x-aip-user"] || "gebruiker"), org: currentOrg() });
    try { return reply.redirect(oauthAuthorizeUrl(def, values, oauthRedirectUri(req), state)); }
    catch (err) { return reply.code(400).type("text/html").send(`<p>${esc((err as Error).message)}</p>`); }
  });

  app.get<{ Querystring: { code?: string; state?: string; error?: string; error_description?: string } }>("/api/v1/oauth/callback", { schema: { tags: ["plugins"], summary: "OAuth2-callback (redirect-URI)" } }, async (req, reply) => {
    const page = (ok: boolean, msg: string) => reply.type("text/html; charset=utf-8").send(`<!doctype html><meta charset="utf-8"><title>AIP · ${ok ? "Verbonden" : "Mislukt"}</title>
      <body style="font-family:system-ui;padding:40px;color:#1b2536"><h2>${ok ? "✓ Verbonden" : "✕ Verbinden mislukt"}</h2><p>${esc(msg)}</p><p style="color:#8b97ab">Je kunt dit venster sluiten.</p>
      <script>try{window.opener&&window.opener.postMessage({type:"aip-oauth",ok:${ok}},"*")}catch(e){};${ok ? "setTimeout(()=>window.close(),1500)" : ""}</script></body>`);
    const st = req.query.state ? states.get(req.query.state) : undefined;
    if (!st) return page(false, "Onbekende of verlopen aanvraag. Start het verbinden opnieuw.");
    states.delete(req.query.state!);
    if (req.query.error) return page(false, `${req.query.error}: ${req.query.error_description || ""}`);
    const def = plugins.get(st.plugin)!;
    // De callback komt van de dienst (zonder sessie): werk in de organisatie van de aanvraag.
    return runInOrg(st.org, async () => {
      try {
        const values = credentials.resolve(st.credential, st.env).values;
        const patch = await exchangeCode(def, values, String(req.query.code || ""), oauthRedirectUri(req));
        credentials.patchValues(st.credential, st.env, patch, st.by);
        audit.append({ actor: st.by, event: "credential.connected", subject: st.credential, data: { plugin: def.id, env: st.env } });
        return page(true, `${def.name} is verbonden met koppeling '${st.credential}' op ${st.env.toUpperCase()}.`);
      } catch (err) { return page(false, (err as Error).message); }
    });
  });
}
