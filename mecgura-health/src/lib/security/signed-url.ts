import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Short-lived signed access tokens for private files. The token binds WHO (subject), WHAT (resource path), the tenant and an expiry;
 * changing any of them, or waiting past the expiry, makes it invalid. A signed URL is only an extra gate in front of the normal authorization check — it never replaces it.
 * (The product currently stores no uploaded patient files — documents are generated per request behind authentication — so this is the mechanism future file storage must use.)
 */
export interface SignedClaims { r: string; t: string; s: string; e: number }
const b64 = (s: string) => Buffer.from(s).toString("base64url");
export function signAccess(secret: string, c: { resource: string; tenantId: string; subject: string; ttlSeconds: number; now?: number }): string {
  if (c.ttlSeconds <= 0 || c.ttlSeconds > 3600) throw new RangeError("ttl must be 1..3600 seconds");
  const claims: SignedClaims = { r: c.resource, t: c.tenantId, s: c.subject, e: Math.floor((c.now ?? Date.now()) / 1000) + c.ttlSeconds };
  const body = b64(JSON.stringify(claims)); return `${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`;
}
export function verifyAccess(secret: string, token: string, expect: { resource: string; tenantId: string; subject: string; now?: number }): boolean {
  const [body, sig] = token.split("."); if (!body || !sig) return false;
  const want = createHmac("sha256", secret).update(body).digest("base64url"); const a = Buffer.from(sig), b = Buffer.from(want); if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  let c: SignedClaims; try { c = JSON.parse(Buffer.from(body, "base64url").toString("utf8")); } catch { return false; }
  return c.e >= Math.floor((expect.now ?? Date.now()) / 1000) && c.r === expect.resource && c.t === expect.tenantId && c.s === expect.subject;
}
