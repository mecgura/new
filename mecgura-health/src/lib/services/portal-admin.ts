import "server-only";
import type { TenantRequestContext } from "@/lib/auth/context";
import { recordAudit } from "@/lib/audit";
import { AppError } from "@/lib/errors";
import { tenantDb } from "@/lib/tenant/db";
import { parseOrThrow } from "@/lib/validation";
import { portalSettingsSchema, requestReviewSchema, CORRECTABLE_FIELDS } from "@/lib/validation/portal";
import type { Client } from "./clinic-shared";
import { AUDIT_ACTIONS, PAGE, iso, loadPortalSettings } from "./portal-core";
import { containsCI } from "./shared";

const db = (ctx: TenantRequestContext) => tenantDb(ctx) as Client;
function manage(ctx: TenantRequestContext) { if (ctx.user.role === "SUPER_ADMIN" || !ctx.permissions.has("portal.manage")) throw new AppError("FORBIDDEN"); }

/* -------------------------------------------------- clinic policy -------------------------------------------------- */
export async function getPortalPolicy(ctx: TenantRequestContext) {
  if (ctx.user.role === "SUPER_ADMIN" || !(ctx.permissions.has("portal.configure") || ctx.permissions.has("portal.manage"))) throw new AppError("FORBIDDEN");
  return { ...(await loadPortalSettings(db(ctx), ctx.tenantId)), canConfigure: ctx.permissions.has("portal.configure") };
}
export async function savePortalPolicy(ctx: TenantRequestContext, raw: unknown) {
  if (ctx.user.role === "SUPER_ADMIN" || !ctx.permissions.has("portal.configure")) throw new AppError("FORBIDDEN");
  const v = parseOrThrow(portalSettingsSchema, raw); const tdb = db(ctx); const cur = await loadPortalSettings(tdb, ctx.tenantId);
  const data = { enabled: v.enabled, allowBooking: v.allowBooking, allowCancel: v.allowCancel, allowReschedule: v.allowReschedule, changeCutoffHours: v.changeCutoffHours, showDiagnoses: v.showDiagnoses, supportNote: v.supportNote ?? null, privacyNotice: v.privacyNotice ?? null, consentVersion: v.consentVersion, editableFields: JSON.stringify(v.editableFields) };
  await tdb.portalSettings.upsert({ where: { tenantId: ctx.tenantId }, update: data, create: { tenantId: ctx.tenantId, ...data } });
  const changed = Object.keys(data).filter((k) => (k === "editableFields" ? JSON.stringify(cur.editableFields) !== data.editableFields : (cur as unknown as Record<string, unknown>)[k] !== (data as Record<string, unknown>)[k]));
  await recordAudit({ action: AUDIT_ACTIONS.PORTAL_CONFIG_CHANGED, tenantId: ctx.tenantId, actorId: ctx.user.id, entityType: "portal_settings", entityId: ctx.tenantId, metadata: { fields: changed } });
  if (!v.enabled && cur.enabled) await tdb.patientAccount.updateMany({ where: {}, data: { sessionsValidFrom: new Date() } }); // switching the portal off ends every patient session
  return loadPortalSettings(tdb, ctx.tenantId);
}

/* -------------------------------------------------- patient requests (staff review) -------------------------------------------------- */
export async function listPatientRequests(ctx: TenantRequestContext, q: { status?: string; kind?: string; q?: string; page?: number } = {}) {
  manage(ctx); const tdb = db(ctx); const page = Math.max(1, Math.floor(q.page ?? 1)); const text = (q.q ?? "").trim().slice(0, 60);
  const where: Record<string, unknown> = { ...(q.status ? { status: q.status } : {}), ...(q.kind ? { kind: q.kind } : {}) };
  if (text) { const pts = (await tdb.patient.findMany({ where: { OR: [{ name: containsCI(text) }, { code: containsCI(text) }] }, select: { id: true }, take: 100 })) as { id: string }[]; where.OR = [{ requestNumber: containsCI(text) }, { patientId: { in: pts.map((p) => p.id) } }]; }
  const [total, rows] = await Promise.all([tdb.patientRequest.count({ where }), tdb.patientRequest.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * PAGE, take: PAGE })]);
  const pts = (await tdb.patient.findMany({ where: { id: { in: [...new Set(rows.map((r: { patientId: string }) => r.patientId))] as string[] } }, select: { id: true, code: true, name: true } })) as { id: string; code: string; name: string }[];
  return { rows: rows.map((r: Record<string, any>) => { const p = pts.find((x) => x.id === r.patientId); return { id: r.id as string, requestNumber: r.requestNumber as string, patientId: r.patientId as string, patientName: p?.name ?? "—", patientCode: p?.code ?? "", kind: r.kind as string, field: (r.field ?? null) as string | null, currentValue: (r.currentValue ?? null) as string | null, requestedValue: (r.requestedValue ?? null) as string | null, reason: r.reason as string, status: r.status as string, reviewNote: (r.reviewNote ?? null) as string | null, applied: r.applied as boolean, createdAt: iso(r.createdAt) as string, canApply: r.kind === "PROFILE_CORRECTION" && !!r.field && (CORRECTABLE_FIELDS as readonly string[]).includes(r.field) && !r.applied }; }), total: total as number, page, pageSize: PAGE };
}
function coerce(field: string, value: string): unknown {
  const v = value.trim(); if (!v) throw new AppError("VALIDATION_ERROR", { message: "The requested value is empty." });
  if (field === "dateOfBirth") { if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`))) throw new AppError("VALIDATION_ERROR", { message: "The requested date of birth isn't a valid date (yyyy-mm-dd). Update the record by hand." }); return new Date(`${v}T00:00:00Z`); }
  if (field === "gender") { const g = v.toUpperCase(); if (!["MALE", "FEMALE", "OTHER", "UNDISCLOSED"].includes(g)) throw new AppError("VALIDATION_ERROR", { message: "Gender must be MALE, FEMALE, OTHER or UNDISCLOSED. Update the record by hand." }); return g; }
  if (field === "phone") { const d = v.replace(/[\s()-]/g, ""); const m = /^(?:\+91|91|0)?([6-9]\d{9})$/.exec(d); if (!m) throw new AppError("VALIDATION_ERROR", { message: "The requested mobile number isn't a valid 10-digit number. Update the record by hand." }); return `+91${m[1]}`; }
  if (field === "email") { if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) throw new AppError("VALIDATION_ERROR", { message: "The requested email isn't valid. Update the record by hand." }); return v.toLowerCase(); }
  return v.slice(0, 200);
}
/** start → under review; approve / reject close it; "apply" (approved demographic corrections only) writes the value to the patient record — never silently, always by a named reviewer and audited. */
export async function reviewPatientRequest(ctx: TenantRequestContext, id: string, raw: unknown) {
  manage(ctx); const v = parseOrThrow(requestReviewSchema, raw); const tdb = db(ctx);
  const r = await tdb.patientRequest.findFirst({ where: { id } });
  if (!r) throw new AppError("NOT_FOUND", { message: "Request not found." });
  const audit = (metadata: Record<string, unknown>) => recordAudit({ action: AUDIT_ACTIONS.PORTAL_REQUEST_REVIEWED, tenantId: ctx.tenantId, actorId: ctx.user.id, entityType: "patient_request", entityId: id, metadata: { number: r.requestNumber, kind: r.kind, ...metadata } });
  if (v.action === "start") {
    const u = await tdb.patientRequest.updateMany({ where: { id, status: "PENDING" }, data: { status: "UNDER_REVIEW", reviewedById: ctx.user.id } });
    if (u.count !== 1) throw new AppError("CONFLICT", { message: "This request is no longer waiting for review." });
    await audit({ status: "UNDER_REVIEW" }); return { status: "UNDER_REVIEW" };
  }
  if (v.action === "apply") {
    if (r.status !== "APPROVED" || r.kind !== "PROFILE_CORRECTION" || !r.field || !(CORRECTABLE_FIELDS as readonly string[]).includes(r.field) || r.applied || !r.requestedValue) throw new AppError("CONFLICT", { message: "Only an approved profile correction can be applied." });
    if (!ctx.permissions.has("patients.edit")) throw new AppError("FORBIDDEN", { message: "You need permission to edit patient records to apply this." });
    const value = coerce(r.field, r.requestedValue);
    await tdb.$transaction(async (tx: Client) => {
      const u = await tx.patientRequest.updateMany({ where: { id, tenantId: ctx.tenantId, applied: false }, data: { applied: true } });
      if (u.count !== 1) throw new AppError("CONFLICT", { message: "This correction was just applied." });
      await tx.patient.update({ where: { id: r.patientId }, data: { [r.field]: value } });
    });
    await recordAudit({ action: AUDIT_ACTIONS.PORTAL_REQUEST_REVIEWED, tenantId: ctx.tenantId, actorId: ctx.user.id, entityType: "patient", entityId: r.patientId, metadata: { applied: true, request: r.requestNumber, field: r.field } });
    return { applied: true };
  }
  const to = v.action === "approve" ? "APPROVED" : "REJECTED";
  if (to === "REJECTED" && !v.note) throw new AppError("VALIDATION_ERROR", { message: "Give the patient a reason.", fieldErrors: { note: "Give a reason." } });
  const u = await tdb.patientRequest.updateMany({ where: { id, status: { in: ["PENDING", "UNDER_REVIEW"] } }, data: { status: to, reviewedById: ctx.user.id, reviewedAt: new Date(), reviewNote: v.note ?? null } });
  if (u.count !== 1) throw new AppError("CONFLICT", { message: "This request was already closed." });
  if (to === "APPROVED" && r.kind === "ACCOUNT_DEACTIVATION") {
    await tdb.patientAccount.updateMany({ where: { patientId: r.patientId }, data: { status: "DEACTIVATED", sessionsValidFrom: new Date() } }); // portal login only — the medical record is untouched
  }
  await audit({ status: to, accountDeactivated: to === "APPROVED" && r.kind === "ACCOUNT_DEACTIVATION" });
  return { status: to };
}
export async function pendingRequestCount(ctx: TenantRequestContext) {
  if (!ctx.permissions.has("portal.manage")) return 0;
  return (await db(ctx).patientRequest.count({ where: { status: { in: ["PENDING", "UNDER_REVIEW"] } } })) as number;
}
