import { randomUUID } from "node:crypto";
import type { Element } from "@xmldom/xmldom";
import { EB, SOAP, DS, XLINK, SIGNAL, TO_PARTY, NEXT, esc, soapParts, children, one, text, parseXml, messageId, serialize } from "./xml";
import { pack, contentId, strictBase64, type PayloadPart, type PackedMessage } from "./mime";
import { encryptPart, signEnvelope, type SignatureReference } from "./security";

export const PROFILES = ["osb-be", "osb-rm", "osb-be-s", "osb-rm-s", "osb-be-e", "osb-rm-e"];
export function profile(v: Record<string, string>) {
  const name = v.profile || "osb-be";
  if (!PROFILES.includes(name)) throw new Error("Onbekend Digikoppeling-profiel");
  return { name, reliable: name.includes("-rm"), signed: /-[se]$/.test(name), encrypted: name.endsWith("-e") };
}
export function numberSetting(v: Record<string, string>, key: string, fallback: number, min: number, max: number): number {
  const value = Number(v[key] || fallback);
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < min || value > max) throw new Error(`Ongeldige instelling ${key}`);
  return value;
}
export function reliability(v: Record<string, string>) {
  const retries = numberSetting(v, "retries", 120, 0, 10000);
  const interval = numberSetting(v, "retryIntervalSeconds", 3600, 1, 604800);
  const ttl = numberSetting(v, "timeToLiveSeconds", 432000, 1, 31536000);
  const persist = numberSetting(v, "persistDurationSeconds", Math.max(604800, (retries + 1) * interval), 1, 31536000);
  if (persist < (retries + 1) * interval || persist < ttl) throw new Error("PersistDuration moet de volledige retry- en TTL-periode dekken");
  return { retries, interval, ttl, persist };
}
function party(tag: string, id: string, role: string, type: string): string {
  return `<eb:${tag}><eb:PartyId${type ? ` eb:type="${esc(type)}"` : ""}>${esc(id)}</eb:PartyId>${role ? `<eb:Role>${esc(role)}</eb:Role>` : ""}</eb:${tag}>`;
}
function headerXml(v: Record<string, string>, p: Record<string, unknown>, signal: boolean, id: string, conversation: string, now: string) {
  for (const k of ["fromPartyId", "toPartyId", "cpaId"]) if (!v[k]) throw new Error(`CPA-veld '${k}' ontbreekt`);
  const service = signal ? SIGNAL : v.service;
  const action = String(p.action || v.action || "");
  if (!service || !action) throw new Error("CPA-service/actie ontbreekt");
  if (!signal && !v.serviceType && !/^[a-z][a-z0-9+.-]*:/i.test(service)) throw new Error("Service zonder type moet een URI zijn");
  const ttl = !signal && profile(v).reliable ? new Date(Date.parse(now) + reliability(v).ttl * 1000).toISOString() : "";
  return `<eb:MessageHeader soap:mustUnderstand="1" eb:version="2.0">${party("From", v.fromPartyId, v.fromRole || "", v.partyIdType || "")}${party("To", v.toPartyId, v.toRole || "", v.partyIdType || "")}<eb:CPAId>${esc(v.cpaId)}</eb:CPAId><eb:ConversationId>${esc(conversation)}</eb:ConversationId><eb:Service${!signal && v.serviceType ? ` eb:type="${esc(v.serviceType)}"` : ""}>${esc(service)}</eb:Service><eb:Action>${esc(action)}</eb:Action><eb:MessageData><eb:MessageId>${esc(id)}</eb:MessageId><eb:Timestamp>${now}</eb:Timestamp>${p.refToMessageId ? `<eb:RefToMessageId>${esc(messageId(String(p.refToMessageId)))}</eb:RefToMessageId>` : ""}${ttl ? `<eb:TimeToLive>${ttl}</eb:TimeToLive>` : ""}</eb:MessageData>${!signal && profile(v).reliable ? "<eb:DuplicateElimination/>" : ""}</eb:MessageHeader>`;
}
function envelope(header: string, body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><soap:Envelope xmlns:soap="${SOAP}" xmlns:eb="${EB}" xmlns:xlink="${XLINK}" xmlns:ds="${DS}"><soap:Header>${header}</soap:Header><soap:Body>${body}</soap:Body></soap:Envelope>`;
}
export function buildMessage(v: Record<string, string>, p: Record<string, unknown>): PackedMessage {
  if (v.sendEnabled === "false") throw new Error("CPA staat alleen ontvangst toe");
  const action = String(p.action || v.action || "");
  if (!(v.sendActions || v.action || "").split(",").map(a => a.trim()).includes(action)) throw new Error("Verzendactie niet toegestaan door CPA");
  const prof = profile(v);
  const id = messageId(String(p.messageId || `${randomUUID()}@aip`));
  const conversation = String(p.conversationId || randomUUID());
  const payload = String(p.payload || ""); parseXml(payload);
  let parts: PayloadPart[] = [{ contentId: `${randomUUID()}@aip`, contentType: "application/xml; charset=UTF-8", data: Buffer.from(payload) }];
  const attachments = p.attachments ?? [];
  if (!Array.isArray(attachments) || attachments.length > 99) throw new Error("Bijlagen moeten een lijst zijn (maximaal 99)");
  for (const a of attachments) {
    if (!a || typeof a !== "object" || typeof a.dataBase64 !== "string") throw new Error("Bijlage vereist dataBase64");
    parts.push({ contentId: contentId(a.contentId || `${randomUUID()}@aip`), contentType: String(a.contentType || "application/octet-stream"), data: strictBase64(a.dataBase64) });
  }
  if (new Set(parts.map(p => p.contentId)).size !== parts.length) throw new Error("Dubbele Content-ID in bijlagen");
  if (prof.encrypted) parts = parts.map(p => encryptPart(p, v.encryptionCert || v.peerSigningCert));
  let header = headerXml(v, p, false, id, conversation, new Date().toISOString());
  if (prof.reliable) {
    header += `<eb:AckRequested soap:mustUnderstand="1" eb:version="2.0" eb:signed="${prof.signed}" soap:actor="${TO_PARTY}"/>`;
    if ((v.syncReplyMode || "mshSignalsOnly") === "mshSignalsOnly") header += `<eb:SyncReply soap:mustUnderstand="1" eb:version="2.0" soap:actor="${NEXT}"/>`;
    else if (v.syncReplyMode !== "none") throw new Error("Alleen syncReplyMode none/mshSignalsOnly ondersteund");
  }
  const body = `<eb:Manifest eb:version="2.0">${parts.map(p => `<eb:Reference xlink:type="simple" xlink:href="cid:${esc(p.contentId)}"/>`).join("")}</eb:Manifest>`;
  let xml = envelope(header, body);
  if (prof.signed) xml = signEnvelope(xml, parts, v);
  return { messageId: id, conversationId: conversation, envelope: xml, ...pack(xml, parts) };
}

export function inspectMessage(xml: string) {
  const { root, header, body } = soapParts(xml);
  const mh = one(header, EB, "MessageHeader")!;
  if (mh.getAttributeNS(EB, "version") !== "2.0" || mh.getAttributeNS(SOAP, "mustUnderstand") !== "1") throw new Error("ebMS 2.0 MessageHeader/mustUnderstand vereist");
  if (mh.getAttributeNS(SOAP, "actor")) throw new Error("MessageHeader actor niet toegestaan");
  const known = new Set(["MessageHeader", "Acknowledgment", "AckRequested", "SyncReply", "ErrorList"]);
  for (const n of Array.from(header.childNodes)) {
    if (n.nodeType !== 1) continue;
    const e = n as Element;
    if (e.getAttributeNS(SOAP, "mustUnderstand") === "1" && !(e.namespaceURI === EB && known.has(e.localName || "")) && !(e.namespaceURI === DS && e.localName === "Signature")) throw new Error("Niet ondersteunde mustUnderstand-header");
  }
  const data = one(mh, EB, "MessageData")!;
  const from = one(mh, EB, "From")!, to = one(mh, EB, "To")!;
  const fromId = one(from, EB, "PartyId")!, toId = one(to, EB, "PartyId")!;
  const ack = one(header, EB, "Acknowledgment", false), requested = one(header, EB, "AckRequested", false);
  const statusRequest = one(body, EB, "StatusRequest", false), statusResponse = one(body, EB, "StatusResponse", false);
  const manifest = one(body, EB, "Manifest", false);
  const timestamp = text(data, EB, "Timestamp");
  const ttl = text(data, EB, "TimeToLive", false);
  if (!Number.isFinite(Date.parse(timestamp)) || ttl && !Number.isFinite(Date.parse(ttl))) throw new Error("Ongeldige Timestamp/TimeToLive");
  const id = messageId(text(data, EB, "MessageId"));
  const serviceElement = one(mh, EB, "Service")!;
  const service = text(mh, EB, "Service"), action = text(mh, EB, "Action");
  const errors = one(header, EB, "ErrorList", false), fault = one(body, SOAP, "Fault", false);
  if (requested && !["true", "false"].includes(requested.getAttributeNS(EB, "signed") || "")) throw new Error("AckRequested signed ontbreekt");
  if (requested && ![null, "", TO_PARTY].includes(requested.getAttributeNS(SOAP, "actor"))) throw new Error("Alleen end-to-end AckRequested ondersteund");
  const ref = text(data, EB, "RefToMessageId", false);
  if (ref) messageId(ref);
  if (service === SIGNAL) {
    if (!["Acknowledgment", "MessageError", "StatusRequest", "StatusResponse", "Ping", "Pong"].includes(action)) throw new Error("Onbekende ebMS-protocolactie");
    if (requested || manifest) throw new Error("Protocolbericht mag geen AckRequested of Manifest bevatten");
    if (action === "Acknowledgment" && (!ack || text(ack, EB, "RefToMessageId") !== ref)) throw new Error("Acknowledgment-correlatie ontbreekt of verschilt");
    if (action === "MessageError" && (!errors || !ref)) throw new Error("MessageError mist ErrorList/correlatie");
    if (action === "StatusRequest" && !statusRequest || action === "StatusResponse" && !statusResponse) throw new Error("Status-element ontbreekt");
  } else if (!manifest && !fault) throw new Error("Zakelijk bericht mist Manifest");
  if ([ack, errors, statusRequest, statusResponse].filter(Boolean).length > 1) throw new Error("Onverenigbare protocol-elementen");
  return {
    messageId: id, conversationId: text(mh, EB, "ConversationId"), cpaId: text(mh, EB, "CPAId"), service, serviceType: serviceElement.getAttributeNS(EB, "type") || "", action,
    fromPartyId: fromId.textContent?.trim() || "", toPartyId: toId.textContent?.trim() || "", fromPartyIdType: fromId.getAttributeNS(EB, "type") || "", toPartyIdType: toId.getAttributeNS(EB, "type") || "",
    fromRole: text(from, EB, "Role", false), toRole: text(to, EB, "Role", false), timestamp, timeToLive: ttl, refToMessageId: ref,
    acknowledgment: ack ? { refToMessageId: text(ack, EB, "RefToMessageId"), timestamp: text(ack, EB, "Timestamp"), references: children(ack, DS, "Reference").map(r => ({ uri: r.getAttribute("URI") || "", digest: text(r, DS, "DigestValue") })) } : undefined,
    ackRequested: !!requested, signedAckRequested: requested?.getAttributeNS(EB, "signed") === "true", syncReply: !!one(header, EB, "SyncReply", false), duplicateElimination: !!one(mh, EB, "DuplicateElimination", false),
    errors: errors ? children(errors, EB, "Error").map(e => ({ code: e.getAttributeNS(EB, "errorCode") || e.getAttribute("errorCode"), severity: e.getAttributeNS(EB, "severity") || e.getAttribute("severity"), description: e.textContent })) : undefined,
    fault: fault ? serialize(fault) : undefined,
    statusRequest: statusRequest ? text(statusRequest, EB, "RefToMessageId") : undefined,
    statusResponse: statusResponse ? { refToMessageId: text(statusResponse, EB, "RefToMessageId"), status: statusResponse.getAttributeNS(EB, "messageStatus") || statusResponse.getAttribute("messageStatus") } : undefined,
    references: manifest ? children(manifest, EB, "Reference").map(r => r.getAttributeNS(XLINK, "href") || "") : [],
    envelope: serialize(root),
  };
}
export type InspectedMessage = ReturnType<typeof inspectMessage>;

export function buildSignal(v: Record<string, string>, action: string, opts: { conversationId?: string; refToMessageId?: string; receivedAt?: string; references?: SignatureReference[]; signed?: boolean; targetMessageId?: string; status?: string; errorCode?: string; description?: string } = {}): PackedMessage {
  const id = `${randomUUID()}@aip`, conversation = opts.conversationId || randomUUID();
  let header = headerXml(v, { action, refToMessageId: opts.refToMessageId }, true, id, conversation, new Date().toISOString());
  let body = "";
  if (action === "Acknowledgment") header += `<eb:Acknowledgment soap:mustUnderstand="1" eb:version="2.0"><eb:Timestamp>${esc(opts.receivedAt || new Date().toISOString())}</eb:Timestamp><eb:RefToMessageId>${esc(opts.refToMessageId)}</eb:RefToMessageId>${(opts.references || []).map(r => r.xml).join("")}</eb:Acknowledgment>`;
  if (action === "MessageError") header += `<eb:ErrorList soap:mustUnderstand="1" eb:version="2.0" eb:highestSeverity="Error"><eb:Error eb:codeContext="urn:oasis:names:tc:ebxml-msg:service:errors" eb:errorCode="${esc(opts.errorCode || "Inconsistent")}" eb:severity="Error"><eb:Description xml:lang="nl">${esc(opts.description || "Bericht afgewezen")}</eb:Description></eb:Error></eb:ErrorList>`;
  if (action === "StatusRequest" || action === "StatusResponse") body = `<eb:${action} eb:version="2.0"${action === "StatusResponse" ? ` eb:messageStatus="${esc(opts.status || "NotRecognized")}"` : ""}><eb:RefToMessageId>${esc(messageId(opts.targetMessageId || ""))}</eb:RefToMessageId>${opts.receivedAt ? `<eb:Timestamp>${esc(opts.receivedAt)}</eb:Timestamp>` : ""}</eb:${action}>`;
  let xml = envelope(header, body);
  if (opts.signed ?? profile(v).signed) xml = signEnvelope(xml, [], v);
  return { messageId: id, conversationId: conversation, envelope: xml, ...pack(xml, []) };
}

export function validatePartner(m: InspectedMessage, v: Record<string, string>, parts: PayloadPart[]): void {
  if (m.cpaId !== v.cpaId || m.fromPartyId !== v.toPartyId || m.toPartyId !== v.fromPartyId) throw new Error("CPA of PartyId komt niet overeen met koppeling");
  if (v.partyIdType && (m.fromPartyIdType !== v.partyIdType || m.toPartyIdType !== v.partyIdType)) throw new Error("PartyId type komt niet overeen met CPA");
  if (v.toRole && m.fromRole !== v.toRole || v.fromRole && m.toRole !== v.fromRole) throw new Error("Rollen komen niet overeen met CPA");
  if (m.service !== SIGNAL) {
    if (v.receiveEnabled === "false") throw new Error("CPA staat geen zakelijke ontvangst toe");
    if (m.service !== (v.receiveService || v.service) || m.serviceType !== (v.receiveServiceType || v.serviceType || "")) throw new Error("Service komt niet overeen met CPA");
    const actions = (v.receiveAction || v.action || "").split(",").map(a => a.trim());
    if (!actions.includes(m.action)) throw new Error("Actie niet toegestaan door CPA");
    const prof = profile(v);
    if (prof.reliable && (!m.ackRequested || !m.duplicateElimination)) throw new Error("Reliable profiel vereist AckRequested/DuplicateElimination");
    if (prof.signed && prof.reliable && !m.signedAckRequested) throw new Error("Profiel vereist signed acknowledgment");
    if (m.signedAckRequested && !prof.signed) throw new Error("Signed acknowledgment niet afgesproken in CPA");
    if (m.syncReply !== (prof.reliable && (v.syncReplyMode || "mshSignalsOnly") === "mshSignalsOnly")) throw new Error("SyncReply wijkt af van CPA");
    if (m.references.length !== parts.length || new Set(m.references).size !== parts.length) throw new Error("Manifest en MIME-parts verschillen");
    for (const ref of m.references) if (!ref.startsWith("cid:") || !parts.some(p => `cid:${p.contentId}` === ref)) throw new Error("Manifest verwijst naar ontbrekende of externe payload");
    if (!parts.length) throw new Error("XML-payload ontbreekt");
  } else if (parts.length) throw new Error("Protocolbericht mag geen MIME-payload hebben");
}
