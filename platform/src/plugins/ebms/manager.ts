import { createHash, randomUUID } from "node:crypto";
import { credentials } from "../../connectors/credentials";
import { persistence } from "../../store";
import { scoped } from "../../tenancy/context";
import type { EnvName } from "../../domain/environments";
import { deployments } from "../../domain/deployments";
import { agentGroups } from "../../runtime/agentGroups";
import { runDeployed } from "../../runtime/dispatch";
import { audit } from "../../audit/auditLog";
import { triggers } from "../../triggers/manager";
import { unpack, type PackedMessage } from "./mime";
import { buildMessage, buildSignal, inspectMessage, validatePartner, profile, reliability, type InspectedMessage } from "./protocol";
import { envelopeDigest, verifyEnvelope, decryptPart, storedSignatureReferences } from "./security";
import { SIGNAL, parseXml } from "./xml";
import { MessageRepository, recordId, seal, unseal, type MessageRecord, type MessageContent } from "./repository";
import { sendHttps, type TransportReply } from "./transport";

const PROTOCOL_FIELDS = ["endpoint", "replyEndpoint", "fromPartyId", "toPartyId", "partyIdType", "fromRole", "toRole", "cpaId", "service", "serviceType", "action", "sendActions", "sendEnabled", "receiveEnabled", "receiveService", "receiveServiceType", "receiveAction", "profile", "syncReplyMode", "retries", "retryIntervalSeconds", "timeToLiveSeconds", "persistDurationSeconds", "cpaStart", "cpaEnd"];
const snapshot = (v: Record<string, string>) => Object.fromEntries(PROTOCOL_FIELDS.filter(k => v[k] !== undefined).map(k => [k, v[k]]));
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const stable = (v: unknown): string => JSON.stringify(v, (_k, value) => value && typeof value === "object" && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) : value);
const now = () => new Date().toISOString();
const IDS = new Set(["ebms", "digipoort", "berichtenbox", "lopende-zaken", "digilevering"]);
export function resolveConnection(credential: string, env: EnvName): { plugin: string; values: Record<string, string> } {
  const plugin = credentials.pluginOf(credential);
  if (!plugin || !IDS.has(plugin)) throw new Error("Geen ebMS-koppeling");
  const raw = credentials.resolve(credential, env).values;
  // Credential defaults are also needed by the receiver/background worker.
  const { plugins } = require("../registry") as typeof import("../registry");
  const { withDefaults } = require("../runtime") as typeof import("../runtime");
  return { plugin, values: withDefaults(plugins.get(plugin)!, raw) };
}
function requireActive(v: Record<string, string>): void {
  if (v.enabled !== "true") throw new Error("ebMS-koppeling is niet geactiveerd (enabled=true)");
  if (v.cpaStart && Date.parse(v.cpaStart) > Date.now() || v.cpaEnd && Date.parse(v.cpaEnd) <= Date.now()) throw new Error("CPA is verlopen of nog niet geldig");
  if (persistence.kind === "memory" && process.env.NODE_ENV === "production") throw new Error("ebMS vereist duurzame bestandsopslag of Postgres");
}

export class EbmsManager {
  readonly repo = new MessageRepository();
  private worker = randomUUID();
  private timer?: NodeJS.Timeout;
  private ticking = false;
  private dispatching = new Map<string, Promise<void>>();
  constructor(private transport: (message: PackedMessage, values: Record<string, string>, endpoint?: string) => Promise<TransportReply> = sendHttps) {}
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => { void this.tick(false).catch(e => audit.append({ actor: "ebms", event: "ebms.worker.error", data: { error: (e as Error).message } })); }, 1000);
    this.timer.unref();
  }
  stop(): void { if (this.timer) clearInterval(this.timer); this.timer = undefined; }
  async hydrate(): Promise<void> {
    // Processing without a completed run is ambiguous; never replay it automatically.
    for (const r of await this.repo.all()) if (r.state === "processing" && Date.parse(r.leaseUntil || "") <= Date.now()) await this.repo.change(r, { state: "uncertain", leaseOwner: undefined, leaseUntil: undefined, lastError: "Worker onderbroken tijdens procesuitvoering; beoordeel vóór opnieuw verwerken" });
  }
  async enqueue(credential: string, env: EnvName, params: Record<string, unknown>) {
    const { plugin, values: v } = resolveConnection(credential, env); requireActive(v);
    const id = String(params.messageId || `${randomUUID()}@aip`);
    const fingerprint = hash(stable({ snapshot: snapshot(v), ...params, messageId: id, action: params.action || v.action }));
    const existing = await this.repo.get("outbox", env, credential, id);
    if (existing) {
      if (existing.fingerprint !== fingerprint) throw new Error("Bericht-ID bestaat al met andere inhoud of CPA");
      return this.repo.summary(existing);
    }
    const message = buildMessage(v, { ...params, messageId: id });
    const settings = reliability(v), prof = profile(v);
    const created = now();
    const record: MessageRecord = {
      id: recordId("outbox", env, credential, id), box: "outbox", env, credential, plugin, messageId: id, conversationId: message.conversationId,
      cpaId: v.cpaId, action: String(params.action || v.action), service: v.service, createdAt: created, updatedAt: created,
      expiresAt: new Date(Date.now() + settings.ttl * 1000).toISOString(), retainUntil: new Date(Date.now() + settings.persist * 1000).toISOString(),
      state: "queued", attempts: 0, retries: settings.retries, intervalSeconds: settings.interval, nextAttemptAt: created, reliable: prof.reliable, fingerprint,
      encrypted: seal({ message, snapshot: snapshot(v) }),
    };
    if (!await this.repo.create(record)) {
      const winner = await this.repo.get("outbox", env, credential, id);
      if (!winner || winner.fingerprint !== fingerprint) throw new Error("Bericht-ID bestaat met andere inhoud");
      return this.repo.summary(winner);
    }
    audit.append({ actor: "ebms", event: "ebms.queued", subject: id, data: { env, credential } });
    // Once persisted, return a durable queue result even if transport is temporarily unavailable.
    await this.attempt(record);
    return this.repo.summary((await this.repo.get("outbox", env, credential, id))!);
  }

  private async queueSignal(credential: string, env: EnvName, message: PackedMessage, v: Record<string, string>): Promise<MessageRecord> {
    const created = now(), settings = reliability(v);
    const { plugin } = resolveConnection(credential, env);
    const m = inspectMessage(message.envelope);
    const r: MessageRecord = {
      id: recordId("outbox", env, credential, message.messageId), box: "outbox", env, credential, plugin,
      messageId: message.messageId, conversationId: message.conversationId, cpaId: v.cpaId, action: m.action, service: SIGNAL,
      createdAt: created, updatedAt: created, expiresAt: new Date(Date.now() + settings.ttl * 1000).toISOString(), retainUntil: new Date(Date.now() + settings.persist * 1000).toISOString(),
      state: "queued", attempts: 0, retries: settings.retries, intervalSeconds: settings.interval, nextAttemptAt: created, reliable: false, fingerprint: hash(message.wire),
      encrypted: seal({ message, snapshot: snapshot(v) }),
    };
    await this.repo.create(r);
    return r;
  }

  async requestSignal(credential: string, env: EnvName, action: "Ping" | "StatusRequest", targetMessageId?: string) {
    const { values: v } = resolveConnection(credential, env); requireActive(v);
    const message = buildSignal(v, action, { targetMessageId });
    const record = await this.queueSignal(credential, env, message, v);
    await this.attempt(record);
    return this.repo.summary((await this.repo.get("outbox", env, credential, record.messageId))!);
  }

  private async attempt(record: MessageRecord): Promise<void> {
    if (!["queued", "awaiting-ack"].includes(record.state) || Date.parse(record.nextAttemptAt) > Date.now()) return;
    if (record.leaseUntil && Date.parse(record.leaseUntil) > Date.now()) return;
    if (Date.parse(record.expiresAt) <= Date.now() || record.attempts > record.retries) {
      await this.repo.change(record, { state: "failed", lastError: "TimeToLive of maximaal aantal retries verstreken" }); return;
    }
    const content = unseal(record);
    let values: Record<string, string>;
    try {
      values = { ...resolveConnection(record.credential, record.env).values, ...content.snapshot };
      requireActive(values);
    } catch (e) {
      // Disabled connections stay queued and can be reactivated without losing messages.
      await this.repo.change(record, { lastError: (e as Error).message, nextAttemptAt: new Date(Date.now() + record.intervalSeconds * 1000).toISOString() }); return;
    }
    const claimed = await this.repo.change(record, { leaseOwner: this.worker, leaseUntil: new Date(Date.now() + 60000).toISOString(), attempts: record.attempts + 1, nextAttemptAt: new Date(Date.now() + record.intervalSeconds * 1000).toISOString() });
    if (!claimed) return;
    try {
      const response = await this.transport(content.message, values, ["Acknowledgment", "MessageError", "Pong", "StatusResponse"].includes(record.action) && record.service === SIGNAL ? values.replyEndpoint || values.endpoint : values.endpoint);
      if (response.status < 200 || response.status >= 300) throw new Error(`ebMS HTTP ${response.status}`);
      if (response.body.length) {
        const received = await this.receive(record.credential, record.env, response.body, response.contentType, values);
        if (received.error) throw new Error(received.error);
      }
      await this.repo.updateLatest(record.id, current => current.state === "delivered" || current.state === "failed" ? { httpStatus: response.status, leaseOwner: undefined, leaseUntil: undefined } : {
        httpStatus: response.status, state: record.reliable ? "awaiting-ack" : "delivered", lastError: undefined, leaseOwner: undefined, leaseUntil: undefined,
      });
    } catch (e) {
      await this.repo.updateLatest(record.id, current => current.state === "delivered" ? { leaseOwner: undefined, leaseUntil: undefined } : {
        leaseOwner: undefined, leaseUntil: undefined, lastError: (e as Error).message,
        state: current.state === "failed" || claimed.attempts > current.retries ? "failed" : "queued",
      });
    }
  }

  async receive(credential: string, env: EnvName, wire: Buffer | string, contentType: string, override?: Record<string, string>): Promise<{ reply?: PackedMessage; duplicate: boolean; messageId: string; error?: string }> {
    const connection = resolveConnection(credential, env), v = override || connection.values; requireActive(v);
    const unpacked = unpack(wire, contentType), m = inspectMessage(unpacked.envelope);
    validatePartner(m, v, unpacked.parts);
    const verified = verifyEnvelope(unpacked.envelope, unpacked.parts, v.peerSigningCert, profile(v).signed);
    const parts = unpacked.parts.map(p => decryptPart(p, v));
    if (m.service !== SIGNAL) {
      if (profile(v).encrypted && unpacked.parts.some(p => !/^application\/xenc\+xml\b/i.test(p.contentType))) throw new Error("CPA vereist encryptie van alle payloads");
      const first = parts.find(p => `cid:${p.contentId}` === m.references[0]);
      if (!first || !/^(application|text)\/xml\b/i.test(first.contentType)) throw new Error("Eerste payload moet XML zijn");
      parseXml(first.data.toString("utf8"));
    }
    const fingerprint = hash(envelopeDigest(unpacked.envelope) + unpacked.parts.map(p => hash(p.data.toString("base64"))).join(":"));
    const existing = await this.repo.get("inbox", env, credential, m.messageId);
    if (existing) {
      if (existing.fingerprint !== fingerprint) throw new Error("Zelfde MessageId met gewijzigde inhoud ontvangen");
      const saved = unseal(existing);
      // A duplicate signal can finish correlation after a crash between inbox commit and outbox update.
      if (m.service === SIGNAL) await this.applySignal(existing, m, v, verified.verified);
      if (saved.reply && !m.syncReply && m.service !== SIGNAL) await this.queueSignal(credential, env, saved.reply, v);
      return { messageId: m.messageId, duplicate: true, reply: m.syncReply || m.service === SIGNAL ? saved.reply : undefined };
    }
    if (m.timeToLive && Date.parse(m.timeToLive) <= Date.now()) {
      const reply = buildSignal(v, "MessageError", { conversationId: m.conversationId, refToMessageId: m.messageId, errorCode: "TimeToLiveExpired", description: "TimeToLive verstreken" });
      if (!m.syncReply) await this.queueSignal(credential, env, reply, v);
      return { messageId: m.messageId, duplicate: false, reply: m.syncReply ? reply : undefined, error: "TimeToLiveExpired" };
    }
    const created = now(); let reply: PackedMessage | undefined;
    if (m.ackRequested) reply = buildSignal(v, "Acknowledgment", { conversationId: m.conversationId, refToMessageId: m.messageId, receivedAt: created, references: m.signedAckRequested ? verified.references : [], signed: m.signedAckRequested });
    if (m.action === "Ping" && m.service === SIGNAL) reply = buildSignal(v, "Pong", { conversationId: m.conversationId, refToMessageId: m.messageId });
    if (m.statusRequest) {
      const target = await this.repo.get("inbox", env, credential, m.statusRequest);
      reply = buildSignal(v, "StatusResponse", { conversationId: m.conversationId, refToMessageId: m.messageId, targetMessageId: m.statusRequest, status: !target ? "NotRecognized" : target.state === "processed" ? "Processed" : "Received", receivedAt: target?.createdAt });
    }
    const settings = reliability(v);
    const packed: PackedMessage = { messageId: m.messageId, conversationId: m.conversationId, envelope: unpacked.envelope, wire: Buffer.isBuffer(wire) ? wire.toString("base64") : Buffer.from(wire).toString("base64"), contentType };
    const content: MessageContent = { message: packed, snapshot: snapshot(v), incoming: m, reply, parts: m.references.map(ref => {
      const p = parts.find(p => `cid:${p.contentId}` === ref)!; return { contentId: p.contentId, contentType: p.contentType, dataBase64: p.data.toString("base64") };
    }) };
    const record: MessageRecord = {
      id: recordId("inbox", env, credential, m.messageId), box: "inbox", env, credential, plugin: connection.plugin,
      messageId: m.messageId, conversationId: m.conversationId, cpaId: m.cpaId, action: m.action, service: m.service,
      createdAt: created, updatedAt: created, expiresAt: m.timeToLive || new Date(Date.now() + settings.ttl * 1000).toISOString(), retainUntil: new Date(Date.now() + settings.persist * 1000).toISOString(),
      state: m.service === SIGNAL ? "processed" : "received", attempts: 0, retries: 0, intervalSeconds: settings.interval, nextAttemptAt: created, reliable: profile(v).reliable, fingerprint, encrypted: seal(content),
    };
    if (!await this.repo.create(record)) return this.receive(credential, env, wire, contentType, override);
    // The durable commit above must precede every acknowledgment and process dispatch.
    if (m.service === SIGNAL) await this.applySignal(record, m, v, verified.verified);
    if (reply && !m.syncReply && m.service !== SIGNAL) await this.queueSignal(credential, env, reply, v);
    audit.append({ actor: "ebms", event: "ebms.received", subject: m.messageId, data: { env, credential, action: m.action } });
    return { messageId: m.messageId, duplicate: false, reply: m.syncReply || m.service === SIGNAL ? reply : undefined, error: m.errors?.length || m.fault ? "ebMS-protocolfout ontvangen" : undefined };
  }

  private async applySignal(record: MessageRecord, m: InspectedMessage, v: Record<string, string>, signatureVerified: boolean): Promise<void> {
    const ref = m.acknowledgment?.refToMessageId || m.refToMessageId;
    if (!ref) return;
    const outgoing = await this.repo.get("outbox", record.env, record.credential, ref);
    if (!outgoing || outgoing.cpaId !== m.cpaId || outgoing.conversationId !== m.conversationId) throw new Error("Protocolantwoord verwijst niet naar een bekend bericht/conversatie");
    if (m.acknowledgment) {
      if (!outgoing.reliable || outgoing.service === SIGNAL) throw new Error("Onverwachte acknowledgment");
      const original = unseal(outgoing);
      const mustSign = profile(original.snapshot).signed;
      if (mustSign) {
        if (!signatureVerified) throw new Error("Signed receipt vereist");
        const expected = storedSignatureReferences(original.message.envelope);
        const received = m.acknowledgment.references;
        if (received.length !== expected.length || new Set(received.map(r => r.uri)).size !== expected.length || expected.some(e => !received.some(r => r.uri === e.uri && r.digest === e.digest))) throw new Error("Signed receipt digests wijken af van verzonden bericht");
      }
      await this.repo.updateLatest(outgoing.id, current => current.state === "delivered" ? {} : { state: "delivered", confirmedAt: record.createdAt, responseMessageId: m.messageId, lastError: undefined, leaseOwner: undefined, leaseUntil: undefined });
    } else if (m.errors?.some(e => e.severity === "Error") || m.fault) {
      await this.repo.updateLatest(outgoing.id, current => current.state === "delivered" ? {} : { state: "failed", lastError: m.errors?.map(e => e.code).join(",") || "SOAP Fault", responseMessageId: m.messageId });
    } else if (m.action === "Pong" || m.statusResponse) {
      if (outgoing.action !== (m.action === "Pong" ? "Ping" : "StatusRequest")) throw new Error("Protocolantwoord heeft verkeerde actie");
      await this.repo.updateLatest(outgoing.id, () => ({ responseMessageId: m.messageId }));
    }
  }

  async tick(waitForProcesses = true): Promise<void> {
    if (this.ticking) return; this.ticking = true;
    try {
      for (const r of (await this.repo.all()).filter(r => r.box === "inbox" && r.state === "received" && Date.parse(r.nextAttemptAt) <= Date.now()).slice(0, 50)) {
        const content = unseal(r);
        if (content.reply && !content.incoming?.syncReply) {
          const v = { ...resolveConnection(r.credential, r.env).values, ...content.snapshot };
          await this.queueSignal(r.credential, r.env, content.reply, v);
        }
        if (this.dispatching.size < 8 && !this.dispatching.has(r.id)) {
          const task = this.dispatch(r).catch(e => { audit.append({ actor: "ebms", event: "ebms.dispatch.error", subject: r.messageId, data: { error: (e as Error).message } }); }).finally(() => this.dispatching.delete(r.id));
          this.dispatching.set(r.id, task);
        }
      }
      const due = (await this.repo.all()).filter(r => ["queued", "awaiting-ack"].includes(r.state) && Date.parse(r.nextAttemptAt) <= Date.now() && (!r.leaseUntil || Date.parse(r.leaseUntil) <= Date.now())).slice(0, 8);
      await Promise.all(due.map(r => this.attempt(r)));
      if (waitForProcesses) await Promise.all(this.dispatching.values());
      for (const r of await this.repo.all()) if (r.state === "processing" && r.leaseUntil && Date.parse(r.leaseUntil) <= Date.now()) await this.repo.change(r, { state: "uncertain", lastError: "Procesclaim verlopen; beoordeel voor opnieuw verwerken" });
    } finally { this.ticking = false; }
  }

  private async dispatch(r: MessageRecord): Promise<void> {
    const { values } = resolveConnection(r.credential, r.env);
    if (values.enabled !== "true") { await this.repo.change(r, { nextAttemptAt: new Date(Date.now() + 5000).toISOString() }); return; }
    const defs = deployments.listStates().map(s => deployments.getActiveDefinition(s.integration, r.env)).filter(d => d?.trigger.type === "ebms" && d.trigger.credential === r.credential && (!d.trigger.service || d.trigger.service === r.service) && (!d.trigger.action || d.trigger.action === r.action));
    if (defs.length !== 1) { await this.repo.change(r, { nextAttemptAt: new Date(Date.now() + 5000).toISOString(), lastError: defs.length ? "Meerdere ebMS-processen voor deze service/actie; maak de filters eenduidig" : "Geen gedeployed ebMS-proces voor deze service/actie; wacht op deployment of handmatige ontvangst" }); return; }
    const def = defs[0]!;
    if (triggers.isPaused(r.env, def.integration)) { await this.repo.change(r, { nextAttemptAt: new Date(Date.now() + 5000).toISOString() }); return; }
    const targets = agentGroups.getTargets(def.integration, r.env);
    if (targets.groups.length !== 1) { await this.repo.change(r, { nextAttemptAt: new Date(Date.now() + 5000).toISOString(), lastError: "ebMS-ontvangst vereist precies één agentgroep om dubbele uitvoering via fan-out/failover te voorkomen" }); return; }
    const claimed = await this.repo.change(r, { state: "processing", integration: def.integration, version: def.version, leaseOwner: this.worker, leaseUntil: new Date(Date.now() + 300000).toISOString() });
    if (!claimed) return;
    const content = unseal(claimed), first = content.parts?.[0];
    const input = { payload: { xml: first ? Buffer.from(first.dataBase64, "base64").toString("utf8") : "" }, attachments: content.parts?.slice(1) || [], _ebms: { messageId: r.messageId, conversationId: r.conversationId, cpaId: r.cpaId, service: r.service, action: r.action, credential: r.credential }, _trigger: { type: "ebms", env: r.env, firedAt: now() } };
    // Keep long-running claims alive; a process interrupted after effects is never automatically rerun.
    const heartbeat = setInterval(() => { void this.repo.updateLatest(r.id, current => current.state === "processing" && current.leaseOwner === this.worker ? { leaseUntil: new Date(Date.now() + 300000).toISOString() } : {}).catch(() => undefined); }, 30000);
    heartbeat.unref();
    try {
      const run = await runDeployed(def, r.env, input, { triggeredBy: "ebms" });
      await this.repo.updateLatest(r.id, current => current.state === "processing" && current.leaseOwner === this.worker ? { state: run.status === "success" ? "processed" : "failed", runId: run.id, lastError: run.error, leaseOwner: undefined, leaseUntil: undefined } : {});
    } catch (e) { await this.repo.updateLatest(r.id, () => ({ state: "uncertain", lastError: (e as Error).message, leaseOwner: undefined, leaseUntil: undefined })); }
    finally { clearInterval(heartbeat); }
  }

  async status(credential: string, env: EnvName, id: string, box: "inbox" | "outbox" = "outbox") {
    const r = await this.repo.get(box, env, credential, id);
    if (!r) throw new Error("Bericht niet gevonden");
    const response = r.responseMessageId ? await this.repo.get("inbox", env, credential, r.responseMessageId) : undefined;
    return { ...this.repo.summary(r), protocolResponse: response ? unseal(response).incoming : undefined };
  }
  async wait(credential: string, env: EnvName, id: string, seconds: number) {
    if (!Number.isInteger(seconds) || seconds < 1 || seconds > 300) throw new Error("Wachttijd moet 1–300 seconden zijn");
    const deadline = Date.now() + seconds * 1000;
    for (;;) {
      const state = await this.status(credential, env, id);
      if (state.state === "delivered") return state;
      if (state.state === "failed") throw Object.assign(new Error(`ebMS-aflevering gefaald: ${state.lastError || "protocolfout"}`), { noRetry: true });
      if (Date.now() >= deadline) return { ...state, timedOut: true };
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  }
  async rejectMessage(credential: string, env: EnvName, wire: Buffer, ct: string, error: Error): Promise<PackedMessage | undefined> {
    const { values: v } = resolveConnection(credential, env);
    const m = inspectMessage(unpack(wire, ct).envelope);
    if (m.service === SIGNAL || m.cpaId !== v.cpaId || m.fromPartyId !== v.toPartyId || m.toPartyId !== v.fromPartyId) throw error;
    const code = /handtekening|Digest|certificaat|encrypt|cipher|GCM/i.test(error.message) ? "SecurityFailure" : /MIME|Manifest|payload/i.test(error.message) ? "MimeProblem" : /Service|Actie/i.test(error.message) ? "NotRecognized" : "Inconsistent";
    const reply = buildSignal(v, "MessageError", { conversationId: m.conversationId, refToMessageId: m.messageId, errorCode: code, description: "Bericht afgewezen op protocolcontrole" });
    audit.append({ actor: "ebms", event: "ebms.rejected", subject: m.messageId, data: { env, credential, code } });
    if (!m.syncReply) { await this.queueSignal(credential, env, reply, v); return undefined; }
    return reply;
  }
  async receiveNext(credential: string, env: EnvName) {
    const r = (await this.repo.all()).find(r => r.box === "inbox" && r.env === env && r.credential === credential && r.state === "received");
    if (!r) return { message: null };
    const claimed = await this.repo.change(r, { state: "processing", leaseOwner: `consumer:${randomUUID()}`, leaseUntil: new Date(Date.now() + 300000).toISOString() });
    if (!claimed) return { message: null };
    return { ...this.repo.summary(claimed), claimToken: claimed.leaseOwner, message: unseal(claimed).incoming, payloads: unseal(claimed).parts };
  }
  async complete(credential: string, env: EnvName, id: string, token: string) {
    const r = await this.repo.get("inbox", env, credential, id);
    if (!r || r.state !== "processing" || !r.leaseUntil || Date.parse(r.leaseUntil) <= Date.now() || !r.leaseOwner?.startsWith("consumer:") || token !== r.leaseOwner) throw new Error("Ongeldige of verlopen procesclaim");
    const updated = await this.repo.change(r, { state: "processed", leaseOwner: undefined, leaseUntil: undefined });
    if (!updated) throw new Error("Procesclaim is veranderd");
    return this.repo.summary(updated);
  }
  async redrive(credential: string, env: EnvName, id: string, box: "inbox" | "outbox") {
    const r = await this.repo.get(box, env, credential, id);
    if (!r || !["failed", "uncertain"].includes(r.state)) throw new Error("Alleen gefaalde/onzekere berichten kunnen opnieuw aangeboden worden");
    if (box === "outbox" && Date.parse(r.expiresAt) <= Date.now()) throw new Error("TimeToLive verlopen: maak een nieuw bericht met nieuwe MessageId");
    const updated = await this.repo.change(r, { state: box === "outbox" ? "queued" : "received", attempts: 0, nextAttemptAt: now(), leaseOwner: undefined, leaseUntil: undefined, lastError: undefined });
    if (!updated) throw new Error("Bericht inmiddels gewijzigd");
    audit.append({ actor: "ebms", event: "ebms.redrive", subject: id, data: { env, credential, box } });
    return this.repo.summary(updated);
  }
}
export const ebms = scoped("ebms", () => new EbmsManager());
