import { promises as fs, constants } from "node:fs";
import { join, resolve, relative, isAbsolute, sep, basename } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { currentOrg } from "../../tenancy/context";
import type { EnvName } from "../../domain/environments";
import { MAX_BYTES } from "../ebms/xml";

export const digest = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");
export function directories(credential: string, env: EnvName) {
  const root = resolve(process.env.AIP_AS4_ROOT || join(__dirname, "..", "..", "..", "data", "as4"));
  const base = join(root, digest(currentOrg()).slice(0, 32), env, digest(credential).slice(0, 32));
  return { root, base, out: join(base, "out"), incoming: join(base, "in") };
}
function within(root: string, path: string) {
  const rel = relative(root, path);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error("Pad buiten AS4-koppelingsmap");
}
// The root is operator-controlled. Children must never follow tenant-controlled symlinks.
export async function safeDirectory(root: string, path: string): Promise<void> {
  within(root, path); await fs.mkdir(root, { recursive: true, mode: 0o700 });
  let cursor = root;
  for (const segment of relative(root, path).split(sep).filter(Boolean)) {
    cursor = join(cursor, segment);
    try { await fs.mkdir(cursor, { mode: 0o700 }); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e; }
    const st = await fs.lstat(cursor);
    if (!st.isDirectory() || st.isSymbolicLink()) throw new Error("Symlink of ongeldig AS4-directorypad");
  }
}
async function syncDir(dir: string) { const h = await fs.open(dir, "r"); try { await h.sync(); } finally { await h.close(); } }
export async function readSafe(root: string, location: string, max = MAX_BYTES): Promise<Buffer> {
  if (!location || location.includes("\0") || /^[a-z][a-z\d+.-]*:/i.test(location)) throw new Error("Alleen lokale payloadbestanden toegestaan");
  const path = resolve(root, location); within(root, path);
  const actualRoot = await fs.realpath(root), actual = await fs.realpath(path); within(actualRoot, actual);
  const h = await fs.open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const st = await h.stat(); if (!st.isFile() || st.size > max) throw new Error("AS4-bestand ongeldig of te groot");
    // Bound the read even when a file grows while being read.
    const b = Buffer.alloc(Math.min(max + 1, st.size + 1));
    let offset = 0;
    while (offset < b.length) { const r = await h.read(b, offset, b.length - offset, offset); if (!r.bytesRead) break; offset += r.bytesRead; }
    if (offset > max || offset !== st.size) throw new Error("AS4-bestand gewijzigd tijdens lezen of te groot");
    return b.subarray(0, offset);
  } finally { await h.close(); }
}
// Hard-link publication makes the final name visible atomically without overwriting.
export async function publish(dir: string, name: string, data: Buffer | string): Promise<void> {
  if (basename(name) !== name || !/^[a-z\d.-]+$/i.test(name)) throw new Error("Ongeldige spoolbestandsnaam");
  const final = join(dir, name), temp = join(dir, `.aip-${randomUUID()}.tmp`);
  const h = await fs.open(temp, "wx", 0o600);
  try { await h.writeFile(data); await h.sync(); } finally { await h.close(); }
  try { await fs.link(temp, final); await syncDir(dir); }
  catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    const stored = await readSafe(dir, name);
    if (!stored.equals(Buffer.isBuffer(data) ? data : Buffer.from(data))) throw new Error("AS4-spoolbestand bestaat met andere inhoud");
  } finally { await fs.unlink(temp).catch(() => undefined); }
}
export async function files(dir: string): Promise<string[]> { return (await fs.readdir(dir, { withFileTypes: true })).filter(f => f.isFile() && !f.isSymbolicLink()).map(f => f.name).sort(); }
