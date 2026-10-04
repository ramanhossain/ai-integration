import { createPublicKey, createHmac, timingSafeEqual, verify as cryptoVerify, constants, type JsonWebKey } from "node:crypto";
import { safeFetch } from "../net/egress";

// JWT-verificatie voor OAuth-identiteiten van API-beleid (bearer tokens van een externe
// identity provider zoals Entra ID, Auth0, Keycloak of Okta). Sleutels via JWKS (gecachet).
// Ondersteund: RS256/384/512, PS256/384/512, ES256/384/512 en HS256/384/512 (gedeeld geheim).

export interface Issuer { id: string; name: string; issuer: string; audience?: string; jwksUri?: string; hsSecret?: string }
export type Claims = Record<string, unknown>;

const b64 = (s: string) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
const jwksCache = new Map<string, { at: number; keys: Array<JsonWebKey & { kid?: string }> }>();

// null = geen JWT (dan mag een volgende authenticatiemethode het proberen).
export function parseJwt(token: string): { header: Record<string, unknown>; payload: Claims; signed: string; sig: Buffer } | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const header = JSON.parse(b64(parts[0]).toString("utf8")) as Record<string, unknown>;
    const payload = JSON.parse(b64(parts[1]).toString("utf8")) as Claims;
    if (typeof header !== "object" || typeof payload !== "object" || !header.alg) return null;
    return { header, payload, signed: `${parts[0]}.${parts[1]}`, sig: b64(parts[2]) };
  } catch { return null; }
}

async function jwks(uri: string, force = false): Promise<Array<JsonWebKey & { kid?: string }>> {
  const hit = jwksCache.get(uri);
  if (hit && !force && Date.now() - hit.at < 10 * 60_000) return hit.keys;
  const res = await safeFetch(uri, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`JWKS ophalen mislukt (${res.status})`);
  const body = (await res.json()) as { keys?: Array<JsonWebKey & { kid?: string }> };
  const keys = Array.isArray(body.keys) ? body.keys : [];
  jwksCache.set(uri, { at: Date.now(), keys });
  return keys;
}

const HASH: Record<string, string> = { "256": "sha256", "384": "sha384", "512": "sha512" };

// Geeft de claims terug of gooit een fout (ongeldig token).
export async function verifyJwt(token: string, issuers: Issuer[]): Promise<{ claims: Claims; issuer: Issuer }> {
  const jwt = parseJwt(token);
  if (!jwt) throw new Error("Geen geldig JWT");
  const alg = String(jwt.header.alg);
  const iss = String(jwt.payload.iss || "");
  const issuer = issuers.find((i) => i.issuer.replace(/\/$/, "") === iss.replace(/\/$/, ""));
  if (!issuer) throw new Error("Onbekende uitgever (iss)");
  const m = alg.match(/^(RS|PS|ES|HS)(256|384|512)$/);
  if (!m) throw new Error(`Algoritme ${alg} wordt niet ondersteund`);
  const hash = HASH[m[2]];
  let ok = false;
  if (m[1] === "HS") {
    if (!issuer.hsSecret) throw new Error("Geen gedeeld geheim voor HS-tokens");
    const mac = createHmac(hash, issuer.hsSecret).update(jwt.signed).digest();
    ok = mac.length === jwt.sig.length && timingSafeEqual(mac, jwt.sig);
  } else {
    if (!issuer.jwksUri) throw new Error("Geen JWKS-URI ingesteld");
    const kid = jwt.header.kid as string | undefined;
    let keys = await jwks(issuer.jwksUri);
    let jwk = keys.find((k) => (!kid || k.kid === kid) && (!k.use || k.use === "sig"));
    if (!jwk && kid) { keys = await jwks(issuer.jwksUri, true); jwk = keys.find((k) => k.kid === kid); } // sleutelrotatie
    if (!jwk) throw new Error("Sleutel (kid) niet gevonden in JWKS");
    const key = createPublicKey({ key: jwk, format: "jwk" });
    const opts = m[1] === "PS" ? { key, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: constants.RSA_PSS_SALTLEN_DIGEST }
      : m[1] === "ES" ? { key, dsaEncoding: "ieee-p1363" as const } : { key };
    ok = cryptoVerify(hash, Buffer.from(jwt.signed), opts, jwt.sig);
  }
  if (!ok) throw new Error("Handtekening ongeldig");
  const now = Math.floor(Date.now() / 1000);
  const exp = Number(jwt.payload.exp), nbf = Number(jwt.payload.nbf);
  if (Number.isFinite(exp) && now > exp + 60) throw new Error("Token verlopen");
  if (Number.isFinite(nbf) && now + 60 < nbf) throw new Error("Token nog niet geldig");
  if (issuer.audience) {
    const aud = jwt.payload.aud;
    const list = Array.isArray(aud) ? aud.map(String) : aud === undefined ? [] : [String(aud)];
    if (!list.includes(issuer.audience)) throw new Error("Audience (aud) klopt niet");
  }
  return { claims: jwt.payload, issuer };
}

// Claim-regels: Exists, Exact, Regex — allemaal moeten kloppen.
export interface ClaimRule { claim: string; op: "exists" | "exact" | "regex"; value?: string }
export function claimValue(claims: Claims, path: string): unknown {
  return path.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), claims);
}
export function checkRules(claims: Claims, rules: ClaimRule[] = []): string | null {
  for (const r of rules) {
    const v = claimValue(claims, r.claim);
    const vals = Array.isArray(v) ? v.map(String) : v === undefined || v === null ? [] : [String(v)];
    if (r.op === "exists" && !vals.length) return `Claim '${r.claim}' ontbreekt`;
    if (r.op === "exact" && !vals.includes(String(r.value ?? ""))) return `Claim '${r.claim}' heeft niet de vereiste waarde`;
    if (r.op === "regex") {
      let re: RegExp;
      try { re = new RegExp(String(r.value ?? "")); } catch { return `Ongeldige regex voor '${r.claim}'`; }
      if (!vals.some((x) => re.test(x))) return `Claim '${r.claim}' voldoet niet aan de regel`;
    }
  }
  return null;
}
