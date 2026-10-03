import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { ENVIRONMENTS, type EnvName } from "../domain/environments";
import { persistence } from "../store";
import { audit } from "../audit/auditLog";
import { bus } from "../events/bus";
import { scoped } from "../tenancy/context";

// Koppelingen (credentials) met waarden per omgeving. Dezelfde stap gebruikt op DEV andere
// servers/wachtwoorden dan op PROD. Geheime velden worden versleuteld opgeslagen
// (AES-256-GCM) en komen nooit terug via de API.

export type CredType = "ftp" | "ftps" | "sftp" | "smtp" | "postgres" | "http-basic" | "http-bearer" | "api-key" | "mcp" | "webhook" | "generic" | "plugin";

export interface CredField {
  key: string;
  label: string;
  secret?: boolean;
  placeholder?: string;
}

// Machine-leesbare beschrijving van elk type (ook voor de GUI en MCP).
export const CRED_TYPES: Record<CredType, { label: string; fields: CredField[] }> = {
  ftp: { label: "FTP", fields: [{ key: "host", label: "Host" }, { key: "port", label: "Poort", placeholder: "21" }, { key: "user", label: "Gebruiker" }, { key: "password", label: "Wachtwoord", secret: true }] },
  ftps: { label: "FTPS (FTP over TLS)", fields: [{ key: "host", label: "Host" }, { key: "port", label: "Poort", placeholder: "21" }, { key: "user", label: "Gebruiker" }, { key: "password", label: "Wachtwoord", secret: true }] },
  sftp: { label: "SFTP (SSH)", fields: [{ key: "host", label: "Host" }, { key: "port", label: "Poort", placeholder: "22" }, { key: "user", label: "Gebruiker" }, { key: "password", label: "Wachtwoord", secret: true }, { key: "privateKey", label: "Private key (PEM)", secret: true }] },
  smtp: { label: "E-mail (SMTP)", fields: [{ key: "host", label: "Host" }, { key: "port", label: "Poort", placeholder: "587" }, { key: "secure", label: "TLS (true/false)", placeholder: "false" }, { key: "user", label: "Gebruiker" }, { key: "password", label: "Wachtwoord", secret: true }, { key: "from", label: "Afzender", placeholder: "integraties@bedrijf.nl" }] },
  postgres: { label: "PostgreSQL", fields: [{ key: "connectionString", label: "Connection string", secret: true, placeholder: "postgres://user:pass@host:5432/db" }] },
  "http-basic": { label: "HTTP Basic auth", fields: [{ key: "user", label: "Gebruiker" }, { key: "password", label: "Wachtwoord", secret: true }] },
  "http-bearer": { label: "HTTP Bearer token", fields: [{ key: "token", label: "Token", secret: true }] },
  "api-key": { label: "API-key (header)", fields: [{ key: "header", label: "Headernaam", placeholder: "x-api-key" }, { key: "key", label: "Sleutel", secret: true }] },
  mcp: { label: "MCP-server", fields: [{ key: "url", label: "URL (Streamable HTTP)", placeholder: "https://server.example/mcp" }, { key: "token", label: "Bearer token", secret: true }] },
  webhook: { label: "Webhook-URL (Teams/Slack)", fields: [{ key: "url", label: "URL", secret: true }] },
  generic: { label: "Algemeen (sleutel/waarde)", fields: [] },
  plugin: { label: "Plugin (connector)", fields: [] } // velden komen uit de plugin-definitie
};

export interface Credential {
  name: string;
  type: CredType;
  plugin?: string; // bij type "plugin": id van de connector (bv. "slack")
  description?: string;
  // per omgeving: veld -> waarde (geheime velden versleuteld: "enc:v1:<iv>:<tag>:<data>")
  values: Partial<Record<EnvName, Record<string, string>>>;
  updatedAt: string;
}

export const MASK = "••••••";

function keyBytes(): Buffer {
  const secret = process.env.AIP_SECRET_KEY ?? "aip-dev-insecure-key-verander-mij";
  return createHash("sha256").update(secret).digest();
}
export const usingDefaultKey = () => !process.env.AIP_SECRET_KEY;

function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", keyBytes(), iv);
  const data = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return `enc:v1:${iv.toString("base64")}:${c.getAuthTag().toString("base64")}:${data.toString("base64")}`;
}
function decrypt(v: string): string {
  if (!v.startsWith("enc:v1:")) return v;
  const [, , iv, tag, data] = v.split(":");
  const d = createDecipheriv("aes-256-gcm", keyBytes(), Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(data, "base64")), d.final()]).toString("utf8");
}

function isSecret(type: CredType, key: string): boolean {
  const f = CRED_TYPES[type]?.fields.find((x) => x.key === key);
  if (f) return Boolean(f.secret);
  // generic: velden met typische geheime namen versleutelen
  return /pass|secret|token|key/i.test(key);
}

class Credentials {
  private items = new Map<string, Credential>();

  async hydrate(): Promise<void> {
    for (const { doc } of await persistence.loadAll("credentials")) {
      const c = doc as Credential;
      this.items.set(c.name, c);
    }
  }

  // Publieke weergave: geheime waarden gemaskeerd; per omgeving welke velden gevuld zijn.
  view(c: Credential) {
    const values: Partial<Record<EnvName, Record<string, string>>> = {};
    for (const env of ENVIRONMENTS) {
      const v = c.values[env];
      if (!v) continue;
      values[env] = Object.fromEntries(Object.entries(v).map(([k, val]) => [k, isSecret(c.type, k) ? (val ? MASK : "") : val]));
    }
    const connected = c.type === "plugin" ? ENVIRONMENTS.filter((e) => c.values[e]?.accessToken) : undefined;
    return { name: c.name, type: c.type, plugin: c.plugin, connected, typeLabel: CRED_TYPES[c.type]?.label, description: c.description, envs: ENVIRONMENTS.filter((e) => c.values[e] && Object.keys(c.values[e]!).length), values, updatedAt: c.updatedAt };
  }

  list() {
    return [...this.items.values()].sort((a, b) => a.name.localeCompare(b.name)).map((c) => this.view(c));
  }
  get(name: string) {
    const c = this.items.get(name);
    return c ? this.view(c) : undefined;
  }

  // Opslaan. Een geheim veld met waarde MASK (of weggelaten) behoudt de bestaande waarde.
  upsert(input: { name: string; type: CredType; plugin?: string; description?: string; values?: Partial<Record<EnvName, Record<string, string>>> }, actor: string) {
    if (input.type === "plugin" && !input.plugin) throw new Error("Kies de plugin (connector) van deze koppeling");
    if (!/^[A-Za-z][A-Za-z0-9_.-]{1,63}$/.test(input.name)) throw new Error("Naam: begin met een letter, 2–64 tekens (letters, cijfers, . _ -).");
    if (!CRED_TYPES[input.type]) throw new Error(`Onbekend type: ${input.type}`);
    const prev = this.items.get(input.name);
    const values: Credential["values"] = {};
    for (const env of ENVIRONMENTS) {
      const incoming = input.values?.[env];
      const old = prev?.type === input.type && prev?.plugin === input.plugin ? prev.values[env] ?? {} : {};
      if (!incoming) { if (Object.keys(old).length) values[env] = old; continue; }
      const merged: Record<string, string> = {};
      for (const [k, raw] of Object.entries(incoming)) {
        const v = String(raw ?? "");
        if (isSecret(input.type, k)) {
          if (v === MASK) { if (old[k]) merged[k] = old[k]; }
          else if (v) merged[k] = encrypt(v);
        } else if (v !== "") merged[k] = v;
      }
      // OAuth-tokens die al verkregen zijn blijven behouden bij het bewerken
      for (const k of ["accessToken", "refreshToken", "expiresAt"]) if (old[k] && !(k in incoming)) merged[k] = old[k];
      if (Object.keys(merged).length) values[env] = merged;
    }
    const c: Credential = { name: input.name, type: input.type, ...(input.type === "plugin" ? { plugin: input.plugin } : {}), description: input.description, values, updatedAt: new Date().toISOString() };
    this.items.set(c.name, c);
    persistence.put("credentials", c.name, c);
    audit.append({ actor, event: prev ? "credential.updated" : "credential.created", subject: c.name, data: { type: c.type, envs: Object.keys(values) } });
    bus.publish("credential.changed", { name: c.name, type: c.type });
    return this.view(c);
  }

  // Waarden van één omgeving bijwerken (bv. OAuth-tokens na verbinden of verversen).
  patchValues(name: string, env: EnvName, patch: Record<string, string>, actor: string): void {
    const d = this.delivered.get(`${env}:${name}`);
    if (d) { Object.assign(d.values, patch); return; } // agent: alleen in het geheugen
    const c = this.items.get(name);
    if (!c) throw new Error(`Koppeling '${name}' bestaat niet`);
    const cur = { ...(c.values[env] ?? {}) };
    for (const [k, v] of Object.entries(patch)) cur[k] = isSecret(c.type, k) ? encrypt(v) : v;
    c.values[env] = cur;
    c.updatedAt = new Date().toISOString();
    persistence.put("credentials", c.name, c);
    if (actor !== "oauth-refresh") audit.append({ actor, event: "credential.updated", subject: c.name, data: { env, keys: Object.keys(patch) } });
  }
  pluginOf(name: string): string | undefined { return this.items.get(name)?.plugin; }

  remove(name: string, actor: string): boolean {
    if (!this.items.delete(name)) return false;
    persistence.delete("credentials", name);
    audit.append({ actor, event: "credential.deleted", subject: name });
    bus.publish("credential.changed", { name, deleted: true });
    return true;
  }

  // Voor de engine: ontsleutelde waarden van één omgeving.
  // Agent (AWS/Azure): het portaal levert per job de ontsleutelde waarden die het proces nodig heeft.
  private delivered = new Map<string, { type: CredType; values: Record<string, string> }>();
  useDelivered(env: EnvName, map: Record<string, { type: string; values: Record<string, string> }>): void {
    for (const [name, v] of Object.entries(map)) this.delivered.set(`${env}:${name}`, v as { type: CredType; values: Record<string, string> });
  }

  resolve(name: string, env: EnvName): { type: CredType; values: Record<string, string> } {
    const d = this.delivered.get(`${env}:${name}`);
    if (d) return d;
    const c = this.items.get(name);
    if (!c) throw new Error(`Koppeling '${name}' bestaat niet`);
    const v = c.values[env];
    if (!v || !Object.keys(v).length) throw new Error(`Koppeling '${name}' heeft geen waarden voor ${env.toUpperCase()}`);
    return { type: c.type, values: Object.fromEntries(Object.entries(v).map(([k, val]) => [k, decrypt(val)])) };
  }
}

export const credentials = scoped("credentials", () => new Credentials());
