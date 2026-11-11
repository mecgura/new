import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";
import type { RequestContext, TenantRequestContext } from "@/lib/auth/context";
import { AppError } from "@/lib/errors";
import { ROLES } from "@/lib/permissions";
import { getPlatformSettingRaw, invalidatePlatformSetting } from "@/lib/platform/runtime";
import { guard } from "./platform-core";

/** Security policy: which roles MUST use a second factor, and audit retention. Platform-wide, plus an optional stricter list per clinic. Nothing is required by default. */
export interface SecurityPolicy { mfaRequiredRoles: string[]; auditRetentionDays: number | null; passwordResetMinutes: number }
export const DEFAULT_SECURITY: SecurityPolicy = { mfaRequiredRoles: [], auditRetentionDays: null, passwordResetMinutes: 30 };
const KEY = "security.policy"; const tkey = (t: string) => `security.tenant.${t}`;
const schema = z.object({ mfaRequiredRoles: z.array(z.enum(ROLES as unknown as [string, ...string[]])).max(12), auditRetentionDays: z.number().int().min(365).max(36500).nullable(), passwordResetMinutes: z.number().int().min(10).max(120) }).partial();
const parse = (raw: string | null): Partial<SecurityPolicy> => { try { return raw ? (JSON.parse(raw) as Partial<SecurityPolicy>) : {}; } catch { return {}; } };

export async function getSecurityPolicy(): Promise<SecurityPolicy> { return { ...DEFAULT_SECURITY, ...parse(await getPlatformSettingRaw(KEY)) }; }
export async function getTenantMfaRoles(tenantId: string): Promise<string[]> { return parse(await getPlatformSettingRaw(tkey(tenantId))).mfaRequiredRoles ?? []; }
/** Roles that must have MFA for a user of this clinic (platform ∪ clinic). */
export async function mfaRequiredFor(role: string, tenantId: string | null): Promise<boolean> {
  const p = await getSecurityPolicy(); if (p.mfaRequiredRoles.includes(role)) return true;
  return tenantId ? (await getTenantMfaRoles(tenantId)).includes(role) : false;
}
function check<T>(v: unknown): T { const r = schema.safeParse(v); if (!r.success) throw new AppError("VALIDATION_ERROR", { message: r.error.issues[0]?.message ?? "Invalid security setting." }); return r.data as T; }
async function put(key: string, value: unknown) { await db.platformSetting.upsert({ where: { key }, create: { key, value: JSON.stringify(value) }, update: { value: JSON.stringify(value) } }); invalidatePlatformSetting(key); }

export async function saveSecurityPolicy(ctx: RequestContext, input: unknown) {
  guard(ctx); const before = await getSecurityPolicy(); const next = { ...before, ...check<Partial<SecurityPolicy>>(input) }; await put(KEY, next);
  await recordAudit({ action: AUDIT_ACTIONS.SECURITY_SETTING_CHANGED, tenantId: null, actorId: ctx.user.id, entityType: "security_policy", entityId: "platform", metadata: { before: { mfaRequiredRoles: before.mfaRequiredRoles, auditRetentionDays: before.auditRetentionDays }, after: { mfaRequiredRoles: next.mfaRequiredRoles, auditRetentionDays: next.auditRetentionDays } } });
  return next;
}
/** A Clinic Admin may require MFA for roles in THEIR clinic (never loosen the platform rule). */
export async function saveTenantMfaRoles(ctx: TenantRequestContext, roles: unknown) {
  if (!ctx.permissions.has("security.manage")) throw new AppError("FORBIDDEN");
  const { mfaRequiredRoles } = check<{ mfaRequiredRoles: string[] }>({ mfaRequiredRoles: roles }); const allowed = mfaRequiredRoles.filter((r) => r !== "SUPER_ADMIN" && r !== "PATIENT");
  const before = await getTenantMfaRoles(ctx.tenantId); await put(tkey(ctx.tenantId), { mfaRequiredRoles: allowed });
  await recordAudit({ action: AUDIT_ACTIONS.SECURITY_SETTING_CHANGED, tenantId: ctx.tenantId, actorId: ctx.user.id, entityType: "security_policy", entityId: ctx.tenantId, metadata: { before, after: allowed } });
  return allowed;
}
