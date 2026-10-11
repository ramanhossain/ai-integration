import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, X509Certificate } from "node:crypto";
import { buildEbms, inspectEbms, checkConnection } from "../src/plugins/ebms";
import { buildSignal, inspectMessage, reliability } from "../src/plugins/ebms/protocol";
import { signEnvelope, verifyEnvelope, decryptPart } from "../src/plugins/ebms/security";
import { unpack, pack, type PackedMessage } from "../src/plugins/ebms/mime";
import { CPPA, cpaSettings, inspectCpa } from "../src/plugins/ebms/cpa";
import { EbmsManager } from "../src/plugins/ebms/manager";
import { unseal } from "../src/plugins/ebms/repository";
import { SOAP, EB, SIGNAL } from "../src/plugins/ebms/xml";
import { plugins } from "../src/plugins/registry";
import { executePlugin } from "../src/plugins/runtime";
import { credentials } from "../src/connectors/credentials";
import { persistence } from "../src/store";
import { FileDriver } from "../src/store/file";
import { runInOrg } from "../src/tenancy/context";
import { deployments } from "../src/domain/deployments";
import { engine } from "../src/engine/engine";
import { agentGroups } from "../src/runtime/agentGroups";
import { buildServer } from "../src/index";
import { sendHttps } from "../src/plugins/ebms/transport";

const payload = '<bericht>Hallo &amp; welkom</bericht>';
const dir = mkdtempSync(join(tmpdir(), "aip-ebms-"));
function certificate(name: string) {
  const keyFile = join(dir, `${name}.key`), certFile = join(dir, `${name}.crt`);
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-sha256", "-keyout", keyFile, "-out", certFile, "-days", "2", "-subj", `/CN=${name}`, "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1"], { stdio: "ignore" });
  return { key: readFileSync(keyFile, "utf8"), cert: readFileSync(certFile, "utf8"), keyFile, certFile };
}
const a = certificate("a"), b = certificate("b");
function values(profile = "osb-rm-s") {
  const settings = { service: "urn:test:service", action: "Deliver", cpaId: "CPA", partyIdType: "urn:oin", profile, enabled: "true", retryIntervalSeconds: "1", retries: "2", timeToLiveSeconds: "100", persistDurationSeconds: "200", syncReplyMode: "mshSignalsOnly" };
  const sender = { ...settings, fromPartyId: "OIN1", toPartyId: "OIN2", endpoint: "https://localhost/ebms", cert: a.cert, privateKey: a.key, peerSigningCert: b.cert, peerTlsCert: b.cert, ca: b.cert };
  const receiver = { ...settings, fromPartyId: "OIN2", toPartyId: "OIN1", endpoint: "https://localhost/ebms", cert: b.cert, privateKey: b.key, peerSigningCert: a.cert, peerTlsCert: a.cert, ca: a.cert };
  return { sender, receiver };
}
function connections(v = values()) {
  credentials.upsert({ name: "sender", type: "plugin", plugin: "ebms", values: { dev: v.sender, test: v.sender } }, "test");
  credentials.upsert({ name: "receiver", type: "plugin", plugin: "digilevering", values: { dev: v.receiver, test: v.receiver } }, "test");
}
function signedAck(message: PackedMessage, v = values(), ref?: string) {
  const parsed = unpack(message.wire, message.contentType), m = inspectMessage(parsed.envelope);
  const refs = verifyEnvelope(parsed.envelope, parsed.parts, a.cert, true).references;
  return buildSignal(v.receiver, "Acknowledgment", { conversationId: message.conversationId, refToMessageId: ref || message.messageId, references: refs, signed: true });
}
function ok(title: string) { console.log(`  ok ${title}`); }
async function suite(name: string, fn: () => Promise<void>) { await runInOrg(`test-${name}`, fn); }
async function main() {
  await persistence.init();
  const v = values();
  checkConnection(v.sender);
  for (const id of ["ebms", "digipoort", "berichtenbox", "lopende-zaken", "digilevering"]) assert.ok(plugins.get(id)?.operations.some(o => o.id === "message.receive"));
  const plain = buildEbms({ ...v.sender, profile: "osb-be" }, { payload, messageId: "fixed@aip", conversationId: "conv", attachments: [{ contentId: "binary@aip", contentType: "application/octet-stream", dataBase64: Buffer.from([0, 255, 128, 13, 10]).toString("base64") }] });
  const plainParts = unpack(plain.wire, plain.contentType);
  assert.equal(inspectEbms(plain.envelope).messageId, "fixed@aip");
  assert.equal(plainParts.parts[0].data.toString(), payload);
  assert.deepEqual(plainParts.parts[1].data, Buffer.from([0, 255, 128, 13, 10]));
  assert.throws(() => unpack(plain.wire.replace("binary@aip", plainParts.parts[0].contentId), plain.contentType), /dubbele/);
  assert.throws(() => unpack(plain.wire.replace(/--aip_[^\r\n]+--\r\n$/, ""), plain.contentType), /Onvolledig/);
  assert.throws(() => buildEbms(v.sender, { payload: '<!DOCTYPE a [<!ENTITY x "bad">]><a>&x;</a>' }), /DTD/);
  assert.throws(() => buildEbms(v.sender, { payload: "<broken>" }), /Ongeldige/);
  assert.throws(() => inspectEbms(plain.envelope.replace(EB, "urn:evil")), /MessageHeader/);
  assert.throws(() => inspectEbms(plain.envelope.replace("<soap:Header>", "<soap:Header><eb:MessageHeader/>")), /exact/);
  assert.throws(() => buildEbms(v.sender, { payload, messageId: "invalid" }), /Bericht-ID/);
  assert.throws(() => reliability({ ...v.sender, persistDurationSeconds: "1" }), /PersistDuration/);
  ok("SOAP/MIME met XML en binaire bijlagen; namespaces, duplicaten, DTD en grenzen");

  for (const prof of ["osb-rm-s", "osb-rm-e"]) {
    const pair = values(prof);
    const message = buildEbms(pair.sender, { payload, attachments: [{ dataBase64: Buffer.from("private-attachment").toString("base64") }] });
    const parsed = unpack(message.wire, message.contentType);
    assert.equal(verifyEnvelope(parsed.envelope, parsed.parts, a.cert, true).verified, true);
    assert.throws(() => verifyEnvelope(parsed.envelope, parsed.parts, b.cert, true), /handtekening/);
    assert.throws(() => verifyEnvelope(parsed.envelope.replace("Deliver", "Evil"), parsed.parts, a.cert, true), /Digest/);
    const changed = parsed.parts.map((p, i) => i === 0 ? { ...p, data: Buffer.from("changed") } : p);
    assert.throws(() => verifyEnvelope(parsed.envelope, changed, a.cert, true), /Digest/);
    const decoded = parsed.parts.map(p => decryptPart(p, pair.receiver));
    assert.equal(decoded[0].data.toString(), payload);
    assert.equal(decoded[1].data.toString(), "private-attachment");
    if (prof.endsWith("-e")) {
      assert.ok(!parsed.parts[0].data.toString().includes("Hallo"));
      assert.throws(() => decryptPart(parsed.parts[0], pair.sender));
      const encryptedXml = parsed.parts[0].data.toString();
      const changedXml = encryptedXml.replace(/(<xenc:CipherValue>)([A-Za-z0-9])/, (_m, prefix, c) => `${prefix}${c === "A" ? "B" : "A"}`);
      assert.throws(() => decryptPart({ ...parsed.parts[0], data: Buffer.from(changedXml) }, pair.receiver));
    }
  }
  ok("RSA-SHA256 envelope/bijlagendekking, vertrouwde partner en AES256-GCM/RSA-OAEP");

  await suite("receipts", async () => {
    connections();
    let sends = 0;
    const manager = new EbmsManager(async message => { sends++; const ack = signedAck(message); return { status: 200, contentType: ack.contentType, body: Buffer.from(ack.wire) }; });
    const params = { payload, messageId: "send@aip" };
    const statuses = await Promise.all([manager.enqueue("sender", "dev", params), manager.enqueue("sender", "dev", params)]);
    assert.equal(sends, 1);
    const receiptStatus = await manager.status("sender", "dev", "send@aip");
    assert.equal(receiptStatus.deliveryConfirmed, true, JSON.stringify(receiptStatus));
    assert.ok(statuses.every(s => s.messageId === "send@aip"));
    await manager.enqueue("sender", "dev", params);
    assert.equal(sends, 1);
    await assert.rejects(() => manager.enqueue("sender", "dev", { ...params, payload: "<changed/>" }), /andere inhoud/);
    const raw = JSON.stringify(await manager.repo.all());
    assert.ok(!raw.includes("Hallo") && !raw.includes("PRIVATE KEY"));
    ok("durable enqueue, concurrerende workers, idempotente IDs en signed receipts");
  });

  await suite("retry", async () => {
    connections(); const seen: string[] = [];
    const manager = new EbmsManager(async message => { seen.push(message.wire); throw new Error("transport unavailable"); });
    const result = await manager.enqueue("sender", "dev", { payload, messageId: "retry@aip" });
    assert.equal(result.state, "queued");
    const record = (await manager.repo.get("outbox", "dev", "sender", "retry@aip"))!;
    await manager.repo.change(record, { nextAttemptAt: new Date(0).toISOString() });
    const restored = new EbmsManager(async message => { seen.push(message.wire); const ack = signedAck(message); return { status: 200, contentType: ack.contentType, body: Buffer.from(ack.wire) }; });
    await restored.hydrate(); await restored.tick();
    assert.equal(seen.length, 2); assert.equal(seen[0], seen[1]);
    assert.equal((await restored.status("sender", "dev", "retry@aip")).deliveryConfirmed, true);
    ok("restart/retry hergebruikt exact dezelfde opgeslagen wire en MessageId");
  });

  await suite("badack", async () => {
    connections();
    const manager = new EbmsManager(async message => { const ack = signedAck(message, v, "unknown@aip"); return { status: 200, contentType: ack.contentType, body: Buffer.from(ack.wire) }; });
    const result = await manager.enqueue("sender", "dev", { payload, messageId: "bad@aip" });
    assert.equal(result.deliveryConfirmed, false);
    const another = new EbmsManager(async () => ({ status: 200, contentType: "text/xml", body: Buffer.alloc(0) }));
    const missing = await another.enqueue("sender", "dev", { payload, messageId: "missing@aip" });
    assert.equal(missing.state, "awaiting-ack"); assert.equal(missing.deliveryConfirmed, false);
    const original = (await another.repo.get("outbox", "dev", "sender", "missing@aip"))!;
    const wrong = buildSignal(v.receiver, "Acknowledgment", { refToMessageId: original.messageId, conversationId: original.conversationId, signed: true, references: [{ uri: "", digest: "AAAA", xml: '<ds:Reference URI="" xmlns:ds="http://www.w3.org/2000/09/xmldsig#"><ds:DigestValue>AAAA</ds:DigestValue></ds:Reference>' }] });
    await assert.rejects(() => another.receive("sender", "dev", wrong.wire, wrong.contentType), /digests/);
    await another.repo.change((await another.repo.get("outbox", "dev", "sender", "missing@aip"))!, { expiresAt: new Date(0).toISOString(), nextAttemptAt: new Date(0).toISOString() });
    await another.tick();
    assert.equal((await another.status("sender", "dev", "missing@aip")).state, "failed");
    ok("HTTP 200, verkeerde correlatie en foutieve signed-receipt-digests bevestigen geen aflevering; TTL stopt retries");
  });

  await suite("duplicates", async () => {
    connections();
    const manager = new EbmsManager();
    const message = buildEbms(v.sender, { payload, messageId: "duplicate@aip" });
    const results = await Promise.all([manager.receive("receiver", "dev", message.wire, message.contentType), manager.receive("receiver", "dev", message.wire, message.contentType)]);
    assert.equal(results.filter(r => !r.duplicate).length, 1);
    assert.equal(results[0].reply?.wire, results[1].reply?.wire);
    assert.equal((await manager.repo.all()).filter(r => r.box === "inbox").length, 1);
    const other = buildEbms(v.sender, { payload: "<changed/>", messageId: "duplicate@aip" });
    await assert.rejects(() => manager.receive("receiver", "dev", other.wire, other.contentType), /gewijzigde inhoud/);
    const claims = await Promise.all([manager.receiveNext("receiver", "dev"), manager.receiveNext("receiver", "dev")]);
    const claimed = claims.find(r => "claimToken" in r)!;
    assert.ok("claimToken" in claimed);
    await manager.complete("receiver", "dev", "duplicate@aip", claimed.claimToken!);
    assert.equal((await manager.status("receiver", "dev", "duplicate@aip", "inbox")).state, "processed");
    const differentEnv = await manager.receive("receiver", "test", message.wire, message.contentType);
    assert.equal(differentEnv.duplicate, false);
    ok("concurrerende duplicaten geven dezelfde receipt en één procesclaim; omgevingen gescheiden");
  });

  await suite("storage-failure", async () => {
    connections(); const manager = new EbmsManager();
    const message = buildEbms(v.sender, { payload });
    const original = persistence.create;
    persistence.create = async () => { throw new Error("disk full"); };
    try { await assert.rejects(() => manager.receive("receiver", "dev", message.wire, message.contentType), /disk full/); }
    finally { persistence.create = original; }
    assert.equal((await manager.repo.all()).length, 0);
    ok("opslagfout verhindert acknowledgment en procesdispatch");
  });

  await suite("async", async () => {
    const pair = values(); pair.sender.syncReplyMode = "none"; pair.receiver.syncReplyMode = "none"; connections(pair);
    const sender = new EbmsManager(async () => ({ status: 200, body: Buffer.alloc(0), contentType: "text/xml" }));
    const result = await sender.enqueue("sender", "dev", { payload, messageId: "async@aip" });
    assert.equal(result.deliveryConfirmed, false);
    const outgoing = (await sender.repo.get("outbox", "dev", "sender", "async@aip"))!;
    const message = unseal(outgoing).message;
    const receiver = new EbmsManager(async reply => {
      await sender.receive("sender", "dev", reply.wire, reply.contentType);
      return { status: 200, body: Buffer.alloc(0), contentType: "text/xml" };
    });
    assert.equal((await receiver.receive("receiver", "dev", message.wire, message.contentType)).reply, undefined);
    await receiver.tick();
    assert.equal((await sender.status("sender", "dev", "async@aip")).deliveryConfirmed, true);
    ok("asynchrone acknowledgments worden duurzaam verzonden en gecorreleerd");
  });

  await suite("workflow", async () => {
    connections();
    await agentGroups.hydrate();
    deployments.recordNewVersion({ integration: "ReceiveEbms", trigger: { type: "ebms", credential: "receiver" }, steps: [{ id: "check", type: "validate", config: { required: ["payload.xml", "_ebms.messageId"] } }] });
    const manager = new EbmsManager();
    const message = buildEbms(v.sender, { payload, messageId: "workflow@aip" });
    await manager.receive("receiver", "dev", message.wire, message.contentType);
    await manager.tick();
    const workflowStatus = await manager.status("receiver", "dev", "workflow@aip", "inbox");
    assert.equal(workflowStatus.state, "processed", JSON.stringify(workflowStatus));
    const before = engine.list({ limit: 100 }).length;
    await manager.receive("receiver", "dev", message.wire, message.contentType); await manager.tick();
    assert.equal(engine.list({ limit: 100 }).length, before);
    const interrupted = buildEbms(v.sender, { payload, messageId: "interrupted@aip" });
    await manager.receive("receiver", "dev", interrupted.wire, interrupted.contentType);
    const r = (await manager.repo.get("inbox", "dev", "receiver", interrupted.messageId))!;
    await manager.repo.change(r, { state: "processing", leaseUntil: new Date(0).toISOString(), leaseOwner: "old-worker" });
    await manager.hydrate(); await manager.tick();
    assert.equal((await manager.status("receiver", "dev", "interrupted@aip", "inbox")).state, "uncertain");
    assert.equal(engine.list({ limit: 100 }).length, before);
    ok("ebMS-trigger start het proces eenmaal; onderbroken uitvoering krijgt uncertain zonder automatische replay");
  });

  await suite("signals", async () => {
    connections(); const manager = new EbmsManager();
    const ping = buildSignal(v.sender, "Ping");
    const pong = (await manager.receive("receiver", "dev", ping.wire, ping.contentType)).reply!;
    assert.equal(inspectMessage(pong.envelope).action, "Pong");
    const request = buildSignal(v.sender, "StatusRequest", { targetMessageId: "unknown@aip" });
    const response = (await manager.receive("receiver", "dev", request.wire, request.contentType)).reply!;
    assert.equal(inspectMessage(response.envelope).statusResponse?.status, "NotRecognized");
    const existing = buildEbms(v.sender, { payload, messageId: "known@aip" });
    await manager.receive("receiver", "dev", existing.wire, existing.contentType);
    const known = buildSignal(v.sender, "StatusRequest", { targetMessageId: existing.messageId });
    assert.equal(inspectMessage((await manager.receive("receiver", "dev", known.wire, known.contentType)).reply!.envelope).statusResponse?.status, "Received");
    ok("MSH Ping/Pong en StatusRequest/StatusResponse");
  });

  await suite("tenant-a", async () => { connections(); const manager = new EbmsManager(); const message = buildEbms(v.sender, { payload, messageId: "tenant@aip" }); await manager.receive("receiver", "dev", message.wire, message.contentType); });
  await suite("tenant-b", async () => { connections(); assert.equal((await new EbmsManager().repo.all()).length, 0); });
  ok("inbox/outbox en credentials geïsoleerd per organisatie");

  const cpa = `<cppa:CollaborationProtocolAgreement xmlns:cppa="${CPPA}" cppa:cpaid="CPA-IMPORT"><cppa:Status cppa:value="agreed"/>${["OIN1", "OIN2"].map((id, i) => `<cppa:PartyInfo><cppa:PartyId cppa:type="urn:oin">${id}</cppa:PartyId><cppa:CollaborationRole><cppa:Role cppa:name="urn:role:${i}"/><cppa:ServiceBinding><cppa:Service>urn:test:service</cppa:Service><cppa:${i ? "CanReceive" : "CanSend"}><cppa:ThisPartyActionBinding cppa:action="Deliver"><cppa:ChannelId>channel${i}</cppa:ChannelId></cppa:ThisPartyActionBinding></cppa:${i ? "CanReceive" : "CanSend"}></cppa:ServiceBinding></cppa:CollaborationRole><cppa:DeliveryChannel cppa:channelId="channel${i}" cppa:transportId="transport${i}" cppa:docExchangeId="exchange"><cppa:MessagingCharacteristics cppa:syncReplyMode="mshSignalsOnly"/></cppa:DeliveryChannel><cppa:Transport cppa:transportId="transport${i}"><cppa:TransportReceiver><cppa:Endpoint cppa:uri="https://localhost/party${i}"/></cppa:TransportReceiver></cppa:Transport><cppa:DocExchange cppa:docExchangeId="exchange"><cppa:${i ? "ebXMLReceiverBinding" : "ebXMLSenderBinding"}><cppa:ReliableMessaging><cppa:Retries>2</cppa:Retries><cppa:RetryInterval>PT1S</cppa:RetryInterval></cppa:ReliableMessaging><cppa:PersistDuration>PT200S</cppa:PersistDuration></cppa:${i ? "ebXMLReceiverBinding" : "ebXMLSenderBinding"}></cppa:DocExchange></cppa:PartyInfo>`).join("")}</cppa:CollaborationProtocolAgreement>`;
  assert.equal(inspectCpa(cpa).parties.length, 2);
  const imported = cpaSettings(cpa, { fromPartyId: "OIN1" });
  assert.equal(imported.profile, "osb-rm"); assert.equal(imported.retries, "2"); assert.equal(imported.retryIntervalSeconds, "1");
  assert.equal(imported.endpoint, "https://localhost/party1");
  assert.equal(imported.persistDurationSeconds, "200");
  const inboundOnly = cpaSettings(cpa, { fromPartyId: "OIN2", direction: "receive" });
  assert.equal(inboundOnly.endpoint, "https://localhost/party0");
  assert.equal(inboundOnly.sendEnabled, "false"); assert.equal(inboundOnly.receiveEnabled, "true");
  assert.equal(inboundOnly.receiveAction, "Deliver");
  assert.throws(() => buildEbms({ ...v.receiver, ...inboundOnly }, { payload }), /alleen ontvangst/i);
  assert.throws(() => cpaSettings(cpa.replace(/mshSignalsOnly/g, "signalsAndResponse"), { fromPartyId: "OIN1" }), /SyncReplyMode/);
  await suite("runtime", async () => {
    connections();
    const def = plugins.get("ebms")!;
    const built = await executePlugin({ plugin: def, operation: "message.build", credential: "sender", params: { payload, messageId: "runtime@aip" }, env: "dev" });
    assert.equal((built.data as { messageId: string }).messageId, "runtime@aip");
    await executePlugin({ plugin: def, operation: "cpa.import", credential: "sender", params: { xml: cpa, fromPartyId: "OIN1" }, env: "dev" });
    assert.equal(credentials.resolve("sender", "dev").values.cpaId, "CPA-IMPORT"); assert.equal(credentials.resolve("sender", "dev").values.enabled, "false");
  });
  ok("CPA-inlezen, semantische validatie, selectie en import via plugin-runtime");

  const files = join(dir, "store"); const disk = new FileDriver(files); await disk.init();
  assert.equal(await disk.create("messages", "id", { state: "received" }), true);
  assert.equal(await disk.create("messages", "id", { state: "changed" }), false);
  const reopened = new FileDriver(files); await reopened.init();
  assert.equal((await reopened.loadAll("messages"))[0].doc && ((await reopened.loadAll("messages"))[0].doc as { state: string }).state, "received");
  assert.equal(await disk.replace("messages", "id", { state: "wrong" }, { state: "processed" }), false);
  assert.equal(await disk.replace("messages", "id", { state: "received" }, { state: "processed" }), true);
  await disk.close(); await reopened.close();
  ok("bestandsopslag commit is leesbaar vóór close en CAS weigert verouderde updates");

  process.env.AIP_TLS_CERT_FILE = b.certFile; process.env.AIP_TLS_KEY_FILE = b.keyFile; process.env.AIP_TLS_CA_FILE = a.certFile;
  const app = await buildServer();
  connections();
  const unauthenticated = await app.inject({ method: "POST", url: "/ebms/dev/receiver", headers: { "content-type": plain.contentType }, payload: plain.wire });
  assert.equal(unauthenticated.statusCode, 401);
  try {
    await app.listen({ port: 0, host: "127.0.0.1" });
    const address = app.server.address() as { port: number };
    const pair = values("osb-rm-e"); pair.sender.endpoint = `https://localhost:${address.port}/ebms/dev/receiver`;
    connections(pair);
    const manager = new EbmsManager();
    const sent = await manager.enqueue("sender", "dev", { payload, messageId: "https@aip", attachments: [{ contentType: "application/pdf", dataBase64: Buffer.from("test-pdf").toString("base64") }] });
    assert.equal(sent.deliveryConfirmed, true, JSON.stringify(sent));
    const received = (await manager.repo.get("inbox", "dev", "receiver", "https@aip"))!;
    assert.equal(Buffer.from(unseal(received).parts![0].dataBase64, "base64").toString(), payload);
    const list = await app.inject({ method: "GET", url: "/api/v1/ebms/dev/messages" });
    assert.equal(list.statusCode, 200); assert.ok(!list.body.includes("encrypted") && !list.body.includes("PRIVATE KEY"));
    const wrongPin = { ...pair.sender, peerTlsCert: a.cert };
    await assert.rejects(() => sendHttps(buildEbms(wrongPin, { payload }), wrongPin), /partnercertificaat/);
    const deactivate = await app.inject({ method: "POST", url: "/api/v1/ebms/dev/connections/receiver/deactivate" });
    assert.equal(deactivate.statusCode, 200);
    const rejected = await sendHttps(buildEbms(pair.sender, { payload }), pair.sender);
    assert.equal(rejected.status, 503);
    ok("echte HTTPS/mTLS end-to-end met signing, encryptie, bijlage, receipt, pinning en activatie-API");
  } finally { await app.close(); }
  console.log("ALLE ebMS-TESTS GESLAAGD");
}
main().catch(e => { console.error(e); process.exitCode = 1; });
