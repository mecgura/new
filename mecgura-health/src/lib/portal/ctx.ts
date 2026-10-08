import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getAccess, type TenantRequestContext } from "@/lib/auth/context";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";

/**
 * Who is calling the patient portal. Resolved ONLY through   session -> User(role PATIENT) -> PatientAccount -> Patient -> clinic.
 * No patient id, account id or clinic id supplied by the browser is ever used. Every request re-reads the account, so suspending a
 * portal account, archiving the patient or "log out everywhere" takes effect immediately.
 */
export interface PatientContext extends TenantRequestContext {
  /** the ONLY patient this request may read or write */
  patientId: string;
  accountId: string;
  patient: { id: string; code: string; name: string; preferredName: string | null };
}
export type PortalBlock = "no_session" | "expired" | "account_unavailable" | "clinic_unavailable";

export const getPatientAccess = cache(async (): Promise<{ ctx: PatientContext | null; block: PortalBlock | null }> => {
  const { ctx, blocked } = await getAccess();
  if (!ctx) return { ctx: null, block: blocked === "tenant_unavailable" || blocked === "maintenance" ? "clinic_unavailable" : "no_session" };
  const session = await auth();
  const portal = session?.portal;
  if (ctx.user.role !== "PATIENT" || !portal || !ctx.tenant) return { ctx: null, block: "no_session" };
  if (Date.now() > portal.pexp) return { ctx: null, block: "expired" };
  const account = await db.patientAccount.findFirst({ where: { userId: ctx.user.id, tenantId: ctx.tenant.id }, include: { patient: { select: { id: true, code: true, name: true, preferredName: true, status: true, deletedAt: true } } } });
  if (!account || account.status !== "ACTIVE" || account.patient.deletedAt || account.patient.status === "ARCHIVED") return { ctx: null, block: "account_unavailable" };
  if (portal.sa < account.sessionsValidFrom.getTime()) return { ctx: null, block: "expired" }; // signed in before "log out everywhere" / a password change
  if (ctx.disabledFeatures?.includes("patientPortal")) return { ctx: null, block: "clinic_unavailable" }; // switched off by the platform: records stay, access stops
  const settings = await db.portalSettings.findFirst({ where: { tenantId: ctx.tenant.id }, select: { enabled: true } });
  if (settings && !settings.enabled) return { ctx: null, block: "clinic_unavailable" };
  return { ctx: { ...ctx, tenant: ctx.tenant, tenantId: ctx.tenant.id, patientId: account.patientId, accountId: account.id, patient: { id: account.patient.id, code: account.patient.code, name: account.patient.name, preferredName: account.patient.preferredName } }, block: null };
});

/** Page guard: not signed in as a patient -> the portal login (never the staff login). */
export async function requirePatientContext(): Promise<PatientContext> {
  const { ctx, block } = await getPatientAccess();
  if (!ctx) redirect(`/portal/login${block && block !== "no_session" ? `?reason=${block}` : ""}`);
  return ctx;
}

/** API / server-action guard. */
export async function requirePatientApiContext(): Promise<PatientContext> {
  const { ctx, block } = await getPatientAccess();
  if (!ctx) throw new AppError(block === "expired" ? "UNAUTHENTICATED" : block === "no_session" ? "UNAUTHENTICATED" : "FORBIDDEN", block === "expired" ? { message: "Your session has ended. Please sign in again." } : undefined);
  return ctx;
}
