import { promises as fs } from "node:fs";
import { join, resolve, relative, dirname, posix } from "node:path";
import { Client as FtpClient } from "basic-ftp";
import SftpClient from "ssh2-sftp-client";
import { Readable, Writable } from "node:stream";
import type { EnvName } from "../domain/environments";
import { credentials } from "./credentials";
import { currentOrg, DEFAULT_ORG } from "../tenancy/context";
import { assertHostAllowed } from "../net/egress";

// Eén interface voor lokale bestanden en FTP/FTPS/SFTP, zodat stappen en triggers
// (map-watcher, FTP-poller) dezelfde code gebruiken.

export interface FileEntry {
  name: string;
  path: string;
  size: number;
  modifiedAt?: string;
  isDir: boolean;
}

export interface FileSystem {
  list(dir: string): Promise<FileEntry[]>;
  read(path: string): Promise<string>;
  write(path: string, content: string): Promise<void>;
  remove(path: string): Promise<void>;
  move(from: string, to: string): Promise<void>;
  close(): Promise<void>;
}

// ---------- lokaal ----------
// Alle paden liggen binnen <AIP_FILES_ROOT>/<omgeving>; buiten die map komen kan niet.
export const FILES_ROOT = resolve(process.env.AIP_FILES_ROOT ?? join(__dirname, "..", "..", "data", "files"));

export function envRoot(env: EnvName): string {
  const org = currentOrg();
  return org === DEFAULT_ORG ? join(FILES_ROOT, env) : join(FILES_ROOT, "orgs", org, env);
}

function safe(env: EnvName, p: string): string {
  const root = envRoot(env);
  const full = resolve(root, "." + posix.normalize("/" + (p || "")));
  const rel = relative(root, full);
  if (rel.startsWith("..") || resolve(root, rel) !== full) throw new Error(`Pad buiten de bestandsmap: ${p}`);
  return full;
}

export class LocalFs implements FileSystem {
  constructor(private env: EnvName) {}
  async list(dir: string): Promise<FileEntry[]> {
    const full = safe(this.env, dir);
    await fs.mkdir(full, { recursive: true });
    const items = await fs.readdir(full, { withFileTypes: true });
    return Promise.all(items.map(async (d) => {
      const st = await fs.stat(join(full, d.name));
      return { name: d.name, path: posix.join(dir || "/", d.name), size: st.size, modifiedAt: st.mtime.toISOString(), isDir: d.isDirectory() };
    }));
  }
  async read(path: string): Promise<string> {
    return fs.readFile(safe(this.env, path), "utf8");
  }
  async write(path: string, content: string): Promise<void> {
    const full = safe(this.env, path);
    await fs.mkdir(dirname(full), { recursive: true });
    await fs.writeFile(full, content, "utf8");
  }
  async remove(path: string): Promise<void> {
    await fs.rm(safe(this.env, path), { force: true });
  }
  async move(from: string, to: string): Promise<void> {
    const dst = safe(this.env, to);
    await fs.mkdir(dirname(dst), { recursive: true });
    await fs.rename(safe(this.env, from), dst);
  }
  async close(): Promise<void> {}
}

// ---------- FTP / FTPS ----------
class FtpFs implements FileSystem {
  private client = new FtpClient(20000);
  constructor(private cfg: Record<string, string>, private secure: boolean) {}
  async connect(): Promise<this> {
    await assertHostAllowed(this.cfg.host);
    await this.client.access({
      host: this.cfg.host,
      port: Number(this.cfg.port || 21),
      user: this.cfg.user || "anonymous",
      password: this.cfg.password || "",
      secure: this.secure,
      secureOptions: this.secure ? { rejectUnauthorized: this.cfg.rejectUnauthorized !== "false" } : undefined
    });
    return this;
  }
  async list(dir: string): Promise<FileEntry[]> {
    const items = await this.client.list(dir || "/");
    return items.map((i) => ({ name: i.name, path: posix.join(dir || "/", i.name), size: i.size, modifiedAt: i.modifiedAt?.toISOString(), isDir: i.isDirectory }));
  }
  async read(path: string): Promise<string> {
    const chunks: Buffer[] = [];
    const sink = new Writable({ write(c, _e, cb) { chunks.push(Buffer.from(c)); cb(); } });
    await this.client.downloadTo(sink, path);
    return Buffer.concat(chunks).toString("utf8");
  }
  async write(path: string, content: string): Promise<void> {
    await this.client.ensureDir(posix.dirname(path));
    await this.client.cd("/");
    await this.client.uploadFrom(Readable.from([Buffer.from(content, "utf8")]), path);
  }
  async remove(path: string): Promise<void> {
    await this.client.remove(path);
  }
  async move(from: string, to: string): Promise<void> {
    await this.client.ensureDir(posix.dirname(to));
    await this.client.cd("/");
    await this.client.rename(from, to);
  }
  async close(): Promise<void> {
    this.client.close();
  }
}

// ---------- SFTP ----------
class SftpFs implements FileSystem {
  private client = new SftpClient();
  constructor(private cfg: Record<string, string>) {}
  async connect(): Promise<this> {
    await assertHostAllowed(this.cfg.host);
    await this.client.connect({
      host: this.cfg.host,
      port: Number(this.cfg.port || 22),
      username: this.cfg.user,
      password: this.cfg.password || undefined,
      privateKey: this.cfg.privateKey || undefined,
      readyTimeout: 20000
    });
    return this;
  }
  async list(dir: string): Promise<FileEntry[]> {
    const items = await this.client.list(dir || "/");
    return items.map((i) => ({ name: i.name, path: posix.join(dir || "/", i.name), size: i.size, modifiedAt: new Date(i.modifyTime).toISOString(), isDir: i.type === "d" }));
  }
  async read(path: string): Promise<string> {
    const buf = (await this.client.get(path)) as Buffer;
    return Buffer.from(buf).toString("utf8");
  }
  async write(path: string, content: string): Promise<void> {
    await this.client.mkdir(posix.dirname(path), true).catch(() => undefined);
    await this.client.put(Buffer.from(content, "utf8"), path);
  }
  async remove(path: string): Promise<void> {
    await this.client.delete(path);
  }
  async move(from: string, to: string): Promise<void> {
    await this.client.mkdir(posix.dirname(to), true).catch(() => undefined);
    await this.client.rename(from, to);
  }
  async close(): Promise<void> {
    await this.client.end();
  }
}

// Open een bestandssysteem: zonder koppeling lokaal, anders FTP/FTPS/SFTP volgens de koppeling.
export async function openFs(env: EnvName, credentialName?: string): Promise<FileSystem> {
  if (!credentialName) return new LocalFs(env);
  const { type, values } = credentials.resolve(credentialName, env);
  if (type === "sftp") return new SftpFs(values).connect();
  if (type === "ftp" || type === "ftps") return new FtpFs(values, type === "ftps").connect();
  throw new Error(`Koppeling '${credentialName}' is van type ${type}; verwacht ftp, ftps of sftp`);
}
