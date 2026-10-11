import { request } from "node:https";
import { lookup } from "node:dns/promises";
import { X509Certificate } from "node:crypto";
import type { TLSSocket } from "node:tls";
import { assertHostAllowed } from "../../net/egress";
import { checkedCert } from "./security";
import { MAX_BYTES } from "./xml";
import type { PackedMessage } from "./mime";

export interface TransportReply { status: number; body: Buffer; contentType: string }
export async function sendHttps(message: PackedMessage, v: Record<string, string>, endpoint = v.endpoint): Promise<TransportReply> {
  const url = new URL(endpoint);
  if (url.protocol !== "https:" || url.username || url.password || url.hash) throw new Error("Endpoint moet HTTPS zonder gebruikersgegevens of fragment zijn");
  if (!v.cert || !v.privateKey) throw new Error("Clientcertificaat en private sleutel ontbreken");
  checkedCert(v.cert);
  const pin = v.peerTlsCert ? checkedCert(v.peerTlsCert).fingerprint256 : undefined;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = await lookup(host, { all: true });
  if (!addresses.length) throw new Error("Endpoint DNS-adres ontbreekt");
  for (const a of addresses) await assertHostAllowed(a.address);
  const address = addresses.find(a => a.family === 4) || addresses[0];
  return new Promise<TransportReply>((resolve, reject) => {
    const req = request(url, {
      method: "POST", agent: false, cert: v.cert, key: v.privateKey, passphrase: v.passphrase || undefined, ca: v.ca || undefined, crl: v.crl || undefined,
      rejectUnauthorized: true, minVersion: "TLSv1.2", family: address.family,
      // Pin the DNS result that passed egress validation, closing the rebinding window.
      lookup: (_host, _opts, cb) => cb(null, address.address, address.family),
      signal: AbortSignal.timeout(30000),
      headers: { "content-type": message.contentType, SOAPAction: '"ebXML"', "content-length": Buffer.byteLength(message.wire) },
    }, res => {
      const chunks: Buffer[] = []; let length = 0;
      res.on("data", (b: Buffer) => { length += b.length; if (length > MAX_BYTES) res.destroy(new Error("Antwoord groter dan 20 MiB")); else chunks.push(b); });
      res.on("aborted", () => reject(new Error("ebMS-antwoord afgebroken")));
      res.on("error", reject);
      res.on("end", () => resolve({ status: res.statusCode || 0, body: Buffer.concat(chunks), contentType: String(res.headers["content-type"] || "text/xml") }));
    });
    req.on("socket", socket => socket.once("secureConnect", () => {
      if (pin) {
        const peer = (socket as TLSSocket).getPeerCertificate();
        if (!peer.raw || new X509Certificate(peer.raw).fingerprint256 !== pin) req.destroy(new Error("Servercertificaat wijkt af van partnercertificaat"));
      }
    }));
    req.on("error", reject);
    req.end(message.wire);
  });
}
