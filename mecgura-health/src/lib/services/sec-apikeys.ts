import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";
import type { RequestContext } from "@/lib/auth/context";
import { AppError } from "@/lib/errors";
import { hmacHex, randomToken, safeEqualStr } from "@/lib/security/crypto";
import { rateLimit } from "@/lib/security/rate-limit";
import { getRequestMeta } from "@/lib/security/request";
import { reauth } from "./platform-core";
import { securityEvent } from "./sec-events";

/** Scopes an integration key can hold. A key never gets more than its scopes, and a clinic key only ever sees its own clinic. */
export const API_SCOPES = { "appointments.read": { label: "Read appointments (no patient details)", platform: false }, "services.read": { label: "Read the clinic's services list", platform: false }, "platform.status.read": { label: "Read platform status counts", platform: true } } as const;
export type ApiScope = keyof typeof API_SCOPES;
const IP = /^(?:\d{1,3}(?:\.\d{1,3}){3}|[0-9a-f:]{2,39})$/i;
const input = z.object({ name: z.string().trim().min(2).max(60), scopes: z.array(z.enum(Object.keys(API_SCOPES) as [ApiScope, ...ApiScope[]])).min(1).max(5), expiresInDays: z.number().int().min(1).max(730).nullable(), allowedIps: z.array(z.string().regex(IP)).max(10).default([]) });

const scopeOk = (platform: boolean, scopes: ApiScope[]) => scopes.every((s) => API_SCOPES[s].platform === platform);
function canManage(ctx: RequestContext) { return ctx.user.role === "SUPER_ADMIN" ? !ctx.tenant && ctx.permissions.has("platform.manage") : !!ctx.tenant && ctx.permissions.has("apikeys.manage"); }

export async function createApiKey(ctx: RequestContext, raw: { name?: unknown; scopes?: unknown; expiresInDays?: unknown; allowedIps?: unknown; password?: unknown }) {
  if (!canManage(ctx)) throw new AppError("FORBIDDEN");
  const r = input.safeParse({ name: raw.name, scopes: raw.scopes, expiresInDays: raw.expiresInDays ?? null, allowedIps: raw.allowedIps ?? [] });
  if (!r.success) throw new AppError("VALIDATION_ERROR", { message: r.error.issues[0]?.message ?? "Check the key details." });
  const platform = ctx.user.role === "SUPER_ADMIN"; if (!scopeOk(platform, r.data.scopes)) throw new AppError("VALIDATION_ERROR", { message: platform ? "Platform keys can only hold platform scopes." : "Clinic keys can't hold platform scopes." });
  await reauth(ctx, raw.password, "api_key_create");
  const tenantId = platform ? null : ctx.tenant!.id;
  if ((await db.apiKey.count({ where: { tenantId, revokedAt: null } })) >= 20) throw new AppError("CONFLICT", { message: "Revoke an unused key before creating another (limit 20 active keys)." });
  const prefix = `mh_${randomToken(6).replace(/[-_]/g, "a").toLowerCase().slice(0, 8)}`; const secret = randomToken(32);
  const row = await db.apiKey.create({ data: { tenantId, name: r.data.name, prefix, secretHash: hmacHex("apikey", secret).hmac, scopes: JSON.stringify(r.data.scopes), expiresAt: r.data.expiresInDays ? new Date(Date.now() + r.data.expiresInDays * 86_400_000) : null, allowedIps: JSON.stringify(r.data.allowedIps), createdById: ctx.user.id } });
  await recordAudit({ action: AUDIT_ACTIONS.SECURITY_API_KEY_CREATED, tenantId, actorId: ctx.user.id, entityType: "api_key", entityId: row.id, metadata: { prefix, scopes: r.data.scopes, expires: row.expiresAt?.toISOString() ?? null, ipRestricted: r.data.allowedIps.length > 0 } });
  await securityEvent({ severity: "MEDIUM", category: "API_KEY", type: "API_KEY_CREATED", summary: `API key “${r.data.name}” created`, tenantId, actorId: ctx.user.id, metadata: { prefix, scopes: r.data.scopes } });
  return { id: row.id, name: row.name, key: `${prefix}.${secret}`, prefix, note: "Copy this key now. It is shown only once and cannot be recovered." };
}
export async function listApiKeys(ctx: RequestContext) {
  if (!canManage(ctx)) throw new AppError("FORBIDDEN");
  const tenantId = ctx.user.role === "SUPER_ADMIN" ? null : ctx.tenant!.id;
  const rows = await db.apiKey.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" }, take: 100 });
  return rows.map((k) => ({ id: k.id, name: k.name, prefix: k.prefix, scopes: JSON.parse(k.scopes) as ApiScope[], expiresAt: k.expiresAt, revokedAt: k.revokedAt, lastUsedAt: k.lastUsedAt, lastUsedIp: k.lastUsedIp, allowedIps: JSON.parse(k.allowedIps) as string[], createdAt: k.createdAt, status: k.revokedAt ? "REVOKED" : k.expiresAt && k.expiresAt < new Date() ? "EXPIRED" : "ACTIVE" }));
}
export async function revokeApiKey(ctx: RequestContext, id: string, password: unknown) {
  if (!canManage(ctx)) throw new AppError("FORBIDDEN"); await reauth(ctx, password, "api_key_revoke");
  const tenantId = ctx.user.role === "SUPER_ADMIN" ? null : ctx.tenant!.id; const k = await db.apiKey.findFirst({ where: { id, tenantId } }); if (!k) throw new AppError("NOT_FOUND"); // another clinic's key is "not found"
  if (k.revokedAt) return { revoked: true }; await db.apiKey.update({ where: { id }, data: { revokedAt: new Date(), revokedById: ctx.user.id } });
  await recordAudit({ action: AUDIT_ACTIONS.SECURITY_API_KEY_REVOKED, tenantId, actorId: ctx.user.id, entityType: "api_key", entityId: id, metadata: { prefix: k.prefix } });
  await securityEvent({ severity: "MEDIUM", category: "API_KEY", type: "API_KEY_REVOKED", summary: `API key “${k.name}” revoked`, tenantId, actorId: ctx.user.id });
  return { revoked: true };
}
/** Rotation = a new key with the same scopes, then the old one is revoked. */
export async function rotateApiKey(ctx: RequestContext, id: string, password: unknown) {
  if (!canManage(ctx)) throw new AppError("FORBIDDEN"); const tenantId = ctx.user.role === "SUPER_ADMIN" ? null : ctx.tenant!.id; const old = await db.apiKey.findFirst({ where: { id, tenantId, revokedAt: null } }); if (!old) throw new AppError("NOT_FOUND");
  const created = await createApiKey(ctx, { name: old.name, scopes: JSON.parse(old.scopes), expiresInDays: old.expiresAt ? Math.max(1, Math.ceil((old.expiresAt.getTime() - Date.now()) / 86_400_000)) : null, allowedIps: JSON.parse(old.allowedIps), password });
  await revokeApiKey(ctx, id, password).catch(() => undefined); return created;
}

export interface ApiPrincipal { keyId: string; tenantId: string | null; scopes: ApiScope[] }
const deny = () => new AppError("UNAUTHENTICATED", { message: "Invalid or missing API key." });
/** Verifies `Authorization: Bearer <prefix>.<secret>`. Every failure is the same generic 401 to the caller; the reason goes to the Security Center. */
export async function authenticateApiKey(req: Request, scope: ApiScope | null): Promise<ApiPrincipal> {
  const { ip, userAgent } = await getRequestMeta().catch(() => ({ ip: null as string | null, userAgent: null as string | null }));
  const lim = await rateLimit(`apikey:ip:${ip ?? "?"}`, { limit: 300, windowMs: 60_000 }); if (!lim.allowed) throw new AppError("RATE_LIMITED");
  const h = req.headers.get("authorization") ?? ""; const m = /^Bearer\s+(mh_[a-z0-9]{1,12})\.([A-Za-z0-9_-]{20,64})$/.exec(h); if (!m) throw deny();
  const [, prefix, secret] = m; const key = await db.apiKey.findUnique({ where: { prefix } });
  const fail = async (type: string, sev: "LOW" | "MEDIUM", why: string) => { await securityEvent({ severity: sev, category: "API_KEY", type, summary: `API key rejected: ${why}`, tenantId: key?.tenantId ?? null, ip, userAgent, metadata: { prefix } }); throw deny(); };
  if (!key || !safeEqualStr(hmacHex("apikey", secret).hmac, key.secretHash)) return fail("API_KEY_BAD", "LOW", "unknown key or wrong secret");
  const kl = await rateLimit(`apikey:key:${key.id}`, { limit: 120, windowMs: 60_000 }); if (!kl.allowed) throw new AppError("RATE_LIMITED");
  if (key.revokedAt) return fail("API_KEY_REVOKED_USED", "MEDIUM", "revoked key used"); if (key.expiresAt && key.expiresAt < new Date()) return fail("API_KEY_EXPIRED_USED", "LOW", "expired key used");
  const ips = JSON.parse(key.allowedIps) as string[]; if (ips.length && (!ip || !ips.includes(ip))) return fail("API_KEY_IP_DENIED", "MEDIUM", "request from a non-allowed address");
  const scopes = JSON.parse(key.scopes) as ApiScope[]; if (scope && !scopes.includes(scope)) { await securityEvent({ severity: "LOW", category: "API_KEY", type: "API_KEY_SCOPE_DENIED", summary: `API key lacks scope ${scope}`, tenantId: key.tenantId, ip, metadata: { prefix } }); throw new AppError("FORBIDDEN", { message: "This key does not have the required scope." }); }
  if (!key.lastUsedAt || Date.now() - key.lastUsedAt.getTime() > 60_000) await db.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date(), lastUsedIp: ip } }).catch(() => undefined);
  return { keyId: key.id, tenantId: key.tenantId, scopes };
}
