import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CATALOG } from "./catalog";
import { plugins } from "./registry";
import { safeFetch } from "../net/egress";

// Logo's van de organisaties achter de plugins.
// 1. Merkicoon uit simple-icons (CC0), in de merkkleur.
// 2. Anders: het app-icoon of favicon van de website van de dienst, één keer opgehaald
//    (via de egress-controle) en daarna uit de cache (data/logos).
// 3. Anders 404: de GUI toont dan de initialen.

const ICON_DIR = join(__dirname, "..", "..", "node_modules", "simple-icons", "icons");
const CACHE_DIR = join(process.env.AIP_DATA_DIR ? join(process.env.AIP_DATA_DIR, "..") : join(__dirname, "..", "..", "data"), "logos");
const norm = (s: string) => s.toLowerCase().replace(/\+/g, "plus").replace(/\./g, "dot").replace(/&/g, "and").normalize("NFKD").replace(/[^a-z0-9]/g, "");

let hexBySlug: Map<string, string> | null = null;
function hexOf(slug: string): string | undefined {
  if (!hexBySlug) {
    hexBySlug = new Map();
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const si = require("simple-icons") as Record<string, { slug?: string; hex?: string }>;
      for (const v of Object.values(si)) if (v && v.slug && v.hex) hexBySlug.set(v.slug, v.hex);
    } catch { /* geen kleuren */ }
  }
  return hexBySlug.get(slug);
}

// Diensten waarvan het merkicoon onder een andere naam (of bij het moederbedrijf) staat.
const ALIAS: Record<string, string> = { kafka: "apachekafka", "cisco-webex": "cisco", "google-contacts": "google" };
function slugFor(id: string, name: string): string | undefined {
  if (ALIAS[id] && existsSync(join(ICON_DIR, `${ALIAS[id]}.svg`))) return ALIAS[id];
  const base = id.replace(/^(aws|amazon|azure|microsoft|google)-/, "");
  const cands = [norm(id), norm(name), norm(name.replace(/\(.*?\)/g, ""))];
  if (id.startsWith("aws-")) cands.push(`amazon${norm(base)}`, `aws${norm(base)}`, `amazonaws`, "amazonwebservices");
  if (id.startsWith("azure-")) cands.push(`azure${norm(base)}`, "microsoftazure");
  if (id.startsWith("google-")) cands.push(`google${norm(base)}`);
  if (id.startsWith("microsoft-")) cands.push(`microsoft${norm(base)}`);
  return cands.find((c) => c && existsSync(join(ICON_DIR, `${c}.svg`)));
}

const websiteOf = (id: string): string | undefined => CATALOG.find((c) => c.id === id)?.website || plugins.get(id)?.website;
const nameOf = (id: string): string => CATALOG.find((c) => c.id === id)?.name || plugins.get(id)?.name || id;

export interface Logo { type: string; body: Buffer }
const memo = new Map<string, Logo | null>();
const pending = new Map<string, Promise<Logo | null>>();

async function fetchImage(url: string): Promise<Logo | null> {
  const res = await safeFetch(url, { signal: AbortSignal.timeout(8000), headers: { "user-agent": "Mozilla/5.0 (AIP logo)" } });
  if (!res.ok) return null;
  const type = String(res.headers.get("content-type") || "").split(";")[0].trim();
  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.length || buf.length > 300_000) return null;
  const isIco = type.includes("icon") || url.endsWith(".ico");
  if (!type.startsWith("image/") && !isIco) return null;
  // Geen HTML-pagina's die zich als icoon voordoen.
  const head = buf.subarray(0, 64).toString("utf8").trimStart().toLowerCase();
  if (head.startsWith("<!doctype") || head.startsWith("<html") || (head.startsWith("<") && !head.startsWith("<svg") && !head.startsWith("<?xml"))) return null;
  return { type: isIco && !type.startsWith("image/") ? "image/x-icon" : type, body: buf };
}

// App-icoon (groot) of favicon van de homepage.
async function fromWebsite(site: string): Promise<Logo | null> {
  const home = new URL(site);
  const origin = `${home.protocol}//${home.host}`;
  const cands: string[] = [];
  try {
    const res = await safeFetch(origin + "/", { signal: AbortSignal.timeout(8000), headers: { "user-agent": "Mozilla/5.0 (AIP logo)", accept: "text/html" } });
    const html = (await res.text()).slice(0, 300_000);
    const links = [...html.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0]);
    const pick = (re: RegExp) => links.filter((l) => re.test(l)).map((l) => (l.match(/href=["']([^"']+)["']/i) || [])[1]).filter(Boolean) as string[];
    cands.push(...pick(/rel=["'][^"']*apple-touch-icon/i), ...pick(/rel=["'][^"']*icon/i));
    const base = res.url || origin + "/";
    for (let i = 0; i < cands.length; i++) cands[i] = new URL(cands[i], base).toString();
  } catch { /* homepage niet bereikbaar */ }
  cands.push(`${origin}/apple-touch-icon.png`, `${origin}/favicon.ico`);
  for (const c of [...new Set(cands)].filter((c) => !c.startsWith("data:")).slice(0, 6)) {
    try { const img = await fetchImage(c); if (img) return img; } catch { /* volgende */ }
  }
  return null;
}

export async function pluginLogo(id: string): Promise<Logo | null> {
  // Alleen bestaande plugins (geen cachebestanden voor willekeurige id's).
  if (!CATALOG.some((c) => c.id === id) && !plugins.get(id)) return null;
  if (memo.has(id)) return memo.get(id)!;
  if (pending.has(id)) return pending.get(id)!;
  const job = (async (): Promise<Logo | null> => {
    const slug = slugFor(id, nameOf(id));
    if (slug) {
      const hex = hexOf(slug) || "333333";
      const svg = readFileSync(join(ICON_DIR, `${slug}.svg`), "utf8").replace("<svg ", `<svg fill="#${hex}" `);
      return { type: "image/svg+xml", body: Buffer.from(svg) };
    }
    mkdirSync(CACHE_DIR, { recursive: true });
    const meta = join(CACHE_DIR, `${id}.json`);
    if (existsSync(meta)) {
      const m = JSON.parse(readFileSync(meta, "utf8")) as { type?: string; none?: boolean; at: number };
      if (m.none && Date.now() - m.at < 7 * 86400_000) return null;
      if (m.type && existsSync(join(CACHE_DIR, `${id}.img`))) return { type: m.type, body: readFileSync(join(CACHE_DIR, `${id}.img`)) };
    }
    const site = websiteOf(id);
    const img = site ? await fromWebsite(site).catch(() => null) : null;
    if (img) { writeFileSync(join(CACHE_DIR, `${id}.img`), img.body); writeFileSync(meta, JSON.stringify({ type: img.type, at: Date.now() })); }
    else writeFileSync(meta, JSON.stringify({ none: true, at: Date.now() }));
    return img;
  })();
  pending.set(id, job);
  try { const r = await job; memo.set(id, r); return r; } finally { pending.delete(id); }
}
