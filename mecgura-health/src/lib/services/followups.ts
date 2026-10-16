import "server-only";
import { notifyFollowUpCreated } from "@/lib/notifications/events";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";
import type { TenantRequestContext } from "@/lib/auth/context";
import { CLINICAL_TYPES, EDITABLE_STATUS_FOR_START, METHOD_PREF, OPEN_STATUSES, OUTCOME_STATUS, daysBetween, isOpen, type FollowUpType } from "@/lib/followups/core";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { addDays, todayIn, utcToZoned, zonedToUtc } from "@/lib/scheduling/time";
import { tenantDb } from "@/lib/tenant/db";
import { parseOrThrow } from "@/lib/validation";
import { completionBuiltin, contactBuiltin, contactSchema, followUpActionSchema, followUpCreateSchema, followUpEditSchema, followUpSettingsSchema } from "@/lib/validation/followups";
import { isUniqueViolation, nextCounter, tenantTimezone, type Client } from "./clinic-shared";
import { autoBill } from "./billing-invoices";
import { containsCI } from "./shared";

/**
 * Follow-up CRM. A follow-up is an OPERATIONAL task about a patient (call them, book the visit, review the report). Rules:
 *  - always tenant-scoped; visibility by role (doctor: own, reception: assigned + unassigned, nurse: assigned, admin: all);
 *  - "overdue" is computed from the due date; DUE is set lazily; nothing is auto-completed or auto-cancelled by time;
 *  - a logged contact never completes a follow-up, and only a real booking (existing appointment engine) makes it APPOINTMENT_BOOKED;
 *  - nothing here sends a message: every contact is a manual log, and a patient's "not allowed" preference blocks logging that channel;
 *  - history (events, contacts, reschedules) is append-only. No medical decisions are made or suggested.
 */
const db = (ctx: TenantRequestContext) => tenantDb(ctx) as Client;
const iso = (d: Date | null | undefined) => d?.toISOString() ?? null;
const pad = (n: number) => String(n).padStart(6, "0");
const ASSIGNEE_ROLES = ["DOCTOR", "RECEPTIONIST", "NURSE", "CLINIC_ADMIN", "STAFF"];

export function fuGuard(ctx: TenantRequestContext) {
  if (ctx.user.role === "SUPER_ADMIN") throw new AppError("FORBIDDEN", { message: "Platform administrators don't open clinic follow-ups." });
  if (!ctx.permissions.has("followups.view")) throw new AppError("FORBIDDEN");
}
const hasClinical = (ctx: TenantRequestContext) => ctx.permissions.has("patients.clinical");
/** Who sees which follow-ups. Foreign or out-of-scope ids simply don't exist for the caller. */
export function scopeWhere(ctx: TenantRequestContext): Record<string, unknown> {
  const me = ctx.user.id;
  if (ctx.user.role === "CLINIC_ADMIN") return {};
  if (ctx.user.role === "DOCTOR") return { OR: [{ doctorUserId: me }, { assignedToId: me }, { createdById: me }] };
  if (ctx.user.role === "RECEPTIONIST") return { OR: [{ assignedToId: me }, { assignedToId: null }] };
  return { assignedToId: me };
}

export interface FollowUpSettingsView { createOnNoShow: boolean; createOnCancellation: boolean; recallCreatesFollowUp: boolean; completeWhenVisitDone: boolean; contactOutcomes: string[]; completionOutcomes: string[] }
const parseList = (s: string | null | undefined): string[] => { try { const v = JSON.parse(s ?? "[]"); return Array.isArray(v) ? v.filter((x) => typeof x === "string") : []; } catch { return []; } };
export async function loadSettings(client: Client, tenantId: string): Promise<FollowUpSettingsView> {
  const s = await client.followUpSettings.findFirst({ where: { tenantId } });
  return { createOnNoShow: s?.createOnNoShow ?? true, createOnCancellation: s?.createOnCancellation ?? false, recallCreatesFollowUp: s?.recallCreatesFollowUp ?? false, completeWhenVisitDone: s?.completeWhenVisitDone ?? false, contactOutcomes: parseList(s?.contactOutcomes), completionOutcomes: parseList(s?.completionOutcomes) };
}
export async function getSettings(ctx: TenantRequestContext) { fuGuard(ctx); return { ...(await loadSettings(db(ctx), ctx.tenantId)), canConfigure: ctx.permissions.has("followups.configure"), integrations: { whatsapp: false, sms: false, email: false } }; }
export async function updateSettings(ctx: TenantRequestContext, raw: unknown) {
  fuGuard(ctx); if (!ctx.permissions.has("followups.configure")) throw new AppError("FORBIDDEN");
  const v = parseOrThrow(followUpSettingsSchema, raw);
  const data = { createOnNoShow: v.createOnNoShow, createOnCancellation: v.createOnCancellation, recallCreatesFollowUp: v.recallCreatesFollowUp, completeWhenVisitDone: v.completeWhenVisitDone, contactOutcomes: JSON.stringify([...new Set(v.contactOutcomes)]), completionOutcomes: JSON.stringify([...new Set(v.completionOutcomes)]), updatedById: ctx.user.id };
  await tenantDb(ctx).followUpSettings.upsert({ where: { tenantId: ctx.tenantId }, update: data, create: { tenantId: ctx.tenantId, ...data } });
  await recordAudit({ action: AUDIT_ACTIONS.FOLLOWUP_CONFIG_CHANGED, tenantId: ctx.tenantId, actorId: ctx.user.id, entityType: "followup_settings", entityId: ctx.tenantId, metadata: { createOnNoShow: v.createOnNoShow, createOnCancellation: v.createOnCancellation, recallCreatesFollowUp: v.recallCreatesFollowUp, completeWhenVisitDone: v.completeWhenVisitDone } });
  return { saved: true };
}

/* ------------------------------------------------ internals ------------------------------------------------ */
async function addEvent(tx: Client, tenantId: string, fu: { id: string; patientId: string }, type: string, userId: string | null, extra: { fromValue?: string | null; toValue?: string | null; note?: string | null } = {}) {
  await tx.followUpEvent.create({ data: { tenantId, followUpId: fu.id, patientId: fu.patientId, type, userId, fromValue: extra.fromValue ?? null, toValue: extra.toValue ?? null, note: extra.note ?? null } });
}
async function validAssignee(tdb: Client, userId: string) {
  const u = await tdb.user.findFirst({ where: { id: userId, status: "ACTIVE", deletedAt: null, role: { key: { in: ASSIGNEE_ROLES } } }, select: { id: true, role: { select: { key: true } } } });
  if (!u) throw new AppError("VALIDATION_ERROR", { message: "Choose a staff member from this clinic.", fieldErrors: { assignedToId: "Choose a staff member from this clinic." } });
  if (u.role.key === "STAFF" && !(await tdb.userPermissionGrant.findFirst({ where: { userId, permission: "followups.view" }, select: { id: true } }))) throw new AppError("VALIDATION_ERROR", { message: "That staff member can't open follow-ups.", fieldErrors: { assignedToId: "That staff member can't open follow-ups." } });
}
export interface NewFollowUp { patientId: string; doctorUserId?: string | null; consultationId?: string | null; prescriptionId?: string | null; investigationOrderId?: string | null; labReportId?: string | null; doctorOrderId?: string | null; recallId?: string | null; sourceAppointmentId?: string | null; type: FollowUpType; title: string; description?: string | null; doctorNotes?: string | null; notes?: string | null; dueDate: string; preferredDate?: string | null; priority?: string; assignedToId?: string | null; source: string; dedupeKey?: string | null; createdById: string }
/** Creates the row, its number and its CREATED event inside the caller's transaction. Returns null when the dedupe key already exists. */
export async function insertFollowUp(tx: Client, tenantId: string, d: NewFollowUp, yr: string, assignedById: string | null) {
  if (d.dedupeKey && (await tx.followUp.findFirst({ where: { tenantId, dedupeKey: d.dedupeKey }, select: { id: true } }))) return null;
  const n = await nextCounter(tx, tenantId, `fu:${yr}`);
  try {
    const fu = await tx.followUp.create({ data: { tenantId, followUpNumber: `FU-${yr}-${pad(n)}`, patientId: d.patientId, doctorUserId: d.doctorUserId ?? null, consultationId: d.consultationId ?? null, prescriptionId: d.prescriptionId ?? null, investigationOrderId: d.investigationOrderId ?? null, labReportId: d.labReportId ?? null, doctorOrderId: d.doctorOrderId ?? null, recallId: d.recallId ?? null, sourceAppointmentId: d.sourceAppointmentId ?? null, type: d.type, title: d.title, description: d.description ?? null, doctorNotes: d.doctorNotes ?? null, notes: d.notes ?? null, dueDate: d.dueDate, preferredDate: d.preferredDate ?? null, priority: d.priority ?? "NORMAL", assignedToId: d.assignedToId ?? null, assignedById: d.assignedToId ? assignedById : null, assignedAt: d.assignedToId ? new Date() : null, source: d.source, dedupeKey: d.dedupeKey ?? null, createdById: d.createdById } });
    await addEvent(tx, tenantId, fu, "CREATED", d.createdById, { toValue: d.dueDate, note: d.source });
    return fu as { id: string; followUpNumber: string; patientId: string };
  } catch (e) { if (d.dedupeKey && isUniqueViolation(e)) return null; throw e; }
}
const yearOf = async (tenantId: string) => todayIn(await tenantTimezone(tenantId)).slice(0, 4);
const todayOf = async (ctx: TenantRequestContext) => todayIn(await tenantTimezone(ctx.tenantId));

/** Lazy housekeeping, run when lists/stats load: PENDING/RESCHEDULED that reached their date become DUE; booked visits are reconciled with the real appointment. */
export async function refresh(ctx: TenantRequestContext) {
  const tdb = db(ctx); const today = await todayOf(ctx);
  await tdb.followUp.updateMany({ where: { status: { in: ["PENDING", "RESCHEDULED"] }, dueDate: { lte: today } }, data: { status: "DUE" } });
  const booked = await tdb.followUp.findMany({ where: { status: "APPOINTMENT_BOOKED", appointmentId: { not: null } }, select: { id: true, patientId: true, appointmentId: true }, take: 200 });
  if (!booked.length) return;
  const appts = await tdb.appointment.findMany({ where: { id: { in: booked.map((b: { appointmentId: string }) => b.appointmentId) } }, select: { id: true, status: true } });
  const st = new Map<string, string>(appts.map((a: { id: string; status: string }) => [a.id, a.status]));
  const settings = await loadSettings(tdb, ctx.tenantId);
  for (const b of booked as { id: string; patientId: string; appointmentId: string }[]) {
    const s = st.get(b.appointmentId);
    if (s === "CANCELLED" || s === "NO_SHOW") await releaseBooking(ctx.tenantId, tdb, b, s);
    else if (s === "COMPLETED" && settings.completeWhenVisitDone) {
      await tdb.$transaction(async (tx: Client) => {
        const r = await tx.followUp.updateMany({ where: { id: b.id, tenantId: ctx.tenantId, status: "APPOINTMENT_BOOKED" }, data: { status: "COMPLETED", outcome: "COMPLETED", outcomeNotes: "Follow-up visit completed.", completedAt: new Date() } });
        if (r.count === 1) await addEvent(tx, ctx.tenantId, b, "COMPLETED", null, { note: "Follow-up visit completed (clinic rule)" });
      });
    }
  }
}
async function releaseBooking(tenantId: string, tdb: Client, b: { id: string; patientId: string; appointmentId: string }, apptStatus: string) {
  await tdb.$transaction(async (tx: Client) => {
    const r = await tx.followUp.updateMany({ where: { id: b.id, tenantId, status: "APPOINTMENT_BOOKED", appointmentId: b.appointmentId }, data: { status: "DUE", appointmentId: null } });
    if (r.count === 1) await addEvent(tx, tenantId, b, "APPOINTMENT_RELEASED", null, { note: apptStatus === "NO_SHOW" ? "Booked visit was missed" : "Booked visit was cancelled" });
  });
}

/* ------------------------------------------------ create ------------------------------------------------ */
async function resolveLinks(ctx: TenantRequestContext, v: ReturnType<typeof parseCreate>) {
  const tdb = db(ctx);
  const doctorOnly = (msg: string) => { if (ctx.user.role !== "DOCTOR" && ctx.user.role !== "CLINIC_ADMIN") throw new AppError("FORBIDDEN", { message: msg }); };
  let patientId = v.patientId ?? null; let consultationId = v.consultationId ?? null; let doctorUserId = v.doctorUserId ?? null;
  let investigationOrderId: string | null = null; const labReportId = v.labReportId ?? null; const prescriptionId = v.prescriptionId ?? null; const doctorOrderId = v.doctorOrderId ?? null;
  let source = "MANUAL"; let type: FollowUpType = v.type;
  const own = (docId: string | null) => { if (ctx.user.role === "DOCTOR" && docId !== ctx.user.id) throw new AppError("FORBIDDEN", { message: "Only the treating doctor can create follow-ups from this record." }); };
  if (labReportId) {
    doctorOnly("Only doctors create follow-ups from a report.");
    const r = await tdb.labReport.findFirst({ where: { id: labReportId }, select: { patientId: true, doctorUserId: true, investigationOrderId: true, currentVersion: true } });
    if (!r) throw new AppError("NOT_FOUND", { message: "Report not found." });
    if (r.currentVersion < 1) throw new AppError("CONFLICT", { message: "This report has not been released yet." });
    own(r.doctorUserId);
    const o = await tdb.investigationOrder.findFirst({ where: { id: r.investigationOrderId }, select: { consultationId: true } });
    patientId = r.patientId; doctorUserId = r.doctorUserId; investigationOrderId = r.investigationOrderId; consultationId = o?.consultationId ?? consultationId; source = "REPORT"; if (v.type === "MANUAL_FOLLOW_UP") type = "REPORT_REVIEW";
  } else if (prescriptionId) {
    doctorOnly("Only doctors create follow-ups from a prescription.");
    const r = await tdb.prescription.findFirst({ where: { id: prescriptionId }, select: { patientId: true, consultationId: true } });
    if (!r) throw new AppError("NOT_FOUND", { message: "Prescription not found." });
    const c = await tdb.consultation.findFirst({ where: { id: r.consultationId }, select: { doctorUserId: true } });
    own(c?.doctorUserId ?? null);
    patientId = r.patientId; consultationId = r.consultationId; doctorUserId = c?.doctorUserId ?? null; source = "PRESCRIPTION"; if (v.type === "MANUAL_FOLLOW_UP") type = "MEDICATION_REVIEW";
  } else if (doctorOrderId) {
    doctorOnly("Only doctors create follow-ups from an order.");
    const r = await tdb.doctorOrder.findFirst({ where: { id: doctorOrderId }, select: { patientId: true, consultationId: true, doctorUserId: true } });
    if (!r) throw new AppError("NOT_FOUND", { message: "Order not found." });
    own(r.doctorUserId);
    patientId = r.patientId; consultationId = r.consultationId; doctorUserId = r.doctorUserId; source = "DOCTOR_ORDER";
  } else if (consultationId) {
    doctorOnly("Only doctors create follow-ups from a consultation.");
    const c = await tdb.consultation.findFirst({ where: { id: consultationId }, select: { patientId: true, doctorUserId: true, status: true } });
    if (!c) throw new AppError("NOT_FOUND", { message: "Consultation not found." });
    own(c.doctorUserId);
    if (c.status === "CANCELLED") throw new AppError("CONFLICT", { message: "This consultation was cancelled." });
    patientId = c.patientId; doctorUserId = c.doctorUserId; source = "CONSULTATION"; if (v.type === "MANUAL_FOLLOW_UP") type = "CONSULTATION_FOLLOW_UP";
  }
  if (!patientId) throw new AppError("VALIDATION_ERROR", { message: "Choose the patient.", fieldErrors: { patientId: "Choose the patient." } });
  const p = await tdb.patient.findFirst({ where: { id: patientId }, select: { id: true, status: true } });
  if (!p) throw new AppError("NOT_FOUND", { message: "Patient not found." });
  if (p.status === "ARCHIVED") throw new AppError("CONFLICT", { message: "This patient record is archived." });
  if (doctorUserId && doctorUserId !== (v.doctorUserId ?? null)) { /* derived from the record, never from the client */ }
  else if (doctorUserId) { const d = await tdb.user.findFirst({ where: { id: doctorUserId, role: { key: "DOCTOR" }, deletedAt: null }, select: { id: true } }); if (!d) throw new AppError("VALIDATION_ERROR", { message: "Choose a doctor from this clinic.", fieldErrors: { doctorUserId: "Choose a doctor from this clinic." } }); }
  return { patientId, consultationId, doctorUserId, investigationOrderId, labReportId, prescriptionId, doctorOrderId, source, type };
}
const parseCreate = (raw: unknown) => ({ ...parseOrThrow(followUpCreateSchema, raw) });

export async function createFollowUp(ctx: TenantRequestContext, raw: unknown) {
  fuGuard(ctx); if (!ctx.permissions.has("followups.create")) throw new AppError("FORBIDDEN");
  const v = parseCreate(raw);
  const tdb = db(ctx);
  const l = await resolveLinks(ctx, v);
  if (l.type === "NO_SHOW" || l.type === "MISSED_APPOINTMENT") { /* allowed manually too */ }
  if (v.assignedToId) await validAssignee(tdb, v.assignedToId);
  const today = await todayOf(ctx);
  const dueDate = v.dueDate ?? addDays(today, v.afterDays ?? 0);
  if (dueDate < today && !v.dueDate) throw new AppError("VALIDATION_ERROR", { message: "Due date is in the past.", fieldErrors: { dueDate: "Due date is in the past." } });
  if (dueDate < today) throw new AppError("VALIDATION_ERROR", { message: "Choose today or a later date.", fieldErrors: { dueDate: "Choose today or a later date." } });
  // double-click / duplicate guard: the same open follow-up for the same record and date
  const dup = await tdb.followUp.findFirst({ where: { patientId: l.patientId, type: l.type, title: v.title, dueDate, consultationId: l.consultationId, labReportId: l.labReportId, prescriptionId: l.prescriptionId, status: { in: [...OPEN_STATUSES] } }, select: { id: true } });
  if (dup) throw new AppError("CONFLICT", { message: "An identical open follow-up already exists." });
  const yr = await yearOf(ctx.tenantId);
  const fu = await tdb.$transaction(async (tx: Client) => insertFollowUp(tx, ctx.tenantId, { patientId: l.patientId, doctorUserId: l.doctorUserId, consultationId: l.consultationId, prescriptionId: l.prescriptionId, investigationOrderId: l.investigationOrderId, labReportId: l.labReportId, doctorOrderId: l.doctorOrderId, type: l.type, title: v.title, description: v.description, doctorNotes: hasClinical(ctx) ? v.doctorNotes : null, notes: v.notes, dueDate, preferredDate: v.preferredDate, priority: v.priority, assignedToId: v.assignedToId, source: l.source, createdById: ctx.user.id }, yr, ctx.user.id));
  await recordAudit({ action: AUDIT_ACTIONS.FOLLOWUP_CREATED, tenantId: ctx.tenantId, actorId: ctx.user.id, entityType: "followup", entityId: fu!.id, metadata: { number: fu!.followUpNumber, type: l.type, source: l.source, priority: v.priority, assigned: !!v.assignedToId } });
  await notifyFollowUpCreated(ctx.tenantId, fu!.id, ctx.user.id);
  return { id: fu!.id, followUpNumber: fu!.followUpNumber };
}

/** After a consultation is finalized: the doctor's own follow-up plan becomes (or updates) ONE follow-up. Never duplicates; never touches closed ones. */
export async function syncConsultationFollowUp(ctx: TenantRequestContext, consultationId: string) {
  try {
    const tdb = db(ctx);
    const c = await tdb.consultation.findFirst({ where: { id: consultationId }, select: { id: true, number: true, patientId: true, doctorUserId: true, followUpRequired: true, followUpAfterDays: true, followUpDate: true, followUpNotes: true } });
    if (!c) return;
    const key = `consult:${c.id}`;
    const existing = await tdb.followUp.findFirst({ where: { dedupeKey: key } });
    if (!c.followUpRequired) {
      if (existing && isOpen(existing.status) && existing.status !== "APPOINTMENT_BOOKED") await cancelInternal(ctx, existing, "The doctor removed the follow-up from the consultation.");
      return;
    }
    const today = await todayOf(ctx);
    const due = c.followUpDate ?? (c.followUpAfterDays != null ? addDays(today, c.followUpAfterDays) : null);
    if (!due) return;
    if (existing) {
      if (!isOpen(existing.status)) return;
      const changes: Record<string, unknown> = {};
      if (existing.dueDate !== due && existing.status !== "APPOINTMENT_BOOKED") { changes.dueDate = due; changes.rescheduleCount = { increment: 1 }; if (existing.status === "DUE") changes.status = "PENDING"; }
      if ((existing.doctorNotes ?? null) !== (c.followUpNotes ?? null)) changes.doctorNotes = c.followUpNotes ?? null;
      if (!Object.keys(changes).length) return;
      await tdb.$transaction(async (tx: Client) => {
        await tx.followUp.updateMany({ where: { id: existing.id, tenantId: ctx.tenantId }, data: changes });
        if (changes.dueDate) await addEvent(tx, ctx.tenantId, existing, "RESCHEDULED", ctx.user.id, { fromValue: existing.dueDate, toValue: due, note: "Consultation was amended" });
        else await addEvent(tx, ctx.tenantId, existing, "EDITED", ctx.user.id, { note: "Doctor note updated from the consultation" });
      });
      await recordAudit({ action: AUDIT_ACTIONS.FOLLOWUP_EDITED, tenantId: ctx.tenantId, actorId: ctx.user.id, entityType: "followup", entityId: existing.id, metadata: { fields: Object.keys(changes) } });
      return;
    }
    const yr = await yearOf(ctx.tenantId);
    const fu = await tdb.$transaction(async (tx: Client) => insertFollowUp(tx, ctx.tenantId, { patientId: c.patientId, doctorUserId: c.doctorUserId, consultationId: c.id, type: "CONSULTATION_FOLLOW_UP", title: "Follow-up visit", description: `Follow-up planned in consultation ${c.number}.`, doctorNotes: c.followUpNotes ?? null, dueDate: due, source: "CONSULTATION", dedupeKey: key, createdById: ctx.user.id }, yr, null));
    if (fu) await recordAudit({ action: AUDIT_ACTIONS.FOLLOWUP_CREATED, tenantId: ctx.tenantId, actorId: ctx.user.id, entityType: "followup", entityId: fu.id, metadata: { number: fu.followUpNumber, type: "CONSULTATION_FOLLOW_UP", source: "CONSULTATION", priority: "NORMAL", assigned: false } });
  } catch (e) { logger.error("followup.sync_failed", { consultationId, error: e instanceof Error ? e.message : String(e) }); }
}

/** Appointment engine hook: a no-show or cancellation can create a follow-up ONLY when the clinic switched that rule on. */
export async function onAppointmentClosed(ctx: TenantRequestContext, a: { id: string; patientId: string | null; doctorUserId: string; startsAt: Date; type: string }, kind: "NO_SHOW" | "CANCELLED") {
  try {
    const tdb = db(ctx);
    const linked = await tdb.followUp.findFirst({ where: { appointmentId: a.id, status: "APPOINTMENT_BOOKED" }, select: { id: true, patientId: true, appointmentId: true } });
    if (linked) { await releaseBooking(ctx.tenantId, tdb, linked, kind); return; } // the follow-up itself is re-opened instead of spawning another
    if (!a.patientId) return; // contact-only bookings have no patient record to follow up
    const s = await loadSettings(tdb, ctx.tenantId);
    if (kind === "NO_SHOW" ? !s.createOnNoShow : !s.createOnCancellation) return;
    const tz = await tenantTimezone(ctx.tenantId); const when = utcToZoned(a.startsAt, tz).date; const today = todayIn(tz);
    const yr = today.slice(0, 4);
    const fu = await tdb.$transaction(async (tx: Client) => insertFollowUp(tx, ctx.tenantId, { patientId: a.patientId!, doctorUserId: a.doctorUserId, type: kind === "NO_SHOW" ? "NO_SHOW" : "MISSED_APPOINTMENT", title: kind === "NO_SHOW" ? "Patient missed scheduled appointment" : "Appointment was cancelled", description: `Appointment on ${when}.`, dueDate: today, source: kind === "NO_SHOW" ? "NO_SHOW" : "CANCELLATION", sourceAppointmentId: a.id, dedupeKey: `${kind === "NO_SHOW" ? "noshow" : "cancel"}:${a.id}`, createdById: ctx.user.id }, yr, null));
    if (fu) await recordAudit({ action: AUDIT_ACTIONS.FOLLOWUP_CREATED, tenantId: ctx.tenantId, actorId: ctx.user.id, entityType: "followup", entityId: fu.id, metadata: { number: fu.followUpNumber, type: kind, source: "RULE", priority: "NORMAL", assigned: false } });
  } catch (e) { logger.error("followup.appointment_hook_failed", { appointmentId: a.id, error: e instanceof Error ? e.message : String(e) }); }
}

/* ------------------------------------------------ reads ------------------------------------------------ */
export interface FollowUpRow { id: string; followUpNumber: string; type: string; title: string; dueDate: string; priority: string; status: string; source: string; overdueDays: number; assignedTo: { id: string; name: string } | null; doctorName: string | null; patient: { id: string; code: string; name: string; phone: string | null } | null; appointmentId: string | null; visitCompleted: boolean }
const TAB_WHERE = (tab: string, today: string): Record<string, unknown> => {
  const open = { status: { in: [...OPEN_STATUSES] } };
  switch (tab) {
    case "today": return { ...open, dueDate: today };
    case "due": return { status: "DUE" };
    case "overdue": return { ...open, dueDate: { lt: today } };
    case "upcoming": return { ...open, dueDate: { gt: today } };
    case "completed": return { status: { in: ["COMPLETED", "PATIENT_DECLINED"] } };
    case "cancelled": return { status: { in: ["CANCELLED", "EXPIRED"] } };
    case "open": return open;
    default: return {};
  }
};
export const FU_TABS = ["all", "today", "due", "overdue", "upcoming", "completed", "cancelled"] as const;
const FU_PAGE = 20;
async function names(tdb: Client, ids: (string | null | undefined)[]) {
  const list = [...new Set(ids.filter(Boolean))] as string[];
  const users = list.length ? await tdb.user.findMany({ where: { id: { in: list } }, select: { id: true, name: true } }) : [];
  return new Map<string, string>(users.map((u: { id: string; name: string }) => [u.id, u.name]));
}

export async function listFollowUps(ctx: TenantRequestContext, q: { tab?: string; q?: string; doctorId?: string; assignedTo?: string; priority?: string; type?: string; status?: string; source?: string; date?: string; patientId?: string; consultationId?: string; page?: number }) {
  fuGuard(ctx); await refresh(ctx);
  const tdb = db(ctx); const today = await todayOf(ctx);
  const tab = (FU_TABS as readonly string[]).includes(q.tab ?? "") ? q.tab! : "all";
  const text = q.q?.trim().slice(0, 60); const page = Math.max(1, q.page ?? 1);
  const and: Record<string, unknown>[] = [scopeWhere(ctx), TAB_WHERE(tab, today)];
  if (tab === "all" && !q.status && !q.consultationId) and.push({ status: { in: [...OPEN_STATUSES] } });
  if (q.status) and.push({ status: q.status });
  if (q.priority) and.push({ priority: q.priority });
  if (q.type) and.push({ type: q.type });
  if (q.source) and.push({ source: q.source });
  if (q.doctorId) and.push({ doctorUserId: q.doctorId });
  if (q.patientId) and.push({ patientId: q.patientId });
  if (q.consultationId) and.push({ consultationId: q.consultationId });
  if (q.date && /^\d{4}-\d{2}-\d{2}$/.test(q.date)) and.push({ dueDate: q.date });
  if (q.assignedTo === "me") and.push({ assignedToId: ctx.user.id }); else if (q.assignedTo === "unassigned") and.push({ assignedToId: null }); else if (q.assignedTo) and.push({ assignedToId: q.assignedTo });
  if (text) and.push({ OR: [{ followUpNumber: containsCI(text) }, { title: containsCI(text) }, { patient: { name: containsCI(text) } }, { patient: { code: containsCI(text) } }, { patient: { phone: containsCI(text.replace(/[\s-]/g, "")) } }] });
  const where = { AND: and };
  const completedTab = tab === "completed" || tab === "cancelled";
  const [rows, total] = await Promise.all([
    tdb.followUp.findMany({ where, orderBy: completedTab ? [{ updatedAt: "desc" }] : [{ dueDate: "asc" }, { createdAt: "asc" }], skip: (page - 1) * FU_PAGE, take: FU_PAGE, include: { patient: { select: { id: true, code: true, name: true, phone: true } } } }),
    tdb.followUp.count({ where }),
  ]);
  const nm = await names(tdb, rows.flatMap((r: { assignedToId: string | null; doctorUserId: string | null }) => [r.assignedToId, r.doctorUserId]));
  const apptIds = rows.filter((r: { status: string; appointmentId: string | null }) => r.status === "APPOINTMENT_BOOKED" && r.appointmentId).map((r: { appointmentId: string }) => r.appointmentId);
  const appts = apptIds.length ? await tdb.appointment.findMany({ where: { id: { in: apptIds } }, select: { id: true, status: true } }) : [];
  const as = new Map<string, string>(appts.map((a: { id: string; status: string }) => [a.id, a.status]));
  const showId = ctx.permissions.has("patients.identity") || ctx.permissions.has("patients.view");
  const canPhone = showId && ctx.permissions.has("followups.contact");
  const out: FollowUpRow[] = rows.map((r: Record<string, any>) => ({ // eslint-disable-line @typescript-eslint/no-explicit-any
    id: r.id, followUpNumber: r.followUpNumber, type: r.type, title: r.title, dueDate: r.dueDate, priority: r.priority, status: r.status, source: r.source, overdueDays: isOpen(r.status) && r.dueDate < today ? daysBetween(r.dueDate, today) : 0,
    assignedTo: r.assignedToId ? { id: r.assignedToId, name: nm.get(r.assignedToId) ?? "Staff" } : null, doctorName: r.doctorUserId ? nm.get(r.doctorUserId) ?? null : null,
    patient: showId ? { id: r.patient.id, code: r.patient.code, name: r.patient.name, phone: canPhone ? r.patient.phone : null } : null, appointmentId: r.appointmentId ?? null, visitCompleted: as.get(r.appointmentId) === "COMPLETED",
  }));
  return { page, pageSize: FU_PAGE, total, tab, today, rows: out };
}

/** Real database counts for the command center (scoped to what the caller may see). */
export async function followUpStats(ctx: TenantRequestContext) {
  fuGuard(ctx); await refresh(ctx);
  const tdb = db(ctx); const tz = await tenantTimezone(ctx.tenantId); const today = todayIn(tz); const tomorrow = addDays(today, 1);
  const sc = scopeWhere(ctx); const open = { status: { in: [...OPEN_STATUSES] } };
  const c = (extra: Record<string, unknown>) => tdb.followUp.count({ where: { AND: [sc, extra] } });
  const dayStart = zonedToUtc(today, 0, tz); const month = zonedToUtc(addDays(today, -30), 0, tz);
  const [dueToday, overdue, dueTomorrow, upcoming, noResponse, booked, completedToday, toContact, noShowOpen, completed30, created30, unassigned] = await Promise.all([
    c({ ...open, dueDate: today }), c({ ...open, dueDate: { lt: today } }), c({ ...open, dueDate: tomorrow }), c({ ...open, dueDate: { gt: today } }), c({ status: "NO_RESPONSE" }), c({ status: "APPOINTMENT_BOOKED" }),
    c({ status: "COMPLETED", completedAt: { gte: dayStart } }), c({ status: { in: ["PENDING", "DUE"] }, dueDate: { lte: today } }), c({ ...open, type: { in: ["NO_SHOW", "MISSED_APPOINTMENT"] } }),
    c({ status: "COMPLETED", completedAt: { gte: month } }), c({ createdAt: { gte: month } }), c({ ...open, assignedToId: null }),
  ]);
  const showRecall = ctx.permissions.has("recalls.manage");
  const recallDue = showRecall ? await tdb.recall.count({ where: { status: "ACTIVE", dueDate: { lte: today } } }) : 0;
  const reschedules30 = await tdb.followUpEvent.count({ where: { type: "RESCHEDULED", at: { gte: month }, followUp: { is: sc } } });
  const doctor = ctx.user.role === "DOCTOR";
  const pendingReportReviews = doctor ? await tdb.labReport.count({ where: { doctorUserId: ctx.user.id, currentVersion: { gt: 0 }, order: { is: { status: { not: "DOCTOR_REVIEWED" } } } } }) : 0;
  return { today, dueToday, overdue, dueTomorrow, upcoming, noResponse, booked, completedToday, toContact, noShowOpen, unassigned, recallDue, retention: { completed30, created30, reschedules30, overdue, noShowOpen, recallDue }, pendingReportReviews };
}

export async function getFollowUp(ctx: TenantRequestContext, id: string) {
  fuGuard(ctx); await refresh(ctx);
  const tdb = db(ctx); const today = await todayOf(ctx);
  const f = await tdb.followUp.findFirst({ where: { AND: [{ id }, scopeWhere(ctx)] }, include: { patient: true, contacts: { orderBy: { contactedAt: "desc" }, take: 100 }, events: { orderBy: { at: "desc" }, take: 200 } } });
  if (!f) throw new AppError("NOT_FOUND", { message: "Follow-up not found." });
  const clinical = hasClinical(ctx); const open = isOpen(f.status);
  const nm = await names(tdb, [f.assignedToId, f.assignedById, f.doctorUserId, f.createdById, f.completedById, f.cancelledById, ...f.contacts.map((c: { contactedById: string }) => c.contactedById), ...f.events.map((e: { userId: string | null }) => e.userId)]);
  const settings = await loadSettings(tdb, ctx.tenantId);
  const showId = ctx.permissions.has("patients.identity") || ctx.permissions.has("patients.view");
  const appts = await tdb.appointment.findMany({ where: { patientId: f.patientId }, orderBy: { startsAt: "desc" }, take: 8, select: { id: true, publicId: true, startsAt: true, status: true, type: true, doctorUserId: true } });
  const dn = await names(tdb, appts.map((a: { doctorUserId: string }) => a.doctorUserId));
  const linked = f.appointmentId ? appts.find((a: { id: string }) => a.id === f.appointmentId) ?? (await tdb.appointment.findFirst({ where: { id: f.appointmentId }, select: { id: true, publicId: true, startsAt: true, status: true, type: true, doctorUserId: true } })) : null;
  const clinicalOk = !CLINICAL_TYPES.includes(f.type) || clinical;
  const p = f.patient;
  const manage = ctx.permissions.has("followups.manage");
  return {
    id: f.id, followUpNumber: f.followUpNumber, type: f.type, title: f.title, description: f.description, notes: f.notes, doctorNotes: clinical ? f.doctorNotes : null, dueDate: f.dueDate, preferredDate: f.preferredDate, priority: f.priority, status: f.status, source: f.source,
    overdueDays: open && f.dueDate < today ? daysBetween(f.dueDate, today) : 0, rescheduleCount: f.rescheduleCount, outcome: f.outcome, outcomeNotes: f.outcomeNotes, completedAt: iso(f.completedAt), completedBy: f.completedById ? nm.get(f.completedById) ?? null : null, cancelledAt: iso(f.cancelledAt), cancelReason: f.cancelReason, cancelledBy: f.cancelledById ? nm.get(f.cancelledById) ?? null : null,
    doctorId: f.doctorUserId, doctorName: f.doctorUserId ? nm.get(f.doctorUserId) ?? null : null, assignedTo: f.assignedToId ? { id: f.assignedToId, name: nm.get(f.assignedToId) ?? "Staff" } : null, assignedBy: f.assignedById ? nm.get(f.assignedById) ?? null : null, assignedAt: iso(f.assignedAt), createdBy: nm.get(f.createdById) ?? null, createdAt: iso(f.createdAt),
    patient: showId ? { id: p.id, code: p.code, name: p.name, phone: ctx.permissions.has("followups.contact") ? p.phone : null, preferredName: p.preferredName, prefs: { phone: p.prefPhone, whatsapp: p.prefWhatsapp, sms: p.prefSms, email: p.prefEmail }, status: p.status } : null,
    links: { consultationId: clinical ? f.consultationId : null, labReportId: clinical ? f.labReportId : null, investigationOrderId: clinical ? f.investigationOrderId : null, prescriptionId: clinical ? f.prescriptionId : null },
    appointment: linked ? { id: linked.id, publicId: linked.publicId, startsAt: linked.startsAt.toISOString(), status: linked.status, type: linked.type, doctorName: nm.get(linked.doctorUserId) ?? dn.get(linked.doctorUserId) ?? null } : null,
    appointments: appts.map((a: { id: string; publicId: string; startsAt: Date; status: string; type: string; doctorUserId: string }) => ({ id: a.id, publicId: a.publicId, startsAt: a.startsAt.toISOString(), status: a.status, type: a.type, doctorName: dn.get(a.doctorUserId) ?? null })) as { id: string; publicId: string; startsAt: string; status: string; type: string; doctorName: string | null }[],
    contacts: f.contacts.map((c: Record<string, any>) => ({ id: c.id, method: c.method, outcome: c.outcome, notes: c.notes, contactedAt: iso(c.contactedAt), by: nm.get(c.contactedById) ?? null, nextAction: c.nextAction, nextActionDate: c.nextActionDate })) as { id: string; method: string; outcome: string; notes: string | null; contactedAt: string | null; by: string | null; nextAction: string | null; nextActionDate: string | null }[], // eslint-disable-line @typescript-eslint/no-explicit-any
    events: f.events.map((e: Record<string, any>) => ({ id: e.id, type: e.type, by: e.userId ? nm.get(e.userId) ?? null : "System", fromValue: e.fromValue, toValue: e.toValue, note: e.note, at: iso(e.at) })) as { id: string; type: string; by: string | null; fromValue: string | null; toValue: string | null; note: string | null; at: string | null }[], // eslint-disable-line @typescript-eslint/no-explicit-any
    outcomes: { contact: [...new Set([...contactBuiltin, ...settings.contactOutcomes])], completion: [...new Set([...completionBuiltin, ...settings.completionOutcomes])] },
    integrations: { whatsapp: false, sms: false, email: false }, clinicalAccess: clinical,
    can: {
      start: open && (manage || ctx.permissions.has("followups.contact")) && EDITABLE_STATUS_FOR_START.includes(f.status), contact: open && ctx.permissions.has("followups.contact"), book: open && manage && ctx.permissions.has("appointments.create") && showId, reschedule: open && manage,
      complete: open && manage && clinicalOk, cancel: open && manage, assign: open && manage, edit: open && manage, createNext: ctx.permissions.has("followups.create"),
    },
    visitCompleted: linked?.status === "COMPLETED" && f.status === "APPOINTMENT_BOOKED",
  };
}
export type FollowUpDetail = Awaited<ReturnType<typeof getFollowUp>>;

export async function assignableUsers(ctx: TenantRequestContext) {
  fuGuard(ctx); if (!ctx.permissions.has("followups.manage") && !ctx.permissions.has("followups.create")) throw new AppError("FORBIDDEN");
  const users = await db(ctx).user.findMany({ where: { status: "ACTIVE", deletedAt: null, role: { key: { in: ASSIGNEE_ROLES } } }, select: { id: true, name: true, role: { select: { key: true } } }, orderBy: { name: "asc" }, take: 200 });
  const staffIds = users.filter((u: { role: { key: string } }) => u.role.key === "STAFF").map((u: { id: string }) => u.id);
  const granted = staffIds.length ? await db(ctx).userPermissionGrant.findMany({ where: { userId: { in: staffIds }, permission: "followups.view" }, select: { userId: true } }) : [];
  const ok = new Set(granted.map((g: { userId: string }) => g.userId));
  return { users: users.filter((u: { id: string; role: { key: string } }) => u.role.key !== "STAFF" || ok.has(u.id)).map((u: { id: string; name: string; role: { key: string } }) => ({ id: u.id, name: u.name, role: u.role.key })) as { id: string; name: string; role: string }[] };
}

/* ------------------------------------------------ changes ------------------------------------------------ */
async function loadScoped(ctx: TenantRequestContext, id: string) {
  const f = await db(ctx).followUp.findFirst({ where: { AND: [{ id }, scopeWhere(ctx)] } });
  if (!f) throw new AppError("NOT_FOUND", { message: "Follow-up not found." });
  return f as Record<string, any> & { id: string; patientId: string; status: string }; // eslint-disable-line @typescript-eslint/no-explicit-any
}
const closedMsg = () => new AppError("CONFLICT", { message: "This follow-up is already closed." });
const stale = () => new AppError("CONFLICT", { message: "Someone else just changed this follow-up. Refresh and try again." });

export async function editFollowUp(ctx: TenantRequestContext, id: string, raw: unknown) {
  fuGuard(ctx); if (!ctx.permissions.has("followups.manage")) throw new AppError("FORBIDDEN");
  const v = parseOrThrow(followUpEditSchema, raw);
  const f = await loadScoped(ctx, id);
  if (!isOpen(f.status)) throw closedMsg();
  const data: Record<string, unknown> = {};
  for (const k of ["title", "description", "notes", "priority", "preferredDate"] as const) if (v[k] !== undefined && (f[k] ?? null) !== (v[k] ?? null)) data[k] = v[k] ?? null;
  if (v.doctorNotes !== undefined) { if (!hasClinical(ctx)) throw new AppError("FORBIDDEN", { message: "Doctor notes can only be changed by clinical staff." }); if ((f.doctorNotes ?? null) !== (v.doctorNotes ?? null)) data.doctorNotes = v.doctorNotes ?? null; }
  if (v.doctorUserId !== undefined && v.doctorUserId !== f.doctorUserId) { if (v.doctorUserId && !(await db(ctx).user.findFirst({ where: { id: v.doctorUserId, role: { key: "DOCTOR" }, deletedAt: null }, select: { id: true } }))) throw new AppError("VALIDATION_ERROR", { message: "Choose a doctor from this clinic." }); data.doctorUserId = v.doctorUserId ?? null; }
  if (!Object.keys(data).length) return { updated: false };
  await db(ctx).$transaction(async (tx: Client) => {
    const r = await tx.followUp.updateMany({ where: { id, tenantId: ctx.tenantId, status: f.status }, data });
    if (r.count !== 1) throw stale();
    await addEvent(tx, ctx.tenantId, f, "EDITED", ctx.user.id, { note: Object.keys(data).join(", ") });
  });
  await recordAudit({ action: AUDIT_ACTIONS.FOLLOWUP_EDITED, tenantId: ctx.tenantId, actorId: ctx.user.id, entityType: "followup", entityId: id, metadata: { fields: Object.keys(data) } });
  return { updated: true };
}

async function cancelInternal(ctx: TenantRequestContext, f: { id: string; patientId: string; status: string }, reason: string) {
  await db(ctx).$transaction(async (tx: Client) => {
    const r = await tx.followUp.updateMany({ where: { id: f.id, tenantId: ctx.tenantId, status: f.status }, data: { status: "CANCELLED", cancelledAt: new Date(), cancelledById: ctx.user.id, cancelReason: reason } });
    if (r.count !== 1) throw stale();
    await addEvent(tx, ctx.tenantId, f, "CANCELLED", ctx.user.id, { note: reason });
  });
  await recordAudit({ action: AUDIT_ACTIONS.FOLLOWUP_CANCELLED, tenantId: ctx.tenantId, actorId: ctx.user.id, entityType: "followup", entityId: f.id, metadata: {} });
}

export async function followUpAction(ctx: TenantRequestContext, id: string, raw: unknown) {
  fuGuard(ctx);
  const a = parseOrThrow(followUpActionSchema, raw);
  const tdb = db(ctx); const tenantId = ctx.tenantId; const uid = ctx.user.id;
  const f = await loadScoped(ctx, id);
  const manage = ctx.permissions.has("followups.manage");
  if (!isOpen(f.status)) throw closedMsg();

  switch (a.action) {
    case "start": {
      if (!(manage || ctx.permissions.has("followups.contact"))) throw new AppError("FORBIDDEN");
      if (!EDITABLE_STATUS_FOR_START.includes(f.status)) throw new AppError("CONFLICT", { message: "This follow-up can't be started from its current status." });
      await tdb.$transaction(async (tx: Client) => {
        const r = await tx.followUp.updateMany({ where: { id, tenantId, status: f.status }, data: { status: "IN_PROGRESS", ...(f.assignedToId ? {} : { assignedToId: uid, assignedById: uid, assignedAt: new Date() }) } });
        if (r.count !== 1) throw stale();
        if (!f.assignedToId) await addEvent(tx, tenantId, f, "ASSIGNED", uid, { toValue: uid, note: "Took the task" });
        await addEvent(tx, tenantId, f, "STARTED", uid);
      });
      await recordAudit({ action: AUDIT_ACTIONS.FOLLOWUP_STARTED, tenantId, actorId: uid, entityType: "followup", entityId: id, metadata: { from: f.status } });
      return { status: "IN_PROGRESS" };
    }
    case "assign": {
      if (!manage) throw new AppError("FORBIDDEN");
      const to = a.assignedToId || null;
      if (to) await validAssignee(tdb, to);
      if ((f.assignedToId ?? null) === to) return { assignedToId: to };
      await tdb.$transaction(async (tx: Client) => {
        const r = await tx.followUp.updateMany({ where: { id, tenantId, status: f.status }, data: { assignedToId: to, assignedById: uid, assignedAt: new Date() } });
        if (r.count !== 1) throw stale();
        await addEvent(tx, tenantId, f, f.assignedToId ? "REASSIGNED" : "ASSIGNED", uid, { fromValue: f.assignedToId ?? null, toValue: to });
      });
      await recordAudit({ action: f.assignedToId ? AUDIT_ACTIONS.FOLLOWUP_REASSIGNED : AUDIT_ACTIONS.FOLLOWUP_ASSIGNED, tenantId, actorId: uid, entityType: "followup", entityId: id, metadata: { from: f.assignedToId ?? null, to } });
      return { assignedToId: to };
    }
    case "reschedule": {
      if (!manage) throw new AppError("FORBIDDEN");
      const today = await todayOf(ctx);
      if (a.dueDate < today) throw new AppError("VALIDATION_ERROR", { message: "Choose today or a later date.", fieldErrors: { dueDate: "Choose today or a later date." } });
      if (a.dueDate === f.dueDate) throw new AppError("VALIDATION_ERROR", { message: "That is the current due date.", fieldErrors: { dueDate: "That is the current due date." } });
      const nextStatus = f.status === "APPOINTMENT_BOOKED" ? "APPOINTMENT_BOOKED" : a.dueDate <= today ? "DUE" : "RESCHEDULED";
      await tdb.$transaction(async (tx: Client) => {
        const r = await tx.followUp.updateMany({ where: { id, tenantId, status: f.status, dueDate: f.dueDate }, data: { dueDate: a.dueDate, status: nextStatus, rescheduleCount: { increment: 1 } } });
        if (r.count !== 1) throw stale();
        await addEvent(tx, tenantId, f, "RESCHEDULED", uid, { fromValue: f.dueDate, toValue: a.dueDate, note: a.reason });
      });
      await recordAudit({ action: AUDIT_ACTIONS.FOLLOWUP_RESCHEDULED, tenantId, actorId: uid, entityType: "followup", entityId: id, metadata: { from: f.dueDate, to: a.dueDate } });
      return { dueDate: a.dueDate, status: nextStatus };
    }
    case "complete": {
      if (!manage) throw new AppError("FORBIDDEN");
      if (CLINICAL_TYPES.includes(f.type) && !hasClinical(ctx)) throw new AppError("FORBIDDEN", { message: "Only a doctor or clinical staff can close this clinical follow-up." });
      const settings = await loadSettings(tdb, tenantId);
      const allowed = [...completionBuiltin, ...settings.completionOutcomes];
      if (!allowed.includes(a.outcome)) throw new AppError("VALIDATION_ERROR", { message: "Choose a valid outcome.", fieldErrors: { outcome: "Choose a valid outcome." } });
      const wantsNext = a.nextDueDate || a.nextAfterDays != null;
      if (wantsNext && !ctx.permissions.has("followups.create")) throw new AppError("FORBIDDEN", { message: "You can't create a next follow-up." });
      const today = await todayOf(ctx);
      const nextDue = wantsNext ? a.nextDueDate ?? addDays(today, a.nextAfterDays ?? 0) : null;
      if (nextDue && nextDue < today) throw new AppError("VALIDATION_ERROR", { message: "Next follow-up date is in the past.", fieldErrors: { nextDueDate: "Next follow-up date is in the past." } });
      const yr = today.slice(0, 4);
      const next = await tdb.$transaction(async (tx: Client) => {
        const r = await tx.followUp.updateMany({ where: { id, tenantId, status: f.status }, data: { status: a.outcome === "PATIENT_DECLINED" ? "PATIENT_DECLINED" : "COMPLETED", outcome: a.outcome, outcomeNotes: a.notes, completedAt: new Date(), completedById: uid } });
        if (r.count !== 1) throw stale();
        await addEvent(tx, tenantId, f, "COMPLETED", uid, { toValue: a.outcome });
        if (!nextDue) return null;
        const type = (f.type === "NO_SHOW" || f.type === "MISSED_APPOINTMENT" ? "MANUAL_FOLLOW_UP" : f.type) as FollowUpType;
        return insertFollowUp(tx, tenantId, { patientId: f.patientId, doctorUserId: f.doctorUserId, consultationId: f.consultationId, type, title: a.nextTitle ?? f.title, description: f.description, dueDate: nextDue, priority: f.priority, assignedToId: f.assignedToId, source: "MANUAL", createdById: uid }, yr, uid);
      });
      await recordAudit({ action: AUDIT_ACTIONS.FOLLOWUP_COMPLETED, tenantId, actorId: uid, entityType: "followup", entityId: id, metadata: { outcome: a.outcome, next: next?.followUpNumber ?? null } });
      if (next) await recordAudit({ action: AUDIT_ACTIONS.FOLLOWUP_CREATED, tenantId, actorId: uid, entityType: "followup", entityId: next.id, metadata: { number: next.followUpNumber, type: f.type, source: "MANUAL", priority: f.priority, assigned: !!f.assignedToId, previous: id } });
      return { status: a.outcome === "PATIENT_DECLINED" ? "PATIENT_DECLINED" : "COMPLETED", next: next ? { id: next.id, followUpNumber: next.followUpNumber } : null };
    }
    case "cancel": {
      if (!manage) throw new AppError("FORBIDDEN");
      await cancelInternal(ctx, f, a.reason);
      return { status: "CANCELLED" };
    }
  }
}

export async function logContact(ctx: TenantRequestContext, id: string, raw: unknown) {
  fuGuard(ctx); if (!ctx.permissions.has("followups.contact")) throw new AppError("FORBIDDEN");
  const v = parseOrThrow(contactSchema, raw);
  const tdb = db(ctx); const tenantId = ctx.tenantId; const uid = ctx.user.id;
  const f = await loadScoped(ctx, id);
  if (!isOpen(f.status)) throw closedMsg();
  const settings = await loadSettings(tdb, tenantId);
  if (!([...contactBuiltin, ...settings.contactOutcomes] as string[]).includes(v.outcome)) throw new AppError("VALIDATION_ERROR", { message: "Choose a valid outcome.", fieldErrors: { outcome: "Choose a valid outcome." } });
  const prefKey = METHOD_PREF[v.method];
  if (prefKey) {
    const p = await tdb.patient.findFirst({ where: { id: f.patientId }, select: { prefPhone: true, prefWhatsapp: true, prefSms: true, prefEmail: true } });
    if (p?.[prefKey] === "NOT_ALLOWED") throw new AppError("CONFLICT", { message: `This patient has asked not to be contacted by ${v.method.toLowerCase()}. Choose another method.`, fieldErrors: { method: "The patient has not allowed this method." } });
  }
  const mapped = OUTCOME_STATUS[v.outcome] ?? null;
  const nextStatus = f.status === "APPOINTMENT_BOOKED" ? f.status : mapped ?? (f.status === "PENDING" || f.status === "DUE" || f.status === "RESCHEDULED" ? "IN_PROGRESS" : f.status);
  const c = await tdb.$transaction(async (tx: Client) => {
    const r = await tx.followUp.updateMany({ where: { id, tenantId, status: f.status }, data: { status: nextStatus, ...(f.assignedToId ? {} : { assignedToId: uid, assignedById: uid, assignedAt: new Date() }) } });
    if (r.count !== 1) throw stale();
    const row = await tx.followUpContact.create({ data: { tenantId, followUpId: id, patientId: f.patientId, contactedById: uid, method: v.method, outcome: v.outcome, notes: v.notes ?? null, nextAction: v.nextAction ?? null, nextActionDate: v.nextActionDate ?? null } });
    if (!f.assignedToId) await addEvent(tx, tenantId, f, "ASSIGNED", uid, { toValue: uid, note: "Took the task" });
    await addEvent(tx, tenantId, f, "CONTACTED", uid, { toValue: v.outcome, note: v.method });
    return row;
  });
  await recordAudit({ action: AUDIT_ACTIONS.FOLLOWUP_CONTACT_LOGGED, tenantId, actorId: uid, entityType: "followup", entityId: id, metadata: { method: v.method, outcome: v.outcome } });
  return { id: c.id as string, status: nextStatus };
}

/* ------------------------------------------ appointment engine link ------------------------------------------ */
/** Checked BEFORE the appointment is created so a bad link can't leave a stray booking. */
export async function assertLinkable(ctx: TenantRequestContext, followUpId: string, patientId: string | null) {
  if (!ctx.permissions.has("followups.manage")) throw new AppError("FORBIDDEN", { message: "You can't book appointments from follow-ups." });
  const f = await loadScoped(ctx, followUpId);
  if (!isOpen(f.status)) throw new AppError("CONFLICT", { message: "This follow-up is already closed." });
  if (!patientId || patientId !== f.patientId) throw new AppError("VALIDATION_ERROR", { message: "The appointment must be for the follow-up's patient.", fieldErrors: { patient: "The appointment must be for the follow-up's patient." } });
  return f;
}
export async function linkAppointment(ctx: TenantRequestContext, followUpId: string, appointment: { id: string; startsAt: Date }) {
  const f = await loadScoped(ctx, followUpId);
  const tz = await tenantTimezone(ctx.tenantId); const when = utcToZoned(appointment.startsAt, tz).date;
  await db(ctx).$transaction(async (tx: Client) => {
    const r = await tx.followUp.updateMany({ where: { id: followUpId, tenantId: ctx.tenantId, status: { in: [...OPEN_STATUSES] } }, data: { status: "APPOINTMENT_BOOKED", appointmentId: appointment.id, preferredDate: when } });
    if (r.count !== 1) throw stale();
    if (f.appointmentId && f.appointmentId !== appointment.id) await addEvent(tx, ctx.tenantId, f, "APPOINTMENT_RELEASED", ctx.user.id, { note: "Replaced by a new booking" });
    await addEvent(tx, ctx.tenantId, f, "APPOINTMENT_BOOKED", ctx.user.id, { toValue: when, note: appointment.id });
  });
  await recordAudit({ action: AUDIT_ACTIONS.FOLLOWUP_APPOINTMENT_BOOKED, tenantId: ctx.tenantId, actorId: ctx.user.id, entityType: "followup", entityId: followUpId, metadata: { appointmentId: appointment.id } });
  await autoBill(ctx, "followup", followUpId); // draft invoice only if the clinic enabled it
}

/* ------------------------------------------------ patient views ------------------------------------------------ */
export async function patientFollowUps(ctx: TenantRequestContext, patientId: string) {
  fuGuard(ctx); await refresh(ctx);
  const tdb = db(ctx); const today = await todayOf(ctx);
  if (!(await tdb.patient.findFirst({ where: { id: patientId }, select: { id: true } }))) throw new AppError("NOT_FOUND", { message: "Patient not found." });
  const rows = await tdb.followUp.findMany({ where: { AND: [{ patientId }, scopeWhere(ctx)] }, orderBy: [{ dueDate: "desc" }], take: 100 });
  const nm = await names(tdb, rows.flatMap((r: { doctorUserId: string | null }) => [r.doctorUserId]));
  const recalls = ctx.permissions.has("recalls.manage") ? await tdb.recall.findMany({ where: { patientId, status: { in: ["ACTIVE", "FOLLOW_UP_CREATED"] } }, orderBy: { dueDate: "asc" }, take: 20 }) : [];
  const mapped = rows.map((r: Record<string, any>) => ({ id: r.id, followUpNumber: r.followUpNumber, type: r.type, title: r.title, dueDate: r.dueDate, priority: r.priority, status: r.status, doctorName: r.doctorUserId ? nm.get(r.doctorUserId) ?? null : null, overdueDays: isOpen(r.status) && r.dueDate < today ? daysBetween(r.dueDate, today) : 0, group: !isOpen(r.status) ? (r.status === "CANCELLED" || r.status === "EXPIRED" ? "cancelled" : "completed") : r.dueDate < today ? "overdue" : r.dueDate === today ? "active" : "upcoming" })) as { id: string; followUpNumber: string; type: string; title: string; dueDate: string; priority: string; status: string; doctorName: string | null; overdueDays: number; group: "overdue" | "active" | "upcoming" | "completed" | "cancelled" }[]; // eslint-disable-line @typescript-eslint/no-explicit-any
  return { followUps: mapped, recalls: recalls.map((r: Record<string, any>) => ({ id: r.id, title: r.title, dueDate: r.dueDate, frequency: r.frequency, status: r.status })), can: { create: ctx.permissions.has("followups.create"), recall: ctx.permissions.has("recalls.manage") } }; // eslint-disable-line @typescript-eslint/no-explicit-any
}

/** Timeline entries for Patient 360 (only for follow-ups the caller may see). Safe summaries: no notes, no clinical text. */
export interface TimelineItem { id: string; type: string; title: string; at: string; detail: string; href: string }
export async function followUpTimeline(ctx: TenantRequestContext, patientId: string): Promise<TimelineItem[]> {
  if (!ctx.permissions.has("followups.view") || ctx.user.role === "SUPER_ADMIN") return [];
  const tdb = db(ctx);
  const events = await tdb.followUpEvent.findMany({ where: { patientId, followUp: { is: scopeWhere(ctx) } }, orderBy: { at: "desc" }, take: 80, include: { followUp: { select: { id: true, followUpNumber: true, title: true } } } });
  const nm = await names(tdb, events.map((e: { userId: string | null }) => e.userId));
  const LABEL: Record<string, [string, string]> = { CREATED: ["FOLLOW_UP_CREATED", "Follow-up created"], ASSIGNED: ["FOLLOW_UP_ASSIGNED", "Follow-up assigned"], REASSIGNED: ["FOLLOW_UP_ASSIGNED", "Follow-up reassigned"], STARTED: ["FOLLOW_UP_STARTED", "Follow-up started"], CONTACTED: ["FOLLOW_UP_CONTACTED", "Patient contacted"], RESCHEDULED: ["FOLLOW_UP_RESCHEDULED", "Follow-up rescheduled"], APPOINTMENT_BOOKED: ["FOLLOW_UP_APPOINTMENT_BOOKED", "Follow-up appointment booked"], APPOINTMENT_RELEASED: ["FOLLOW_UP_APPOINTMENT_RELEASED", "Follow-up appointment released"], COMPLETED: ["FOLLOW_UP_COMPLETED", "Follow-up completed"], CANCELLED: ["FOLLOW_UP_CANCELLED", "Follow-up cancelled"], EDITED: ["FOLLOW_UP_EDITED", "Follow-up updated"] };
  return events.filter((e: { type: string }) => LABEL[e.type]).map((e: Record<string, any>) => ({ id: `fu-${e.id}`, type: LABEL[e.type][0], title: LABEL[e.type][1], at: e.at.toISOString(), detail: `${e.followUp.followUpNumber} · ${e.followUp.title}${e.userId ? ` · ${nm.get(e.userId) ?? "Staff"}` : ""}`, href: `/followups/${e.followUp.id}` })) as TimelineItem[]; // eslint-disable-line @typescript-eslint/no-explicit-any
}
