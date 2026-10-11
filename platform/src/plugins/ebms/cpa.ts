import type { Element, Node } from "@xmldom/xmldom";
import { parseXml, children, one, text } from "./xml";
import { profile, reliability } from "./protocol";

export const CPPA = "http://www.oasis-open.org/committees/ebxml-cppa/schema/cpp-cpa-2_0.xsd";
const attr = (e: Element, name: string) => e.getAttributeNS(CPPA, name) || e.getAttribute(name) || "";
function descendants(n: Node, name: string): Element[] { return Array.from((n as Element).getElementsByTagNameNS(CPPA, name)); }
export function durationSeconds(value: string): number {
  const m = value.match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/);
  if (!m || !m.slice(1).some(Boolean)) throw new Error("CPA-duur moet dagen/uren/minuten/seconden bevatten");
  const seconds = Number(m[1] || 0) * 86400 + Number(m[2] || 0) * 3600 + Number(m[3] || 0) * 60 + Number(m[4] || 0);
  if (!Number.isInteger(seconds) || seconds < 1) throw new Error("CPA-duur moet minimaal één hele seconde zijn");
  return seconds;
}
export function inspectCpa(xml: string) {
  const doc = parseXml(xml), root = doc.documentElement!;
  if (root.namespaceURI !== CPPA || root.localName !== "CollaborationProtocolAgreement") throw new Error("CPPA 2.0 CollaborationProtocolAgreement vereist");
  const cpaId = attr(root, "cpaid");
  if (!cpaId) throw new Error("CPA-ID ontbreekt");
  const status = one(root, CPPA, "Status", false);
  if (status && attr(status, "value") !== "agreed") throw new Error("CPA moet status agreed hebben");
  const start = text(root, CPPA, "Start", false), end = text(root, CPPA, "End", false);
  for (const date of [start, end].filter(Boolean)) if (!Number.isFinite(Date.parse(date))) throw new Error("Ongeldige CPA-datum");
  if (start && Date.parse(start) > Date.now() || end && Date.parse(end) <= Date.now()) throw new Error("CPA is nog niet geldig of verlopen");
  const parties = children(root, CPPA, "PartyInfo");
  if (parties.length !== 2) throw new Error("CPA moet twee partijen bevatten");
  const partyViews = parties.map(p => {
    const ids = descendants(p, "PartyId");
    if (!ids.length) throw new Error("CPA PartyId ontbreekt");
    const bindings = descendants(p, "ServiceBinding").flatMap(s => {
      const service = one(s, CPPA, "Service")!;
      return ["CanSend", "CanReceive"].flatMap(direction => children(s, CPPA, direction).map(d => {
        const binding = one(d, CPPA, "ThisPartyActionBinding")!;
        const channelIds = children(binding, CPPA, "ChannelId").map(c => c.textContent?.trim() || "");
        return { direction, id: attr(binding, "id"), otherPartyBinding: text(d, CPPA, "OtherPartyActionBinding", false), service: service.textContent?.trim() || "", serviceType: attr(service, "type"), action: attr(binding, "action"), channelIds };
      }));
    });
    return { partyIds: ids.map(id => ({ id: id.textContent?.trim() || "", type: attr(id, "type") })), bindings };
  });
  return { cpaId, start, end, parties: partyViews, root, partyElements: parties };
}

// Select one unambiguous outbound action/channel. All unsupported CPA modes fail closed.
export function cpaSettings(xml: string, selector: { fromPartyId: string; toPartyId?: string; service?: string; action?: string; channelId?: string; profile?: string; direction?: "send" | "receive" }) {
  const cpa = inspectCpa(xml);
  const ownIndex = cpa.parties.findIndex(p => p.partyIds.some(id => id.id === selector.fromPartyId));
  if (ownIndex < 0) throw new Error("Eigen PartyId staat niet in CPA");
  const own = cpa.partyElements[ownIndex], peer = cpa.partyElements[1 - ownIndex];
  const ownView = cpa.parties[ownIndex], peerView = cpa.parties[1 - ownIndex];
  const peerId = selector.toPartyId ? peerView.partyIds.find(i => i.id === selector.toPartyId) : peerView.partyIds.length === 1 ? peerView.partyIds[0] : undefined;
  if (!peerId) throw new Error("Kies een eenduidige ontvangende PartyId");
  const ownId = ownView.partyIds.find(i => i.id === selector.fromPartyId)!;
  if (ownId.type !== peerId.type) throw new Error("Verschillende PartyId-types vereisen aparte CPA-configuratie");
  const direction = selector.direction || (ownView.bindings.some(b => b.direction === "CanSend") ? "send" : "receive");
  const sends = ownView.bindings.filter(b => b.direction === (direction === "send" ? "CanSend" : "CanReceive") && (!selector.service || b.service === selector.service) && (!selector.action || b.action === selector.action));
  if (sends.length !== 1) throw new Error("Kies één CPA-service en actie");
  const send = sends[0];
  const channels = send.channelIds.filter(id => !selector.channelId || id === selector.channelId);
  if (channels.length !== 1) throw new Error("Kies één CPA-channel");
  const byId = (party: Element, name: string, id: string) => {
    const elements = descendants(party, name).filter(e => attr(e, name === "Transport" ? "transportId" : name === "DocExchange" ? "docExchangeId" : "channelId") === id);
    if (elements.length !== 1) throw new Error(`CPA ${name} ${id} ontbreekt of is dubbel`);
    return elements[0];
  };
  const channel = byId(own, "DeliveryChannel", channels[0]);
  const exchangeId = attr(channel, "docExchangeId");
  const remoteBindings = peerView.bindings.filter(b => b.direction === (direction === "send" ? "CanReceive" : "CanSend") && b.service === send.service && b.action === send.action && (!send.otherPartyBinding || b.id === send.otherPartyBinding));
  if (remoteBindings.length !== 1 || remoteBindings[0].channelIds.length !== 1) throw new Error("CPA mist een eenduidige bijpassende ontvangbinding/channel bij partner");
  const remoteChannel = byId(peer, "DeliveryChannel", direction === "receive" && attr(peer, "defaultMshChannelId") ? attr(peer, "defaultMshChannelId") : remoteBindings[0].channelIds[0]);
  const transport = byId(peer, "Transport", attr(remoteChannel, "transportId"));
  const receiverTransport = one(transport, CPPA, "TransportReceiver")!;
  const endpoints = children(receiverTransport, CPPA, "Endpoint");
  if (endpoints.length !== 1) throw new Error("CPA moet één ontvangendpoint voor channel bevatten");
  const endpoint = attr(endpoints[0], "uri");
  if (!endpoint.startsWith("https://")) throw new Error("CPA vereist HTTPS-endpoint");
  const exchange = byId(own, "DocExchange", exchangeId);
  const senderBinding = one(exchange, CPPA, direction === "send" ? "ebXMLSenderBinding" : "ebXMLReceiverBinding")!;
  const characteristic = one(channel, CPPA, "MessagingCharacteristics", false);
  const sync = characteristic ? attr(characteristic, "syncReplyMode") || "none" : "none";
  if (!["none", "mshSignalsOnly"].includes(sync)) throw new Error("CPA SyncReplyMode wordt niet ondersteund");
  const ordered = characteristic ? attr(characteristic, "messageOrderSemantics") : "";
  if (ordered && ordered !== "NotGuaranteed") throw new Error("Gegarandeerde message order wordt niet ondersteund");
  const rm = children(senderBinding, CPPA, "ReliableMessaging");
  if (rm.length > 1) throw new Error("Meerdere ReliableMessaging-instellingen: selecteer een afzonderlijke koppeling");
  const signing = descendants(senderBinding, direction === "send" ? "SenderNonRepudiation" : "ReceiverNonRepudiation").length > 0 || descendants(senderBinding, "NonRepudiation").length > 0;
  const encryption = descendants(senderBinding, direction === "send" ? "SenderDigitalEnvelope" : "ReceiverDigitalEnvelope").length > 0 || descendants(senderBinding, "DigitalEnvelope").length > 0;
  const inferred = `osb-${rm.length ? "rm" : "be"}${encryption ? "-e" : signing ? "-s" : ""}`;
  if (selector.profile && selector.profile !== inferred) throw new Error("Gekozen profiel wijkt af van CPA-beveiliging/betrouwbaarheid");
  const out: Record<string, string> = { cpaId: cpa.cpaId, fromPartyId: selector.fromPartyId, toPartyId: peerId.id, partyIdType: ownId.type, service: send.service, serviceType: send.serviceType, action: send.action, endpoint, profile: inferred, syncReplyMode: sync, cpaStart: cpa.start, cpaEnd: cpa.end, sendEnabled: direction === "send" ? "true" : "false", receiveEnabled: "false", receiveService: "", receiveServiceType: "", receiveAction: "", sendActions: send.action };
  const roleFor = (party: Element, direction: string) => {
    const roles = descendants(party, "CollaborationRole").filter(role => descendants(role, direction).some(d => {
      const b = one(d, CPPA, "ThisPartyActionBinding", false); return b && attr(b, "action") === send.action;
    }));
    if (roles.length === 1) return attr(one(roles[0], CPPA, "Role")!, "name");
    if (roles.length > 1) throw new Error("Ambigue CPA-rollen");
    return "";
  };
  out.fromRole = roleFor(own, direction === "send" ? "CanSend" : "CanReceive"); out.toRole = roleFor(peer, direction === "send" ? "CanReceive" : "CanSend");
  const receives = direction === "receive" ? [send] : ownView.bindings.filter(b => b.direction === "CanReceive");
  if (receives.length === 1) { out.receiveEnabled = "true"; out.receiveService = receives[0].service; out.receiveServiceType = receives[0].serviceType; out.receiveAction = receives[0].action; }
  if (receives.length > 1) throw new Error("CPA heeft meerdere ontvangacties: maak afzonderlijke koppelingen of configureer ontvangst expliciet");
  if (rm.length) {
    out.retries = text(rm[0], CPPA, "Retries");
    out.retryIntervalSeconds = String(durationSeconds(text(rm[0], CPPA, "RetryInterval")));
    const messageOrder = text(rm[0], CPPA, "MessageOrderSemantics", false);
    if (messageOrder && messageOrder !== "NotGuaranteed") throw new Error("Gegarandeerde message order wordt niet ondersteund");
    if (characteristic) {
      const ack = attr(characteristic, "ackRequested"), elimination = attr(characteristic, "duplicateElimination"), actor = attr(characteristic, "actor");
      if (ack && ack !== "always" || elimination && elimination !== "always" || actor && actor !== "urn:oasis:names:tc:ebxml-msg:actor:toPartyMSH") throw new Error("CPA vereist een niet ondersteunde reliable messaging-combinatie");
    }
    const duration = text(senderBinding, CPPA, "PersistDuration", false) || text(rm[0], CPPA, "PersistDuration", false);
    if (duration) out.persistDurationSeconds = String(durationSeconds(duration));
    out.timeToLiveSeconds = String((Number(out.retries) + 1) * Number(out.retryIntervalSeconds));
  }
  profile(out); if (profile(out).reliable) reliability(out);
  return out;
}
