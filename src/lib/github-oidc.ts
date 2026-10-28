import { createPublicKey, verify, type JsonWebKey } from "node:crypto";

/**
 * Verifies a GitHub Actions OIDC token, so the repository's scheduled workflow can call the scheduler without a stored
 * secret. Only tokens GitHub signed for this repository, with our audience and not expired, are accepted.
 */
const ISSUER = "https://token.actions.githubusercontent.com";
export const SCHEDULER_AUDIENCE = "mecgura-scheduler";
const JWKS_URL = `${ISSUER}/.well-known/jwks`;

type Jwk = JsonWebKey & { kid?: string };
let cache: { at: number; keys: Jwk[] } | null = null;

async function keys(force = false): Promise<Jwk[]> {
  if (!force && cache && Date.now() - cache.at < 60 * 60_000) return cache.keys;
  const res = await fetch(JWKS_URL, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error("Could not load GitHub signing keys");
  const body = (await res.json()) as { keys?: Jwk[] };
  cache = { at: Date.now(), keys: body.keys ?? [] };
  return cache.keys;
}

const b64 = (s: string) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");

export type GithubClaims = { iss: string; aud: string | string[]; exp: number; nbf?: number; repository: string; event_name?: string; ref?: string };

/** Returns the token's claims when it is a valid GitHub Actions token for `repository`, otherwise null. */
export async function verifyGithubOidc(token: string, repository: string): Promise<GithubClaims | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const header = JSON.parse(b64(parts[0]).toString("utf8")) as { alg?: string; kid?: string };
    if (header.alg !== "RS256" || !header.kid) return null;
    let jwk = (await keys()).find((k) => k.kid === header.kid);
    if (!jwk) jwk = (await keys(true)).find((k) => k.kid === header.kid);
    if (!jwk) return null;
    const ok = verify("RSA-SHA256", Buffer.from(`${parts[0]}.${parts[1]}`), createPublicKey({ key: jwk, format: "jwk" }), b64(parts[2]));
    if (!ok) return null;
    const c = JSON.parse(b64(parts[1]).toString("utf8")) as GithubClaims;
    const now = Math.floor(Date.now() / 1000);
    const aud = Array.isArray(c.aud) ? c.aud : [c.aud];
    if (c.iss !== ISSUER || !aud.includes(SCHEDULER_AUDIENCE)) return null;
    if (typeof c.exp !== "number" || c.exp < now - 30 || (c.nbf && c.nbf > now + 30)) return null;
    if (c.repository?.toLowerCase() !== repository.toLowerCase()) return null;
    return c;
  } catch {
    return null;
  }
}
