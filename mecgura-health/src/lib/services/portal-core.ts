import "server-only";
import { AUDIT_ACTIONS, recordAudit, type AuditAction } from "@/lib/audit";
import type { PatientContext } from "@/lib/portal/ctx";
import { tenantDb } from "@/lib/tenant/db";
import type { Client } from "./clinic-shared";

export { AUDIT_ACTIONS };
export const pdb = (ctx: { tenantId: string }) => tenantDb(ctx) as Client;
export const iso = (d: Date | null | undefined) => d?.toISOString() ?? null;
export const PAGE = 15;

export interface PortalSettingsView { enabled: boolean; allowBooking: boolean; allowCancel: boolean; allowReschedule: boolean; changeCutoffHours: number; showDiagnoses: boolean; editableFields: string[]; supportNote: string | null; privacyNotice: string | null; consentVersion: string }
const DEFAULT_EDITABLE = ["preferredName", "email", "alternatePhone", "addressLine", "city", "state", "country", "pincode", "emergencyContactName", "emergencyContactRelation", "emergencyContactPhone"];
export async function loadPortalSettings(client: Client, tenantId: string): Promise<PortalSettingsView> {
  const s = await client.portalSettings.findFirst({ where: { tenantId } });
  let editable = DEFAULT_EDITABLE; try { const j = JSON.parse(s?.editableFields ?? "null"); if (Array.isArray(j)) editable = j.filter((x) => typeof x === "string"); } catch { /* defaults */ }
  return { enabled: s?.enabled ?? true, allowBooking: s?.allowBooking ?? true, allowCancel: s?.allowCancel ?? true, allowReschedule: s?.allowReschedule ?? true, changeCutoffHours: s?.changeCutoffHours ?? 24, showDiagnoses: s?.showDiagnoses ?? false, editableFields: editable, supportNote: s?.supportNote ?? null, privacyNotice: s?.privacyNotice ?? null, consentVersion: s?.consentVersion ?? "v1" };
}

/** Audit of a patient's own action. Identifiers only — never medical content, passwords or codes. */
export async function paudit(ctx: PatientContext, action: AuditAction, entityType: string, entityId: string, metadata: Record<string, unknown> = {}) {
  await recordAudit({ action, tenantId: ctx.tenantId, actorId: ctx.user.id, entityType, entityId, metadata });
}
export async function doctorNames(tdb: Client, ids: (string | null | undefined)[]) {
  const list = [...new Set(ids.filter(Boolean))] as string[];
  const rows = list.length ? await tdb.user.findMany({ where: { id: { in: list } }, select: { id: true, name: true } }) : [];
  return new Map<string, string>(rows.map((u: { id: string; name: string }) => [u.id, u.name]));
}
export const clinicContact = (ctx: PatientContext) => ({ name: ctx.tenant.name, phone: ctx.tenant.contactPhone, email: ctx.tenant.contactEmail, address: [ctx.tenant.address, ctx.tenant.city, ctx.tenant.state, ctx.tenant.pincode].filter(Boolean).join(", ") || null });
