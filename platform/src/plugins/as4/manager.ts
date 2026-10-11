import { randomUUID } from "node:crypto";
import { credentials, encrypt, decrypt } from "../../connectors/credentials";
import { persistence } from "../../store";
import { scoped } from "../../tenancy/context";
import { ENVIRONMENTS, type EnvName } from "../../domain/environments";
import { deployments } from "../../domain/deployments";
import { agentGroups } from "../../runtime/agentGroups";
import { runDeployed } from "../../runtime/dispatch";
import { triggers } from "../../triggers/manager";
import { audit } from "../../audit/auditLog";
import { MAX_BYTES } from "../ebms/xml";
import { normalize, buildMmd, inspectDelivery, validateDelivery, type Submission, type Delivery, type Part } from "./formats";
import { directories, safeDirectory, files, readSafe, publish, digest } from "./spool";

export type State = "queued" | "publishing" | "submitted" | "accepted" | "delivered" | "received" | "processing" | "processed" | "failed" | "uncertain";
export interface RecordDoc { id: string; box: "inbox" | "outbox"; env: EnvName; credential: string; messageId: string; conversationId: string; service: string; action: string; pmodeId: string; state: State; createdAt: string; updatedAt: string; fingerprint: string; encrypted: string; leaseOwner?: string; leaseUntil?: string; nextAttemptAt: string; lastError?: string; runId?: string; responseMessageId?: string; receiptType?: string }
interface Content { submission?: Submission; delivery?: Delivery; parts?: Part[]; xml?: string; sourceFile?: string }
const COLLECTION = "as4-messages";
const now = () => new Date().toISOString();
const stable = (x: unknown): string => JSON.stringify(x, (_k, v) => v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v);
const idFor = (box: string, env: string, cred: string, id: string) => digest(JSON.stringify([box, env, cred, id]));
const seal = (x: Content) => encrypt(JSON.stringify(x));
export const contentOf = (r: RecordDoc): Content => JSON.parse(decrypt(r.encrypted));
export function resolveAs4(credential: string, env: EnvName) {
  if (credentials.pluginOf(credential) !== "as4") throw new Error("Geen AS4-plugin-koppeling");
  const { plugins } = require("../registry") as typeof import("../registry");
  const { withDefaults } = require("../runtime") as typeof import("../runtime");
  return withDefaults(plugins.get("as4")!, credentials.resolve(credential, env).values);
}
function active(v: Record<string, string>) {
  if (v.enabled !== "true") throw new Error("AS4-koppeling niet geactiveerd");
  if (persistence.kind === "memory" && process.env.NODE_ENV === "production") throw new Error("AS4 vereist duurzame opslag in productie");
}
export async function checkAs4(credential: string, env: EnvName, v = resolveAs4(credential, env)) {
  for (const k of ["pmodeId", "fromPartyId", "toPartyId", "fromRole", "toRole", "service", "action"]) if (!v[k]?.trim() || v[k].length > 4096) throw new Error(`AS4-koppelingsveld ${k} ontbreekt of is ongeldig`);
  const d = directories(credential, env);
  await safeDirectory(d.root, d.out); await safeDirectory(d.root, d.incoming);
  return { configured: true, enabled: v.enabled === "true", backend: "as4-file", pmodeId: v.pmodeId, outDirectory: d.out, deliveryDirectory: d.incoming, gatewayVerified: false, note: "Controleer in AS4 Gateway dat P-Mode, certificaten en file-backend actief zijn" };
}
export class As4Manager {
  private worker = randomUUID();
  private timer?: NodeJS.Timeout;
  private ticking = false;
  private dispatching = new Map<string, Promise<void>>();
  async all(): Promise<RecordDoc[]> { return (await persistence.loadAll(COLLECTION)).map(r => r.doc as RecordDoc); }
  async get(box: "inbox" | "outbox", env: EnvName, cred: string, msg: string) { return (await this.all()).find(r => r.id === idFor(box, env, cred, msg)); }
  summary(r: RecordDoc) { const { encrypted, fingerprint, leaseOwner, ...meta } = r; return { ...meta, gatewayAccepted: r.box === "outbox" && ["accepted", "delivered"].includes(r.state), deliveryConfirmed: r.box === "outbox" && r.state === "delivered" }; }
  async change(r: RecordDoc, patch: Partial<RecordDoc>) { const next = { ...r, ...patch, updatedAt: now() }; return await persistence.replace(COLLECTION, r.id, r, next) ? next : undefined; }
  private async update(id: string, fn: (r: RecordDoc) => Partial<RecordDoc>) {
    for (let i = 0; i < 12; i++) { const r = (await this.all()).find(r => r.id === id); if (!r) throw new Error("AS4-record ontbreekt"); const result = await this.change(r, fn(r)); if (result) return result; }
    throw new Error("AS4-record gelijktijdig gewijzigd; probeer opnieuw");
  }
  start() { if (!this.timer) { this.timer = setInterval(() => { void this.tick(false).catch(e => audit.append({ actor: "as4", event: "as4.worker.error", data: { error: (e as Error).message } })); }, 2000); this.timer.unref(); } }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = undefined; }
  async hydrate() { await this.all(); }
  async enqueue(cred: string, env: EnvName, p: Record<string, unknown>) {
    const v = resolveAs4(cred, env); active(v);
    if (v.sendEnabled === "false") throw new Error("AS4-verzending uitgeschakeld");
    const submission = normalize(v, p);
    // Omitted conversation IDs must not change the intent of an explicit MessageId retry.
    const intent = { ...submission, conversationId: p.conversationId || "", parts: submission.parts };
    const fingerprint = digest(stable(intent));
    const existing = await this.get("outbox", env, cred, submission.messageId);
    if (existing) { if (existing.fingerprint !== fingerprint) throw new Error("AS4-MessageId bestaat met andere inhoud/configuratie"); return this.summary(existing); }
    const time = now();
    const r: RecordDoc = { id: idFor("outbox", env, cred, submission.messageId), box: "outbox", env, credential: cred, messageId: submission.messageId, conversationId: submission.conversationId, service: submission.service, action: submission.action, pmodeId: submission.pmodeId, state: "queued", createdAt: time, updatedAt: time, nextAttemptAt: time, fingerprint, encrypted: seal({ submission }) };
    if (!await persistence.create(COLLECTION, r.id, r)) { const winner = await this.get("outbox", env, cred, submission.messageId); if (!winner || winner.fingerprint !== fingerprint) throw new Error("AS4-MessageId bestaat met andere inhoud"); return this.summary(winner); }
    await this.submit(r);
    return this.summary((await this.get("outbox", env, cred, r.messageId))!);
  }
  private async markers(r: RecordDoc): Promise<"accepted" | "failed" | "present" | "missing"> {
    const names = await files(directories(r.credential, r.env).out);
    const start = `aip-${r.id}`;
    if (names.some(n => n === `${start}.accepted` || n.startsWith(`${start}.accepted.`))) return "accepted";
    if (names.some(n => n === `${start}.rejected` || n.startsWith(`${start}.rejected.`))) return "failed";
    if (names.some(n => n === `${start}.mmd` || n.startsWith(`${start}_`) && n.endsWith(".processing"))) return "present";
    return "missing";
  }
  private async submit(r: RecordDoc) {
    const v = resolveAs4(r.credential, r.env); if (v.enabled !== "true") return; active(v);
    const d = directories(r.credential, r.env); await checkAs4(r.credential, r.env, v);
    const claimed = await this.change(r, { state: "publishing", leaseOwner: this.worker, leaseUntil: new Date(Date.now() + 60000).toISOString() });
    if (!claimed) return;
    try {
      const s = contentOf(claimed).submission!;
      const locations = s.parts.map((_p, i) => `aip-${r.id}-payload-${i}.bin`);
      for (let i = 0; i < s.parts.length; i++) await publish(d.out, locations[i], Buffer.from(s.parts[i].dataBase64, "base64"));
      await publish(d.out, `aip-${r.id}.mmd`, buildMmd(s, locations));
      await this.update(r.id, current => current.state === "publishing" ? { state: "submitted", leaseOwner: undefined, leaseUntil: undefined } : {});
      audit.append({ actor: "as4", event: "as4.submitted", subject: r.messageId, data: { env: r.env, credential: r.credential } });
    } catch {
      // Publishing and gateway consumption cannot share a transaction. Never silently resubmit.
      await this.update(r.id, current => current.state === "publishing" ? { state: "uncertain", lastError: "Publicatie onderbroken; controleer AS4 Gateway en spool vóór opnieuw aanbieden", leaseOwner: undefined, leaseUntil: undefined } : {});
    }
  }
  async ingest(cred: string, env: EnvName, sourceFile: string) {
    const v = resolveAs4(cred, env); active(v);
    const d = directories(cred, env); await safeDirectory(d.root, d.incoming);
    const xml = (await readSafe(d.incoming, sourceFile)).toString("utf8"), delivery = inspectDelivery(xml);
    validateDelivery(delivery, v);
    const parts: Part[] = []; let size = 0;
    for (const p of delivery.payloads) { const data = await readSafe(d.incoming, p.location, MAX_BYTES - size); size += data.length; parts.push({ contentId: p.contentId, contentType: p.contentType, dataBase64: data.toString("base64"), properties: p.properties }); }
    // File locations may differ on a repeated gateway delivery; compare semantic content.
    const fingerprint = digest(stable({ delivery: { ...delivery, payloads: delivery.payloads.map(({ location, properties, ...rest }) => ({ ...rest, properties: Object.fromEntries(Object.entries(properties).filter(([k]) => k !== "org:holodeckb2b:location")) })) }, parts: parts.map(p => ({ ...p, properties: Object.fromEntries(Object.entries(p.properties || {}).filter(([k]) => k !== "org:holodeckb2b:location")) })) }));
    const time = now();
    const r: RecordDoc = { id: idFor("inbox", env, cred, delivery.messageId), box: "inbox", env, credential: cred, messageId: delivery.messageId, conversationId: delivery.conversationId, service: delivery.service, action: delivery.action, pmodeId: delivery.pmodeId, state: delivery.kind === "user" ? "received" : "processed", createdAt: time, updatedAt: time, nextAttemptAt: time, fingerprint, encrypted: seal({ delivery, parts, xml, sourceFile }) };
    if (!await persistence.create(COLLECTION, r.id, r)) { const prior = await this.get("inbox", env, cred, delivery.messageId); if (!prior || prior.fingerprint !== fingerprint) throw new Error("AS4-duplicaat met gewijzigde inhoud"); }
    if (delivery.kind !== "user") await this.signal(cred, env, delivery);
    return this.summary((await this.get("inbox", env, cred, delivery.messageId))!);
  }
  private async signal(cred: string, env: EnvName, d: Delivery) {
    const outgoing = await this.get("outbox", env, cred, d.refToMessageId);
    if (!outgoing) throw new Error("AS4-signaal verwijst niet naar bekend uitgaand bericht");
    if (d.kind === "receipt") {
      await this.update(outgoing.id, r => r.state === "delivered" ? {} : { state: "delivered", responseMessageId: d.messageId, receiptType: d.receiptType, lastError: undefined, leaseOwner: undefined, leaseUntil: undefined });
    } else if (d.errors.some(e => /^(failure|fatal)$/i.test(e.severity))) {
      await this.update(outgoing.id, r => r.state === "delivered" ? {} : { state: "failed", responseMessageId: d.messageId, lastError: d.errors.map(e => e.code).join(", "), leaseOwner: undefined, leaseUntil: undefined });
    }
  }
  async scan(cred: string, env: EnvName) {
    const v = resolveAs4(cred, env); active(v); await checkAs4(cred, env, v);
    const d = directories(cred, env), entries = await files(d.incoming);
    const result = { imported: 0, errors: [] as Array<{ file: string; error: string }> };
    // Files remain in the trusted gateway spool; the ledger prevents repeat ingestion.
    const known = new Set((await this.all()).filter(r => r.box === "inbox" && r.env === env && r.credential === cred).map(r => contentOf(r).sourceFile));
    for (const file of entries.filter(n => n.startsWith("mi-") && n.endsWith(".xml") && !known.has(n)).slice(0, 100)) {
      try { await this.ingest(cred, env, file); result.imported++; } catch (e) { result.errors.push({ file, error: (e as Error).message }); }
    }
    // Retry signal application after a crash between durable receipt and correlation.
    for (const r of (await this.all()).filter(r => r.box === "inbox" && r.env === env && r.credential === cred && !r.action)) { const d = contentOf(r).delivery; if (d && d.kind !== "user") await this.signal(cred, env, d).catch(() => undefined); }
    return result;
  }
  async tick(wait = true) {
    if (this.ticking) return; this.ticking = true;
    try {
      for (const c of credentials.list().filter(c => c.plugin === "as4")) for (const env of ENVIRONMENTS) {
        let v: Record<string, string>;
        try { v = resolveAs4(c.name, env); } catch { continue; }
        if (v.enabled !== "true") continue;
        try { const result = await this.scan(c.name, env); if (result.errors.length) audit.append({ actor: "as4", event: "as4.scan.rejected", subject: c.name, data: { env, errors: result.errors } }); }
        catch (e) { audit.append({ actor: "as4", event: "as4.scan.error", subject: c.name, data: { env, error: (e as Error).message } }); }
      }
      for (const r of await this.all()) {
        if (r.state === "queued") await this.submit(r);
        if (["submitted", "accepted", "publishing"].includes(r.state)) {
          const v = resolveAs4(r.credential, r.env); if (v.enabled !== "true") continue;
          const marker = await this.markers(r);
          if (marker === "accepted" && r.state !== "accepted") await this.change(r, { state: "accepted", leaseOwner: undefined, leaseUntil: undefined });
          else if (marker === "failed") await this.change(r, { state: "failed", lastError: "AS4 Gateway heeft de MMD-submission geweigerd; zie gateway .err-bestand", leaseOwner: undefined, leaseUntil: undefined });
          else if (r.state === "publishing" && Date.parse(r.leaseUntil || "") <= Date.now()) await this.change(r, { state: marker === "present" ? "submitted" : "uncertain", lastError: marker === "present" ? undefined : "Publicatieclaim verlopen; controleer gateway vóór opnieuw aanbieden", leaseOwner: undefined, leaseUntil: undefined });
        }
        if (r.state === "received" && Date.parse(r.nextAttemptAt) <= Date.now() && this.dispatching.size < 8 && !this.dispatching.has(r.id)) {
          const task = this.dispatch(r).catch(e => { audit.append({ actor: "as4", event: "as4.dispatch.error", subject: r.messageId, data: { error: (e as Error).message } }); }).finally(() => this.dispatching.delete(r.id)); this.dispatching.set(r.id, task);
        }
        if (r.state === "processing" && Date.parse(r.leaseUntil || "") <= Date.now()) await this.change(r, { state: "uncertain", lastError: "Procesclaim verlopen; beoordeel eerdere effecten vóór opnieuw verwerken" });
      }
      if (wait) await Promise.all(this.dispatching.values());
    } finally { this.ticking = false; }
  }
  private async dispatch(r: RecordDoc) {
    const v = resolveAs4(r.credential, r.env); if (v.enabled !== "true") return; active(v);
    const defs = deployments.listStates().map(s => deployments.getActiveDefinition(s.integration, r.env)).filter(d => d?.trigger.type === "as4" && d.trigger.credential === r.credential && (!d.trigger.service || d.trigger.service === r.service) && (!d.trigger.action || d.trigger.action === r.action));
    if (defs.length !== 1 || triggers.isPaused(r.env, defs[0]!.integration) || agentGroups.getTargets(defs[0]!.integration, r.env).groups.length !== 1) { await this.change(r, { nextAttemptAt: new Date(Date.now() + 5000).toISOString(), lastError: "Ontvangst wacht op precies één actief AS4-proces met één agentgroep" }); return; }
    const claimed = await this.change(r, { state: "processing", leaseOwner: this.worker, leaseUntil: new Date(Date.now() + 300000).toISOString(), lastError: undefined }); if (!claimed) return;
    const content = contentOf(claimed), parts = content.parts || [], first = parts[0];
    const input = { payload: { dataBase64: first?.dataBase64 || "", contentType: first?.contentType || "", ...(first && /(?:xml|text\/)/i.test(first.contentType) ? { xml: Buffer.from(first.dataBase64, "base64").toString("utf8") } : {}) }, attachments: parts.slice(1), _as4: { messageId: r.messageId, conversationId: r.conversationId, pmodeId: r.pmodeId, service: r.service, action: r.action, credential: r.credential, properties: content.delivery?.properties }, _trigger: { type: "as4", env: r.env, firedAt: now() } };
    const heartbeat = setInterval(() => { void this.update(r.id, current => current.state === "processing" && current.leaseOwner === this.worker ? { leaseUntil: new Date(Date.now() + 300000).toISOString() } : {}).catch(() => undefined); }, 30000); heartbeat.unref();
    try {
      const run = await runDeployed(defs[0]!, r.env, input, { triggeredBy: "as4" });
      await this.update(r.id, current => current.state === "processing" && current.leaseOwner === this.worker ? { state: run.status === "success" ? "processed" : "failed", runId: run.id, lastError: run.error, leaseOwner: undefined, leaseUntil: undefined } : {});
    } catch { await this.update(r.id, () => ({ state: "uncertain", lastError: "Procesuitvoering onderbroken; beoordeel eerdere effecten", leaseOwner: undefined, leaseUntil: undefined })); }
    finally { clearInterval(heartbeat); }
  }
  async status(cred: string, env: EnvName, msg: string, box: "inbox" | "outbox" = "outbox") { const r = await this.get(box, env, cred, msg); if (!r) throw new Error("AS4-bericht niet gevonden"); return this.summary(r); }
  async receiveNext(cred: string, env: EnvName) {
    active(resolveAs4(cred, env));
    const r = (await this.all()).find(r => r.box === "inbox" && r.env === env && r.credential === cred && r.state === "received"); if (!r) return { message: null };
    const claimed = await this.change(r, { state: "processing", leaseOwner: `consumer:${randomUUID()}`, leaseUntil: new Date(Date.now() + 300000).toISOString() });
    return claimed ? { ...this.summary(claimed), claimToken: claimed.leaseOwner, message: contentOf(claimed).delivery, payloads: contentOf(claimed).parts } : { message: null };
  }
  async complete(cred: string, env: EnvName, msg: string, token: string) {
    const r = await this.get("inbox", env, cred, msg);
    if (!r || r.state !== "processing" || !r.leaseOwner?.startsWith("consumer:") || token !== r.leaseOwner || Date.parse(r.leaseUntil || "") <= Date.now()) throw new Error("Ongeldige of verlopen AS4-claim");
    const updated = await this.change(r, { state: "processed", leaseOwner: undefined, leaseUntil: undefined }); if (!updated) throw new Error("AS4-claim gewijzigd"); return this.summary(updated);
  }
  async redrive(cred: string, env: EnvName, msg: string, box: "inbox" | "outbox") {
    active(resolveAs4(cred, env)); const r = await this.get(box, env, cred, msg);
    if (!r || !["failed", "uncertain"].includes(r.state)) throw new Error("Alleen gefaalde/onzekere AS4-berichten kunnen opnieuw aangeboden worden");
    // Gateway owns transport retries. Republishing a consumed MessageId is ambiguous.
    if (box === "outbox") throw new Error("Controleer/herstel uitgaande verzending in AS4 Gateway; maak uitsluitend na beoordeling een nieuw bericht met nieuwe MessageId");
    const updated = await this.change(r, { state: "received", nextAttemptAt: now(), leaseOwner: undefined, leaseUntil: undefined, lastError: undefined }); if (!updated) throw new Error("AS4-record gewijzigd"); return this.summary(updated);
  }
}
export const as4 = scoped("as4", () => new As4Manager());
