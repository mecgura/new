import "server-only";
import { notifyAccount } from "@/lib/notifications/events";
import { createHmac } from "node:crypto";
import bcrypt from "bcryptjs";
import type { TenantRequestContext } from "@/lib/auth/context";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { resolvePortalTenantId } from "@/lib/portal/patient-login";
import type { PatientContext } from "@/lib/portal/ctx";
import { rateLimit } from "@/lib/security/rate-limit";
import { tenantDb } from "@/lib/tenant/db";
import { parseOrThrow } from "@/lib/validation";
import { activateSchema, changePasswordSchema } from "@/lib/validation/portal";
import { normalizeIdentifier } from "@/lib/validation/schemas";
import { isUniqueViolation, randomCode, type Client } from "./clinic-shared";
import { AUDIT_ACTIONS, loadPortalSettings, paudit, pdb } from "./portal-core";
import { recordAudit } from "@/lib/audit";

const INVITE_HOURS = 72;
const MAX_CODE_ATTEMPTS = 5;
const hashCode = (code: string) => createHmac("sha256", process.env.AUTH_SECRET ?? "dev-secret").update(code.replace(/-/g, "").toUpperCase()).digest("hex");
const fmt = (c: string) => `${c.slice(0, 5)}-${c.slice(5)}`;

/* ------------------------------------------------ clinic staff side ------------------------------------------------ */
function staffGuard(ctx: TenantRequestContext) {
  if (ctx.user.role === "SUPER_ADMIN" || !ctx.permissions.has("portal.manage")) throw new AppError("FORBIDDEN");
}
/** Status of a patient's portal access, for the staff card on the patient file. Never exposes hashes or codes. */
export async function portalAccessFor(ctx: TenantRequestContext, patientId: string) {
  staffGuard(ctx); const tdb = tenantDb(ctx) as Client;
  const p = await tdb.patient.findFirst({ where: { id: patientId }, select: { id: true, phone: true, email: true } });
  if (!p) throw new AppError("NOT_FOUND", { message: "Patient not found." });
  const [acc, invite, settings] = await Promise.all([
    tdb.patientAccount.findFirst({ where: { patientId }, select: { status: true, lastLoginAt: true, createdAt: true, loginEmail: true, loginPhone: true } }),
    tdb.patientInvite.findFirst({ where: { patientId, usedAt: null, revokedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" }, select: { expiresAt: true, purpose: true } }),
    loadPortalSettings(tdb, ctx.tenantId),
  ]);
  return { enabled: settings.enabled, hasContact: !!(p.phone || p.email), account: acc ? { status: acc.status as string, lastLoginAt: acc.lastLoginAt?.toISOString() ?? null, createdAt: acc.createdAt.toISOString(), loginWith: acc.loginEmail ? "email" : "mobile number" } : null, pendingInvite: invite ? { expiresAt: invite.expiresAt.toISOString(), purpose: invite.purpose as string } : null };
}
/** Creates a single-use activation (or access-reset) code. The code is returned ONCE; only its hash is stored. Nothing is sent to the patient. */
export async function issuePortalInvite(ctx: TenantRequestContext, patientId: string) {
  staffGuard(ctx); const tdb = tenantDb(ctx) as Client;
  const settings = await loadPortalSettings(tdb, ctx.tenantId);
  if (!settings.enabled) throw new AppError("CONFLICT", { message: "The patient portal is switched off for this clinic." });
  const p = await tdb.patient.findFirst({ where: { id: patientId }, select: { id: true, status: true, phone: true, email: true } });
  if (!p) throw new AppError("NOT_FOUND", { message: "Patient not found." });
  if (p.status === "ARCHIVED") throw new AppError("CONFLICT", { message: "This patient record is archived." });
  if (!p.phone && !p.email) throw new AppError("VALIDATION_ERROR", { message: "Add the patient's mobile number or email first — the patient proves who they are with it." });
  const existing = await tdb.patientAccount.findFirst({ where: { patientId }, select: { status: true } });
  const purpose = existing ? "ACCESS_RESET" : "ACTIVATION";
  const code = randomCode(10); const expiresAt = new Date(Date.now() + INVITE_HOURS * 3_600_000);
  await tdb.$transaction(async (tx: Client) => {
    await tx.patientInvite.updateMany({ where: { patientId, usedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
    await tx.patientInvite.create({ data: { tenantId: ctx.tenantId, patientId, codeHash: hashCode(code), purpose, expiresAt, createdById: ctx.user.id } });
  });
  await recordAudit({ action: AUDIT_ACTIONS.PORTAL_INVITE_ISSUED, tenantId: ctx.tenantId, actorId: ctx.user.id, entityType: "patient", entityId: patientId, metadata: { purpose } });
  if (purpose === "ACCESS_RESET") await notifyAccount(ctx.tenantId, patientId, "reset_issued", patientId);
  return { code: fmt(code), purpose, expiresAt: expiresAt.toISOString(), hours: INVITE_HOURS };
}
export async function setPortalAccountStatus(ctx: TenantRequestContext, patientId: string, action: "suspend" | "reactivate") {
  staffGuard(ctx); const tdb = tenantDb(ctx) as Client;
  const acc = await tdb.patientAccount.findFirst({ where: { patientId } });
  if (!acc) throw new AppError("NOT_FOUND", { message: "This patient has no portal account." });
  if (acc.status === "DEACTIVATED") throw new AppError("CONFLICT", { message: "This account was deactivated at the patient's request. Issue a new access code to restore it." });
  const status = action === "suspend" ? "SUSPENDED" : "ACTIVE";
  await tdb.patientAccount.update({ where: { id: acc.id }, data: { status, sessionsValidFrom: new Date() } });
  await recordAudit({ action: AUDIT_ACTIONS.PORTAL_ACCESS_CHANGED, tenantId: ctx.tenantId, actorId: ctx.user.id, entityType: "patient_account", entityId: acc.id, metadata: { status } });
  return { status };
}

/* ------------------------------------------------ patient activation (public) ------------------------------------------------ */
/**
 * Activates (or resets) a portal account. The patient must hold a code issued by the clinic AND give the mobile number / email the clinic has
 * on file for them. A wrong identity counts against the code; after 5 attempts the code is revoked. Arbitrary Patient IDs are never accepted.
 */
export async function activatePortalAccount(raw: unknown, ip: string | null) {
  const v = parseOrThrow(activateSchema, raw);
  const lim = await rateLimit(`portal:activate:${ip ?? "?"}`, { limit: 12, windowMs: 15 * 60_000 });
  if (!lim.allowed) throw new AppError("RATE_LIMITED");
  const generic = new AppError("VALIDATION_ERROR", { message: "We couldn't activate your account with those details. Check the code and the mobile number or email the clinic has on file, or ask the clinic for a new code." });
  const tenantId = await resolvePortalTenantId(v.clinic);
  if (!tenantId) throw generic;
  const settings = await loadPortalSettings(db as unknown as Client, tenantId);
  if (!settings.enabled) throw new AppError("FORBIDDEN", { message: "The patient portal isn't available for this clinic." });
  const invite = await db.patientInvite.findFirst({ where: { tenantId, codeHash: hashCode(v.code), usedAt: null, revokedAt: null, expiresAt: { gt: new Date() } } });
  if (!invite || invite.attempts >= MAX_CODE_ATTEMPTS) throw generic;
  const patient = await db.patient.findFirst({ where: { id: invite.patientId, tenantId, deletedAt: null } });
  const id = normalizeIdentifier(v.identifier)!;
  const matches = !!patient && patient.status !== "ARCHIVED" && (id.kind === "email" ? (patient.email ?? "").toLowerCase() === id.value : patient.phone === id.value);
  if (!matches || !patient) {
    const attempts = invite.attempts + 1;
    await db.patientInvite.update({ where: { id: invite.id }, data: { attempts, ...(attempts >= MAX_CODE_ATTEMPTS ? { revokedAt: new Date() } : {}) } });
    await recordAudit({ action: AUDIT_ACTIONS.PORTAL_LOGIN_FAILED, tenantId, entityType: "patient_invite", entityId: invite.id, metadata: { reason: "identity_mismatch", attempts } });
    throw generic;
  }
  const passwordHash = await bcrypt.hash(v.password, 12);
  const existing = await db.patientAccount.findFirst({ where: { patientId: patient.id, tenantId } });
  try {
    const result = await db.$transaction(async (tx) => {
      const used = await tx.patientInvite.updateMany({ where: { id: invite.id, usedAt: null, revokedAt: null }, data: { usedAt: new Date() } });
      if (used.count !== 1) throw generic; // someone used it a moment ago
      if (existing) {
        await tx.user.update({ where: { id: existing.userId }, data: { passwordHash, failedLoginCount: 0, lockedUntil: null } });
        await tx.patientAccount.update({ where: { id: existing.id }, data: { status: "ACTIVE", sessionsValidFrom: new Date(), passwordChangedAt: new Date(), verifiedAt: existing.verifiedAt ?? new Date() } });
        return { accountId: existing.id, userId: existing.userId, reset: true };
      }
      const role = await tx.role.findFirstOrThrow({ where: { key: "PATIENT", tenantId: null }, select: { id: true } });
      const user = await tx.user.create({ data: { tenantId, roleId: role.id, email: `patient+${invite.id}@portal.invalid`, name: patient.name, passwordHash, status: "ACTIVE" } });
      const acc = await tx.patientAccount.create({ data: { tenantId, userId: user.id, patientId: patient.id, loginEmail: id.kind === "email" ? id.value : null, loginPhone: id.kind === "phone" ? id.value : null, verifiedAt: new Date(), passwordChangedAt: new Date() } });
      await tx.patientConsent.create({ data: { tenantId, patientId: patient.id, type: "PRIVACY", status: "GRANTED", version: settings.consentVersion, note: "Accepted when activating the patient portal", recordedById: user.id } });
      return { accountId: acc.id, userId: user.id, reset: false };
    });
    await recordAudit({ action: AUDIT_ACTIONS.PORTAL_ACTIVATED, tenantId, actorId: result.userId, entityType: "patient_account", entityId: result.accountId, metadata: { reset: result.reset } });
    await notifyAccount(tenantId, patient.id, result.reset ? "reset_done" : "activated", result.accountId);
    return { identifier: v.identifier, reset: result.reset };
  } catch (e) {
    if (isUniqueViolation(e)) throw new AppError("CONFLICT", { message: `This ${id.kind === "email" ? "email address" : "mobile number"} is already used for another portal account. Use a different one that the clinic has on file for you, or ask the clinic for help.` });
    throw e;
  }
}

/* ------------------------------------------------ patient security centre ------------------------------------------------ */
export async function securityOverview(ctx: PatientContext) {
  const acc = await pdb(ctx).patientAccount.findFirst({ where: { id: ctx.accountId }, select: { lastLoginAt: true, passwordChangedAt: true, loginEmail: true, loginPhone: true, createdAt: true } });
  const { otpConfigured } = await import("@/lib/integrations/otp");
  return { loginMethod: "Password", loginWith: acc?.loginEmail ? "email address" : "mobile number", lastLoginAt: acc?.lastLoginAt?.toISOString() ?? null, passwordChangedAt: acc?.passwordChangedAt?.toISOString() ?? null, createdAt: acc?.createdAt.toISOString() ?? null, otpAvailable: otpConfigured(), sessionNote: "Portal sessions end automatically after 4 hours." };
}
export async function changePortalPassword(ctx: PatientContext, raw: unknown) {
  const v = parseOrThrow(changePasswordSchema, raw);
  const lim = await rateLimit(`portal:pw:${ctx.user.id}`, { limit: 6, windowMs: 15 * 60_000 });
  if (!lim.allowed) throw new AppError("RATE_LIMITED");
  const user = await db.user.findFirst({ where: { id: ctx.user.id, tenantId: ctx.tenantId }, select: { passwordHash: true } });
  const ok = await bcrypt.compare(v.current, user?.passwordHash ?? "x");
  if (!ok) throw new AppError("VALIDATION_ERROR", { message: "Your current password isn't right.", fieldErrors: { current: "Your current password isn't right." } });
  const passwordHash = await bcrypt.hash(v.next, 12);
  await db.$transaction([db.user.update({ where: { id: ctx.user.id }, data: { passwordHash, failedLoginCount: 0, lockedUntil: null } }), db.patientAccount.update({ where: { id: ctx.accountId }, data: { passwordChangedAt: new Date(), sessionsValidFrom: new Date() } })]);
  await paudit(ctx, AUDIT_ACTIONS.PORTAL_SECURITY_CHANGED, "patient_account", ctx.accountId, { change: "credentials" });
  await notifyAccount(ctx.tenantId, ctx.patientId, "password_changed", ctx.accountId);
  return { signedOut: true }; // every session, including this one, must sign in again
}
export async function logoutEverywhere(ctx: PatientContext) {
  await db.patientAccount.update({ where: { id: ctx.accountId }, data: { sessionsValidFrom: new Date() } });
  await paudit(ctx, AUDIT_ACTIONS.PORTAL_SECURITY_CHANGED, "patient_account", ctx.accountId, { change: "logout_everywhere" });
  await notifyAccount(ctx.tenantId, ctx.patientId, "logout_all", ctx.accountId);
  return { signedOut: true };
}
