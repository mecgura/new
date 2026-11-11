import "server-only";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "@/lib/db";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";
import type { RequestContext } from "@/lib/auth/context";
import { email as emailProvider } from "@/lib/communications/providers/registry";
import { esc } from "@/lib/billing/billing-html";
import { getEnv } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { randomToken, sha256Hex } from "@/lib/security/crypto";
import { rateLimit } from "@/lib/security/rate-limit";
import { getRequestMeta } from "@/lib/security/request";
import { TENANT_ACCESS_STATUSES } from "@/lib/domain/constants";
import { securityEvent } from "./sec-events";
import { getSecurityPolicy } from "./sec-policy";
import { hasMfa, verifySecondFactor } from "./sec-mfa";

const pw = z.string().min(10, "Password must be at least 10 characters.").max(128).refine((v) => /[A-Za-z]/.test(v) && /\d/.test(v), "Password must include at least one letter and one number.");

/** Signs a user out everywhere (every session signed in before now stops working on its next request). */
export async function revokeAllSessions(userId: string, tenantId: string | null, actorId: string, why: string) {
  await db.user.update({ where: { id: userId }, data: { sessionsValidFrom: new Date() } });
  await recordAudit({ action: AUDIT_ACTIONS.AUTH_SESSIONS_REVOKED, tenantId, actorId, entityType: "user", entityId: userId, metadata: { why } });
}
export async function logoutEverywhere(ctx: RequestContext) { await revokeAllSessions(ctx.user.id, ctx.user.tenantId, ctx.user.id, "self"); return { signedOut: true }; }

export async function changePassword(ctx: RequestContext, input: { current?: string; next?: string; confirm?: string; mfaCode?: string }) {
  const lim = await rateLimit(`pwchange:${ctx.user.id}`, { limit: 6, windowMs: 15 * 60_000 }); if (!lim.allowed) throw new AppError("RATE_LIMITED");
  const parsed = pw.safeParse(input.next); if (!parsed.success) throw new AppError("VALIDATION_ERROR", { fieldErrors: { next: parsed.error.issues[0].message } });
  if (input.next !== input.confirm) throw new AppError("VALIDATION_ERROR", { fieldErrors: { confirm: "Passwords do not match." } });
  const u = await db.user.findFirst({ where: { id: ctx.user.id, deletedAt: null }, select: { passwordHash: true } });
  if (!u?.passwordHash || typeof input.current !== "string" || !(await bcrypt.compare(input.current, u.passwordHash))) throw new AppError("FORBIDDEN", { message: "Your current password wasn't accepted.", fieldErrors: { current: "Wrong password." } });
  if (await hasMfa(ctx.user.id)) { const f = await verifySecondFactor(ctx.user.id, input.mfaCode); if (!f.ok) throw new AppError("FORBIDDEN", { message: "Enter your authenticator code.", fieldErrors: { mfaCode: "Wrong code." } }); }
  if (await bcrypt.compare(input.next!, u.passwordHash)) throw new AppError("VALIDATION_ERROR", { fieldErrors: { next: "Choose a password you haven't used just now." } });
  await db.user.update({ where: { id: ctx.user.id }, data: { passwordHash: await bcrypt.hash(input.next!, 12), failedLoginCount: 0, lockedUntil: null, sessionsValidFrom: new Date() } });
  await recordAudit({ action: AUDIT_ACTIONS.AUTH_PASSWORD_CHANGED, tenantId: ctx.user.tenantId, actorId: ctx.user.id });
  await securityEvent({ severity: "INFO", category: "AUTH", type: "PASSWORD_CHANGED", summary: "Password changed; other sessions ended", tenantId: ctx.user.tenantId, actorId: ctx.user.id });
  return { signedOut: true };
}

/** Always answers the same way (no account enumeration). The email is sent only when an email provider is really configured. The link uses APP_URL, never the request's Host header. */
export async function requestPasswordReset(identifier: unknown) {
  const generic = { sent: true as const };
  const { ip } = await getRequestMeta().catch(() => ({ ip: null as string | null }));
  const [a, b] = await Promise.all([rateLimit(`reset:ip:${ip ?? "?"}`, { limit: 10, windowMs: 60 * 60_000 }), rateLimit(`reset:id:${String(identifier).toLowerCase().slice(0, 120)}`, { limit: 3, windowMs: 60 * 60_000 })]);
  if (!a.allowed || !b.allowed) return generic;
  const id = String(identifier ?? "").trim().toLowerCase(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(id)) return generic;
  const user = await db.user.findFirst({ where: { email: id, deletedAt: null, status: "ACTIVE", passwordHash: { not: null } }, include: { role: { select: { key: true } }, tenant: { select: { status: true, deletedAt: true, name: true } } } });
  if (!user || user.role.key === "PATIENT" || (user.tenant && (user.tenant.deletedAt || !TENANT_ACCESS_STATUSES.includes(user.tenant.status)))) return generic;
  const token = randomToken(32); const ttl = (await getSecurityPolicy()).passwordResetMinutes;
  await db.passwordResetToken.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } }); // one live token at a time
  await db.passwordResetToken.create({ data: { userId: user.id, tokenHash: sha256Hex(token), expiresAt: new Date(Date.now() + ttl * 60_000), ip } });
  await recordAudit({ action: AUDIT_ACTIONS.AUTH_PASSWORD_RESET_REQUESTED, tenantId: user.tenantId, actorId: user.id });
  const provider = emailProvider();
  if (!provider) { logger.warn("password reset requested but no email provider is configured", {}); return generic; }
  const link = `${getEnv().APP_URL.replace(/\/$/, "")}/reset-password/${token}`;
  const r = await provider.sendEmail({ to: user.email, fromName: "MECGURA HEALTH", subject: "Reset your MECGURA HEALTH password", html: `<p>We received a request to reset your password.</p><p><a href="${esc(link)}">Choose a new password</a> — this link works once and expires in ${ttl} minutes.</p><p>If you didn't ask for this, ignore this email; your password is unchanged.</p>`, text: `Reset your password (valid ${ttl} minutes, one use): ${link}\nIf you didn't ask for this, ignore this email.` });
  if (!r.ok) logger.warn("password reset email not accepted", { code: r.code });
  return generic;
}
export async function completePasswordReset(input: { token?: string; password?: string; confirm?: string }) {
  const { ip } = await getRequestMeta().catch(() => ({ ip: null as string | null })); const lim = await rateLimit(`reset-complete:${ip ?? "?"}`, { limit: 20, windowMs: 60 * 60_000 }); if (!lim.allowed) throw new AppError("RATE_LIMITED");
  const bad = new AppError("VALIDATION_ERROR", { message: "This reset link is invalid or has expired. Request a new one." });
  if (typeof input.token !== "string" || input.token.length < 20 || input.token.length > 200) throw bad;
  const parsed = pw.safeParse(input.password); if (!parsed.success) throw new AppError("VALIDATION_ERROR", { fieldErrors: { password: parsed.error.issues[0].message } });
  if (input.password !== input.confirm) throw new AppError("VALIDATION_ERROR", { fieldErrors: { confirm: "Passwords do not match." } });
  const row = await db.passwordResetToken.findUnique({ where: { tokenHash: sha256Hex(input.token) } });
  if (!row || row.usedAt || row.expiresAt < new Date()) throw bad;
  const claim = await db.passwordResetToken.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } }); if (claim.count !== 1) throw bad; // one-time, even under a race
  const user = await db.user.findFirst({ where: { id: row.userId, deletedAt: null, status: "ACTIVE" } }); if (!user) throw bad;
  await db.user.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash(input.password!, 12), failedLoginCount: 0, lockedUntil: null, sessionsValidFrom: new Date() } });
  await recordAudit({ action: AUDIT_ACTIONS.AUTH_PASSWORD_RESET, tenantId: user.tenantId, actorId: user.id });
  await securityEvent({ severity: "LOW", category: "AUTH", type: "PASSWORD_RESET", summary: "Password reset through an emailed link; all sessions ended", tenantId: user.tenantId, actorId: user.id });
  return { reset: true };
}
