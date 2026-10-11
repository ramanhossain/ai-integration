import type { DriverCtx, DriverResult } from "./drivers";
import { isEnv } from "../domain/environments";
import { credentials } from "../connectors/credentials";
import { audit } from "../audit/auditLog";
import { as4, checkAs4, resolveAs4 } from "./as4/manager";
import { normalize, buildMmd, inspectDelivery, inspectPmode } from "./as4/formats";
export async function as4Driver(action: string, c: DriverCtx): Promise<DriverResult> {
  const p = c.params, split = c.credKey.indexOf(":"), env = c.credKey.slice(0, split), cred = c.credKey.slice(split + 1);
  if (action === "inspect") return { data: inspectDelivery(String(p.xml)), target: "as4:inspect" };
  if (action === "pmode-inspect") return { data: inspectPmode(String(p.xml)), target: "as4:pmode" };
  if (!isEnv(env) || cred === "-") throw new Error("AS4-operatie vereist een plugin-koppeling");
  const v = resolveAs4(cred, env);
  let data: unknown;
  switch (action) {
    case "build": { const s = normalize(v, p); data = { messageId: s.messageId, conversationId: s.conversationId, mmd: buildMmd(s, s.parts.map((_p, i) => `payload-${i}.bin`)), parts: s.parts, protocol: "AS4 Gateway submission metadata; AS4 wire wordt door de gateway gemaakt" }; break; }
    case "check": data = await checkAs4(cred, env, v); break;
    case "activate": case "deactivate": {
      if (action === "activate") await checkAs4(cred, env, v);
      credentials.patchValues(cred, env, { enabled: action === "activate" ? "true" : "false" }, "as4");
      audit.append({ actor: "as4", event: `as4.${action}`, subject: cred, data: { env } }); data = { enabled: action === "activate" }; break;
    }
    case "send": data = await as4.enqueue(cred, env, p); break;
    case "scan": data = await as4.scan(cred, env); break;
    case "status": data = await as4.status(cred, env, String(p.messageId), p.box === "inbox" ? "inbox" : "outbox"); break;
    case "list": data = (await as4.all()).filter(r => r.env === env && r.credential === cred && (!p.box || r.box === p.box)).map(r => as4.summary(r)); break;
    case "receive": data = await as4.receiveNext(cred, env); break;
    case "complete": data = await as4.complete(cred, env, String(p.messageId), String(p.claimToken)); break;
    case "redrive": data = await as4.redrive(cred, env, String(p.messageId), p.box === "outbox" ? "outbox" : "inbox"); break;
    case "wait": {
      const seconds = Number(p.timeoutSeconds || 30); if (!Number.isInteger(seconds) || seconds < 1 || seconds > 300) throw new Error("Wachttijd moet 1–300 seconden zijn");
      const deadline = Date.now() + seconds * 1000;
      for (;;) { const s = await as4.status(cred, env, String(p.messageId)); if (s.deliveryConfirmed) { data = s; break; } if (["failed", "uncertain"].includes(s.state)) throw new Error(`AS4-aflevering ${s.state}: ${s.lastError || "zie gateway"}`); if (Date.now() >= deadline) { data = { ...s, timedOut: true }; break; } await new Promise(r => setTimeout(r, 250)); }
      break;
    }
    default: throw new Error("Onbekende AS4-operatie");
  }
  return { data, target: "as4:gateway" };
}
