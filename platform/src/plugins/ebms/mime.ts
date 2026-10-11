import { randomUUID } from "node:crypto";
import { MAX_BYTES, parseXml } from "./xml";

export interface PayloadPart { contentId: string; contentType: string; data: Buffer }
export interface PackedMessage { envelope: string; wire: string; contentType: string; messageId: string; conversationId: string }
const safeHeader = (value: string) => {
  if (!value || /[\r\n\x00-\x1f]/.test(value)) throw new Error("Ongeldige MIME-header");
  return value;
};
export function contentId(id: string): string {
  if (!/^[A-Za-z0-9_.@+-]{1,200}$/.test(id)) throw new Error("Ongeldige MIME Content-ID");
  return id;
}
export function strictBase64(s: string): Buffer {
  const value = s.replace(/[\r\n\t ]/g, "");
  if (value.length % 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw new Error("Ongeldige base64");
  const data = Buffer.from(value, "base64");
  if (data.toString("base64") !== value) throw new Error("Niet-canonieke base64");
  return data;
}
export function pack(envelope: string, parts: PayloadPart[]): { wire: string; contentType: string } {
  if (!parts.length) return { wire: envelope, contentType: "text/xml; charset=UTF-8" };
  const boundary = `aip_${randomUUID()}`, rootId = `${randomUUID()}@aip`;
  const all = [{ contentId: rootId, contentType: "text/xml; charset=UTF-8", data: Buffer.from(envelope) }, ...parts];
  const wire = all.map(p => `--${boundary}\r\nContent-Type: ${safeHeader(p.contentType)}\r\nContent-ID: <${contentId(p.contentId)}>\r\nContent-Transfer-Encoding: base64\r\n\r\n${(p.data.toString("base64").match(/.{1,76}/g) || []).join("\r\n")}\r\n`).join("") + `--${boundary}--\r\n`;
  if (Buffer.byteLength(wire) > MAX_BYTES) throw new Error("Bericht inclusief MIME-codering groter dan 20 MiB");
  return { wire, contentType: `multipart/related; type="text/xml"; start="<${rootId}>"; boundary="${boundary}"` };
}
function parameter(ct: string, name: string): string | undefined {
  const matches = [...ct.matchAll(new RegExp(`(?:^|;)\\s*${name}\\s*=\\s*(?:"([^"]*)"|([^;\\s]+))`, "gi"))];
  if (matches.length > 1) throw new Error(`Dubbele MIME-parameter ${name}`);
  return matches[0]?.[1] ?? matches[0]?.[2];
}
export function unpack(wire: Buffer | string, ct: string): { envelope: string; parts: PayloadPart[] } {
  const bytes = Buffer.isBuffer(wire) ? wire : Buffer.from(wire);
  if (bytes.length > MAX_BYTES) throw new Error("Bericht groter dan 20 MiB");
  if (/^(?:text|application)\/xml\b/i.test(ct)) {
    const envelope = bytes.toString("utf8"); parseXml(envelope);
    return { envelope, parts: [] };
  }
  if (!/^multipart\/related\b/i.test(ct)) throw new Error("Verwacht SOAP XML of multipart/related");
  const boundary = parameter(ct, "boundary");
  if (!boundary || !/^[A-Za-z0-9'()+_,.\/:=? -]{1,70}$/.test(boundary)) throw new Error("Ongeldige MIME-boundary");
  const binary = bytes.toString("latin1");
  // Only delimiter lines are boundaries; binary attachments containing the token remain intact.
  const quoted = boundary.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const delimiters = [...binary.matchAll(new RegExp(`(?:^|\\r\\n)--${quoted}(--)?[ \\t]*(?:\\r\\n|$)`, "g"))];
  if (delimiters.length < 2 || !delimiters.at(-1)![1] || delimiters.slice(0, -1).some(d => d[1])) throw new Error("Onvolledig MIME-bericht");
  if (delimiters.length > 102) throw new Error("Te veel MIME-parts");
  const parts: PayloadPart[] = [];
  for (let i = 0; i < delimiters.length - 1; i++) {
    const raw = binary.slice(delimiters[i].index! + delimiters[i][0].length, delimiters[i + 1].index!);
    const split = raw.indexOf("\r\n\r\n");
    if (split < 0 || split > 16384) throw new Error("MIME-headers ontbreken of zijn te groot");
    const headers: Record<string, string> = {};
    for (const line of raw.slice(0, split).replace(/\r\n[ \t]+/g, " ").split("\r\n")) {
      const m = line.match(/^([A-Za-z0-9-]+):[ \t]*(.*)$/);
      if (!m || headers[m[1].toLowerCase()] !== undefined) throw new Error("Ongeldige of dubbele MIME-header");
      headers[m[1].toLowerCase()] = m[2];
    }
    const id = headers["content-id"]?.match(/^<([^<>]+)>$/)?.[1];
    if (!id || parts.some(p => p.contentId === id)) throw new Error("Ontbrekende of dubbele Content-ID");
    const encoding = (headers["content-transfer-encoding"] || "binary").toLowerCase();
    if (!["base64", "binary", "8bit", "7bit"].includes(encoding)) throw new Error("Niet ondersteunde transfercodering");
    const rawData = raw.slice(split + 4);
    const data = encoding === "base64" ? strictBase64(rawData) : Buffer.from(rawData, "latin1");
    parts.push({ contentId: contentId(id), contentType: headers["content-type"] || "application/octet-stream", data });
  }
  const start = parameter(ct, "start")?.replace(/^<|>$/g, "");
  const root = start ? parts.find(p => p.contentId === start) : parts[0];
  if (!root || !/^(text|application)\/xml\b/i.test(root.contentType)) throw new Error("SOAP MIME-root ontbreekt");
  const envelope = root.data.toString("utf8"); parseXml(envelope);
  return { envelope, parts: parts.filter(p => p !== root) };
}
