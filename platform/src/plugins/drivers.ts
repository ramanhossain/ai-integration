import type { OperationDef, PluginDef } from "./types";
import { currentOrg } from "../tenancy/context";
import { assertTargetsAllowed, safeFetch } from "../net/egress";

// Drivers voor diensten die geen REST-API hebben (databases, message brokers, LDAP, IMAP, SSH)
// of een eigen RPC-protocol (Odoo). Een operatie met `driver: "naam:actie"` komt hier uit.
// Elke aanroep opent een eigen verbinding en sluit die weer (eenvoudig en voorspelbaar).
// Drivers worden pas geladen als ze gebruikt worden.

type V = Record<string, string>;
type Params = Record<string, unknown>;
export interface DriverCtx { def: PluginDef; op: OperationDef; params: Params; values: V; credKey: string }
export interface DriverResult { data: unknown; target: string }
type Driver = (action: string, c: DriverCtx) => Promise<DriverResult>;

const CONNECT_MS = Number(process.env.AIP_DRIVER_CONNECT_MS || 8000);
const TIMEOUT_MS = Number(process.env.AIP_PLUGIN_TIMEOUT_MS || 30000);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function load(mod: string): Promise<any> {
  // CommonJS-pakketten: `default` is altijd module.exports (ook bij klasse-instanties zoals rhea)
  try { const m = await import(mod); return m.default ?? m; }
  catch { throw new Error(`Driver '${mod}' is niet geïnstalleerd (npm install ${mod.split("/")[0]})`); }
}
const s = (v: unknown) => (v === undefined || v === null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));
const need = (p: Params, ...keys: string[]) => { for (const k of keys) if (p[k] === undefined || p[k] === "") throw new Error(`'${k}' ontbreekt`); };
const arr = (v: unknown): unknown[] => (v === undefined || v === "" ? [] : Array.isArray(v) ? v : [v]);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const yes = (v: unknown) => v === true || v === "true" || v === "1" || v === "ja";
const ident = (name: string, q: string) => { if (!/^[A-Za-z_][\w$.]*$/.test(name)) throw new Error(`Ongeldige naam '${name}'`); return name.split(".").map((p) => `${q[0]}${p}${q[1]}`).join("."); };
async function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let t: NodeJS.Timeout | undefined;
  try { return await Promise.race([p, new Promise<T>((_, rej) => { t = setTimeout(() => rej(new Error(`${what}: time-out na ${ms} ms`)), ms); })]); }
  finally { if (t) clearTimeout(t); }
}

// ---------------------------------------------------------------- SQL (MySQL, SQL Server, Oracle, Postgres/TimescaleDB)
type Sql = { run(sql: string, params: unknown[]): Promise<{ rows: unknown[]; affected?: number }>; close(): Promise<void>; ph(i: number): string; q: string; target: string; tables: string };
async function sqlConn(kind: string, v: V): Promise<Sql> {
  const host = v.host || "localhost";
  const ssl = yes(v.ssl);
  if (kind === "mysql") {
    const my = await load("mysql2/promise");
    const port = Number(v.port || 3306);
    const c = await my.createConnection({ host, port, user: v.user, password: v.password, database: v.database, connectTimeout: CONNECT_MS, ssl: ssl ? {} : undefined });
    return { run: async (sql, p) => { const [r] = await c.query({ sql, timeout: TIMEOUT_MS }, p); return Array.isArray(r) ? { rows: r } : { rows: [], affected: r.affectedRows }; }, close: () => c.end(), ph: () => "?", q: "``", target: `mysql://${host}:${port}/${v.database || ""}`, tables: "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE() ORDER BY 1" };
  }
  if (kind === "mssql") {
    const ms = await load("mssql");
    const port = Number(v.port || 1433);
    const pool = await new ms.ConnectionPool({ server: host, port, user: v.user, password: v.password, database: v.database, connectionTimeout: CONNECT_MS, requestTimeout: TIMEOUT_MS, options: { encrypt: ssl, trustServerCertificate: yes(v.trustCert) } }).connect();
    return {
      run: async (sql, p) => { const r = pool.request(); p.forEach((x, i) => r.input(`p${i + 1}`, x)); const res = await r.query(sql); return { rows: res.recordset ?? [], affected: res.rowsAffected?.[0] }; },
      close: () => pool.close(), ph: (i) => `@p${i}`, q: "[]", target: `mssql://${host}:${port}/${v.database || ""}`, tables: "SELECT TABLE_SCHEMA + '.' + TABLE_NAME AS name FROM INFORMATION_SCHEMA.TABLES ORDER BY 1"
    };
  }
  if (kind === "oracle") {
    const ora = await load("oracledb");
    const port = Number(v.port || 1521);
    const connectString = v.connectString || `${host}:${port}/${v.database || "XEPDB1"}`;
    const c = await ora.getConnection({ user: v.user, password: v.password, connectString, connectTimeout: Math.ceil(CONNECT_MS / 1000) });
    return {
      run: async (sql, p) => { const r = await c.execute(sql, p, { outFormat: ora.OUT_FORMAT_OBJECT ?? 4002, autoCommit: true }); return { rows: r.rows ?? [], affected: r.rowsAffected }; },
      close: () => c.close(), ph: (i) => `:${i}`, q: '""', target: `oracle://${connectString}`, tables: "SELECT table_name AS name FROM user_tables ORDER BY 1"
    };
  }
  // postgres (TimescaleDB, QuestDB via pg-wire kan ook)
  const pg = await load("pg");
  const port = Number(v.port || 5432);
  const c = new pg.Client({ host, port, user: v.user, password: v.password, database: v.database, ssl: ssl ? { rejectUnauthorized: false } : undefined, connectionTimeoutMillis: CONNECT_MS, statement_timeout: TIMEOUT_MS });
  await c.connect();
  return { run: async (sql, p) => { const r = await c.query(sql, p); return { rows: r.rows ?? [], affected: r.rowCount ?? undefined }; }, close: () => c.end(), ph: (i) => `$${i}`, q: '""', target: `postgres://${host}:${port}/${v.database || ""}`, tables: "SELECT table_schema || '.' || table_name AS name FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema') ORDER BY 1" };
}
const sqlDriver = (kind: string): Driver => async (action, { params: p, values }) => {
  const db = await sqlConn(kind, values);
  try {
    if (action === "query") {
      need(p, "sql");
      const r = await db.run(String(p.sql), arr(p.parameters));
      return { data: r.rows.length || r.affected === undefined ? r.rows : { affectedRows: r.affected }, target: db.target };
    }
    if (action === "insert") {
      need(p, "table", "rows");
      const rows = arr(p.rows).map(obj);
      let n = 0;
      for (const row of rows) {
        const cols = Object.keys(row);
        if (!cols.length) continue;
        const r = await db.run(`INSERT INTO ${ident(String(p.table), db.q)} (${cols.map((c) => ident(c, db.q)).join(", ")}) VALUES (${cols.map((_, i) => db.ph(i + 1)).join(", ")})`, cols.map((c) => row[c]));
        n += r.affected ?? 1;
      }
      return { data: { inserted: n }, target: db.target };
    }
    if (action === "update") {
      need(p, "table", "key", "row");
      const row = obj(p.row);
      const cols = Object.keys(row).filter((c) => c !== p.key);
      if (!cols.length) throw new Error("Geen kolommen om bij te werken");
      if (row[String(p.key)] === undefined) throw new Error(`De rij mist de sleutelkolom '${p.key}'`);
      const r = await db.run(`UPDATE ${ident(String(p.table), db.q)} SET ${cols.map((c, i) => `${ident(c, db.q)} = ${db.ph(i + 1)}`).join(", ")} WHERE ${ident(String(p.key), db.q)} = ${db.ph(cols.length + 1)}`, [...cols.map((c) => row[c]), row[String(p.key)]]);
      return { data: { updated: r.affected ?? 0 }, target: db.target };
    }
    if (action === "tables") { const r = await db.run(db.tables, []); return { data: r.rows, target: db.target }; }
    throw new Error(`Onbekende actie ${action}`);
  } finally { await db.close().catch(() => undefined); }
};

// ---------------------------------------------------------------- MongoDB
const mongo: Driver = async (action, { params: p, values }) => {
  const { MongoClient } = await load("mongodb");
  if (!values.connectionString) throw new Error("Connection string ontbreekt");
  const client = new MongoClient(values.connectionString, { serverSelectionTimeoutMS: CONNECT_MS, connectTimeoutMS: CONNECT_MS });
  const target = values.connectionString.replace(/\/\/[^@/]+@/, "//•••@");
  try {
    await client.connect();
    const db = client.db(values.database || undefined);
    if (action === "collections") return { data: (await db.listCollections().toArray()).map((c: { name: string }) => c.name), target };
    need(p, "collection");
    const col = db.collection(String(p.collection));
    const filter = obj(p.filter);
    switch (action) {
      case "find": return { data: await col.find(filter, { projection: p.projection ? obj(p.projection) : undefined }).sort(p.sort ? obj(p.sort) : undefined).skip(Number(p.skip || 0)).limit(Number(p.limit || 100)).toArray(), target };
      case "findOne": return { data: await col.findOne(filter), target };
      case "insert": { const docs = arr(p.documents).map(obj); const r = await col.insertMany(docs); return { data: { insertedCount: r.insertedCount, insertedIds: Object.values(r.insertedIds).map(String) }, target }; }
      case "update": { const upd = obj(p.update); const r = await col.updateMany(filter, Object.keys(upd).some((k) => k.startsWith("$")) ? upd : { $set: upd }, { upsert: yes(p.upsert) }); return { data: { matched: r.matchedCount, modified: r.modifiedCount, upserted: r.upsertedCount }, target }; }
      case "delete": { if (!Object.keys(filter).length && !yes(p.all)) throw new Error("Leeg filter: zet 'Alles verwijderen' aan om de hele collectie te legen"); const r = await col.deleteMany(filter); return { data: { deleted: r.deletedCount }, target }; }
      case "aggregate": return { data: await col.aggregate(arr(p.pipeline)).toArray(), target };
      case "count": return { data: { count: await col.countDocuments(filter) }, target };
    }
    throw new Error(`Onbekende actie ${action}`);
  } finally { await client.close().catch(() => undefined); }
};

// ---------------------------------------------------------------- Redis
const redis: Driver = async (action, { params: p, values }) => {
  const mod = await load("ioredis");
  const Redis = mod.Redis ?? mod.default ?? mod;
  const url = values.url || "redis://localhost:6379";
  const r = new Redis(url, { password: values.password || undefined, db: values.database ? Number(values.database) : undefined, connectTimeout: CONNECT_MS, lazyConnect: true, maxRetriesPerRequest: 0, retryStrategy: () => null, enableOfflineQueue: false });
  r.on("error", () => undefined);
  const target = url.replace(/\/\/[^@/]*@/, "//•••@");
  const parse = (x: string | null) => { if (x === null) return null; try { return JSON.parse(x); } catch { return x; } };
  try {
    await r.connect();
    const key = String(p.key ?? "");
    switch (action) {
      case "get": need(p, "key"); return { data: { key, value: parse(await r.get(key)) }, target };
      case "set": { need(p, "key", "value"); const val = s(p.value); const ttl = Number(p.ttl || 0); await (ttl > 0 ? r.set(key, val, "EX", ttl) : r.set(key, val)); return { data: { key, ok: true }, target }; }
      case "delete": need(p, "key"); return { data: { deleted: await r.del(...String(p.key).split(",").map((k) => k.trim())) }, target };
      case "incr": need(p, "key"); return { data: { key, value: await r.incrby(key, Number(p.by || 1)) }, target };
      case "keys": { const found: string[] = []; let cursor = "0"; const max = Number(p.limit || 1000); do { const [c, ks] = await r.scan(cursor, "MATCH", String(p.pattern || "*"), "COUNT", 200); cursor = c; found.push(...ks); } while (cursor !== "0" && found.length < max); return { data: found.slice(0, max), target }; }
      case "publish": need(p, "channel", "message"); return { data: { receivers: await r.publish(String(p.channel), s(p.message)) }, target };
      case "push": need(p, "key", "value"); return { data: { length: await (p.side === "links" ? r.lpush(key, s(p.value)) : r.rpush(key, s(p.value))) }, target };
      case "pop": need(p, "key"); return { data: { value: parse(await (p.side === "rechts" ? r.rpop(key) : r.lpop(key))) }, target };
      case "hget": need(p, "key"); return { data: p.field ? { [String(p.field)]: parse(await r.hget(key, String(p.field))) } : await r.hgetall(key), target };
      case "hset": { need(p, "key", "fields"); const f = Object.entries(obj(p.fields)).flatMap(([k, x]) => [k, s(x)]); return { data: { added: await r.hset(key, ...f) }, target }; }
      case "info": return { data: Object.fromEntries(String(await r.info()).split(/\r?\n/).filter((l: string) => l.includes(":")).map((l: string) => l.split(/:(.*)/s).slice(0, 2))), target };
    }
    throw new Error(`Onbekende actie ${action}`);
  } finally { r.disconnect(); }
};

// ---------------------------------------------------------------- Kafka
const kafka: Driver = async (action, { params: p, values }) => {
  const { Kafka, logLevel } = await load("kafkajs");
  // "kafka://host:9092" of "https://host:9092" mag ook: alleen host:poort doorgeven.
  const brokers = String(values.brokers || "").split(",").map((b) => b.trim().replace(/^[a-z+]+:\/\//i, "").replace(/\/.*$/, "")).filter(Boolean);
  if (!brokers.length) throw new Error("Brokers ontbreken");
  const bad = brokers.find((b) => !/^[\w.-]+:\d{1,5}$|^\[[\da-f:]+\]:\d{1,5}$/i.test(b));
  if (bad) throw new Error("Kafka: elke broker moet de vorm host:poort hebben (bv. kafka.example.com:9092)");
  const sasl = values.user ? { mechanism: (values.mechanism || "plain") as string, username: values.user, password: values.password } : undefined;
  const k = new Kafka({ clientId: values.clientId || "aip", brokers, ssl: yes(values.ssl) || undefined, sasl, connectionTimeout: CONNECT_MS, requestTimeout: TIMEOUT_MS, retry: { retries: 0 }, logLevel: logLevel?.NOTHING ?? 0 });
  const target = `kafka://${brokers.join(",")}`;
  if (action === "send") {
    need(p, "topic", "message");
    const producer = k.producer({ allowAutoTopicCreation: yes(p.autoCreate) });
    await producer.connect();
    try {
      const msgs = arr(p.message).map((m) => ({ key: p.key ? s(p.key) : undefined, value: s(m), headers: p.headers ? Object.fromEntries(Object.entries(obj(p.headers)).map(([a, b]) => [a, s(b)])) : undefined }));
      const r = await producer.send({ topic: String(p.topic), messages: msgs, acks: -1 });
      return { data: r, target };
    } finally { await producer.disconnect().catch(() => undefined); }
  }
  if (action === "topics") { const admin = k.admin(); await admin.connect(); try { return { data: await admin.listTopics(), target }; } finally { await admin.disconnect().catch(() => undefined); } }
  throw new Error(`Onbekende actie ${action}`);
};

// ---------------------------------------------------------------- MQTT
const mqtt: Driver = async (action, { params: p, values }) => {
  const m = await load("mqtt");
  need(p, "topic");
  if (!values.url) throw new Error("Broker-URL ontbreekt");
  const client = await withTimeout<{ publishAsync: (t: string, m: string, o: unknown) => Promise<unknown>; endAsync: () => Promise<void>; end: (f: boolean) => void }>(
    m.connectAsync(values.url, { username: values.user || undefined, password: values.password || undefined, clientId: values.clientId || `aip-${Math.random().toString(16).slice(2, 10)}`, connectTimeout: CONNECT_MS, reconnectPeriod: 0 }), CONNECT_MS + 1000, "MQTT");
  try {
    if (action === "publish") {
      need(p, "message");
      await client.publishAsync(String(p.topic), s(p.message), { qos: Number(p.qos || 0), retain: yes(p.retain) });
      return { data: { topic: p.topic, published: true }, target: values.url.replace(/\/\/[^@/]*@/, "//•••@") };
    }
    throw new Error(`Onbekende actie ${action}`);
  } finally { await client.endAsync().catch(() => client.end(true)); }
};

// ---------------------------------------------------------------- RabbitMQ (AMQP 0-9-1)
const rabbitmq: Driver = async (action, { params: p, values }) => {
  const amqp = await load("amqplib");
  if (!values.url) throw new Error("AMQP-URL ontbreekt");
  const conn = await amqp.connect(values.url, { timeout: CONNECT_MS });
  conn.on("error", () => undefined);
  const target = values.url.replace(/\/\/[^@/]*@/, "//•••@");
  try {
    const ch = await conn.createConfirmChannel();
    if (action === "publish") {
      need(p, "message");
      const body = Buffer.from(s(p.message));
      const opts = { persistent: p.persistent === undefined ? true : yes(p.persistent), contentType: typeof p.message === "object" ? "application/json" : "text/plain", headers: p.headers ? obj(p.headers) : undefined };
      if (p.exchange) ch.publish(String(p.exchange), String(p.routingKey || ""), body, opts);
      else { need(p, "queue"); await ch.assertQueue(String(p.queue), { durable: true }); ch.sendToQueue(String(p.queue), body, opts); }
      await ch.waitForConfirms();
      return { data: { published: true, queue: p.queue, exchange: p.exchange }, target };
    }
    if (action === "get") {
      need(p, "queue");
      const out: unknown[] = [];
      for (let i = 0; i < Number(p.max || 1); i++) {
        const msg = await ch.get(String(p.queue), { noAck: false });
        if (!msg) break;
        const text = msg.content.toString();
        let content: unknown = text;
        try { content = JSON.parse(text); } catch { /* tekst */ }
        out.push({ content, routingKey: msg.fields.routingKey, exchange: msg.fields.exchange, headers: msg.properties.headers });
        ch.ack(msg);
      }
      return { data: out, target };
    }
    if (action === "queue") { need(p, "queue"); return { data: await ch.checkQueue(String(p.queue)), target }; }
    throw new Error(`Onbekende actie ${action}`);
  } finally { await conn.close().catch(() => undefined); }
};

// ---------------------------------------------------------------- AMQP 1.0 (ActiveMQ Artemis, Azure Service Bus, Solace, …)
const amqp10: Driver = async (action, { params: p, values }) => {
  const rhea = await load("rhea");
  need(p, "address", "message");
  if (!values.host) throw new Error("Host ontbreekt");
  const container = rhea.create_container ? rhea.create_container() : rhea;
  const port = Number(values.port || (yes(values.ssl) ? 5671 : 5672));
  const target = `amqp${yes(values.ssl) ? "s" : ""}://${values.host}:${port}/${p.address}`;
  if (action !== "send") throw new Error(`Onbekende actie ${action}`);
  const result = await withTimeout(new Promise<unknown>((resolve, reject) => {
    const conn = container.connect({ host: values.host, hostname: values.host, port, transport: yes(values.ssl) ? "tls" : "tcp", username: values.user || undefined, password: values.password || undefined, reconnect: false, idle_time_out: CONNECT_MS });
    conn.on("connection_error", (c: { connection: { error?: Error } }) => reject(new Error(`AMQP: ${c.connection.error?.message ?? "verbinding geweigerd"}`)));
    conn.on("disconnected", (c: { error?: Error }) => reject(new Error(`AMQP: ${c.error?.message ?? "verbinding verbroken"}`)));
    const sender = conn.open_sender(String(p.address));
    sender.on("sendable", () => {
      const d = sender.send({ body: typeof p.message === "object" ? JSON.stringify(p.message) : String(p.message), content_type: typeof p.message === "object" ? "application/json" : "text/plain", subject: p.subject ? String(p.subject) : undefined, application_properties: p.properties ? obj(p.properties) : undefined });
      sender.on("accepted", () => { conn.close(); resolve({ sent: true, deliveryId: d.id }); });
      sender.on("rejected", (c: { delivery: { remote_state?: { error?: { description?: string } } } }) => { conn.close(); reject(new Error(`AMQP: bericht geweigerd: ${c.delivery.remote_state?.error?.description ?? ""}`)); });
    });
  }), CONNECT_MS + TIMEOUT_MS, "AMQP");
  return { data: result, target };
};

// ---------------------------------------------------------------- LDAP
const ldap: Driver = async (action, { params: p, values }) => {
  const { Client, Attribute, Change } = await load("ldapts");
  if (!values.url) throw new Error("LDAP-URL ontbreekt");
  const client = new Client({ url: values.url, timeout: TIMEOUT_MS, connectTimeout: CONNECT_MS, tlsOptions: yes(values.insecure) ? { rejectUnauthorized: false } : undefined });
  const target = values.url;
  try {
    if (values.bindDn) await client.bind(values.bindDn, values.password || "");
    switch (action) {
      case "search": {
        const r = await client.search(String(p.baseDn || values.baseDn || ""), { scope: String(p.scope || "sub"), filter: String(p.filter || "(objectClass=*)"), attributes: p.attributes ? String(p.attributes).split(",").map((a) => a.trim()) : undefined, sizeLimit: Number(p.limit || 100) });
        return { data: r.searchEntries.map((e: Record<string, unknown>) => Object.fromEntries(Object.entries(e).map(([k, x]) => [k, Buffer.isBuffer(x) ? x.toString("base64") : x]))), target };
      }
      case "add": need(p, "dn", "attributes"); await client.add(String(p.dn), obj(p.attributes)); return { data: { added: p.dn }, target };
      case "modify": {
        need(p, "dn", "attributes");
        const op = String(p.operation || "replace");
        await client.modify(String(p.dn), Object.entries(obj(p.attributes)).map(([type, x]) => new Change({ operation: op, modification: new Attribute({ type, values: arr(x).map(String) }) })));
        return { data: { modified: p.dn }, target };
      }
      case "delete": need(p, "dn"); await client.del(String(p.dn)); return { data: { deleted: p.dn }, target };
      case "rename": need(p, "dn", "newDn"); await client.modifyDN(String(p.dn), String(p.newDn)); return { data: { renamed: p.dn, to: p.newDn }, target };
      case "compare": need(p, "dn", "attribute", "value"); return { data: { match: await client.compare(String(p.dn), String(p.attribute), String(p.value)) }, target };
    }
    throw new Error(`Onbekende actie ${action}`);
  } finally { await client.unbind().catch(() => undefined); }
};

// ---------------------------------------------------------------- IMAP
const imap: Driver = async (action, { params: p, values }) => {
  const { ImapFlow } = await load("imapflow");
  if (!values.host) throw new Error("IMAP-host ontbreekt");
  const port = Number(values.port || 993);
  const client = new ImapFlow({ host: values.host, port, secure: values.ssl === undefined || values.ssl === "" ? port === 993 : yes(values.ssl), auth: { user: values.user, pass: values.password }, logger: false, connectionTimeout: CONNECT_MS, greetingTimeout: CONNECT_MS, socketTimeout: TIMEOUT_MS });
  client.on("error", () => undefined);
  const target = `imap://${values.host}:${port}`;
  await client.connect();
  try {
    if (action === "mailboxes") return { data: (await client.list()).map((m: { path: string; specialUse?: string }) => ({ path: m.path, specialUse: m.specialUse })), target };
    const lock = await client.getMailboxLock(String(p.mailbox || "INBOX"));
    try {
      if (action === "list") {
        const query: Record<string, unknown> = {};
        if (yes(p.unseen)) query.seen = false;
        if (p.since) query.since = new Date(String(p.since));
        if (p.from) query.from = String(p.from);
        if (p.subject) query.subject = String(p.subject);
        const uids: number[] = (await client.search(Object.keys(query).length ? query : { all: true }, { uid: true })) || [];
        const pick = uids.slice(-Number(p.limit || 20));
        const out: unknown[] = [];
        if (pick.length) for await (const m of client.fetch(pick, { uid: true, envelope: true, flags: true, bodyStructure: false, source: yes(p.withBody) }, { uid: true })) {
          const e = m.envelope || {};
          out.push({ uid: m.uid, subject: e.subject, from: (e.from || []).map((a: { address?: string; name?: string }) => a.address), to: (e.to || []).map((a: { address?: string }) => a.address), date: e.date, messageId: e.messageId, flags: [...(m.flags || [])], source: m.source ? m.source.toString("utf8").slice(0, 200000) : undefined });
        }
        if (yes(p.markSeen) && pick.length) await client.messageFlagsAdd(pick, ["\\Seen"], { uid: true });
        return { data: out.reverse(), target };
      }
      if (action === "flag") { need(p, "uid"); const uids = String(p.uid).split(",").map((x) => Number(x.trim())); await (p.remove && yes(p.remove) ? client.messageFlagsRemove(uids, [String(p.flag || "\\Seen")], { uid: true }) : client.messageFlagsAdd(uids, [String(p.flag || "\\Seen")], { uid: true })); return { data: { ok: true, uids }, target }; }
      if (action === "move") { need(p, "uid", "to"); const r = await client.messageMove(String(p.uid), String(p.to), { uid: true }); return { data: { moved: true, uidMap: r && r.uidMap ? Object.fromEntries(r.uidMap) : undefined }, target }; }
      if (action === "delete") { need(p, "uid"); await client.messageDelete(String(p.uid), { uid: true }); return { data: { deleted: p.uid }, target }; }
      throw new Error(`Onbekende actie ${action}`);
    } finally { lock.release(); }
  } finally { await client.logout().catch(() => undefined); }
};

// ---------------------------------------------------------------- SSH
const ssh: Driver = async (action, { params: p, values }) => {
  const { Client } = await load("ssh2");
  if (!values.host) throw new Error("Host ontbreekt");
  need(p, "command");
  if (action !== "exec") throw new Error(`Onbekende actie ${action}`);
  const port = Number(values.port || 22);
  const target = `ssh://${values.user || ""}@${values.host}:${port}`;
  const data = await withTimeout(new Promise<unknown>((resolve, reject) => {
    const c = new Client();
    c.on("error", (e: Error) => reject(new Error(`SSH: ${e.message}`)));
    c.on("ready", () => {
      const cmd = p.cwd ? `cd ${JSON.stringify(String(p.cwd))} && ${p.command}` : String(p.command);
      c.exec(cmd, (err: Error | undefined, stream: NodeJS.ReadableStream & { stderr: NodeJS.ReadableStream; on(e: "close", f: (code: number, signal?: string) => void): unknown }) => {
        if (err) { c.end(); return reject(err); }
        let stdout = "", stderr = "";
        stream.on("data", (d: Buffer) => { stdout += d.toString(); });
        stream.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
        stream.on("close", (code: number, signal?: string) => { c.end(); resolve({ code, signal, stdout: stdout.slice(0, 500000), stderr: stderr.slice(0, 100000) }); });
      });
    });
    c.connect({ host: values.host, port, username: values.user, password: values.password || undefined, privateKey: values.privateKey || undefined, passphrase: values.passphrase || undefined, readyTimeout: CONNECT_MS });
  }), CONNECT_MS + TIMEOUT_MS, "SSH");
  const d = data as { code: number; stderr: string };
  if (d.code !== 0 && yes(p.failOnError ?? true)) throw new Error(`SSH: commando eindigde met code ${d.code}: ${d.stderr.slice(0, 300)}`);
  return { data, target };
};

// ---------------------------------------------------------------- Odoo (JSON-RPC op /jsonrpc)
async function odooRpc(url: string, service: string, method: string, args: unknown[]): Promise<unknown> {
  const res = await safeFetch(`${url.replace(/\/$/, "")}/jsonrpc`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", method: "call", params: { service, method, args }, id: Date.now() }), signal: AbortSignal.timeout(TIMEOUT_MS) });
  const d = (await res.json().catch(() => ({}))) as { result?: unknown; error?: { message?: string; data?: { message?: string } } };
  if (!res.ok || d.error) throw new Error(`Odoo: ${d.error?.data?.message || d.error?.message || res.status}`);
  return d.result;
}
const odooUid = new Map<string, number>();
const odoo: Driver = async (action, { params: p, values, credKey }) => {
  if (!values.url || !values.database || !values.user || !values.apiKey) throw new Error("Odoo: URL, database, gebruiker en API-key zijn nodig");
  const uidKey = `${currentOrg()}:${credKey}`;
  let uid = odooUid.get(uidKey);
  if (!uid) {
    uid = Number(await odooRpc(values.url, "common", "authenticate", [values.database, values.user, values.apiKey, {}]));
    if (!uid) throw new Error("Odoo: aanmelden mislukt (gebruiker of API-key onjuist)");
    odooUid.set(uidKey, uid);
  }
  const model = String(p.model || "res.partner");
  const call = (method: string, args: unknown[], kw: Record<string, unknown> = {}) => odooRpc(values.url, "object", "execute_kw", [values.database, uid, values.apiKey, model, method, args, kw]);
  const target = `${values.url.replace(/\/$/, "")}/jsonrpc · ${model}`;
  const fields = p.fields ? String(p.fields).split(",").map((f) => f.trim()).filter(Boolean) : undefined;
  const ids = (x: unknown) => String(x).split(",").map((i) => Number(i.trim())).filter((n) => !Number.isNaN(n));
  switch (action) {
    case "search": return { data: await call("search_read", [arr(p.domain)], { fields, limit: Number(p.limit || 80), offset: Number(p.offset || 0), order: p.order ? String(p.order) : undefined }), target };
    case "read": need(p, "id"); return { data: await call("read", [ids(p.id)], { fields }), target };
    case "create": need(p, "values"); return { data: { id: await call("create", [obj(p.values)]) }, target };
    case "update": need(p, "id", "values"); return { data: { ok: await call("write", [ids(p.id), obj(p.values)]) }, target };
    case "delete": need(p, "id"); return { data: { ok: await call("unlink", [ids(p.id)]) }, target };
    case "count": return { data: { count: await call("search_count", [arr(p.domain)]) }, target };
    case "fields": return { data: await call("fields_get", [], { attributes: ["string", "type", "required", "relation"] }), target };
    case "method": need(p, "method"); return { data: await call(String(p.method), arr(p.args), obj(p.kwargs)), target };
  }
  throw new Error(`Onbekende actie ${action}`);
};

export const DRIVERS: Record<string, Driver> = {
  mysql: sqlDriver("mysql"), mssql: sqlDriver("mssql"), oracle: sqlDriver("oracle"), postgres: sqlDriver("postgres"),
  mongodb: mongo, redis, kafka, mqtt, rabbitmq, amqp10, ldap, imap, ssh, odoo
};

const hostOf = (v: Record<string, string>) => { try { return new URL(v.url || v.host || "").host || "de server"; } catch { return v.host || "de server"; } };

export async function runDriver(spec: string, c: DriverCtx): Promise<DriverResult> {
  const [name, action] = spec.split(":");
  const d = DRIVERS[name];
  if (!d) throw new Error(`Onbekende driver '${name}'`);
  await assertTargetsAllowed(c.values as Record<string, unknown>);
  try { return await d(action, c); }
  catch (e) {
    const err = e as Error & { code?: string; cause?: { code?: string } };
    let msg = err.message || err.code || String(e);
    if (msg === "fetch failed") msg = `${hostOf(c.values)} niet bereikbaar${err.cause?.code ? ` (${err.cause.code})` : ""}`;
    else if (err.name === "TimeoutError") msg = `geen antwoord van ${hostOf(c.values)}`;
    throw new Error(msg.startsWith(`${c.def.name}:`) || msg.startsWith(`${c.def.name.split(" ")[0]}:`) ? msg : `${c.def.name}: ${msg}`);
  }
}
