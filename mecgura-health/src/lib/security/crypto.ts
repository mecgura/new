import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Key management for application-level secrets (MFA secrets, audit integrity).
 *  - SECURITY_KEYS="k2:<base64 32 bytes>,k1:<base64 32 bytes>"  — the FIRST entry encrypts/signs new data, every entry can still read old data → rotate by prepending a new key.
 *  - Without SECURITY_KEYS a key is derived from AUTH_SECRET (id "auth"). That works but ties data to the session secret; production readiness reports it as a WARNING.
 *  - Purpose strings give every use its own sub-key (HKDF), so an MFA key can never forge an audit signature.
 *  - Keys live in the environment / a secrets manager, never in the database next to the data they protect.
 */
interface KeyEntry { id: string; key: Buffer }
let ring: KeyEntry[] | null = null;
let ringFor = "";
export function keyring(): KeyEntry[] {
  const raw = process.env.SECURITY_KEYS ?? ""; const auth = process.env.AUTH_SECRET ?? "";
  const stamp = raw + "|" + auth;
  if (ring && ringFor === stamp) return ring;
  const out: KeyEntry[] = [];
  for (const part of raw.split(",").map((s) => s.trim()).filter(Boolean)) {
    const i = part.indexOf(":"); const id = part.slice(0, i); const b = Buffer.from(part.slice(i + 1), "base64");
    if (i > 0 && /^[A-Za-z0-9_-]{1,16}$/.test(id) && b.length === 32) out.push({ id, key: b });
  }
  if (auth.length >= 16) out.push({ id: "auth", key: createHash("sha256").update(`mecgura-security-v1:${auth}`).digest() });
  if (!out.length) out.push({ id: "dev", key: createHash("sha256").update("mecgura-dev-insecure-key").digest() }); // only reachable without AUTH_SECRET (tests / first boot)
  ring = out; ringFor = stamp; return out;
}
export const activeKeyId = () => keyring()[0].id;
export const usingDerivedKey = () => !process.env.SECURITY_KEYS;
const sub = (k: KeyEntry, purpose: string) => Buffer.from(hkdfSync("sha256", k.key, Buffer.alloc(0), `mecgura:${purpose}`, 32));
const keyById = (id: string) => keyring().find((k) => k.id === id);

export function encryptString(plain: string, purpose: string): { blob: string; keyId: string } {
  const k = keyring()[0]; const iv = randomBytes(12); const c = createCipheriv("aes-256-gcm", sub(k, purpose), iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]); const tag = c.getAuthTag();
  return { blob: `v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${ct.toString("base64url")}`, keyId: k.id };
}
export function decryptString(blob: string, purpose: string, keyId: string): string {
  const k = keyById(keyId); if (!k) throw new Error("Encryption key is no longer available.");
  const [v, iv, tag, ct] = blob.split("."); if (v !== "v1" || !iv || !tag || !ct) throw new Error("Unreadable encrypted value.");
  const d = createDecipheriv("aes-256-gcm", sub(k, purpose), Buffer.from(iv, "base64url")); d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(ct, "base64url")), d.final()]).toString("utf8");
}
export function hmacHex(purpose: string, data: string, keyId?: string): { hmac: string; keyId: string } {
  const k = keyId ? keyById(keyId) : keyring()[0]; if (!k) throw new Error("Signing key is no longer available.");
  return { hmac: createHmac("sha256", sub(k, purpose)).update(data).digest("hex"), keyId: k.id };
}
export const sha256Hex = (s: string) => createHash("sha256").update(s).digest("hex");
export const randomToken = (bytes = 32) => randomBytes(bytes).toString("base64url");
export function safeEqualStr(a: string, b: string): boolean { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); }
