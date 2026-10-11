import { randomUUID } from "node:crypto";
import type { Element } from "@xmldom/xmldom";
import { parseXml, children, one, text, esc, messageId, MAX_BYTES } from "../ebms/xml";
import { strictBase64 } from "../ebms/mime";

export const EB3 = "http://docs.oasis-open.org/ebxml-msg/ebms/v3.0/ns/core/200704/";
export const MMD = "http://holodeck-b2b.org/schemas/2014/06/mmd";
export const PMODE = "http://holodeck-b2b.org/schemas/2014/10/pmode";
export interface Part { contentId: string; contentType: string; dataBase64: string; properties?: Record<string, string> }
export interface Submission { messageId: string; conversationId: string; refToMessageId?: string; pmodeId: string; fromPartyId: string; toPartyId: string; partyIdType: string; fromRole: string; toRole: string; service: string; serviceType: string; action: string; agreement: string; properties: Record<string, string>; parts: Part[] }
export interface Delivery { kind: "user" | "receipt" | "error"; messageId: string; refToMessageId: string; conversationId: string; pmodeId: string; service: string; serviceType: string; action: string; fromPartyId: string; toPartyId: string; fromType: string; toType: string; fromRole: string; toRole: string; properties: Record<string, string>; payloads: Array<{ contentId: string; contentType: string; location: string; properties: Record<string, string> }>; errors: Array<{ code: string; severity: string; description: string }>; receiptType?: string }
const value = (v: unknown) => String(v ?? "");
const bounded = (s: string, label: string, required = false) => { if (s.length > 4096 || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(s) || required && !s.trim()) throw new Error(`Ongeldige ${label}`); return s; };
export function properties(v: unknown): Record<string, string> {
  if (v === undefined || v === null || v === "") return {};
  if (!v || typeof v !== "object" || Array.isArray(v) || Object.keys(v).length > 100) throw new Error("Properties moeten een object met maximaal 100 waarden zijn");
  return Object.fromEntries(Object.entries(v).map(([k, x]) => { if (typeof x !== "string") throw new Error("Propertywaarden moeten tekst zijn"); return [bounded(k, "propertynaam", true), bounded(x, "propertywaarde", true)]; }));
}
function readProperties(e: Element | undefined, ns = EB3): Record<string, string> {
  const entries = e ? children(e, ns, "Property").map(p => [bounded(p.getAttribute("name") || "", "propertynaam", true), bounded(p.textContent || "", "propertywaarde", true)]) : [];
  if (entries.length > 100 || new Set(entries.map(p => p[0])).size !== entries.length) throw new Error("Dubbele of te veel properties");
  return Object.fromEntries(entries);
}
export function normalize(v: Record<string, string>, p: Record<string, unknown>): Submission {
  const id = messageId(value(p.messageId || `${randomUUID()}@aip`));
  const action = bounded(value(p.action || v.action), "actie", true);
  if (!(v.sendActions || v.action || "").split(",").map(a => a.trim()).includes(action)) throw new Error("Actie niet toegestaan voor AS4-koppeling");
  if (p.payload !== undefined && p.dataBase64 !== undefined) throw new Error("Gebruik payload of dataBase64");
  const parts: Part[] = [];
  if (p.payload !== undefined || p.dataBase64 !== undefined) parts.push({ contentId: messageId(value(p.contentId || "payload@aip")), contentType: value(p.contentType || "application/xml"), dataBase64: p.dataBase64 !== undefined ? strictBase64(value(p.dataBase64)).toString("base64") : Buffer.from(value(p.payload)).toString("base64") });
  if (p.attachments !== undefined && !Array.isArray(p.attachments)) throw new Error("Bijlagen moeten een array zijn");
  for (const item of (p.attachments || []) as unknown[]) {
    if (!item || typeof item !== "object") throw new Error("Ongeldige bijlage");
    const x = item as Record<string, unknown>;
    parts.push({ contentId: messageId(value(x.contentId)), contentType: value(x.contentType || "application/octet-stream"), dataBase64: strictBase64(value(x.dataBase64)).toString("base64"), properties: properties(x.properties) });
  }
  if (!parts.length || parts.length > 100 || new Set(parts.map(x => x.contentId)).size !== parts.length) throw new Error("Eén tot 100 payloads met unieke ContentId vereist");
  let size = 0;
  for (const part of parts) {
    if (!/^[\w!#$&^.+-]+\/[\w!#$&^.+-]+(?:;[^\r\n<>]*)?$/.test(part.contentType)) throw new Error("Ongeldig MIME-type");
    if (part.properties?.MimeType && part.properties.MimeType !== part.contentType) throw new Error("MimeType-property wijkt af van contentType");
    part.properties = { ...part.properties, MimeType: part.contentType };
    size += Buffer.byteLength(part.dataBase64, "base64");
  }
  if (size > MAX_BYTES) throw new Error("AS4-payloads groter dan 20 MiB");
  const out: Submission = { messageId: id, conversationId: bounded(value(p.conversationId || `${randomUUID()}@aip`), "ConversationId", true), refToMessageId: p.refToMessageId ? messageId(value(p.refToMessageId)) : undefined, pmodeId: v.pmodeId, fromPartyId: v.fromPartyId, toPartyId: v.toPartyId, partyIdType: v.partyIdType || "", fromRole: v.fromRole, toRole: v.toRole, service: v.service, serviceType: v.serviceType || "", action, agreement: v.agreement || "", properties: properties(p.properties), parts };
  for (const key of ["pmodeId", "fromPartyId", "toPartyId", "fromRole", "toRole", "service"] as const) bounded(out[key], key, true);
  for (const key of ["partyIdType", "serviceType", "agreement"] as const) bounded(out[key], key);
  return out;
}
const propsXml = (p: Record<string, string>) => Object.entries(p).map(([k, v]) => `<Property name="${esc(k)}">${esc(v)}</Property>`).join("");
export function buildMmd(s: Submission, locations: string[]): string {
  if (locations.length !== s.parts.length) throw new Error("Payloadlocaties komen niet overeen");
  const type = s.partyIdType ? ` type="${esc(s.partyIdType)}"` : "";
  return `<?xml version="1.0" encoding="UTF-8"?><MessageMetaData xmlns="${MMD}"><MessageInfo><MessageId>${esc(s.messageId)}</MessageId>${s.refToMessageId ? `<RefToMessageId>${esc(s.refToMessageId)}</RefToMessageId>` : ""}</MessageInfo><PartyInfo><From><PartyId${type}>${esc(s.fromPartyId)}</PartyId><Role>${esc(s.fromRole)}</Role></From><To><PartyId${type}>${esc(s.toPartyId)}</PartyId><Role>${esc(s.toRole)}</Role></To></PartyInfo><CollaborationInfo><AgreementRef pmode="${esc(s.pmodeId)}">${esc(s.agreement)}</AgreementRef><Service${s.serviceType ? ` type="${esc(s.serviceType)}"` : ""}>${esc(s.service)}</Service><Action>${esc(s.action)}</Action><ConversationId>${esc(s.conversationId)}</ConversationId></CollaborationInfo>${Object.keys(s.properties).length ? `<MessageProperties>${propsXml(s.properties)}</MessageProperties>` : ""}<PayloadInfo deleteFilesAfterSubmit="false">${s.parts.map((part, i) => `<PartInfo containment="attachment" uri="${esc(part.contentId)}" mimeType="${esc(part.contentType)}" location="${esc(locations[i])}">${part.properties && Object.keys(part.properties).length ? `<PartProperties>${propsXml(part.properties)}</PartProperties>` : ""}</PartInfo>`).join("")}</PayloadInfo></MessageMetaData>`;
}

export function inspectDelivery(xml: string): Delivery {
  const root = parseXml(xml).documentElement!;
  if (root.namespaceURI !== EB3 || root.localName !== "Messaging") throw new Error("AS4 Gateway ebms-deliveryformaat vereist (ebMS3 Messaging)");
  const units = [...children(root, EB3, "UserMessage"), ...children(root, EB3, "SignalMessage")];
  if (units.length !== 1 || Array.from(root.childNodes).filter(n => n.nodeType === 1).length !== 1) throw new Error("Exact één bericht per deliverybestand vereist");
  const unit = units[0], info = one(unit, EB3, "MessageInfo")!;
  const out: Delivery = { kind: unit.localName === "UserMessage" ? "user" : "receipt", messageId: messageId(text(info, EB3, "MessageId")), refToMessageId: text(info, EB3, "RefToMessageId", false), conversationId: "", pmodeId: "", service: "", serviceType: "", action: "", fromPartyId: "", toPartyId: "", fromType: "", toType: "", fromRole: "", toRole: "", properties: {}, payloads: [], errors: [] };
  if (out.kind === "user") {
    const party = one(unit, EB3, "PartyInfo")!, from = one(party, EB3, "From")!, to = one(party, EB3, "To")!;
    const fromId = one(from, EB3, "PartyId")!, toId = one(to, EB3, "PartyId")!;
    out.fromPartyId = fromId.textContent!.trim(); out.toPartyId = toId.textContent!.trim(); out.fromType = fromId.getAttribute("type") || ""; out.toType = toId.getAttribute("type") || "";
    out.fromRole = text(from, EB3, "Role"); out.toRole = text(to, EB3, "Role");
    const c = one(unit, EB3, "CollaborationInfo")!, service = one(c, EB3, "Service")!;
    out.pmodeId = one(c, EB3, "AgreementRef")!.getAttribute("pmode") || "";
    out.service = service.textContent!.trim(); out.serviceType = service.getAttribute("type") || ""; out.action = text(c, EB3, "Action"); out.conversationId = text(c, EB3, "ConversationId");
    out.properties = readProperties(one(unit, EB3, "MessageProperties", false));
    out.payloads = children(one(unit, EB3, "PayloadInfo")!, EB3, "PartInfo").map(p => {
      const properties = readProperties(one(p, EB3, "PartProperties")!);
      const location = properties["org:holodeckb2b:location"];
      if (!location) throw new Error("Lokale payloadlocatie ontbreekt");
      const href = p.getAttribute("href") || "";
      if (href && !href.startsWith("cid:") && !href.startsWith("#")) throw new Error("Externe AS4-payloads worden niet ingelezen");
      return { contentId: href || "#body", contentType: properties.MimeType || (!href || href.startsWith("#") ? "application/xml" : "application/octet-stream"), location, properties };
    });
    if (!out.payloads.length || out.payloads.length > 100 || new Set(out.payloads.map(p => p.contentId)).size !== out.payloads.length) throw new Error("Ongeldige payloadreferenties");
  } else {
    messageId(out.refToMessageId);
    const receipts = children(unit, EB3, "Receipt"), errors = children(unit, EB3, "Error");
    if (receipts.length === 1 && !errors.length) {
      out.receiptType = text(receipts[0], "http://holodeck-b2b.org/schemas/2015/08/delivery/ebms/receiptchild", "ReceiptChild");
      if (!["{http://docs.oasis-open.org/ebxml-bp/ebbp-signals-2.0}NonRepudiationInformation", `{${EB3}}UserMessage`].includes(out.receiptType)) throw new Error("Onbekend receipttype");
    } else if (!receipts.length && errors.length) {
      out.kind = "error"; out.errors = errors.map(e => ({ code: e.getAttribute("errorCode") || "", severity: e.getAttribute("severity") || "", description: text(e, EB3, "Description", false) }));
    } else throw new Error("Receipt of Error vereist");
  }
  return out;
}
export function validateDelivery(d: Delivery, v: Record<string, string>) {
  if (d.kind !== "user") return;
  if (v.receiveEnabled === "false") throw new Error("Zakelijke AS4-ontvangst is uitgeschakeld");
  if (d.pmodeId !== v.pmodeId || d.fromPartyId !== v.toPartyId || d.toPartyId !== v.fromPartyId || d.fromType !== (v.partyIdType || "") || d.toType !== (v.partyIdType || "") || d.fromRole !== v.toRole || d.toRole !== v.fromRole) throw new Error("AS4-delivery past niet bij P-Mode/partijen/rollen");
  if (d.service !== (v.receiveService || v.service) || d.serviceType !== (v.receiveServiceType || v.serviceType || "") || !(v.receiveActions || v.action).split(",").map(a => a.trim()).includes(d.action)) throw new Error("AS4-service/actie niet toegestaan");
}
export function inspectPmode(xml: string) {
  const root = parseXml(xml).documentElement!;
  if (root.namespaceURI !== PMODE || root.localName !== "PMode") throw new Error("AS4 Gateway PMode XML vereist");
  const legs = children(root, PMODE, "Leg");
  return { id: text(root, PMODE, "id"), mep: text(root, PMODE, "mep"), mepBinding: text(root, PMODE, "mepBinding"), legs: legs.map(l => {
    const protocol = one(l, PMODE, "Protocol", false), receipt = one(l, PMODE, "Receipt", false);
    return { address: protocol ? text(protocol, PMODE, "Address", false) : "", notifyReceipt: !!receipt && text(receipt, PMODE, "NotifyReceiptToBusinessApplication", false) === "true", compression: Array.from(l.getElementsByTagNameNS(PMODE, "UseAS4Compression")).some(e => e.textContent === "true") };
  }), signing: root.getElementsByTagNameNS(PMODE, "Signing").length > 0, encryption: root.getElementsByTagNameNS(PMODE, "Encryption").length > 0 };
}
