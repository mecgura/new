import "server-only";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { headers } from "next/headers";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { TENANT_ACCESS_STATUSES } from "@/lib/domain/constants";
import { logger } from "@/lib/logger";
import { findTenantByHost } from "@/lib/tenant/resolve-core";
import { normalizeIdentifier } from "@/lib/validation/schemas";

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;
const DUMMY_HASH = bcrypt.hashSync(randomUUID(), 12);
/** Absolute length of a patient session. Sliding refresh never extends it. */
export const PATIENT_SESSION_MS = 4 * 60 * 60 * 1000;

/** The clinic a portal request is for: the HOST's clinic (subdomain / verified custom domain), or — only on a host without a clinic — the clinic slug in the portal URL. */
export async function resolvePortalTenantId(clinicSlug?: string | null): Promise<string | null> {
  const h = await headers();
  const hostTenant = await findTenantByHost(h.get("x-forwarded-host") ?? h.get("host"));
  if (hostTenant) return hostTenant.id;
  if (!clinicSlug || !/^[a-z0-9-]{2,60}$/.test(clinicSlug)) return null;
  const t = await db.tenant.findFirst({ where: { slug: clinicSlug, deletedAt: null, status: { in: [...TENANT_ACCESS_STATUSES] } }, select: { id: true } });
  return t?.id ?? null;
}

/**
 * Auth.js `authorize` for the patient provider. Proves WHO the patient is and refuses everything else: the account must be a PATIENT user with
 * an ACTIVE PatientAccount in the clinic being logged into, on an active clinic, not locked, and (on a clinic's own host) belong to THAT clinic.
 * Failures are indistinguishable to the caller (same generic message) but audited with a reason.
 */
export async function authorizePatient(credentials: Partial<Record<string, unknown>>) {
  const id = typeof credentials.identifier === "string" ? normalizeIdentifier(credentials.identifier) : null;
  const password = typeof credentials.password === "string" ? credentials.password : "";
  const clinic = typeof credentials.clinic === "string" ? credentials.clinic : null;
  if (!id || !password || password.length > 128) return null;
  const tenantId = await resolvePortalTenantId(clinic);
  const account = tenantId
    ? await db.patientAccount.findFirst({ where: { tenantId, ...(id.kind === "email" ? { loginEmail: id.value } : { loginPhone: id.value }) }, include: { user: { include: { role: { select: { key: true } } } }, patient: { select: { status: true, deletedAt: true } } } })
    : null;
  const user = account?.user ?? null;
  const passwordOk = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
  const now = new Date();
  const locked = !!user?.lockedUntil && user.lockedUntil > now;
  const settings = tenantId ? await db.portalSettings.findFirst({ where: { tenantId }, select: { enabled: true } }) : null;
  const allowed = !!account && !!user && passwordOk && !locked && account.status === "ACTIVE" && user.role.key === "PATIENT" && user.status === "ACTIVE" && !user.deletedAt && !account.patient.deletedAt && account.patient.status !== "ARCHIVED" && (settings?.enabled ?? true);
  if (!allowed) {
    if (user && !passwordOk && !locked) {
      const failures = user.failedLoginCount + 1;
      await db.user.update({ where: { id: user.id }, data: { failedLoginCount: failures, lockedUntil: failures >= MAX_FAILED ? new Date(now.getTime() + LOCK_MINUTES * 60_000) : undefined } });
    }
    const reason = !tenantId ? "unknown_clinic" : !account ? "unknown_account" : locked ? "locked" : !passwordOk ? "bad_credentials" : account.status !== "ACTIVE" ? `account_${account.status.toLowerCase()}` : "not_allowed";
    await recordAudit({ action: AUDIT_ACTIONS.PORTAL_LOGIN_FAILED, tenantId: tenantId ?? null, actorId: user?.id, metadata: { reason } });
    logger.warn("portal login rejected", { reason });
    return null;
  }
  await db.user.update({ where: { id: user!.id }, data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: now } });
  await db.patientAccount.update({ where: { id: account!.id }, data: { lastLoginAt: now } });
  await recordAudit({ action: AUDIT_ACTIONS.PORTAL_LOGIN, tenantId: account!.tenantId, actorId: user!.id, entityType: "patient_account", entityId: account!.id });
  return { id: user!.id, name: user!.name, email: user!.email, kind: "patient" as const };
}
