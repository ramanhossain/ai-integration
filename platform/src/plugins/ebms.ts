import { createPrivateKey } from "node:crypto";
import type { DriverCtx, DriverResult } from "./drivers";
import { credentials } from "../connectors/credentials";
import { audit } from "../audit/auditLog";
import { isEnv } from "../domain/environments";
import { ebms, resolveConnection } from "./ebms/manager";
import { buildMessage, inspectMessage, profile, reliability } from "./ebms/protocol";
import { checkedCert } from "./ebms/security";
import { unpack, strictBase64 } from "./ebms/mime";
import { inspectCpa, cpaSettings } from "./ebms/cpa";

export const buildEbms = buildMessage;
export const inspectEbms = inspectMessage;
export function checkConnection(v: Record<string, string>) {
  for (const key of ["endpoint", "fromPartyId", "toPartyId", "cpaId", "cert", "privateKey", "peerTlsCert"]) if (!v[key]) throw new Error(`Koppelingsveld ${key} ontbreekt`);
  const url = new URL(v.endpoint);
  if (url.protocol !== "https:" || url.username || url.password || url.hash) throw new Error("HTTPS-endpoint zonder gebruikersgegevens of fragment vereist");
  if (v.replyEndpoint) { const r = new URL(v.replyEndpoint); if (r.protocol !== "https:" || r.username || r.password || r.hash) throw new Error("Ongeldig HTTPS-replyEndpoint"); }
  const prof = profile(v); reliability(v);
  const cert = checkedCert(v.cert);
  if (!cert.checkPrivateKey(createPrivateKey({ key: v.privateKey, passphrase: v.passphrase || undefined }))) throw new Error("Transportcertificaat en sleutel passen niet bij elkaar");
  checkedCert(v.peerTlsCert);
  if (prof.signed) {
    const signing = checkedCert(v.signingCert || v.cert);
    if (!signing.checkPrivateKey(createPrivateKey({ key: v.signingKey || v.privateKey, passphrase: v.signingPassphrase || v.passphrase || undefined }))) throw new Error("Signingcertificaat en sleutel passen niet bij elkaar");
    checkedCert(v.peerSigningCert);
  }
  if (prof.encrypted) checkedCert(v.encryptionCert || v.peerSigningCert);
  if (v.ingressToken && v.ingressToken.length < 32) throw new Error("Ingress-token moet minimaal 32 tekens bevatten");
  if (!v.service && !v.receiveService || !v.action && !v.receiveAction) throw new Error("CPA-service/actie voor verzenden of ontvangen ontbreekt");
  for (const key of ["cpaStart", "cpaEnd"]) if (v[key] && !Number.isFinite(Date.parse(v[key]))) throw new Error(`Ongeldige ${key}`);
  if (v.cpaStart && Date.parse(v.cpaStart) > Date.now() || v.cpaEnd && Date.parse(v.cpaEnd) <= Date.now()) throw new Error("CPA is verlopen of nog niet geldig");
  return { configured: true, enabled: v.enabled === "true", profile: prof.name, certificateValidUntil: cert.validTo, tlsTrust: "CA-validatie plus vast partnercertificaat", signing: prof.signed, encryption: prof.encrypted };
}
export async function ebmsDriver(action: string, c: DriverCtx): Promise<DriverResult> {
  const { values: v, params: p } = c;
  if (action === "build") return { data: buildMessage(v, p), target: "ebms:build" };
  if (action === "inspect") return { data: inspectMessage(String(p.xml)), target: "ebms:inspect" };
  if (action === "unpack") {
    const decoded = unpack(strictBase64(String(p.dataBase64)), String(p.contentType));
    return { data: { message: inspectMessage(decoded.envelope), parts: decoded.parts.map(part => ({ contentId: part.contentId, contentType: part.contentType, dataBase64: part.data.toString("base64") })) }, target: "ebms:unpack" };
  }
  if (action === "cpa-inspect") {
    const { root, partyElements, ...view } = inspectCpa(String(p.xml));
    return { data: view, target: "ebms:cpa" };
  }
  if (action === "cpa-import" || action === "cpa-validate") {
    const settings = cpaSettings(String(p.xml), { fromPartyId: String(p.fromPartyId || v.fromPartyId || ""), toPartyId: String(p.toPartyId || v.toPartyId || ""), service: p.service ? String(p.service) : undefined, action: p.action ? String(p.action) : undefined, channelId: p.channelId ? String(p.channelId) : undefined, direction: p.direction === "receive" ? "receive" : p.direction === "send" ? "send" : undefined });
    if (action === "cpa-validate") return { data: { valid: true, settings }, target: "ebms:cpa" };
    const split = c.credKey.indexOf(":"), env = c.credKey.slice(0, split), credential = c.credKey.slice(split + 1);
    if (!isEnv(env) || credential === "-") throw new Error("CPA-import vereist een koppeling");
    credentials.patchValues(credential, env, { ...settings, enabled: "false" }, "ebms-cpa-import");
    audit.append({ actor: "ebms", event: "ebms.cpa.imported", subject: credential, data: { env, cpaId: settings.cpaId } });
    return { data: { imported: true, enabled: false, settings }, target: "ebms:cpa" };
  }
  const split = c.credKey.indexOf(":"), env = c.credKey.slice(0, split), credential = c.credKey.slice(split + 1);
  if (!isEnv(env) || credential === "-") throw new Error("ebMS-operatie vereist een koppeling");
  resolveConnection(credential, env);
  let data: unknown;
  switch (action) {
    case "check": data = checkConnection(v); break;
    case "activate": checkConnection(v); credentials.patchValues(credential, env, { enabled: "true" }, "ebms-activate"); data = { enabled: true }; break;
    case "deactivate": credentials.patchValues(credential, env, { enabled: "false" }, "ebms-deactivate"); data = { enabled: false }; break;
    case "send": data = await ebms.enqueue(credential, env, p); break;
    case "ping": data = await ebms.requestSignal(credential, env, "Ping"); break;
    case "status-request": data = await ebms.requestSignal(credential, env, "StatusRequest", String(p.messageId)); break;
    case "status": data = await ebms.status(credential, env, String(p.messageId), p.box === "inbox" ? "inbox" : "outbox"); break;
    case "wait": data = await ebms.wait(credential, env, String(p.messageId), Number(p.timeoutSeconds || 30)); break;
    case "receive": data = await ebms.receiveNext(credential, env); break;
    case "complete": data = await ebms.complete(credential, env, String(p.messageId), String(p.claimToken)); break;
    case "redrive": data = await ebms.redrive(credential, env, String(p.messageId), p.box === "inbox" ? "inbox" : "outbox"); break;
    case "list": data = (await ebms.repo.all()).filter(r => r.env === env && r.credential === credential && (!p.box || r.box === p.box)).map(r => ebms.repo.summary(r)); break;
    default: throw new Error("Onbekende ebMS-operatie");
  }
  return { data, target: "ebms:message-service" };
}
