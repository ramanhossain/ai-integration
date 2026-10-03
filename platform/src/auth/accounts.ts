import { randomBytes, scrypt as scryptCb, createHash, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { persistence } from "../store";
import { ENVIRONMENTS, type EnvName } from "../domain/environments";
import { DEFAULT_ORG } from "../tenancy/context";

// Accounts en organisaties (iPaaS). Platformbreed opgeslagen (collecties met "_").
// - Organisatie: een klant met eigen, afgeschermde gegevens.
// - Gebruiker: hoort bij één organisatie, rol beheerder of gebruiker, toegang per omgeving.
// - Hoofdaccount (superAdmin): ziet en beheert alle organisaties en accounts.
// Wachtwoorden: scrypt met zout. Sessies, reset-/uitnodigingstokens en API-sleutels
// worden alleen als SHA-256-hash bewaard.

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

export type Role = "beheerder" | "gebruiker";
export type Access = "none" | "view" | "edit";
export type EnvAccess = Record<EnvName, Access>;
export interface Org { id: string; name: string; createdAt: string; createdBy?: string; disabled?: boolean }
export interface User {
  id: string; email: string; name: string; orgId: string; role: Role; envAccess: EnvAccess;
  superAdmin?: boolean; passwordHash?: string; disabled?: boolean;
  createdAt: string; createdBy?: string; invitedAt?: string; lastLoginAt?: string; lastSeenAt?: string; loginCount?: number;
}
export interface Session { id: string; userId: string; createdAt: string; expiresAt: string; lastSeenAt: string; ip?: string; ua?: string }
export interface Token { id: string; userId: string; kind: "reset" | "invite"; expiresAt: string; usedAt?: string }
export interface ApiKey { id: string; orgId: string; name: string; hint: string; createdAt: string; createdBy: string; lastUsedAt?: string }
export interface PlatformSettings { signupOpen: boolean }
export type PublicUser = Omit<User, "passwordHash"> & { hasPassword: boolean };

export const FULL_ACCESS: EnvAccess = { dev: "edit", test: "edit", acc: "edit", prod: "edit" };
const SESSION_DAYS = 14;
export const PASSWORD_MIN = 10;

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const token = (prefix = "") => prefix + randomBytes(32).toString("base64url");
const now = () => new Date().toISOString();
export const normEmail = (e: string) => String(e || "").trim().toLowerCase();
const validEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const h = await scrypt(pw, salt, 64);
  return `scrypt$${salt.toString("base64")}$${h.toString("base64")}`;
}
async function verifyPassword(pw: string, stored?: string): Promise<boolean> {
  if (!stored) return false;
  const [kind, s, h] = stored.split("$");
  if (kind !== "scrypt" || !s || !h) return false;
  const want = Buffer.from(h, "base64");
  const got = await scrypt(pw, Buffer.from(s, "base64"), want.length);
  return got.length === want.length && timingSafeEqual(got, want);
}
const DUMMY_HASH = `scrypt$${randomBytes(16).toString("base64")}$${randomBytes(64).toString("base64")}`;
export function checkPassword(pw: string): string | null {
  if (typeof pw !== "string" || pw.length < PASSWORD_MIN) return `Het wachtwoord moet minstens ${PASSWORD_MIN} tekens hebben`;
  if (pw.length > 200) return "Het wachtwoord is te lang";
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return "Gebruik letters én cijfers in het wachtwoord";
  return null;
}
export function normAccess(a: Partial<Record<string, string>> | undefined, fallback: EnvAccess): EnvAccess {
  const out = { ...fallback };
  for (const e of ENVIRONMENTS) { const v = a?.[e]; if (v === "none" || v === "view" || v === "edit") out[e] = v; }
  return out;
}
const slugify = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32) || "org";

class Accounts {
  private orgs = new Map<string, Org>();
  private users = new Map<string, User>();
  private sessions = new Map<string, Session>(); // key = hash van sessietoken
  private tokens = new Map<string, Token>(); // key = hash
  private keys = new Map<string, ApiKey & { hash: string }>(); // key = hash
  private platform: PlatformSettings = { signupOpen: true };
  private attempts = new Map<string, number[]>();

  async hydrate(): Promise<void> {
    for (const { doc } of await persistence.loadAll("_orgs")) { const o = doc as Org; this.orgs.set(o.id, o); }
    for (const { doc } of await persistence.loadAll("_users")) { const u = doc as User; this.users.set(u.id, u); }
    for (const { id, doc } of await persistence.loadAll("_sessions")) this.sessions.set(id, doc as Session);
    for (const { id, doc } of await persistence.loadAll("_tokens")) this.tokens.set(id, doc as Token);
    for (const { id, doc } of await persistence.loadAll("_apikeys")) this.keys.set(id, { ...(doc as ApiKey), hash: id });
    const p = (await persistence.loadAll("_platform")).find((r) => r.id === "settings");
    if (p) this.platform = { ...this.platform, ...(p.doc as PlatformSettings) };
    if (process.env.AIP_SIGNUP === "off") this.platform.signupOpen = false;
    // Verlopen sessies en tokens opruimen.
    const t = Date.now();
    for (const [k, s] of this.sessions) if (Date.parse(s.expiresAt) < t) { this.sessions.delete(k); persistence.delete("_sessions", k); }
    for (const [k, x] of this.tokens) if (Date.parse(x.expiresAt) < t || x.usedAt) { this.tokens.delete(k); persistence.delete("_tokens", k); }
    if (!this.orgs.has(DEFAULT_ORG) && this.users.size) this.ensureDefaultOrg("Hoofdorganisatie");
  }

  // ---------- organisaties ----------
  orgIds(): string[] { return [...new Set([DEFAULT_ORG, ...this.orgs.keys()])]; }
  listOrgs(): Org[] { return [...this.orgs.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt)); }
  getOrg(id: string): Org | undefined { return this.orgs.get(id); }
  private saveOrg(o: Org): void { this.orgs.set(o.id, o); persistence.put("_orgs", o.id, o); }
  ensureDefaultOrg(name: string, by?: string): Org {
    const o = this.orgs.get(DEFAULT_ORG) ?? { id: DEFAULT_ORG, name: name.trim().slice(0, 80) || "Hoofdorganisatie", createdAt: now(), createdBy: by };
    this.saveOrg(o);
    return o;
  }
  createOrg(name: string, by?: string): Org {
    const clean = String(name || "").trim().slice(0, 80);
    if (clean.length < 2) throw new Error("Geef de organisatie een naam (minstens 2 tekens)");
    let id = slugify(clean);
    if (id === DEFAULT_ORG || id === "o" || id === "api") id = `${id}-org`;
    for (let i = 2; this.orgs.has(id); i++) id = `${slugify(clean).slice(0, 28)}-${i}`;
    const o: Org = { id, name: clean, createdAt: now(), createdBy: by };
    this.saveOrg(o);
    return o;
  }
  // Alleen om een mislukte aanmelding terug te draaien (organisatie zonder accounts).
  discardOrg(id: string): void {
    if (id === DEFAULT_ORG || [...this.users.values()].some((u) => u.orgId === id)) return;
    this.orgs.delete(id);
    persistence.delete("_orgs", id);
  }
  // Controle vooraf, zodat er bij een fout geen halve organisatie ontstaat.
  validateNewUser(input: { email: string; name: string; password?: string }): void {
    const email = normEmail(input.email);
    if (!validEmail(email)) throw new Error("Ongeldig e-mailadres");
    if (this.byEmail(email)) throw new Error("Er bestaat al een account met dit e-mailadres");
    if (String(input.name || "").trim().length < 2) throw new Error("Geef een naam op (minstens 2 tekens)");
    if (input.password !== undefined) { const err = checkPassword(input.password); if (err) throw new Error(err); }
  }
  updateOrg(id: string, patch: { name?: string; disabled?: boolean }): Org {
    const o = this.orgs.get(id);
    if (!o) throw new Error("Organisatie niet gevonden");
    if (patch.name !== undefined) { const n = String(patch.name).trim().slice(0, 80); if (n.length < 2) throw new Error("Naam te kort"); o.name = n; }
    if (patch.disabled !== undefined) {
      if (id === DEFAULT_ORG && patch.disabled) throw new Error("De hoofdorganisatie kan niet worden uitgeschakeld");
      o.disabled = Boolean(patch.disabled);
      if (o.disabled) for (const u of this.users.values()) if (u.orgId === id) this.endSessions(u.id);
    }
    this.saveOrg(o);
    return o;
  }

  // ---------- gebruikers ----------
  view(u: User): PublicUser { const { passwordHash, ...rest } = u; return { ...rest, hasPassword: Boolean(passwordHash) }; }
  count(): number { return this.users.size; }
  listUsers(orgId?: string): User[] { return [...this.users.values()].filter((u) => !orgId || u.orgId === orgId).sort((a, b) => a.createdAt.localeCompare(b.createdAt)); }
  getUser(id: string): User | undefined { return this.users.get(id); }
  byEmail(email: string): User | undefined { const e = normEmail(email); return [...this.users.values()].find((u) => u.email === e); }
  private saveUser(u: User): void { this.users.set(u.id, u); persistence.put("_users", u.id, u); }
  async createUser(input: { email: string; name: string; orgId: string; role?: Role; envAccess?: Partial<EnvAccess>; password?: string; superAdmin?: boolean }, by?: string): Promise<User> {
    const email = normEmail(input.email);
    if (!validEmail(email)) throw new Error("Ongeldig e-mailadres");
    if (this.byEmail(email)) throw new Error("Er bestaat al een account met dit e-mailadres");
    const name = String(input.name || "").trim().slice(0, 80);
    if (name.length < 2) throw new Error("Geef een naam op (minstens 2 tekens)");
    if (!this.orgs.has(input.orgId)) throw new Error("Organisatie niet gevonden");
    if (input.password !== undefined) { const err = checkPassword(input.password); if (err) throw new Error(err); }
    const role: Role = input.role === "beheerder" ? "beheerder" : "gebruiker";
    const u: User = {
      id: randomBytes(9).toString("base64url"), email, name, orgId: input.orgId, role,
      envAccess: role === "beheerder" ? { ...FULL_ACCESS } : normAccess(input.envAccess, { dev: "edit", test: "view", acc: "view", prod: "view" }),
      superAdmin: input.superAdmin || undefined,
      passwordHash: input.password ? await hashPassword(input.password) : undefined,
      createdAt: now(), createdBy: by, invitedAt: input.password ? undefined : now(), loginCount: 0
    };
    this.saveUser(u);
    return u;
  }
  updateUser(id: string, patch: { name?: string; role?: Role; envAccess?: Partial<EnvAccess>; disabled?: boolean; superAdmin?: boolean }, actorId?: string): User {
    const u = this.users.get(id);
    if (!u) throw new Error("Account niet gevonden");
    if (patch.name !== undefined) { const n = String(patch.name).trim().slice(0, 80); if (n.length < 2) throw new Error("Naam te kort"); u.name = n; }
    if (patch.role !== undefined && patch.role !== u.role) {
      if (u.role === "beheerder" && this.listUsers(u.orgId).filter((x) => x.role === "beheerder" && !x.disabled).length <= 1) throw new Error("Een organisatie heeft minstens één beheerder nodig");
      u.role = patch.role === "beheerder" ? "beheerder" : "gebruiker";
      if (u.role === "beheerder") u.envAccess = { ...FULL_ACCESS };
    }
    if (patch.envAccess && u.role !== "beheerder") u.envAccess = normAccess(patch.envAccess, u.envAccess);
    if (patch.disabled !== undefined) {
      if (id === actorId && patch.disabled) throw new Error("Je kunt je eigen account niet uitschakelen");
      if (patch.disabled && u.superAdmin && this.superAdmins().length <= 1) throw new Error("Het laatste hoofdaccount kan niet worden uitgeschakeld");
      if (patch.disabled && u.role === "beheerder" && this.listUsers(u.orgId).filter((x) => x.role === "beheerder" && !x.disabled).length <= 1) throw new Error("Een organisatie heeft minstens één actieve beheerder nodig");
      u.disabled = Boolean(patch.disabled) || undefined;
      if (u.disabled) this.endSessions(u.id);
    }
    if (patch.superAdmin !== undefined) {
      if (!patch.superAdmin && u.superAdmin && this.superAdmins().length <= 1) throw new Error("Er moet minstens één hoofdaccount blijven");
      u.superAdmin = patch.superAdmin || undefined;
    }
    this.saveUser(u);
    return u;
  }
  deleteUser(id: string, actorId?: string): void {
    const u = this.users.get(id);
    if (!u) throw new Error("Account niet gevonden");
    if (id === actorId) throw new Error("Je kunt je eigen account niet verwijderen");
    if (u.superAdmin && this.superAdmins().length <= 1) throw new Error("Het laatste hoofdaccount kan niet worden verwijderd");
    if (u.role === "beheerder" && this.listUsers(u.orgId).filter((x) => x.role === "beheerder").length <= 1) throw new Error("De laatste beheerder van een organisatie kan niet worden verwijderd");
    this.endSessions(id);
    for (const [k, t] of this.tokens) if (t.userId === id) { this.tokens.delete(k); persistence.delete("_tokens", k); }
    this.users.delete(id);
    persistence.delete("_users", id);
  }
  superAdmins(): User[] { return [...this.users.values()].filter((u) => u.superAdmin && !u.disabled); }
  async setPassword(id: string, pw: string): Promise<void> {
    const err = checkPassword(pw);
    if (err) throw new Error(err);
    const u = this.users.get(id);
    if (!u) throw new Error("Account niet gevonden");
    u.passwordHash = await hashPassword(pw);
    u.invitedAt = undefined;
    this.endSessions(id);
    this.saveUser(u);
  }
  async changePassword(id: string, current: string, pw: string): Promise<void> {
    const u = this.users.get(id);
    if (!u || !(await verifyPassword(current, u.passwordHash))) throw new Error("Huidig wachtwoord klopt niet");
    await this.setPassword(id, pw);
  }

  // ---------- inloggen ----------
  // Max. 10 mislukte pogingen per 15 minuten per e-mail+IP.
  private limited(key: string): boolean {
    const t = Date.now();
    const list = (this.attempts.get(key) || []).filter((x) => t - x < 15 * 60_000);
    this.attempts.set(key, list);
    return list.length >= 10;
  }
  async login(email: string, pw: string, meta: { ip?: string; ua?: string }): Promise<{ user: User; token: string }> {
    const key = `${normEmail(email)}|${meta.ip || ""}`;
    if (this.limited(key)) throw Object.assign(new Error("Te veel pogingen. Probeer het over een kwartier opnieuw."), { status: 429 });
    const u = this.byEmail(email);
    // Altijd een scrypt-berekening, zodat de responstijd niet verraadt of een account bestaat.
    const ok = await verifyPassword(pw, u?.passwordHash ?? DUMMY_HASH);
    if (!u || !ok) { this.attempts.get(key)!.push(Date.now()); throw Object.assign(new Error("E-mailadres of wachtwoord klopt niet"), { status: 401 }); }
    if (u.disabled) throw Object.assign(new Error("Dit account is uitgeschakeld"), { status: 403 });
    if (this.orgs.get(u.orgId)?.disabled) throw Object.assign(new Error("Deze organisatie is uitgeschakeld"), { status: 403 });
    this.attempts.delete(key);
    return { user: u, token: this.startSession(u, meta) };
  }
  startSession(u: User, meta: { ip?: string; ua?: string } = {}): string {
    const t = token("s_");
    const s: Session = { id: sha(t).slice(0, 16), userId: u.id, createdAt: now(), expiresAt: new Date(Date.now() + SESSION_DAYS * 86400_000).toISOString(), lastSeenAt: now(), ip: meta.ip, ua: meta.ua?.slice(0, 200) };
    this.sessions.set(sha(t), s);
    persistence.put("_sessions", sha(t), s);
    u.lastLoginAt = now();
    u.lastSeenAt = u.lastLoginAt;
    u.loginCount = (u.loginCount || 0) + 1;
    this.saveUser(u);
    return t;
  }
  // Sessietoken -> gebruiker (glijdende vervaldatum; lastSeen max. 1×/minuut opslaan).
  resolveSession(t: string | undefined): User | undefined {
    if (!t) return undefined;
    const k = sha(t);
    const s = this.sessions.get(k);
    if (!s) return undefined;
    if (Date.parse(s.expiresAt) < Date.now()) { this.sessions.delete(k); persistence.delete("_sessions", k); return undefined; }
    const u = this.users.get(s.userId);
    if (!u || u.disabled || this.orgs.get(u.orgId)?.disabled) return undefined;
    if (Date.now() - Date.parse(s.lastSeenAt) > 60_000) {
      s.lastSeenAt = now();
      s.expiresAt = new Date(Date.now() + SESSION_DAYS * 86400_000).toISOString();
      persistence.put("_sessions", k, s);
      u.lastSeenAt = s.lastSeenAt;
      this.saveUser(u);
    }
    return u;
  }
  endSession(t: string | undefined): void { if (!t) return; const k = sha(t); this.sessions.delete(k); persistence.delete("_sessions", k); }
  endSessions(userId: string): void { for (const [k, s] of this.sessions) if (s.userId === userId) { this.sessions.delete(k); persistence.delete("_sessions", k); } }

  // ---------- reset- en uitnodigingstokens ----------
  issueToken(userId: string, kind: "reset" | "invite"): string {
    for (const [k, t] of this.tokens) if (t.userId === userId && t.kind === kind) { this.tokens.delete(k); persistence.delete("_tokens", k); }
    const t = token();
    const hours = kind === "invite" ? 72 : 1;
    const rec: Token = { id: sha(t).slice(0, 12), userId, kind, expiresAt: new Date(Date.now() + hours * 3600_000).toISOString() };
    this.tokens.set(sha(t), rec);
    persistence.put("_tokens", sha(t), rec);
    return t;
  }
  peekToken(t: string): { user: User; kind: Token["kind"] } | undefined {
    const rec = this.tokens.get(sha(String(t || "")));
    if (!rec || rec.usedAt || Date.parse(rec.expiresAt) < Date.now()) return undefined;
    const user = this.users.get(rec.userId);
    return user && !user.disabled ? { user, kind: rec.kind } : undefined;
  }
  async useToken(t: string, pw: string): Promise<User> {
    const hit = this.peekToken(t);
    if (!hit) throw new Error("Deze link is ongeldig of verlopen. Vraag een nieuwe aan.");
    await this.setPassword(hit.user.id, pw);
    const k = sha(t);
    this.tokens.delete(k);
    persistence.delete("_tokens", k);
    return hit.user;
  }

  // ---------- API-sleutels (per organisatie; voor MCP, scripts en CI) ----------
  listKeys(orgId: string): ApiKey[] { return [...this.keys.values()].filter((k) => k.orgId === orgId).map(({ hash: _h, ...k }) => k); }
  createKey(orgId: string, name: string, by: string): { key: string; info: ApiKey } {
    const n = String(name || "").trim().slice(0, 60);
    if (n.length < 2) throw new Error("Geef de sleutel een naam");
    const key = token("aip_");
    const info: ApiKey = { id: randomBytes(6).toString("hex"), orgId, name: n, hint: key.slice(-4), createdAt: now(), createdBy: by };
    this.keys.set(sha(key), { ...info, hash: sha(key) });
    persistence.put("_apikeys", sha(key), info);
    return { key, info };
  }
  deleteKey(orgId: string, id: string): boolean {
    for (const [h, k] of this.keys) if (k.orgId === orgId && k.id === id) { this.keys.delete(h); persistence.delete("_apikeys", h); return true; }
    return false;
  }
  resolveKey(key: string | undefined): ApiKey | undefined {
    if (!key || !key.startsWith("aip_")) return undefined;
    const k = this.keys.get(sha(key));
    if (!k || this.orgs.get(k.orgId)?.disabled) return undefined;
    if (!k.lastUsedAt || Date.now() - Date.parse(k.lastUsedAt) > 60_000) { k.lastUsedAt = now(); const { hash: h, ...info } = k; persistence.put("_apikeys", h, info); }
    const { hash: _h, ...info } = k;
    return info;
  }

  // ---------- platform ----------
  getPlatform(): PlatformSettings { return { ...this.platform }; }
  setPlatform(patch: Partial<PlatformSettings>): PlatformSettings {
    if (typeof patch.signupOpen === "boolean") this.platform.signupOpen = patch.signupOpen;
    persistence.put("_platform", "settings", this.platform);
    return this.getPlatform();
  }
}

export const accounts = new Accounts();
export { ENVIRONMENTS };
