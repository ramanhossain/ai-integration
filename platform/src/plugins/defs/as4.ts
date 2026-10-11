import type { PluginDef } from "../types";
import { P } from "./_shared";
const msg = [P("payload", "Tekst/XML-payload (of dataBase64)", { type: "text" }), P("dataBase64", "Binaire hoofdpayload (base64)", { type: "text" }), P("contentType", "MIME-type hoofdpayload", { default: "application/xml" }), P("messageId", "MessageId (id@domein; hergebruik bij procesretry)"), P("conversationId", "ConversationId"), P("refToMessageId", "Antwoord op MessageId"), P("action", "Actie (standaard koppeling)"), P("properties", "Berichtproperties {naam: waarde}", { type: "json" }), P("attachments", "Bijlagen [{contentId, contentType, dataBase64, properties}]", { type: "json" })];
const reference = [P("messageId", "MessageId", { required: true }), P("box", "Inbox/outbox", { type: "select", options: ["inbox", "outbox"], default: "outbox" })];
export const AS4: PluginDef[] = [{
  id: "as4", name: "AS4 Gateway", category: "Ontwikkeling", color: "#154273",
  description: "AS4 / ebMS3 via AS4 Gateway: duurzame bestandskoppeling, P-Mode, receipts, binaire bijlagen en procesontvangst. AS4 Gateway verzorgt WS-Security, encryptie, compressie en transportretries.",
  website: "https://holodeck-b2b.org", docs: "https://github.com/holodeck-b2b/Holodeck-B2B", baseUrl: "", auth: { type: "custom", signer: "as4", fields: [], help: "Kies een AS4-koppeling. Configureer P-Mode, WS-Security en certificaten in AS4 Gateway. De spoolmappen zijn gescheiden per organisatie, omgeving en koppeling." },
  fields: [
    { key: "pmodeId", label: "AS4 Gateway P-Mode-ID" }, { key: "fromPartyId", label: "Eigen PartyId" }, { key: "toPartyId", label: "Partner PartyId" }, { key: "partyIdType", label: "PartyId type (optioneel)" },
    { key: "fromRole", label: "Eigen rol", default: "Sender" }, { key: "toRole", label: "Partnerrol", default: "Receiver" },
    { key: "service", label: "Service" }, { key: "serviceType", label: "Service type (optioneel)" }, { key: "action", label: "Standaard actie" }, { key: "agreement", label: "AgreementRef (optioneel)" },
    { key: "sendActions", label: "Toegestane verzendacties (komma-gescheiden, standaard actie)" }, { key: "receiveService", label: "Ontvangservice (standaard service)" }, { key: "receiveServiceType", label: "Ontvangservice type" }, { key: "receiveActions", label: "Toegestane ontvangacties (komma-gescheiden, standaard actie)" },
    { key: "sendEnabled", label: "Zakelijke verzending toegestaan (true/false)", default: "true" }, { key: "receiveEnabled", label: "Zakelijke ontvangst toegestaan (true/false)", default: "true" }, { key: "enabled", label: "Geactiveerd (true/false)", default: "false" },
  ],
  operations: [
    { id: "message.build", resource: "Bericht", label: "AS4 Gateway MMD opbouwen (zonder publiceren)", method: "POST", path: "", driver: "as4:build", params: msg },
    { id: "message.send", resource: "Bericht", label: "AS4-bericht aan AS4 Gateway aanbieden", method: "POST", path: "", driver: "as4:send", params: msg },
    { id: "message.list", resource: "Bericht", label: "Inbox/outbox bekijken", method: "GET", path: "", driver: "as4:list", params: [P("box", "Inbox/outbox", { type: "select", options: ["inbox", "outbox"] })] },
    { id: "message.status", resource: "Bericht", label: "Lokale AS4-status", method: "GET", path: "", driver: "as4:status", params: reference },
    { id: "message.wait", resource: "Bericht", label: "Wachten op partnerreceipt", method: "GET", path: "", driver: "as4:wait", params: [P("messageId", "MessageId", { required: true }), P("timeoutSeconds", "Wachttijd 1–300 seconden", { type: "number", default: 30 })] },
    { id: "message.scan", resource: "Bericht", label: "AS4 Gateway-ontvangmap nu inlezen", method: "POST", path: "", driver: "as4:scan" },
    { id: "message.inspect", resource: "Bericht", label: "AS4 Gateway ebMS3-delivery XML inspecteren", method: "POST", path: "", driver: "as4:inspect", params: [P("xml", "Delivery XML", { type: "text", required: true })] },
    { id: "message.receive", resource: "Bericht", label: "Volgend inboxbericht claimen (5 minuten)", method: "POST", path: "", driver: "as4:receive" },
    { id: "message.complete", resource: "Bericht", label: "Inboxclaim afronden", method: "POST", path: "", driver: "as4:complete", params: [P("messageId", "MessageId", { required: true }), P("claimToken", "Claimtoken", { required: true })] },
    { id: "message.redrive", resource: "Bericht", label: "Gefaalde/onzekere inboxverwerking opnieuw aanbieden", description: "Beoordeel eerdere zakelijke effecten. Uitgaand herstel loopt via AS4 Gateway.", method: "POST", path: "", driver: "as4:redrive", params: reference.map(p => p.name === "box" ? { ...p, default: "inbox" } : p) },
    { id: "pmode.inspect", resource: "P-Mode", label: "AS4 Gateway P-Mode inspecteren", method: "POST", path: "", driver: "as4:pmode-inspect", params: [P("xml", "P-Mode XML", { type: "text", required: true })] },
    { id: "connection.check", resource: "Koppeling", label: "Configuratie en spoolmappen controleren", method: "GET", path: "", driver: "as4:check" },
    { id: "connection.activate", resource: "Koppeling", label: "AS4-koppeling activeren", method: "POST", path: "", driver: "as4:activate" },
    { id: "connection.deactivate", resource: "Koppeling", label: "AS4-koppeling deactiveren", method: "POST", path: "", driver: "as4:deactivate" },
  ], test: "connection.check",
}];
