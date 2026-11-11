// Lokale testsystemen voor scripts/scenario-test.ts (niet nodig voor het platform zelf).
// Eenmalig in een aparte map installeren: npm i smtp-server aedes @electric-sql/pglite @electric-sql/pglite-socket mongodb-memory-server
// en dit bestand daar draaien: node test-systems.mjs
import { SMTPServer } from "smtp-server";
import { Aedes } from "aedes";
import net from "node:net";
import http from "node:http";
import { createHmac } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { MongoMemoryServer } from "mongodb-memory-server";

const mails = [];
const mqttMsgs = [];
const feed = [{ guid: "n1", title: "Eerste bericht" }];
const zaken = [];
const zgwAuth = [];
const erp = { orders: [], customers: [{ id: 1, name: "Jansen BV", email: "info@jansen.nl" }, { id: 2, name: "De Vries", email: "dv@example.nl" }] };

new SMTPServer({ authOptional: true, disabledCommands: ["STARTTLS"], onData(stream, session, cb) {
  let raw = ""; stream.on("data", (d) => (raw += d)); stream.on("end", () => { mails.push({ from: session.envelope.mailFrom?.address, to: session.envelope.rcptTo.map((r) => r.address), raw }); cb(); });
} }).listen(2525, "127.0.0.1");

const aedes = await Aedes.createBroker();
aedes.on("publish", (p, client) => { if (client) mqttMsgs.push({ topic: p.topic, payload: p.payload.toString() }); });
net.createServer(aedes.handle).listen(1884, "127.0.0.1");

const db = await PGlite.create();
await db.exec("create table klanten (id serial primary key, naam text, email text, plaats text); insert into klanten (naam,email,plaats) values ('Jansen BV','info@jansen.nl','Utrecht'),('Bakkerij Smit','smit@example.nl','Zwolle');");
await new PGLiteSocketServer({ db, port: 5433, host: "127.0.0.1" }).start();
const db2 = await PGlite.create();
await db2.exec("create table klanten (id serial primary key, naam text, email text, plaats text);");
await new PGLiteSocketServer({ db: db2, port: 5434, host: "127.0.0.1" }).start();

const mongo = await MongoMemoryServer.create({ instance: { port: 27018, ip: "127.0.0.1" } });

// Mock "ERP" + inspectie van de testsystemen
http.createServer((req, res) => {
  let body = ""; req.on("data", (d) => (body += d)); req.on("end", () => {
    const send = (s, d) => { res.writeHead(s, { "content-type": "application/json" }); res.end(JSON.stringify(d)); };
    const u = new URL(req.url, "http://x");
    if (u.pathname === "/_mails") return send(200, mails);
    if (u.pathname === "/_mqtt") return send(200, mqttMsgs);
    if (u.pathname === "/_reset") { mails.length = 0; mqttMsgs.length = 0; erp.orders.length = 0; zaken.length = 0; zgwAuth.length = 0; feed.splice(1); return send(200, { ok: true }); }
    if (u.pathname === "/_feed") { res.writeHead(200, { "content-type": "application/rss+xml" }); return res.end(`<?xml version="1.0"?><rss version="2.0"><channel><title>Test</title>${feed.map((i) => `<item><guid>${i.guid}</guid><title>${i.title}</title><link>http://x/${i.guid}</link></item>`).join("")}</channel></rss>`); }
    if (u.pathname === "/_feed/add") { feed.unshift(JSON.parse(body)); return send(200, { ok: true }); }
    if (u.pathname === "/_zgw") return send(200, { zaken, auth: zgwAuth });
    if (u.pathname === "/soap") {
      const fault = body.includes("<ubiNum>-1</ubiNum>");
      res.writeHead(fault ? 500 : 200, { "content-type": "text/xml" });
      const n = (body.match(/<ubiNum>(-?\d+)<\/ubiNum>/) || [])[1];
      return res.end(fault ? `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><soap:Fault><faultcode>soap:Client</faultcode><faultstring>Negatief getal niet toegestaan</faultstring></soap:Fault></soap:Body></soap:Envelope>`
        : `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><m:DoubleResponse xmlns:m="urn:test"><m:Result>${Number(n) * 2}</m:Result><m:Action>${req.headers.soapaction}</m:Action></m:DoubleResponse></soap:Body></soap:Envelope>`);
    }
    if (u.pathname.startsWith("/zaken/api/v1/")) {
      const m = String(req.headers.authorization || "").match(/^Bearer ([^.]+)\.([^.]+)\.([^.]+)$/);
      const ok = m && createHmac("sha256", "zgw-geheim").update(`${m[1]}.${m[2]}`).digest("base64url") === m[3];
      zgwAuth.push({ ok: Boolean(ok), claims: m ? JSON.parse(Buffer.from(m[2], "base64url").toString()) : null, crs: req.headers["accept-crs"] });
      if (!ok) return send(403, { detail: "Ongeldige JWT" });
      const sub = u.pathname.slice("/zaken/api/v1".length);
      if (sub === "/zaken" && req.method === "POST") { const uuid = "z" + (zaken.length + 1); const z = { url: `http://127.0.0.1:4010/zaken/api/v1/zaken/${uuid}`, uuid, identificatie: `ZAAK-${zaken.length + 1}`, ...JSON.parse(body) }; zaken.push(z); return send(201, z); }
      if (sub === "/zaken" && req.method === "GET") return send(200, { count: zaken.length, results: zaken });
      if (sub === "/statussen" && req.method === "POST") { const st = JSON.parse(body); const z = zaken.find((x) => x.url === st.zaak); if (!z) return send(400, { invalidParams: [{ name: "zaak", reason: "onbekend" }] }); z.status = st.statustype; return send(201, { url: "http://127.0.0.1:4010/zaken/api/v1/statussen/1", ...st }); }
      return send(404, { detail: "niet gevonden" });
    }
    if (req.headers.authorization !== "Bearer erp-token") return send(401, { error: "unauthorized" });
    if (u.pathname === "/customers" && req.method === "GET") return send(200, { items: erp.customers });
    if (u.pathname.startsWith("/customers/") && req.method === "GET") { const c = erp.customers.find((x) => String(x.id) === u.pathname.split("/")[2]); return c ? send(200, c) : send(404, { error: "not found" }); }
    if (u.pathname === "/orders" && req.method === "POST") { const o = { id: erp.orders.length + 1, ...JSON.parse(body || "{}") }; erp.orders.push(o); return send(201, o); }
    if (u.pathname === "/orders" && req.method === "GET") return send(200, { items: erp.orders });
    send(404, { error: "not found" });
  });
}).listen(4010, "127.0.0.1");

console.log("services ready", mongo.getUri());
