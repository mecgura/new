import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";

/** Permissions a key can hold. A request needs the scope its endpoint requires — nothing is implied. */
export const API_SCOPES = {
  "numbers:read": "List WhatsApp numbers",
  "contacts:read": "Read contacts",
  "contacts:write": "Create and update contacts",
  "conversations:read": "Read conversations",
  "messages:read": "Read messages",
  "messages:send": "Send WhatsApp messages",
  "templates:read": "List approved templates",
} as const;
export type ApiScope = keyof typeof API_SCOPES;
export const API_SCOPE_LIST = Object.keys(API_SCOPES) as ApiScope[];

export const API_KEY_LIMITS = { perMinute: 120, maxActiveKeys: 10, logRetentionDays: 30 } as const;
export const ROTATION_GRACE_HOURS = [0, 1, 24, 72] as const;

export const apiKeyCreateSchema = z.object({
  name: z.string().trim().min(1, "Name the key").max(60),
  permissions: z.array(z.enum(API_SCOPE_LIST as [ApiScope, ...ApiScope[]])).min(1, "Choose at least one permission").max(API_SCOPE_LIST.length),
  expiresInDays: z.number().int().min(1).max(730).nullable().optional(),
});
export const apiKeyUpdateSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  permissions: z.array(z.enum(API_SCOPE_LIST as [ApiScope, ...ApiScope[]])).min(1).optional(),
});
export const apiKeyRotateSchema = z.object({ graceHours: z.union([z.literal(0), z.literal(1), z.literal(24), z.literal(72)]).default(0) });

const KEY_RE = /^mgk_[A-Za-z0-9_-]{43}$/;
export const looksLikeApiKey = (s: string) => KEY_RE.test(s);

/** `mgk_` + 256 random bits. Only the hash is stored; the key itself is shown once. */
export function generateApiKey() {
  const key = `mgk_${randomBytes(32).toString("base64url")}`;
  return { key, prefix: key.slice(0, 12), hash: hashApiKey(key) };
}

/** SHA-256 is enough here: the key is 256 bits of randomness, so there is nothing to brute-force. */
export const hashApiKey = (key: string) => createHash("sha256").update(key).digest("hex");

/** Keeps the network part of an address only (203.0.113.7 → 203.0.113.0) so logs identify a network, not a person. */
export function maskIp(ip: string): string {
  const v = ip.trim();
  if (!v) return "";
  if (v.includes(":")) return `${v.split(":").slice(0, 3).join(":")}::`;
  const p = v.split(".");
  return p.length === 4 ? `${p[0]}.${p[1]}.${p[2]}.0` : "";
}

export function keyStatus(k: { revokedAt: Date | null; expiresAt: Date | null }, now = new Date()): "active" | "expiring" | "expired" | "revoked" {
  if (k.revokedAt) return "revoked";
  if (k.expiresAt) return k.expiresAt <= now ? "expired" : "expiring";
  return "active";
}
