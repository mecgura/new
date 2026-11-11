import { createHmac, randomBytes } from "node:crypto";
import { safeEqualStr } from "./crypto";

/** RFC 6238 TOTP (SHA-1, 6 digits, 30 s) — compatible with Google Authenticator, Authy, 1Password, Microsoft Authenticator. No external dependency. */
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export const STEP_SECONDS = 30;
export function base32Encode(buf: Buffer): string { let bits = 0, v = 0, out = ""; for (const b of buf) { v = (v << 8) | b; bits += 8; while (bits >= 5) { out += ALPHABET[(v >>> (bits - 5)) & 31]; bits -= 5; } } if (bits > 0) out += ALPHABET[(v << (5 - bits)) & 31]; return out; }
export function base32Decode(s: string): Buffer { const clean = s.replace(/=+$/, "").replace(/\s+/g, "").toUpperCase(); let bits = 0, v = 0; const out: number[] = []; for (const ch of clean) { const i = ALPHABET.indexOf(ch); if (i < 0) throw new Error("Invalid base32"); v = (v << 5) | i; bits += 5; if (bits >= 8) { out.push((v >>> (bits - 8)) & 255); bits -= 8; } } return Buffer.from(out); }
export const generateSecret = () => base32Encode(randomBytes(20));
export const stepOf = (ms: number) => Math.floor(ms / 1000 / STEP_SECONDS);
export function hotp(secretB32: string, counter: number): string {
  const key = base32Decode(secretB32); const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac("sha1", key).update(msg).digest(); const o = h[h.length - 1] & 0xf;
  const code = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(code % 1_000_000).padStart(6, "0");
}
/** Returns the matching step (so the caller can refuse to accept it twice) or null. Accepts ±1 step for clock drift. */
export function verifyTotp(secretB32: string, code: string, nowMs = Date.now(), lastStep = 0): number | null {
  const c = code.replace(/\s+/g, ""); if (!/^\d{6}$/.test(c)) return null; const now = stepOf(nowMs);
  for (const d of [0, -1, 1]) { const step = now + d; if (step <= lastStep) continue; if (safeEqualStr(hotp(secretB32, step), c)) return step; }
  return null;
}
export const otpauthUri = (secret: string, account: string, issuer: string) => `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${STEP_SECONDS}`;
