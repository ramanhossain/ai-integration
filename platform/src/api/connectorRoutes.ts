import type { FastifyInstance, FastifyRequest } from "fastify";
import { ENVIRONMENTS, isEnv, type EnvName } from "../domain/environments";
import { credentials, CRED_TYPES, usingDefaultKey, type CredType } from "../connectors/credentials";
import { broker } from "../connectors/queue";
import { datatables, type Column } from "../connectors/datatables";
import { LocalFs, openFs, FILES_ROOT } from "../connectors/files";
import { sqlQuery, mcpListTools } from "../connectors/services";
import { STEP_CATALOG, TRIGGER_CATALOG } from "../engine/nodes";
import { triggers } from "../triggers/manager";
import nodemailer from "nodemailer";

// Koppelingen, queues, triggers, bestanden en het webhook-endpoint.

const actor = (req: FastifyRequest) => String(req.headers["x-aip-user"] || "gebruiker").slice(0, 80);
const envParam = { type: "string", enum: [...ENVIRONMENTS] };

export function baseUrl(req: FastifyRequest): string {
  return process.env.AIP_PUBLIC_URL || `${req.protocol}://${req.headers.host}`;
}

export async function registerConnectorRoutes(app: FastifyInstance): Promise<void> {
  // Ruwe bodies voor webhooks (XML/CSV/tekst).
  app.addContentTypeParser(["application/xml", "text/xml", "text/csv", "application/octet-stream"], { parseAs: "string" }, (_req, body, done) => done(null, body));

  // ---------- catalogus ----------
  app.get("/api/v1/step-types", { schema: { tags: ["catalog"] } }, async () => ({ steps: STEP_CATALOG, triggers: TRIGGER_CATALOG }));

  // ---------- koppelingen ----------
  app.get("/api/v1/credential-types", { schema: { tags: ["credentials"] } }, async () =>
    Object.entries(CRED_TYPES).map(([type, t]) => ({ type, label: t.label, fields: t.fields }))
  );
  app.get("/api/v1/credentials", { schema: { tags: ["credentials"] } }, async () => ({ items: credentials.list(), defaultKey: usingDefaultKey() }));
  app.get<{ Params: { name: string } }>("/api/v1/credentials/:name", { schema: { tags: ["credentials"] } }, async (req, reply) => {
    const c = credentials.get(req.params.name);
    return c ?? reply.code(404).send({ error: "Koppeling niet gevonden" });
  });
  app.put<{ Params: { name: string }; Body: { type: CredType; plugin?: string; description?: string; values?: Record<string, Record<string, string>> } }>(
    "/api/v1/credentials/:name",
    {
      schema: {
        tags: ["credentials"],
        body: {
          type: "object",
          required: ["type"],
          properties: {
            type: { type: "string", enum: Object.keys(CRED_TYPES) },
            plugin: { type: "string" },
            description: { type: "string" },
            values: { type: "object", additionalProperties: { type: "object", additionalProperties: { type: "string" } } }
          }
        }
      }
    },
    async (req, reply) => {
      try {
        return credentials.upsert({ name: req.params.name, type: req.body.type, plugin: req.body.plugin, description: req.body.description, values: req.body.values as never }, actor(req));
      } catch (e) {
        return reply.code(400).send({ error: (e as Error).message });
      }
    }
  );
  app.delete<{ Params: { name: string } }>("/api/v1/credentials/:name", { schema: { tags: ["credentials"] } }, async (req, reply) =>
    credentials.remove(req.params.name, actor(req)) ? { deleted: true } : reply.code(404).send({ error: "Koppeling niet gevonden" })
  );
  // Verbinding testen met de waarden van één omgeving.
  app.post<{ Params: { name: string }; Body: { env: EnvName } }>(
    "/api/v1/credentials/:name/test",
    { schema: { tags: ["credentials"], body: { type: "object", required: ["env"], properties: { env: envParam } } } },
    async (req) => {
      const t0 = Date.now();
      try {
        const { type, values } = credentials.resolve(req.params.name, req.body.env);
        let detail: unknown = "waarden aanwezig";
        if (type === "ftp" || type === "ftps" || type === "sftp") {
          const fs = await openFs(req.body.env, req.params.name);
          try { detail = `${(await fs.list("/")).length} items in /`; } finally { await fs.close(); }
        } else if (type === "postgres") {
          detail = (await sqlQuery(req.body.env, req.params.name, "select version() as version", [])).rows[0];
        } else if (type === "smtp") {
          await nodemailer.createTransport({ host: values.host, port: Number(values.port || 587), secure: values.secure === "true", auth: values.user ? { user: values.user, pass: values.password } : undefined }).verify();
          detail = "SMTP-server bereikbaar";
        } else if (type === "mcp") {
          const tools = await mcpListTools(values.url, values.token);
          detail = `${tools.length} tools: ${tools.slice(0, 8).map((t) => t.name).join(", ")}`;
        }
        return { ok: true, ms: Date.now() - t0, detail };
      } catch (e) {
        return { ok: false, ms: Date.now() - t0, error: (e as Error).message };
      }
    }
  );

  // ---------- queues ----------
  app.get<{ Querystring: { env?: string } }>("/api/v1/queues", { schema: { tags: ["queues"] } }, async (req) =>
    broker.list(req.query.env && isEnv(req.query.env) ? req.query.env : undefined)
  );
  app.post<{ Params: { env: EnvName }; Body: { queue: string; description?: string } }>(
    "/api/v1/queues/:env",
    { schema: { tags: ["queues"], params: { type: "object", properties: { env: envParam } }, body: { type: "object", required: ["queue"], properties: { queue: { type: "string" }, description: { type: "string" } } } } },
    async (req, reply) => {
      try { return broker.declare(req.params.env, req.body.queue, req.body.description); }
      catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
    }
  );
  // Verwijdert de queue op alle omgevingen (de queue bestaat overal met dezelfde naam).
  app.delete<{ Params: { env: EnvName; queue: string } }>("/api/v1/queues/:env/:queue", { schema: { tags: ["queues"], summary: "Queue verwijderen op alle omgevingen" } }, async (req) => {
    const purgedPerEnv = broker.deleteQueue(req.params.env, req.params.queue);
    return { deleted: true, envs: Object.keys(purgedPerEnv), purged: Object.values(purgedPerEnv).reduce((a, b) => a + b, 0), purgedPerEnv };
  });
  app.post<{ Params: { env: EnvName; queue: string }; Body: { max?: number } }>("/api/v1/queues/:env/:queue/take", { schema: { tags: ["queues"] } }, async (req) =>
    broker.take(req.params.env, req.params.queue, Number(req.body?.max ?? 1))
  );
  app.post<{ Params: { env: EnvName; queue: string }; Body: { body?: unknown; headers?: Record<string, string> } }>(
    "/api/v1/queues/:env/:queue/messages",
    { schema: { tags: ["queues"], params: { type: "object", properties: { env: envParam, queue: { type: "string" } } } } },
    async (req, reply) => {
      try {
        const m = broker.publish(req.params.env, req.params.queue, req.body?.body ?? req.body ?? {}, req.body?.headers ?? {});
        return { messageId: m.id, queue: m.queue, env: m.env };
      } catch (e) {
        return reply.code(400).send({ error: (e as Error).message });
      }
    }
  );
  app.get<{ Params: { env: EnvName; queue: string } }>("/api/v1/queues/:env/:queue/messages", { schema: { tags: ["queues"] } }, async (req) =>
    broker.peek(req.params.env, req.params.queue)
  );
  app.post<{ Params: { env: EnvName; queue: string } }>("/api/v1/queues/:env/:queue/redrive", { schema: { tags: ["queues"] } }, async (req) => ({
    moved: broker.redrive(req.params.env, req.params.queue)
  }));
  app.post<{ Params: { env: EnvName; queue: string } }>("/api/v1/queues/:env/:queue/purge", { schema: { tags: ["queues"] } }, async (req) => ({
    purged: broker.purge(req.params.env, req.params.queue)
  }));

  // ---------- datatabellen ----------
  const dtErr = (reply: any, e: unknown) => reply.code(/bestaat niet/.test((e as Error).message) ? 404 : 400).send({ error: (e as Error).message });
  const colSchema = { type: "array", items: { type: "object", required: ["name", "type"], properties: { name: { type: "string" }, type: { type: "string", enum: ["string", "number", "boolean", "date", "json"] } } } };
  app.get<{ Params: { env: EnvName } }>("/api/v1/datatables/:env", { schema: { tags: ["datatables"], params: { type: "object", properties: { env: envParam } } } }, async (req) => datatables.list(req.params.env));
  app.post<{ Params: { env: EnvName }; Body: { name: string; description?: string; columns: Column[] } }>(
    "/api/v1/datatables/:env",
    { schema: { tags: ["datatables"], params: { type: "object", properties: { env: envParam } }, body: { type: "object", required: ["name"], properties: { name: { type: "string" }, description: { type: "string" }, columns: colSchema } } } },
    async (req, reply) => { try { return datatables.create(req.params.env, req.body.name, req.body.columns ?? [], req.body.description, actor(req)); } catch (e) { return dtErr(reply, e); } }
  );
  app.get<{ Params: { env: EnvName; name: string } }>("/api/v1/datatables/:env/:name", { schema: { tags: ["datatables"] } }, async (req, reply) => {
    try { return datatables.get(req.params.env, req.params.name); } catch (e) { return dtErr(reply, e); }
  });
  app.put<{ Params: { env: EnvName; name: string }; Body: { columns: Column[] } }>(
    "/api/v1/datatables/:env/:name/columns",
    { schema: { tags: ["datatables"], body: { type: "object", required: ["columns"], properties: { columns: colSchema } } } },
    async (req, reply) => { try { return datatables.setColumns(req.params.env, req.params.name, req.body.columns, actor(req)); } catch (e) { return dtErr(reply, e); } }
  );
  app.delete<{ Params: { env: EnvName; name: string } }>("/api/v1/datatables/:env/:name", { schema: { tags: ["datatables"] } }, async (req, reply) => {
    try { const rows = datatables.drop(req.params.env, req.params.name, actor(req)); return { dropped: true, envs: Object.keys(rows), rows }; } catch (e) { return dtErr(reply, e); }
  });
  app.post<{ Params: { env: EnvName; name: string } }>("/api/v1/datatables/:env/:name/clear", { schema: { tags: ["datatables"] } }, async (req, reply) => {
    try { return { cleared: datatables.clear(req.params.env, req.params.name, actor(req)) }; } catch (e) { return dtErr(reply, e); }
  });
  // Rijen: zoeken met ?q=<kolom>:<waarde>, limit, offset, sort, desc
  app.get<{ Params: { env: EnvName; name: string }; Querystring: { q?: string; limit?: number; offset?: number; sort?: string; desc?: string } }>(
    "/api/v1/datatables/:env/:name/rows",
    { schema: { tags: ["datatables"] } },
    async (req, reply) => {
      try {
        const q = req.query.q;
        const filter = q ? (q.includes(":") ? [{ column: q.split(":")[0], op: "contains" as const, value: q.split(":").slice(1).join(":") }] : undefined) : undefined;
        return datatables.find(req.params.env, req.params.name, filter, { limit: Number(req.query.limit ?? 100), offset: Number(req.query.offset ?? 0), sortBy: req.query.sort, desc: req.query.desc === "true" });
      } catch (e) { return dtErr(reply, e); }
    }
  );
  app.post<{ Params: { env: EnvName; name: string }; Body: Record<string, unknown> | Record<string, unknown>[] }>("/api/v1/datatables/:env/:name/rows", { schema: { tags: ["datatables"] } }, async (req, reply) => {
    try { return datatables.insert(req.params.env, req.params.name, req.body ?? {}); } catch (e) { return dtErr(reply, e); }
  });
  app.post<{ Params: { env: EnvName; name: string }; Body: { conditions?: unknown; limit?: number } }>("/api/v1/datatables/:env/:name/query", { schema: { tags: ["datatables"] } }, async (req, reply) => {
    try { return datatables.find(req.params.env, req.params.name, req.body?.conditions, { limit: req.body?.limit }); } catch (e) { return dtErr(reply, e); }
  });
  app.patch<{ Params: { env: EnvName; name: string; id: string }; Body: Record<string, unknown> }>("/api/v1/datatables/:env/:name/rows/:id", { schema: { tags: ["datatables"] } }, async (req, reply) => {
    try {
      const r = datatables.update(req.params.env, req.params.name, [{ column: "id", op: "eq", value: Number(req.params.id) }], req.body ?? {});
      return r[0] ?? reply.code(404).send({ error: "Rij niet gevonden" });
    } catch (e) { return dtErr(reply, e); }
  });
  app.delete<{ Params: { env: EnvName; name: string; id: string } }>("/api/v1/datatables/:env/:name/rows/:id", { schema: { tags: ["datatables"] } }, async (req, reply) => {
    try { return { deleted: datatables.remove(req.params.env, req.params.name, [{ column: "id", op: "eq", value: Number(req.params.id) }]) }; } catch (e) { return dtErr(reply, e); }
  });

  // ---------- triggers ----------
  app.get("/api/v1/triggers", { schema: { tags: ["triggers"] } }, async (req) => triggers.list(baseUrl(req)));
  app.post<{ Params: { env: EnvName; name: string; action: string } }>(
    "/api/v1/triggers/:env/:name/:action",
    { schema: { tags: ["triggers"], params: { type: "object", properties: { env: envParam, name: { type: "string" }, action: { type: "string", enum: ["pause", "resume"] } } } } },
    async (req) => {
      triggers.setPaused(req.params.env, req.params.name, req.params.action === "pause", actor(req));
      return { ok: true, paused: req.params.action === "pause" };
    }
  );

  // ---------- bestanden (lokale map per omgeving) ----------
  app.get<{ Params: { env: EnvName }; Querystring: { dir?: string } }>(
    "/api/v1/files/:env",
    { schema: { tags: ["files"], params: { type: "object", properties: { env: envParam } } } },
    async (req) => ({ root: `${FILES_ROOT}/${req.params.env}`, dir: req.query.dir || "/", items: await new LocalFs(req.params.env).list(req.query.dir || "/") })
  );
  app.post<{ Params: { env: EnvName }; Body: { path: string; content: string } }>(
    "/api/v1/files/:env",
    { schema: { tags: ["files"], params: { type: "object", properties: { env: envParam } }, body: { type: "object", required: ["path", "content"], properties: { path: { type: "string" }, content: { type: "string" } } } } },
    async (req, reply) => {
      try {
        await new LocalFs(req.params.env).write(req.body.path, req.body.content);
        return { written: req.body.path };
      } catch (e) {
        return reply.code(400).send({ error: (e as Error).message });
      }
    }
  );

  app.get<{ Params: { env: EnvName }; Querystring: { path: string } }>(
    "/api/v1/files/:env/content",
    { schema: { tags: ["files"], params: { type: "object", properties: { env: envParam } }, querystring: { type: "object", required: ["path"], properties: { path: { type: "string" } } } } },
    async (req, reply) => {
      try { return { path: req.query.path, content: await new LocalFs(req.params.env).read(req.query.path) }; }
      catch (e) { return reply.code(404).send({ error: (e as Error).message }); }
    }
  );
  app.delete<{ Params: { env: EnvName }; Querystring: { path: string } }>(
    "/api/v1/files/:env",
    { schema: { tags: ["files"], params: { type: "object", properties: { env: envParam } }, querystring: { type: "object", required: ["path"], properties: { path: { type: "string" } } } } },
    async (req, reply) => {
      try { await new LocalFs(req.params.env).remove(req.query.path); return { deleted: req.query.path }; }
      catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
    }
  );

  // ---------- API-endpoint-trigger: /apis/<omgeving>/<pad> (+ openapi.json per omgeving) ----------
  app.route<{ Params: { env: string; "*": string } }>({
    method: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    url: "/apis/:env/*",
    schema: { hide: true },
    handler: async (req, reply) => {
      if (!isEnv(req.params.env)) return reply.code(404).send({ error: "Onbekende omgeving" });
      if (req.params["*"] === "openapi.json" && req.method === "GET") return triggers.openApi(req.params.env, baseUrl(req));
      try {
        const r = await triggers.handleApi(req.params.env, req.params["*"], { method: req.method, headers: req.headers as Record<string, unknown>, query: req.query as Record<string, unknown>, body: req.body });
        return reply.code(r.status).send(r.body);
      } catch (e) {
        return reply.code(500).send({ error: (e as Error).message });
      }
    }
  });

  // ---------- webhook-trigger: /hooks/<omgeving>/<pad> ----------
  app.route<{ Params: { env: string; "*": string } }>({
    method: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    url: "/hooks/:env/*",
    schema: { hide: true },
    handler: async (req, reply) => {
      if (!isEnv(req.params.env)) return reply.code(404).send({ error: "Onbekende omgeving" });
      try {
        const r = await triggers.handleWebhook(req.params.env, req.params["*"], {
          method: req.method,
          headers: req.headers as Record<string, unknown>,
          query: req.query as Record<string, unknown>,
          body: req.body
        });
        return reply.code(r.status).send(r.body);
      } catch (e) {
        return reply.code(500).send({ error: (e as Error).message });
      }
    }
  });
}
