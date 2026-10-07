import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";
import { ApiError } from "@/lib/api";

/**
 * Secret storage for third-party credentials (Meta access tokens, app secrets,
 * webhook verify tokens). AES-256-GCM with a random 96-bit IV per value.
 * Format: "v1:<iv b64url>:<tag b64url>:<ciphertext b64url>".
 *
 * Key: WHATSAPP_ENCRYPTION_KEY (32 bytes, base64). Outside production a key is
 * derived from AUTH_SECRET so local dev works; production refuses to store
 * secrets without an explicit key.
 */
function key(): Buffer {
  const raw = process.env.WHATSAPP_ENCRYPTION_KEY;
  if (raw) {
    const k = Buffer.from(raw, "base64");
    if (k.length !== 32) throw new ApiError("SERVICE_UNAVAILABLE", "Credential encryption is misconfigured.");
    return k;
  }
  if (process.env.NODE_ENV === "production" || !process.env.AUTH_SECRET) {
    throw new ApiError("SERVICE_UNAVAILABLE", "Secure credential storage is not configured on this server yet.");
  }
  return Buffer.from(hkdfSync("sha256", process.env.AUTH_SECRET, "mecgura-dev", "whatsapp-credentials", 32));
}

export function isEncryptionConfigured(): boolean {
  try {
    key();
    return true;
  } catch {
    return false;
  }
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ct.toString("base64url")].join(":");
}

export function decryptSecret(stored: string): string {
  const [v, iv, tag, ct] = stored.split(":");
  if (v !== "v1" || !iv || !tag || !ct) throw new Error("Unsupported secret format");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ct, "base64url")), decipher.final()]).toString("utf8");
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function hmacSha256Hex(secret: string, payload: Buffer | string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** Constant-time string comparison (false on length mismatch). */
export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function last4(secret: string): string {
  return secret.slice(-4);
}
