import "server-only";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";
import type { RequestContext } from "@/lib/auth/context";
import { AppError } from "@/lib/errors";
import { decryptString, encryptString, randomToken, sha256Hex } from "@/lib/security/crypto";
import { rateLimit } from "@/lib/security/rate-limit";
import { generateSecret, otpauthUri, verifyTotp, stepOf } from "@/lib/security/totp";
import { mfaRequiredFor } from "./sec-policy";
import { securityEvent } from "./sec-events";

const PURPOSE = "mfa-secret";
const BACKUP_COUNT = 10;
const newBackupCodes = () => Array.from({ length: BACKUP_COUNT }, () => { const t = randomToken(6).replace(/[-_]/g, "x").toLowerCase().slice(0, 8); return `${t.slice(0, 4)}-${t.slice(4)}`; });
const hashBackup = (c: string) => sha256Hex(`backup:${c.replace(/[\s-]/g, "").toLowerCase()}`);

export async function mfaStatus(userId: string) {
  const m = await db.userMfa.findUnique({ where: { userId } });
  return { enabled: !!m?.enabledAt, pending: !!m && !m.enabledAt, enabledAt: m?.enabledAt ?? null, backupRemaining: m?.enabledAt ? (JSON.parse(m.backupHashes) as string[]).length : 0 };
}
export const hasMfa = async (userId: string) => !!(await db.userMfa.findFirst({ where: { userId, enabledAt: { not: null } }, select: { id: true } }));

/** The second factor at sign-in and step-up: a current TOTP code (each 30 s step accepted once) or an unused backup code (consumed). Rate limited per user. */
export async function verifySecondFactor(userId: string, rawCode: string | undefined | null): Promise<{ ok: boolean; used?: "totp" | "backup"; reason?: string }> {
  const code = (rawCode ?? "").trim(); if (!code) return { ok: false, reason: "missing" };
  const lim = await rateLimit(`mfa:${userId}`, { limit: 8, windowMs: 5 * 60_000 }); if (!lim.allowed) return { ok: false, reason: "rate_limited" };
  const m = await db.userMfa.findFirst({ where: { userId, enabledAt: { not: null } } }); if (!m) return { ok: false, reason: "not_enrolled" };
  const secret = decryptString(m.secretEnc, PURPOSE, m.keyId);
  const step = verifyTotp(secret, code, Date.now(), m.lastStep);
  if (step !== null) { const r = await db.userMfa.updateMany({ where: { id: m.id, lastStep: { lt: step } }, data: { lastStep: step } }); return r.count === 1 ? { ok: true, used: "totp" } : { ok: false, reason: "replayed" }; }
  const hashes = JSON.parse(m.backupHashes) as string[]; const h = hashBackup(code);
  if (/^[a-z0-9]{4}-?[a-z0-9]{4}$/i.test(code) && hashes.includes(h)) {
    const r = await db.userMfa.updateMany({ where: { id: m.id, backupHashes: m.backupHashes }, data: { backupHashes: JSON.stringify(hashes.filter((x) => x !== h)) } }); // compare-and-set: a code is spent once
    if (r.count === 1) { await recordAudit({ action: AUDIT_ACTIONS.AUTH_MFA_BACKUP_USED, tenantId: m.tenantId, actorId: userId, metadata: { remaining: hashes.length - 1 } }); return { ok: true, used: "backup" }; }
  }
  await recordAudit({ action: AUDIT_ACTIONS.AUTH_MFA_FAILED, tenantId: m.tenantId, actorId: userId });
  await securityEvent({ severity: "LOW", category: "AUTH", type: "MFA_FAILED", summary: "Wrong two-factor code", tenantId: m.tenantId, actorId: userId });
  return { ok: false, reason: "wrong_code" };
}

async function checkPassword(userId: string, password: unknown) {
  const u = await db.user.findFirst({ where: { id: userId, deletedAt: null }, select: { passwordHash: true } });
  if (typeof password !== "string" || !password || !u?.passwordHash || !(await bcrypt.compare(password, u.passwordHash))) throw new AppError("FORBIDDEN", { message: "Your password wasn't accepted, so nothing was changed.", fieldErrors: { password: "Enter your current password." } });
}

export async function beginEnrollment(ctx: RequestContext, password: unknown) {
  await checkPassword(ctx.user.id, password); if (await hasMfa(ctx.user.id)) throw new AppError("CONFLICT", { message: "Two-factor authentication is already on." });
  const secret = generateSecret(); const enc = encryptString(secret, PURPOSE);
  await db.userMfa.upsert({ where: { userId: ctx.user.id }, create: { userId: ctx.user.id, tenantId: ctx.user.tenantId, secretEnc: enc.blob, keyId: enc.keyId }, update: { secretEnc: enc.blob, keyId: enc.keyId, enabledAt: null, backupHashes: "[]", lastStep: 0 } });
  return { secret, otpauth: otpauthUri(secret, ctx.user.email, "MECGURA HEALTH") };
}
export async function confirmEnrollment(ctx: RequestContext, code: unknown) {
  const m = await db.userMfa.findUnique({ where: { userId: ctx.user.id } }); if (!m || m.enabledAt) throw new AppError("CONFLICT", { message: "Start setting up two-factor authentication first." });
  const lim = await rateLimit(`mfa-setup:${ctx.user.id}`, { limit: 8, windowMs: 5 * 60_000 }); if (!lim.allowed) throw new AppError("RATE_LIMITED");
  const step = verifyTotp(decryptString(m.secretEnc, PURPOSE, m.keyId), String(code ?? ""));
  if (step === null) throw new AppError("VALIDATION_ERROR", { message: "That code didn't match. Check the time on your phone and try again.", fieldErrors: { code: "Wrong or expired code." } });
  const codes = newBackupCodes();
  await db.userMfa.update({ where: { id: m.id }, data: { enabledAt: new Date(), lastStep: step, backupHashes: JSON.stringify(codes.map(hashBackup)) } });
  await recordAudit({ action: AUDIT_ACTIONS.AUTH_MFA_ENABLED, tenantId: ctx.user.tenantId, actorId: ctx.user.id });
  await securityEvent({ severity: "INFO", category: "AUTH", type: "MFA_ENABLED", summary: "Two-factor authentication turned on", tenantId: ctx.user.tenantId, actorId: ctx.user.id });
  return { backupCodes: codes }; // shown ONCE; only hashes are kept
}
export async function disableMfa(ctx: RequestContext, password: unknown, code: unknown) {
  await checkPassword(ctx.user.id, password);
  if (await mfaRequiredFor(ctx.user.role, ctx.user.tenantId)) throw new AppError("CONFLICT", { message: "Your organisation requires two-factor authentication for your role, so it can't be turned off." });
  const f = await verifySecondFactor(ctx.user.id, String(code ?? "")); if (!f.ok) throw new AppError("FORBIDDEN", { message: "Enter a valid authenticator or backup code to turn two-factor off.", fieldErrors: { code: "Wrong code." } });
  await db.userMfa.delete({ where: { userId: ctx.user.id } });
  await recordAudit({ action: AUDIT_ACTIONS.AUTH_MFA_DISABLED, tenantId: ctx.user.tenantId, actorId: ctx.user.id });
  await securityEvent({ severity: "MEDIUM", category: "AUTH", type: "MFA_DISABLED", summary: "Two-factor authentication turned off", tenantId: ctx.user.tenantId, actorId: ctx.user.id });
}
export async function regenerateBackupCodes(ctx: RequestContext, password: unknown, code: unknown) {
  await checkPassword(ctx.user.id, password); const f = await verifySecondFactor(ctx.user.id, String(code ?? "")); if (!f.ok) throw new AppError("FORBIDDEN", { message: "Enter a valid authenticator code.", fieldErrors: { code: "Wrong code." } });
  const codes = newBackupCodes(); await db.userMfa.update({ where: { userId: ctx.user.id }, data: { backupHashes: JSON.stringify(codes.map(hashBackup)) } });
  await recordAudit({ action: AUDIT_ACTIONS.SECURITY_SETTING_CHANGED, tenantId: ctx.user.tenantId, actorId: ctx.user.id, entityType: "mfa", entityId: ctx.user.id, metadata: { backupCodesRegenerated: true } });
  return { backupCodes: codes };
}
/** For tests / admin recovery: a Super Admin can reset another user's MFA (audited, HIGH event). */
export async function adminResetMfa(ctx: RequestContext, userId: string, reason: string) {
  if (ctx.user.role !== "SUPER_ADMIN" || !ctx.permissions.has("platform.manage")) throw new AppError("FORBIDDEN");
  const u = await db.user.findFirst({ where: { id: userId, deletedAt: null }, select: { id: true, tenantId: true } }); if (!u) throw new AppError("NOT_FOUND");
  await db.userMfa.deleteMany({ where: { userId } }); await db.user.update({ where: { id: userId }, data: { sessionsValidFrom: new Date() } });
  await recordAudit({ action: AUDIT_ACTIONS.AUTH_MFA_DISABLED, tenantId: u.tenantId, actorId: ctx.user.id, entityType: "user", entityId: userId, reason, metadata: { byAdmin: true } });
  await securityEvent({ severity: "HIGH", category: "AUTH", type: "MFA_RESET_BY_ADMIN", summary: "A Super Admin reset a user's two-factor authentication", tenantId: u.tenantId, actorId: ctx.user.id, metadata: { userId } });
}
export { stepOf };
