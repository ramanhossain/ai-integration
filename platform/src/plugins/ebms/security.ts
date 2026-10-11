import { createHash, createPrivateKey, sign, verify, X509Certificate, timingSafeEqual, randomBytes, createCipheriv, createDecipheriv, publicEncrypt, privateDecrypt, constants } from "node:crypto";
import type { Element, Node } from "@xmldom/xmldom";
import { DS, SOAP, EB, NEXT, EXC, C14N, canonical, children, one, text, soapParts, parseXml, serialize, esc } from "./xml";
import { strictBase64, type PayloadPart } from "./mime";

const SHA256 = "http://www.w3.org/2001/04/xmlenc#sha256";
const RSA256 = "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256";
const ENVELOPED = "http://www.w3.org/2000/09/xmldsig#enveloped-signature";
const XPATH = "http://www.w3.org/TR/1999/REC-xpath-19991116";
const FILTER = `not(ancestor-or-self::node()[@soap:actor="${NEXT}"] | ancestor-or-self::node()[@soap:actor="http://schemas.xmlsoap.org/soap/actor/next"])`;
const XENC = "http://www.w3.org/2001/04/xmlenc#";
const XENC11 = "http://www.w3.org/2009/xmlenc11#";
const GCM = `${XENC11}aes256-gcm`;
const OAEP = `${XENC11}rsa-oaep`;
export interface SignatureReference { uri: string; digest: string; xml: string }
export function checkedCert(pem: string): X509Certificate {
  if (!pem) throw new Error("Vertrouwd certificaat ontbreekt");
  const cert = new X509Certificate(pem);
  if (Date.parse(cert.validFrom) > Date.now() || Date.parse(cert.validTo) < Date.now()) throw new Error("Certificaat is verlopen of nog niet geldig");
  if (cert.publicKey.asymmetricKeyType !== "rsa" || (cert.publicKey.asymmetricKeyDetails?.modulusLength || 0) < 2048) throw new Error("RSA-certificaat van minimaal 2048 bits vereist");
  return cert;
}
const digest = (data: Buffer | string) => createHash("sha256").update(data).digest("base64");
const equalDigest = (a: string, b: string) => { const x = strictBase64(a), y = strictBase64(b); return x.length === y.length && timingSafeEqual(x, y); };

function filteredEnvelope(xml: string, filter = true): Node {
  const { root, header } = soapParts(xml);
  for (const signature of children(header, DS, "Signature")) header.removeChild(signature);
  // The only XPath transform supported is the ebMS nextMSH exclusion, not arbitrary XPath.
  const walk = (node: Node) => {
    for (const c of Array.from(node.childNodes)) {
      if (c.nodeType !== 1) continue;
      const el = c as Element, actor = el.getAttributeNS(SOAP, "actor");
      if (filter && (actor === NEXT || actor === "http://schemas.xmlsoap.org/soap/actor/next")) {
        if (node !== header || el.namespaceURI === EB && el.localName === "MessageHeader") throw new Error("SOAP actor mag geen zakelijke inhoud uitsluiten");
        node.removeChild(c);
      } else walk(c);
    }
  };
  walk(root);
  return root;
}
export function envelopeDigest(xml: string): string { return digest(canonical(filteredEnvelope(xml))); }

// Only use for a locally generated envelope already committed to the authenticated store.
export function storedSignatureReferences(xml: string): Array<{ uri: string; digest: string }> {
  const { header } = soapParts(xml);
  const info = one(one(header, DS, "Signature")!, DS, "SignedInfo")!;
  return children(info, DS, "Reference").map(r => ({ uri: r.getAttribute("URI") || "", digest: text(r, DS, "DigestValue") }));
}

export function signEnvelope(xml: string, parts: PayloadPart[], values: Record<string, string>): string {
  const cert = checkedCert(values.signingCert || values.cert);
  const key = createPrivateKey({ key: values.signingKey || values.privateKey, passphrase: values.signingPassphrase || values.passphrase || undefined });
  if (!cert.checkPrivateKey(key)) throw new Error("Signingcertificaat en private sleutel passen niet bij elkaar");
  const { root, header, doc } = soapParts(xml);
  if (children(header, DS, "Signature").length) throw new Error("Envelope is al ondertekend");
  const reference = (uri: string, hash: string, transforms = "") => `<ds:Reference URI="${esc(uri)}">${transforms}<ds:DigestMethod Algorithm="${SHA256}"/><ds:DigestValue>${hash}</ds:DigestValue></ds:Reference>`;
  const transforms = `<ds:Transforms><ds:Transform Algorithm="${ENVELOPED}"/><ds:Transform Algorithm="${XPATH}"><ds:XPath xmlns:soap="${SOAP}">${esc(FILTER)}</ds:XPath></ds:Transform><ds:Transform Algorithm="${EXC}"/></ds:Transforms>`;
  const refs = reference("", envelopeDigest(xml), transforms) + parts.map(p => reference(`cid:${p.contentId}`, digest(p.data))).join("");
  const fragment = parseXml(`<ds:Signature xmlns:ds="${DS}"><ds:SignedInfo><ds:CanonicalizationMethod Algorithm="${EXC}"/><ds:SignatureMethod Algorithm="${RSA256}"/>${refs}</ds:SignedInfo><ds:SignatureValue/><ds:KeyInfo><ds:X509Data><ds:X509Certificate>${cert.raw.toString("base64")}</ds:X509Certificate></ds:X509Data></ds:KeyInfo></ds:Signature>`);
  const signature = doc.importNode(fragment.documentElement!, true) as Element;
  header.appendChild(signature);
  const signedInfo = one(signature, DS, "SignedInfo")!;
  one(signature, DS, "SignatureValue")!.textContent = sign("RSA-SHA256", Buffer.from(canonical(signedInfo)), key).toString("base64");
  return serialize(root);
}

export function verifyEnvelope(xml: string, parts: PayloadPart[], trustedPem: string, required = false): { verified: boolean; references: SignatureReference[] } {
  const { header, root } = soapParts(xml);
  const signatures = children(header, DS, "Signature");
  if (!signatures.length) { if (required) throw new Error("XML-handtekening vereist"); return { verified: false, references: [] }; }
  if (signatures.length !== 1 || root.getElementsByTagNameNS(DS, "Signature").length !== 1) throw new Error("Exact één SOAP-headerhandtekening vereist");
  const cert = checkedCert(trustedPem);
  const signature = signatures[0], info = one(signature, DS, "SignedInfo")!;
  if (one(info, DS, "SignatureMethod")!.getAttribute("Algorithm") !== RSA256) throw new Error("Alleen RSA-SHA256-handtekeningen ondersteund");
  const cm = one(info, DS, "CanonicalizationMethod")!;
  const cmAlgo = cm.getAttribute("Algorithm")!;
  const inclusive = one(cm, EXC, "InclusiveNamespaces", false)?.getAttribute("PrefixList")?.split(/\s+/).filter(Boolean) || [];
  // Never trust a certificate or key supplied by the message itself.
  if (!verify("RSA-SHA256", Buffer.from(canonical(info, cmAlgo, inclusive)), cert.publicKey, strictBase64(text(signature, DS, "SignatureValue")))) throw new Error("XML-handtekening ongeldig");
  const refs = children(info, DS, "Reference");
  if (refs.length !== parts.length + 1 || refs.filter(r => r.getAttribute("URI") === "").length !== 1) throw new Error("Handtekening moet hele envelope en alle bijlagen dekken");
  const seen = new Set<string>();
  const result = refs.map(r => {
    const uri = r.getAttribute("URI") || "";
    if (seen.has(uri)) throw new Error("Dubbele handtekeningreferentie"); seen.add(uri);
    if (one(r, DS, "DigestMethod")!.getAttribute("Algorithm") !== SHA256) throw new Error("Alleen SHA256-digests ondersteund");
    const transforms = children(one(r, DS, "Transforms", false) || r, DS, "Transform");
    let data: Buffer | string;
    if (uri === "") {
      const algos = transforms.map(t => t.getAttribute("Algorithm"));
      if (algos.length < 2 || algos.length > 3 || algos[0] !== ENVELOPED || ![EXC, C14N].includes(algos.at(-1)!)) throw new Error("Niet ondersteunde envelope-transforms");
      if (algos.length === 3) {
        const expression = one(transforms[1], DS, "XPath")!;
        const normalized = (expression.textContent || "").replace(/\s/g, "").replace(/'/g, '"');
        const prefix = normalized.match(/@([A-Za-z_][\w.-]*):actor/)?.[1];
        if (algos[1] !== XPATH || !prefix || expression.lookupNamespaceURI(prefix) !== SOAP || normalized !== FILTER.replace(/soap:/g, `${prefix}:`).replace(/\s/g, "")) throw new Error("Alleen ebMS nextMSH XPath-filter toegestaan");
      }
      const incl = one(transforms.at(-1)!, EXC, "InclusiveNamespaces", false)?.getAttribute("PrefixList")?.split(/\s+/).filter(Boolean) || [];
      data = canonical(filteredEnvelope(xml, algos.length === 3), algos.at(-1)!, incl);
    } else {
      if (!uri.startsWith("cid:") || transforms.length) throw new Error("Alleen ongetransformeerde cid-bijlagereferenties toegestaan");
      const p = parts.find(p => `cid:${p.contentId}` === uri);
      if (!p) throw new Error("Ondertekende MIME-bijlage ontbreekt");
      data = p.data;
    }
    const hash = text(r, DS, "DigestValue");
    if (!equalDigest(hash, digest(data))) throw new Error("Digest klopt niet: bericht of bijlage gewijzigd");
    // Standalone namespace declaration is retained when embedding refs in signed receipts.
    const copy = r.cloneNode(true) as Element; copy.setAttributeNS("http://www.w3.org/2000/xmlns/", `xmlns:${r.prefix || "ds"}`, DS);
    return { uri, digest: hash, xml: serialize(copy) };
  });
  return { verified: true, references: result };
}

export function encryptPart(part: PayloadPart, peerCert: string): PayloadPart {
  const peer = checkedCert(peerCert), key = randomBytes(32), iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([iv, cipher.update(part.data), cipher.final(), cipher.getAuthTag()]);
  const wrapped = publicEncrypt({ key: peer.publicKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" }, key);
  key.fill(0);
  const xml = `<xenc:EncryptedData xmlns:xenc="${XENC}" xmlns:xenc11="${XENC11}" xmlns:ds="${DS}" MimeType="${esc(part.contentType)}"><xenc:EncryptionMethod Algorithm="${GCM}"/><ds:KeyInfo><xenc:EncryptedKey><xenc:EncryptionMethod Algorithm="${OAEP}"><ds:DigestMethod Algorithm="${SHA256}"/><xenc11:MGF Algorithm="${XENC11}mgf1sha256"/></xenc:EncryptionMethod><xenc:CipherData><xenc:CipherValue>${wrapped.toString("base64")}</xenc:CipherValue></xenc:CipherData></xenc:EncryptedKey></ds:KeyInfo><xenc:CipherData><xenc:CipherValue>${ciphertext.toString("base64")}</xenc:CipherValue></xenc:CipherData></xenc:EncryptedData>`;
  return { ...part, data: Buffer.from(xml), contentType: "application/xenc+xml" };
}
export function decryptPart(part: PayloadPart, values: Record<string, string>): PayloadPart {
  if (!/^application\/xenc\+xml\b/i.test(part.contentType)) return part;
  const root = parseXml(part.data.toString("utf8")).documentElement!;
  if (root.namespaceURI !== XENC || root.localName !== "EncryptedData") throw new Error("EncryptedData ontbreekt");
  if (one(root, XENC, "EncryptionMethod")!.getAttribute("Algorithm") !== GCM) throw new Error("Alleen AES256-GCM ondersteund");
  const encryptedKey = one(one(root, DS, "KeyInfo")!, XENC, "EncryptedKey")!;
  const method = one(encryptedKey, XENC, "EncryptionMethod")!;
  if (method.getAttribute("Algorithm") !== OAEP || one(method, DS, "DigestMethod")!.getAttribute("Algorithm") !== SHA256 || one(method, XENC11, "MGF")!.getAttribute("Algorithm") !== `${XENC11}mgf1sha256`) throw new Error("Alleen RSA-OAEP SHA256/MGF1-SHA256 ondersteund");
  const key = privateDecrypt({ key: values.decryptionKey || values.signingKey || values.privateKey, passphrase: values.decryptionPassphrase || values.signingPassphrase || values.passphrase || undefined, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" }, strictBase64(text(one(encryptedKey, XENC, "CipherData")!, XENC, "CipherValue")));
  try {
    if (key.length !== 32) throw new Error("Ongeldige AES-sleutel");
    const data = strictBase64(text(one(root, XENC, "CipherData")!, XENC, "CipherValue"));
    if (data.length < 28) throw new Error("Ongeldige GCM-ciphertext");
    const decipher = createDecipheriv("aes-256-gcm", key, data.subarray(0, 12));
    decipher.setAuthTag(data.subarray(-16));
    return { ...part, data: Buffer.concat([decipher.update(data.subarray(12, -16)), decipher.final()]), contentType: root.getAttribute("MimeType") || "application/octet-stream" };
  } finally { key.fill(0); }
}
