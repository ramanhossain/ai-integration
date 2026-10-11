import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { persistence } from "../src/store";
import { credentials } from "../src/connectors/credentials";
import { runInOrg } from "../src/tenancy/context";
import { As4Manager } from "../src/plugins/as4/manager";
import { directories, readSafe, safeDirectory } from "../src/plugins/as4/spool";
import { EB3, MMD, normalize, buildMmd, inspectDelivery, inspectPmode } from "../src/plugins/as4/formats";
import { plugins } from "../src/plugins/registry";
import { executePlugin } from "../src/plugins/runtime";
import { deployments } from "../src/domain/deployments";
import { engine } from "../src/engine/engine";
import { agentGroups } from "../src/runtime/agentGroups";
import { buildServer } from "../src/index";

const v = { pmodeId: "test-pmode", fromPartyId: "B", toPartyId: "A", fromRole: "Receiver", toRole: "Sender", service: "urn:service", action: "Deliver", enabled: "true" };
const binary = Buffer.from([0, 255, 128, 13, 10, 42]);
const payload = "<bericht>AS4 &amp; AS4 Gateway</bericht>";
function connection() { credentials.upsert({ name: "gateway", type: "plugin", plugin: "as4", values: { dev: v, test: v } }, "test"); }
async function suite(name: string, fn: () => Promise<void>) { await runInOrg(`as4-${name}`, fn); console.log(`  ok ${name}`); }
function user(id: string, location = "payload.xml") {
  return `<eb:Messaging xmlns:eb="${EB3}"><eb:UserMessage><eb:MessageInfo><eb:Timestamp>2026-10-08T00:00:00Z</eb:Timestamp><eb:MessageId>${id}</eb:MessageId></eb:MessageInfo><eb:PartyInfo><eb:From><eb:PartyId>A</eb:PartyId><eb:Role>Sender</eb:Role></eb:From><eb:To><eb:PartyId>B</eb:PartyId><eb:Role>Receiver</eb:Role></eb:To></eb:PartyInfo><eb:CollaborationInfo><eb:AgreementRef pmode="test-pmode"/><eb:Service>urn:service</eb:Service><eb:Action>Deliver</eb:Action><eb:ConversationId>conversation</eb:ConversationId></eb:CollaborationInfo><eb:PayloadInfo><eb:PartInfo href="cid:payload@aip"><eb:PartProperties><eb:Property name="MimeType">application/xml</eb:Property><eb:Property name="org:holodeckb2b:location">${location}</eb:Property></eb:PartProperties></eb:PartInfo></eb:PayloadInfo></eb:UserMessage></eb:Messaging>`;
}
function receipt(id: string, ref: string, error = false) {
  return `<eb:Messaging xmlns:eb="${EB3}"><eb:SignalMessage><eb:MessageInfo><eb:MessageId>${id}</eb:MessageId><eb:RefToMessageId>${ref}</eb:RefToMessageId></eb:MessageInfo>${error ? '<eb:Error errorCode="EBMS:0301" severity="failure"><eb:Description xml:lang="en">Transport failure</eb:Description></eb:Error>' : '<eb:Receipt><ReceiptChild xmlns="http://holodeck-b2b.org/schemas/2015/08/delivery/ebms/receiptchild">{http://docs.oasis-open.org/ebxml-bp/ebbp-signals-2.0}NonRepudiationInformation</ReceiptChild></eb:Receipt>'}</eb:SignalMessage></eb:Messaging>`;
}
async function delivery(id: string, file = "mi-user.xml") { const d = directories("gateway", "dev"); await safeDirectory(d.root, d.incoming); await fs.writeFile(join(d.incoming, "payload.xml"), payload); await fs.writeFile(join(d.incoming, file), user(id)); return d; }
async function main() {
  process.env.AIP_AS4_ROOT = await fs.mkdtemp(join(tmpdir(), "aip-as4-"));
  await persistence.init();
  const def = plugins.get("as4")!; assert.ok(def);
  await suite("MMD namespaces, IDs, XML-escaping en binaire bijlagen", async () => {
    connection(); const s = normalize(v, { payload, messageId: "out@aip", conversationId: "a & b", attachments: [{ contentId: "bin@aip", contentType: "application/octet-stream", dataBase64: binary.toString("base64") }], properties: { onderwerp: "<test>" } });
    const xml = buildMmd(s, ["a.bin", "b.bin"]);
    assert.ok(xml.includes(`xmlns="${MMD}"`)); assert.ok(xml.includes("a &amp; b")); assert.ok(xml.includes("&lt;test&gt;"));
    assert.ok(Buffer.from(s.parts[1].dataBase64, "base64").equals(binary));
    if (process.env.AIP_AS4_TEST_MMD) await fs.writeFile(process.env.AIP_AS4_TEST_MMD, xml);
    assert.throws(() => normalize(v, { payload, messageId: "invalid" }), /Bericht-ID/i);
    assert.throws(() => normalize(v, { payload, dataBase64: "AA==" }), /payload of/);
    assert.throws(() => normalize(v, { payload, attachments: [{ contentId: "payload@aip", dataBase64: "AA==" }] }), /unieke/);
    assert.throws(() => normalize(v, { payload, action: "Unexpected" }), /niet toegestaan/);
    assert.equal(inspectDelivery(user("body@aip").replace(' href="cid:payload@aip"', "")).payloads[0].contentId, "#body");
    assert.throws(() => inspectDelivery(user("external@aip").replace('href="cid:payload@aip"', 'href="https://external/payload"')), /Externe/);
    assert.throws(() => inspectDelivery(user("in@aip").replaceAll(EB3, "urn:wrong")), /ebMS3/);
    assert.throws(() => inspectDelivery('<!DOCTYPE x [<!ENTITY x SYSTEM "file:///etc/passwd">]>' + user("in@aip")), /DTD|DOCTYPE/i);
  });
  await suite("duurzaam vóór publicatie, concurrentie en idempotente MessageId", async () => {
    connection(); const a = new As4Manager(), b = new As4Manager();
    const input = { payload, messageId: "out@aip", attachments: [{ contentId: "bin@aip", dataBase64: binary.toString("base64") }] };
    await Promise.all([a.enqueue("gateway", "dev", input), b.enqueue("gateway", "dev", input)]);
    const r = (await a.get("outbox", "dev", "gateway", "out@aip"))!;
    assert.equal(r.state, "submitted"); assert.equal((await a.all()).length, 1);
    const d = directories("gateway", "dev"), names = await fs.readdir(d.out);
    assert.equal(names.filter(n => n.endsWith(".mmd")).length, 1);
    assert.ok((await readSafe(d.out, `aip-${r.id}-payload-1.bin`)).equals(binary));
    assert.ok(!JSON.stringify(r).includes("AS4 &amp;"));
    const before = await fs.readFile(join(d.out, `aip-${r.id}.mmd`), "utf8");
    await a.enqueue("gateway", "dev", input); assert.equal(await fs.readFile(join(d.out, `aip-${r.id}.mmd`), "utf8"), before);
    await assert.rejects(() => a.enqueue("gateway", "dev", { ...input, payload: "different" }), /andere inhoud/);
    const original = persistence.create; persistence.create = async () => { throw new Error("disk full"); };
    try { await assert.rejects(() => a.enqueue("gateway", "dev", { payload, messageId: "fault@aip" }), /disk full/); } finally { persistence.create = original; }
    assert.equal((await fs.readdir(d.out)).filter(n => n.endsWith(".mmd")).length, 1);
  });
  await suite("gatewayacceptatie is geen aflevering; gecorreleerde receipts en fouten", async () => {
    connection(); const manager = new As4Manager(); const r = await manager.enqueue("gateway", "dev", { payload, messageId: "confirm@aip" });
    const d = directories("gateway", "dev");
    await fs.rename(join(d.out, `aip-${r.id}.mmd`), join(d.out, `aip-${r.id}.accepted`));
    await manager.tick(); const accepted = await manager.status("gateway", "dev", "confirm@aip"); assert.equal(accepted.state, "accepted"); assert.equal(accepted.deliveryConfirmed, false);
    await fs.writeFile(join(d.incoming, "mi-receipt.xml"), receipt("receipt@aip", "confirm@aip"));
    await manager.scan("gateway", "dev"); assert.equal((await manager.status("gateway", "dev", "confirm@aip")).deliveryConfirmed, true);
    await fs.writeFile(join(d.incoming, "mi-unknown.xml"), receipt("unknown@aip", "missing@aip"));
    assert.equal((await manager.scan("gateway", "dev")).errors.length, 1);
    const failed = await manager.enqueue("gateway", "dev", { payload, messageId: "fail@aip" });
    await fs.writeFile(join(d.incoming, "mi-error.xml"), receipt("error@aip", failed.messageId, true));
    await manager.scan("gateway", "dev"); assert.equal((await manager.status("gateway", "dev", "fail@aip")).state, "failed");
    await assert.rejects(() => manager.redrive("gateway", "dev", "fail@aip", "outbox"), /AS4 Gateway/);
  });
  await suite("ontvangst, duplicaten, claims, padbeveiliging en omgevingsscheiding", async () => {
    connection(); const manager = new As4Manager(); const d = await delivery("receive@aip");
    await Promise.all([manager.ingest("gateway", "dev", "mi-user.xml"), manager.ingest("gateway", "dev", "mi-user.xml")]);
    assert.equal((await manager.all()).length, 1);
    const claims = await Promise.all([manager.receiveNext("gateway", "dev"), manager.receiveNext("gateway", "dev")]);
    const claimed = claims.find(r => "claimToken" in r)!; assert.ok(claimed && "claimToken" in claimed);
    await assert.rejects(() => manager.complete("gateway", "dev", "receive@aip", "wrong"), /claim/);
    await manager.complete("gateway", "dev", "receive@aip", claimed.claimToken!);
    assert.equal((await manager.status("gateway", "dev", "receive@aip", "inbox")).state, "processed");
    assert.equal(directories("gateway", "test").incoming === d.incoming, false);
    await fs.writeFile(join(d.incoming, "mi-bad.xml"), user("bad@aip", "../outside"));
    await assert.rejects(() => manager.ingest("gateway", "dev", "mi-bad.xml"), /buiten/);
    const outside = join(process.env.AIP_AS4_ROOT!, "outside.xml"); await fs.writeFile(outside, "secret"); await fs.symlink(outside, join(d.incoming, "symlink.xml"));
    await assert.rejects(() => readSafe(d.incoming, "symlink.xml"), /buiten/);
    await fs.writeFile(join(d.incoming, "mi-partner.xml"), user("partner@aip").replace('<eb:PartyId>A</eb:PartyId>', '<eb:PartyId>attacker</eb:PartyId>'));
    await assert.rejects(() => manager.ingest("gateway", "dev", "mi-partner.xml"), /partijen/);
    await fs.writeFile(join(d.incoming, "payload.xml"), "<changed/>"); await assert.rejects(() => manager.ingest("gateway", "dev", "mi-user.xml"), /gewijzigde/);
  });
  await suite("herstart tijdens publicatie veroorzaakt geen automatische herverzending", async () => {
    connection(); const manager = new As4Manager();
    const sent = await manager.enqueue("gateway", "dev", { payload, messageId: "crash@aip" });
    const original = (await manager.get("outbox", "dev", "gateway", sent.messageId))!;
    await manager.change(original, { state: "publishing", leaseOwner: "crashed", leaseUntil: new Date(0).toISOString() });
    const d = directories("gateway", "dev"); await fs.unlink(join(d.out, `aip-${original.id}.mmd`));
    await new As4Manager().tick();
    assert.equal((await manager.status("gateway", "dev", sent.messageId)).state, "uncertain");
    assert.equal((await fs.readdir(d.out)).filter(n => n.endsWith(".mmd")).length, 0);
  });
  await suite("AS4-procestrigger eenmaal; crashclaims worden uncertain en herstelbaar", async () => {
    connection(); await agentGroups.hydrate();
    deployments.recordNewVersion({ integration: "ReceiveAs4", trigger: { type: "as4", credential: "gateway" }, steps: [{ id: "check", type: "validate", config: { required: ["payload.xml", "_as4.messageId"] } }] });
    const manager = new As4Manager(); await delivery("workflow@aip"); await manager.tick();
    const status = await manager.status("gateway", "dev", "workflow@aip", "inbox"); assert.equal(status.state, "processed", JSON.stringify(status));
    const count = engine.list({ limit: 100 }).length; await manager.tick(); assert.equal(engine.list({ limit: 100 }).length, count);
    await delivery("interrupted@aip", "mi-interrupted.xml"); await manager.ingest("gateway", "dev", "mi-interrupted.xml");
    const r = (await manager.get("inbox", "dev", "gateway", "interrupted@aip"))!;
    await manager.change(r, { state: "processing", leaseUntil: new Date(0).toISOString(), leaseOwner: "old-worker" });
    await new As4Manager().tick(); assert.equal((await manager.status("gateway", "dev", "interrupted@aip", "inbox")).state, "uncertain"); assert.equal(engine.list({ limit: 100 }).length, count);
    await manager.redrive("gateway", "dev", "interrupted@aip", "inbox"); await manager.tick(); assert.equal((await manager.status("gateway", "dev", "interrupted@aip", "inbox")).state, "processed");
  });
  await suite("organisatie-isolatie, driver-runtime en P-Mode-inspectie", async () => {
    connection(); assert.equal((await new As4Manager().all()).length, 0);
    const own = directories("gateway", "dev"); await runInOrg("as4-other", async () => { connection(); assert.notEqual(directories("gateway", "dev").base, own.base); assert.equal((await new As4Manager().all()).length, 0); });
    const result = await executePlugin({ plugin: def, operation: "message.build", credential: "gateway", params: { payload, messageId: "runtime@aip" }, env: "dev" }); assert.equal((result.data as { messageId: string }).messageId, "runtime@aip");
    await executePlugin({ plugin: def, operation: "connection.deactivate", credential: "gateway", params: {}, env: "dev" }); await assert.rejects(() => new As4Manager().enqueue("gateway", "dev", { payload }), /niet geactiveerd/);
    await executePlugin({ plugin: def, operation: "connection.activate", credential: "gateway", params: {}, env: "dev" }); assert.equal(credentials.resolve("gateway", "dev").values.enabled, "true");
    const pm = inspectPmode('<PMode xmlns="http://holodeck-b2b.org/schemas/2014/10/pmode"><id>test</id><mep>oneWay</mep><mepBinding>push</mepBinding><Leg><Protocol><Address>https://partner/as4</Address></Protocol><Receipt><NotifyReceiptToBusinessApplication>true</NotifyReceiptToBusinessApplication></Receipt></Leg></PMode>'); assert.equal(pm.id, "test"); assert.equal(pm.legs[0].notifyReceipt, true);
  });
  // Actual Fastify routes, encapsulation, activation and metadata filtering.
  connection(); const app = await buildServer();
  const list = await app.inject({ method: "GET", url: "/api/v1/as4/dev/connections" }); assert.equal(list.statusCode, 200);
  assert.ok(list.json().find((c: { credential: string }) => c.credential === "gateway"));
  const deactivated = await app.inject({ method: "POST", url: "/api/v1/as4/dev/connections/gateway/deactivate", payload: {} }); assert.equal(deactivated.statusCode, 200);
  const activated = await app.inject({ method: "POST", url: "/api/v1/as4/dev/connections/gateway/activate", payload: {} }); assert.equal(activated.statusCode, 200);
  const manager = new As4Manager(); await manager.enqueue("gateway", "dev", { payload, messageId: "api@aip" });
  const messages = await app.inject({ method: "GET", url: "/api/v1/as4/dev/messages" }); assert.equal(messages.statusCode, 200); assert.ok(!messages.body.includes('"encrypted"')); assert.ok(!messages.body.includes("AS4 &amp;"));
  assert.equal((await app.inject({ method: "GET", url: "/api/v1/as4/invalid/messages" })).statusCode, 400);
  await app.close(); await persistence.close();
  console.log("ALLE AS4-TESTS GESLAAGD");
}
main().catch(e => { console.error(e); process.exit(1); });
