import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { currentOrg, DEFAULT_ORG } from "../tenancy/context";

// Uitgaand verkeer (egress) vanuit processen, plugins en koppelingen — bescherming tegen SSRF.
// - Altijd geblokkeerd: link-local en cloud-metadata (169.254.0.0/16, fe80::/10,
//   fd00:ec2::254, 100.100.100.200), 0.0.0.0/8, multicast/gereserveerd.
// - Intern netwerk en loopback (127/8, 10/8, 172.16/12, 192.168/16, 100.64/10, ::1, fc00::/7):
//   geblokkeerd voor klantorganisaties; toegestaan voor de hoofdorganisatie (eigen installatie).
//   AIP_EGRESS_PRIVATE=allow staat het voor iedereen toe, =deny voor niemand.
// - Redirects worden handmatig gevolgd en elke stap wordt opnieuw gecontroleerd.
// Rest-risico: DNS-rebinding tussen controle en verbinding (kortstondig) — zet bij hosting
// ook een egress-firewall die metadata-adressen blokkeert.

function v4(ip: string): number[] | null {
  const m = ip.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  return m ? m.slice(1).map(Number) : null;
}
function classify(ipRaw: string): "blocked" | "private" | "public" {
  let ip = ipRaw.toLowerCase();
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) ip = mapped[1];
  const a = v4(ip);
  if (a) {
    const [x, y] = a;
    if (x === 0 || x >= 224) return "blocked"; // 0.0.0.0/8, multicast, gereserveerd
    if (x === 169 && y === 254) return "blocked"; // link-local + cloud-metadata
    if (ip === "100.100.100.200") return "blocked"; // metadata (Alibaba)
    if (x === 127 || x === 10 || (x === 172 && y >= 16 && y <= 31) || (x === 192 && y === 168) || (x === 100 && y >= 64 && y <= 127)) return "private";
    return "public";
  }
  if (ip === "::" || ip.startsWith("ff")) return "blocked";
  if (ip.startsWith("fe8") || ip.startsWith("fe9") || ip.startsWith("fea") || ip.startsWith("feb")) return "blocked";
  if (ip === "fd00:ec2::254") return "blocked";
  if (ip === "::1" || ip.startsWith("fc") || ip.startsWith("fd")) return "private";
  return "public";
}
function privateAllowed(): boolean {
  const mode = process.env.AIP_EGRESS_PRIVATE;
  if (mode === "allow") return true;
  if (mode === "deny") return false;
  return currentOrg() === DEFAULT_ORG;
}

// Controleer een hostnaam of IP (zonder poort).
export async function assertHostAllowed(hostRaw: string): Promise<void> {
  const host = String(hostRaw || "").replace(/^\[|\]$/g, "").trim();
  if (!host) return;
  const ips = isIP(host) ? [host] : (await lookup(host, { all: true }).catch(() => [])).map((r) => r.address);
  if (!ips.length && /^(localhost|.*\.localhost|metadata(\.google\.internal)?)$/i.test(host)) ips.push("127.0.0.1");
  for (const ip of ips) {
    const c = classify(ip);
    if (c === "blocked") throw new Error(`Verbinding met ${host} (${ip}) is niet toegestaan (intern/metadata-adres)`);
    if (c === "private" && !privateAllowed()) throw new Error(`Verbinding met ${host} (${ip}) is niet toegestaan: intern netwerk is afgeschermd voor deze organisatie`);
  }
}

// URL of host-lijst uit koppelingswaarden halen en controleren.
export async function assertUrlAllowed(url: string): Promise<void> {
  let u: URL;
  try { u = new URL(url); } catch { return; } // ongeldig: fetch weigert die zelf
  await assertHostAllowed(u.hostname);
}
export async function assertTargetsAllowed(values: Record<string, unknown>): Promise<void> {
  const hosts = new Set<string>();
  for (const [k, v] of Object.entries(values || {})) {
    if (typeof v !== "string" || !v) continue;
    if (/^(host|hostname|server)$/i.test(k)) hosts.add(v.split(":")[0]);
    else if (/^(url|uri|baseurl|endpoint|connectionstring|instanceurl)$/i.test(k)) {
      for (const h of v.matchAll(/^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]*@)?([^/:?#,]+|\[[^\]]+\])/gi)) hosts.add(h[1]);
      if (/^(host|server)=/i.test(v) || /;\s*(host|server)=/i.test(v)) for (const h of v.matchAll(/(?:^|;)\s*(?:host|server)=([^;:,]+)/gi)) hosts.add(h[1].trim());
    } else if (/^brokers$/i.test(k)) for (const b of v.split(",")) hosts.add(b.trim().split(":")[0]);
  }
  for (const h of hosts) await assertHostAllowed(h);
}

// fetch met controle per stap (ook bij redirects).
export async function safeFetch(url: string | URL, init: RequestInit = {}, maxRedirects = 5): Promise<Response> {
  let current = String(url);
  let opts: RequestInit = { ...init, redirect: "manual" };
  for (let i = 0; i <= maxRedirects; i++) {
    await assertUrlAllowed(current);
    const res = await fetch(current, opts);
    if (res.status < 300 || res.status >= 400 || !res.headers.get("location")) return res;
    current = new URL(res.headers.get("location")!, current).toString();
    if (res.status === 301 || res.status === 302 || res.status === 303) {
      const m = (opts.method || "GET").toUpperCase();
      if (m !== "GET" && m !== "HEAD") opts = { ...opts, method: "GET", body: undefined };
    }
  }
  throw new Error("Te veel redirects");
}
