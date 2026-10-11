import { DOMParser, XMLSerializer, type Document, type Element, type Node } from "@xmldom/xmldom";
import { XMLValidator } from "fast-xml-parser";
import { C14nCanonicalization, ExclusiveCanonicalization } from "xml-crypto";

export const SOAP = "http://schemas.xmlsoap.org/soap/envelope/";
export const EB = "http://www.oasis-open.org/committees/ebxml-msg/schema/msg-header-2_0.xsd";
export const DS = "http://www.w3.org/2000/09/xmldsig#";
export const XLINK = "http://www.w3.org/1999/xlink";
export const SIGNAL = "urn:oasis:names:tc:ebxml-msg:service";
export const TO_PARTY = "urn:oasis:names:tc:ebxml-msg:actor:toPartyMSH";
export const NEXT = "urn:oasis:names:tc:ebxml-msg:actor:nextMSH";
export const EXC = "http://www.w3.org/2001/10/xml-exc-c14n#";
export const C14N = "http://www.w3.org/TR/2001/REC-xml-c14n-20010315";
export const MAX_BYTES = 20 * 1024 * 1024;
export const esc = (s: unknown) => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);
export const serialize = (n: Node) => new XMLSerializer().serializeToString(n);
export function parseXml(xml: string): Document {
  if (Buffer.byteLength(xml) > MAX_BYTES) throw new Error("XML groter dan 20 MiB");
  if (/<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true) throw new Error("Ongeldige XML of verboden DTD/entity");
  const doc = new DOMParser({ onError: (_level, msg) => { throw new Error(`Ongeldige XML: ${msg}`); } }).parseFromString(xml, "application/xml");
  if (!doc.documentElement) throw new Error("XML-root ontbreekt");
  let count = 0;
  const walk = (n: Node, depth: number) => {
    if (depth > 64 || ++count > 100000) throw new Error("XML te complex");
    for (let c = n.firstChild; c; c = c.nextSibling) walk(c, depth + 1);
  };
  walk(doc, 0);
  return doc;
}
export function children(n: Node, ns: string, name: string): Element[] {
  const result: Element[] = [];
  for (let c = n.firstChild; c; c = c.nextSibling) if (c.nodeType === 1 && (c as Element).namespaceURI === ns && (c as Element).localName === name) result.push(c as Element);
  return result;
}
export function one(n: Node, ns: string, name: string, required = true): Element | undefined {
  const found = children(n, ns, name);
  if (found.length > 1 || (required && found.length !== 1)) throw new Error(`XML: ${name} moet exact eenmaal aanwezig zijn`);
  return found[0];
}
export function text(n: Node, ns: string, name: string, required = true): string {
  const e = one(n, ns, name, required);
  if (e && Array.from(e.childNodes).some(c => c.nodeType === 1)) throw new Error(`XML: ${name} moet tekst zijn`);
  const result = e?.textContent?.trim() || "";
  if (required && !result) throw new Error(`XML: ${name} ontbreekt`);
  return result;
}
export function canonical(n: Node, algorithm = EXC, prefixes: string[] = []): string {
  if (algorithm !== EXC && algorithm !== C14N) throw new Error("Niet ondersteunde canonicalisatie");
  const algo = algorithm === EXC ? new ExclusiveCanonicalization() : new C14nCanonicalization();
  // xml-crypto's types use browser DOM interfaces; xmldom supplies the same DOM surface.
  const ns = new Map<string, string>();
  for (let parent = n.parentNode; parent; parent = parent.parentNode) {
    if (parent.nodeType !== 1) continue;
    for (const a of Array.from((parent as Element).attributes)) {
      if (a.name === "xmlns" || a.prefix === "xmlns") {
        const prefix = a.name === "xmlns" ? "" : a.localName || "";
        if (!ns.has(prefix)) ns.set(prefix, a.value);
      }
    }
  }
  return algo.process(n as never, { inclusiveNamespacesPrefixList: prefixes, ancestorNamespaces: [...ns].map(([prefix, namespaceURI]) => ({ prefix, namespaceURI })) });
}
export function soapParts(xml: string) {
  const doc = parseXml(xml), root = doc.documentElement!;
  if (root.localName !== "Envelope" || root.namespaceURI !== SOAP) throw new Error("SOAP 1.1-envelope ontbreekt");
  const header = one(root, SOAP, "Header")!, body = one(root, SOAP, "Body")!;
  if (Array.from(root.childNodes).some(n => n.nodeType === 1 && n !== header && n !== body)) throw new Error("Onverwacht SOAP-element");
  return { doc, root, header, body };
}

export function messageId(value: string): string {
  if (!/^[^\s<>@]+@[^\s<>@]+$/.test(value) || value.length > 998) throw new Error("Bericht-ID moet globaal uniek zijn (id@domein)");
  return value;
}
