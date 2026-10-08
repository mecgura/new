import "server-only";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";
import type { RequestContext } from "@/lib/auth/context";
import { AppError } from "@/lib/errors";

/**
 * Shared guards for the Super Admin console.
 *  - guard():   platform.manage AND the SUPER_ADMIN role, both read from the server-side context (never from the request)
 *  - stepUp():  re-authentication (the Super Admin's own password) for sensitive actions, rate limited and audited on failure
 */
export function guard(ctx: RequestContext) {
  if (ctx.user.role !== "SUPER_ADMIN" || !ctx.permissions.has("platform.manage")) throw new AppError("FORBIDDEN");
}

/** Failed confirmations only (a correct password never counts): 5 wrong tries lock confirmations for 15 minutes. Per process. */
const failures = new Map<string, { count: number; reset: number }>(); const MAX_FAILS = 5;
export const resetStepUpFailures = () => failures.clear();
export async function stepUp(ctx: RequestContext, password: unknown, purpose: string) {
  guard(ctx);
  const f = failures.get(ctx.user.id);
  if (f && f.reset > Date.now() && f.count >= MAX_FAILS) throw new AppError("RATE_LIMITED", { message: "Too many failed confirmations. Wait a few minutes and try again." });
  const row = await db.user.findFirst({ where: { id: ctx.user.id, deletedAt: null }, select: { passwordHash: true } });
  const ok = typeof password === "string" && password.length > 0 && password.length <= 200 && !!row?.passwordHash && (await bcrypt.compare(password, row.passwordHash));
  if (!ok) {
    const cur = f && f.reset > Date.now() ? f : { count: 0, reset: Date.now() + 15 * 60_000 }; cur.count++; failures.set(ctx.user.id, cur);
    await recordAudit({ action: AUDIT_ACTIONS.PLATFORM_REAUTH_FAILED, tenantId: null, actorId: ctx.user.id, entityType: "platform", entityId: purpose, metadata: { purpose } });
    throw new AppError("FORBIDDEN", { message: "Your password wasn't accepted, so nothing was changed.", fieldErrors: { confirmPassword: "Enter your own password to confirm." } });
  }
  failures.delete(ctx.user.id);
}

export const cleanNotes = (v: unknown, max = 500) => (typeof v === "string" ? v.trim().slice(0, max) : "");
export function requireReason(v: unknown, min = 10) {
  const t = cleanNotes(v);
  if (t.length < min) throw new AppError("VALIDATION_ERROR", { message: `Give a short reason (at least ${min} characters).`, fieldErrors: { reason: `Give a short reason (at least ${min} characters).` } });
  return t;
}
export const clamp = (n: unknown, d: number, lo: number, hi: number) => { const v = Number(n); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.trunc(v))) : d; };
export async function findClinic(id: string) {
  const t = await db.tenant.findFirst({ where: { id, deletedAt: null } });
  if (!t) throw new AppError("NOT_FOUND", { message: "That clinic doesn't exist." });
  return t;
}
