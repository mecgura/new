import "server-only";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";
import type { TenantRequestContext } from "@/lib/auth/context";
import { CONSULTATION_TRANSITIONS, EDITABLE, bmi, type ConsultationStatus } from "@/lib/clinical/states";
import { parseJson, sha256 } from "@/lib/clinical/snapshot";
import { AppError } from "@/lib/errors";
import { rateLimit } from "@/lib/security/rate-limit";
import { timeInTz, todayIn, utcToZoned } from "@/lib/scheduling/time";
import { tenantDb } from "@/lib/tenant/db";
import { parseOrThrow } from "@/lib/validation";
import { consultationActionSchema, consultationPatchSchema, diagnosisSchema, templateSchema, vitalsSchema } from "@/lib/validation/clinical";
import { ageLabel, isUniqueViolation, nextCounter, tenantTimezone, type Client } from "./clinic-shared";
import { autoBill } from "./billing-invoices";
import { syncConsultationFollowUp } from "./followups";
import { queueAction } from "./opd";
import { finalizePrescriptionTx, prescriptionSummary } from "./prescription";
import { notifyPrescription } from "@/lib/notifications/events";

/**
 * Doctor consultation. Rules enforced here (never in the browser):
 *  - only the OWNING doctor edits clinical content, and only while it is not finalized;
 *  - nurses may add vitals; other clinical staff may read; platform admins and non-clinical roles may not;
 *  - finalizing is atomic and idempotent-safe (status guard), and finalized content changes only through amend → new version.
 */
const db = (ctx: TenantRequestContext) => tenantDb(ctx) as Client;
export const isOwnerDoctor = (ctx: TenantRequestContext, doctorUserId: string) => ctx.user.role === "DOCTOR" && ctx.user.id === doctorUserId;

export function clinicalGuard(ctx: TenantRequestContext) {
  if (ctx.user.role === "SUPER_ADMIN") throw new AppError("FORBIDDEN", { message: "Platform administrators don't open clinic clinical records." });
}
const msgFinal = "This consultation is finalized. Use “Amend” (with a reason) to change it — the original stays on record.";

export async function loadConsultation(ctx: TenantRequestContext, id: string, mode: "read" | "write" | "vitals") {
  clinicalGuard(ctx);
  if (mode === "read" ? !(ctx.permissions.has("consultation.view") && ctx.permissions.has("patients.clinical")) : mode === "vitals" ? !(ctx.permissions.has("vitals.record") || ctx.permissions.has("consultation.edit")) : !ctx.permissions.has("consultation.edit")) throw new AppError("FORBIDDEN");
  const c = await db(ctx).consultation.findFirst({ where: { id }, include: { patient: true, opdVisit: { select: { id: true, tokenLabel: true, status: true, visitType: true, priority: true, checkedInAt: true } }, appointment: { select: { publicId: true, type: true, source: true, startsAt: true, reason: true } }, doctor: { select: { id: true, name: true } } } });
  if (!c) throw new AppError("NOT_FOUND", { message: "Consultation not found." });
  if (mode === "write" && !isOwnerDoctor(ctx, c.doctorUserId)) throw new AppError("FORBIDDEN", { message: "Only the treating doctor can change this consultation." });
  if (mode === "vitals" && !isOwnerDoctor(ctx, c.doctorUserId) && ctx.user.role === "DOCTOR") throw new AppError("FORBIDDEN", { message: "Only the treating doctor or nursing staff can add vitals." });
  if (mode !== "read") {
    if (c.status === "FINALIZED") throw new AppError("CONFLICT", { message: msgFinal });
    if (!EDITABLE.includes(c.status)) throw new AppError("CONFLICT", { message: "This consultation was cancelled and can't be changed." });
  }
  return c;
}

const year = (tz: string) => todayIn(tz).slice(0, 4);

/* ------------------------------------------------ start ------------------------------------------------ */
export async function startConsultation(ctx: TenantRequestContext, visitId: string) {
  clinicalGuard(ctx);
  if (!ctx.permissions.has("consultation.create") || ctx.user.role !== "DOCTOR") throw new AppError("FORBIDDEN", { message: "Only doctors can start a consultation." });
  const tdb = db(ctx);
  const visit = await tdb.opdVisit.findFirst({ where: { id: visitId }, include: { consultation: { select: { id: true } }, patient: { select: { status: true } } } });
  if (!visit) throw new AppError("NOT_FOUND", { message: "Visit not found." });
  if (visit.doctorUserId !== ctx.user.id) throw new AppError("FORBIDDEN", { message: "This patient is in another doctor's queue." });
  if (visit.consultation) return { id: visit.consultation.id as string, existing: true };
  if (visit.patient.status === "ARCHIVED") throw new AppError("CONFLICT", { message: "This patient record is archived. Ask a clinic admin to restore it." });
  if (visit.status === "COMPLETED") throw new AppError("CONFLICT", { message: "This visit is already completed." });
  if (visit.status === "CANCELLED") throw new AppError("CONFLICT", { message: "This visit was cancelled." });
  if (visit.status === "ON_HOLD" || visit.status === "SKIPPED") throw new AppError("CONFLICT", { message: "Resume the patient in the queue before starting the consultation." });
  // move the queue the normal Phase 3 way (call -> start); the queue's own rules (one patient at a time) still apply.
  // Two clicks / two tabs can race here: the loser re-reads and either opens the winner's consultation or carries on.
  for (let attempt = 0; attempt < 3; attempt++) {
    const cur = await tdb.opdVisit.findFirst({ where: { id: visitId }, include: { consultation: { select: { id: true } } } });
    if (cur?.consultation) return { id: cur.consultation.id as string, existing: true };
    try {
      if (cur!.status === "WAITING") await queueAction(ctx, visitId, { action: "call" });
      if (cur!.status === "WAITING" || cur!.status === "CALLED") await queueAction(ctx, visitId, { action: "start" });
      break;
    } catch (e) {
      if (attempt === 2 || !(e instanceof AppError) || e.code !== "CONFLICT") throw e;
      await new Promise((r) => setTimeout(r, 40 * (attempt + 1)));
    }
  }

  const tz = await tenantTimezone(ctx.tenantId);
  try {
    const c = await tdb.$transaction(async (tx: Client) => {
      const n = await nextCounter(tx, ctx.tenantId, `cons:${year(tz)}`);
      return tx.consultation.create({ data: { tenantId: ctx.tenantId, number: `CONS-${year(tz)}-${String(n).padStart(6, "0")}`, patientId: visit.patientId, doctorUserId: ctx.user.id, opdVisitId: visit.id, appointmentId: visit.appointmentId ?? null, status: "IN_PROGRESS" }, select: { id: true, number: true } });
    });
    await recordAudit({ action: AUDIT_ACTIONS.CONSULTATION_STARTED, tenantId: ctx.tenantId, actorId: ctx.user.id, entityType: "consultation", entityId: c.id, metadata: { number: c.number, patientId: visit.patientId, opdVisitId: visit.id } });
    return { id: c.id as string, existing: false };
  } catch (e) {
    if (isUniqueViolation(e)) { // two clicks / two tabs: the other one won — open that consultation
      const again = await tdb.consultation.findFirst({ where: { opdVisitId: visitId }, select: { id: true } });
      if (again) return { id: again.id as string, existing: true };
    }
    throw e;
  }
}

/* ------------------------------------------------- read ------------------------------------------------- */
export async function getConsultation(ctx: TenantRequestContext, id: string) {
  const c = await loadConsultation(ctx, id, "read");
  const tz = await tenantTimezone(ctx.tenantId);
  const tdb = db(ctx);
  const [vitals, diagnoses, orders, rx] = await Promise.all([
    tdb.consultationVitals.findMany({ where: { consultationId: id }, orderBy: { recordedAt: "desc" }, take: 20 }),
    tdb.consultationDiagnosis.findMany({ where: { consultationId: id }, orderBy: { createdAt: "asc" } }),
    tdb.doctorOrder.findMany({ where: { consultationId: id }, orderBy: { createdAt: "desc" }, take: 50 }),
    prescriptionSummary(ctx, id, true),
  ]);
  const staff = await tdb.user.findMany({ where: { id: { in: [...new Set([...vitals.map((v: { recordedById: string }) => v.recordedById), ...orders.map((o: { assignedToId: string | null }) => o.assignedToId).filter(Boolean)])] as string[] } }, select: { id: true, name: true } });
  const names = new Map(staff.map((u: { id: string; name: string }) => [u.id, u.name]));
  const owner = isOwnerDoctor(ctx, c.doctorUserId);
  const editable = (EDITABLE as readonly string[]).includes(c.status);
  const p = c.patient;
  return {
    id: c.id, number: c.number, status: c.status as ConsultationStatus, rev: c.rev, version: c.version, amendReason: c.amendReason,
    startedAt: c.startedAt.toISOString(), startedLabel: `${utcToZoned(c.startedAt, tz).date} ${timeInTz(c.startedAt, tz)}`, finalizedAt: c.finalizedAt?.toISOString() ?? null,
    patient: { id: p.id, code: p.code, name: p.name, age: ageLabel(p), gender: p.gender, phone: p.phone },
    doctor: c.doctor,
    visit: { token: c.opdVisit.tokenLabel, status: c.opdVisit.status, type: c.opdVisit.visitType, priority: c.opdVisit.priority },
    appointment: c.appointment ? { publicId: c.appointment.publicId, type: c.appointment.type, source: c.appointment.source, when: `${utcToZoned(c.appointment.startsAt, tz).date} ${timeInTz(c.appointment.startsAt, tz)}`, reason: c.appointment.reason } : null,
    content: {
      chiefComplaints: parseJson(c.chiefComplaints, []), symptoms: parseJson(c.symptoms, []), history: parseJson<Record<string, string>>(c.history, {}),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      examination: parseJson<Record<string, any>>(c.examination, {}),
      assessment: c.assessment ?? "", impression: c.impression ?? "", differential: c.differential ?? "", assessmentNotes: c.assessmentNotes ?? "", clinicalNotes: c.clinicalNotes ?? "", advice: c.advice ?? "",
      followUp: { required: c.followUpRequired, afterDays: c.followUpAfterDays, date: c.followUpDate, notes: c.followUpNotes ?? "" },
    },
    vitals: vitals.map((v: Record<string, unknown> & { recordedAt: Date; recordedById: string }) => ({ ...v, tenantId: undefined, recordedAt: v.recordedAt.toISOString(), recordedBy: names.get(v.recordedById) ?? "Staff" })),
    diagnoses: diagnoses.map((d: Record<string, unknown>) => ({ ...d, tenantId: undefined })),
    orders: orders.map((o: Record<string, unknown> & { assignedToId: string | null; createdAt: Date; updatedAt: Date; completedAt: Date | null }) => ({ ...o, tenantId: undefined, assignedTo: o.assignedToId ? names.get(o.assignedToId) ?? null : null, createdAt: o.createdAt.toISOString(), updatedAt: o.updatedAt.toISOString(), completedAt: o.completedAt?.toISOString() ?? null })),
    prescription: rx,
    can: {
      edit: owner && editable && ctx.permissions.has("consultation.edit"), vitals: editable && (owner || ctx.user.role !== "DOCTOR") && (ctx.permissions.has("vitals.record") || owner),
      finalize: owner && ctx.permissions.has("consultation.finalize") && c.status === "READY_FOR_REVIEW", amend: owner && c.status === "FINALIZED" && ctx.permissions.has("consultation.finalize"),
      orders: owner && ctx.permissions.has("orders.create") && c.status !== "CANCELLED", print: ctx.permissions.has("prescription.print"), owner,
    },
  };
}
export type ConsultationView = Awaited<ReturnType<typeof getConsultation>>;

export async function listConsultations(ctx: TenantRequestContext, q: { patientId?: string; page?: number; mine?: boolean }) {
  clinicalGuard(ctx);
  if (!(ctx.permissions.has("consultation.view") && ctx.permissions.has("patients.clinical"))) throw new AppError("FORBIDDEN");
  const tz = await tenantTimezone(ctx.tenantId);
  const page = Math.max(1, Math.min(q.page ?? 1, 500));
  const where = { ...(q.patientId ? { patientId: q.patientId } : {}), ...(q.mine || (!q.patientId && ctx.user.role === "DOCTOR") ? { doctorUserId: ctx.user.id } : {}) };
  const tdb = db(ctx);
  const [total, rows] = await Promise.all([
    tdb.consultation.count({ where }),
    tdb.consultation.findMany({ where, orderBy: { startedAt: "desc" }, skip: (page - 1) * 15, take: 15, include: { patient: { select: { code: true, name: true } }, doctor: { select: { name: true } }, diagnoses: { select: { name: true, type: true }, orderBy: { type: "asc" }, take: 3 }, prescription: { select: { number: true, status: true } } } }),
  ]);
  return {
    page, pageSize: 15, total,
    rows: rows.map((c: { id: string; number: string; status: string; startedAt: Date; chiefComplaints: string; followUpRequired: boolean; followUpAfterDays: number | null; patientId: string; patient: { code: string; name: string }; doctor: { name: string }; diagnoses: { name: string; type: string }[]; prescription: { number: string | null; status: string } | null }) => ({
      id: c.id, number: c.number, status: c.status, date: utcToZoned(c.startedAt, tz).date, patientId: c.patientId, patient: c.patient, doctor: c.doctor.name,
      complaint: parseJson<{ text: string }[]>(c.chiefComplaints, [])[0]?.text ?? null, diagnoses: c.diagnoses.map((d) => d.name), prescription: c.prescription?.number ?? null,
      followUp: c.followUpRequired ? (c.followUpAfterDays ? `after ${c.followUpAfterDays} days` : "required") : null,
    })),
  };
}

/* ------------------------------------------- autosave / content ------------------------------------------- */
export async function patchConsultation(ctx: TenantRequestContext, id: string, raw: unknown) {
  await loadConsultation(ctx, id, "write");
  const p = parseOrThrow(consultationPatchSchema, raw);
  const data: Record<string, unknown> = {};
  if (p.chiefComplaints) data.chiefComplaints = JSON.stringify(p.chiefComplaints);
  if (p.symptoms) data.symptoms = JSON.stringify(p.symptoms);
  if (p.history) data.history = JSON.stringify(p.history);
  if (p.examination) data.examination = JSON.stringify(p.examination);
  for (const k of ["assessment", "impression", "differential", "assessmentNotes", "clinicalNotes", "advice", "followUpNotes", "followUpDate"] as const) if (k in (raw as object)) data[k] = p[k] ?? null;
  if (p.followUpRequired !== undefined) data.followUpRequired = p.followUpRequired;
  if ("followUpAfterDays" in (raw as object)) data.followUpAfterDays = p.followUpAfterDays ?? null;
  if (!Object.keys(data).length) return { rev: p.rev, saved: false };
  // optimistic concurrency: a stale tab can't silently overwrite newer text. Editing a "ready" consultation sends it back to in-progress.
  const res = await db(ctx).consultation.updateMany({ where: { id, rev: p.rev, status: { in: [...EDITABLE] } }, data: { ...data, rev: { increment: 1 }, status: "IN_PROGRESS", readyAt: null } });
  if (res.count !== 1) {
    const cur = await db(ctx).consultation.findFirst({ where: { id }, select: { status: true, rev: true } });
    if (cur && !(EDITABLE as readonly string[]).includes(cur.status)) throw new AppError("CONFLICT", { message: msgFinal });
    throw new AppError("CONFLICT", { message: "This consultation was changed in another window. Reload to see the latest version before editing.", fieldErrors: { _rev: String(cur?.rev ?? "") } });
  }
  if ((await rateLimit(`caudit:${id}`, { limit: 1, windowMs: 5 * 60_000 })).allowed) await recordAudit({ action: AUDIT_ACTIONS.CONSULTATION_UPDATED, tenantId: ctx.tenantId, actorId: ctx.user.id, entityType: "consultation", entityId: id, metadata: { fields: Object.keys(data) } });
  return { rev: p.rev + 1, saved: true };
}

/* ------------------------------------------------- workflow ------------------------------------------------- */
export async function consultationAction(ctx: TenantRequestContext, id: string, raw: unknown) {
  const input = parseOrThrow(consultationActionSchema, raw);
  clinicalGuard(ctx);
  const c0 = await loadConsultation(ctx, id, "read");
  if (!isOwnerDoctor(ctx, c0.doctorUserId) || !ctx.permissions.has("consultation.finalize")) throw new AppError("FORBIDDEN", { message: "Only the treating doctor can do this." });
  const tdb = db(ctx);
  const from = c0.status as ConsultationStatus;
  const move = (to: ConsultationStatus) => { if (!CONSULTATION_TRANSITIONS[from].includes(to)) throw new AppError("CONFLICT", { message: from === "FINALIZED" ? msgFinal : `A ${from.toLowerCase().replace(/_/g, " ")} consultation can't be moved to ${to.toLowerCase().replace(/_/g, " ")}.` }); };
  const audit = (action: Parameters<typeof recordAudit>[0]["action"], metadata?: Record<string, unknown>) => recordAudit({ action, tenantId: ctx.tenantId, actorId: ctx.user.id, entityType: "consultation", entityId: id, metadata: { number: c0.number, ...metadata } });
  const guarded = async (to: ConsultationStatus, data: Record<string, unknown> = {}) => {
    const r = await tdb.consultation.updateMany({ where: { id, status: from }, data: { status: to, ...data } });
    if (r.count !== 1) throw new AppError("CONFLICT", { message: "This consultation was just changed by someone else. Reload and try again." });
  };

  switch (input.action) {
    case "review": {
      move("READY_FOR_REVIEW");
      const has = parseJson<unknown[]>(c0.chiefComplaints, []).length || parseJson<unknown[]>(c0.symptoms, []).length || c0.clinicalNotes || c0.assessment || (await tdb.consultationDiagnosis.count({ where: { consultationId: id } }));
      if (!has) throw new AppError("VALIDATION_ERROR", { message: "Record at least a complaint, note, assessment or diagnosis before review." });
      await guarded("READY_FOR_REVIEW", { readyAt: new Date() });
      await audit(AUDIT_ACTIONS.CONSULTATION_REVIEW);
      return { status: "READY_FOR_REVIEW" };
    }
    case "edit": { move("IN_PROGRESS"); if (from === "FINALIZED") throw new AppError("CONFLICT", { message: msgFinal }); await guarded("IN_PROGRESS", { readyAt: null }); await audit(AUDIT_ACTIONS.CONSULTATION_REOPENED); return { status: "IN_PROGRESS" }; }
    case "cancel": {
      move("CANCELLED");
      if (await tdb.prescription.count({ where: { consultationId: id, currentVersion: { gt: 0 } } })) throw new AppError("CONFLICT", { message: "A finalized prescription exists, so this consultation can't be cancelled." });
      await guarded("CANCELLED", { cancelledAt: new Date(), cancelReason: input.reason ?? null });
      await audit(AUDIT_ACTIONS.CONSULTATION_CANCELLED, { hasReason: !!input.reason });
      return { status: "CANCELLED" };
    }
    case "amend": {
      move("IN_PROGRESS");
      if (from !== "FINALIZED") throw new AppError("CONFLICT", { message: "Only a finalized consultation needs amending." });
      if (!input.reason || input.reason.length < 3) throw new AppError("VALIDATION_ERROR", { message: "Give a reason for the amendment.", fieldErrors: { reason: "Give a reason for the amendment." } });
      await guarded("IN_PROGRESS", { amendReason: input.reason, readyAt: null, rev: { increment: 1 } });
      await audit(AUDIT_ACTIONS.CONSULTATION_AMENDED, { fromVersion: c0.version });
      return { status: "IN_PROGRESS" };
    }
    case "finalize": {
      if (from !== "READY_FOR_REVIEW") throw new AppError("CONFLICT", { message: from === "FINALIZED" ? msgFinal : "Send the consultation to review before finalizing." });
      if (input.confirm !== true) throw new AppError("VALIDATION_ERROR", { message: "Confirm that you have reviewed the consultation.", fieldErrors: { confirm: "Please confirm." } });
      if (c0.version > 0 && !c0.amendReason) throw new AppError("CONFLICT", { message: "An amendment reason is required." });
      const tz = await tenantTimezone(ctx.tenantId);
      const out = await tdb.$transaction(async (tx: Client) => {
        const version = c0.version + 1;
        const r = await tx.consultation.updateMany({ where: { id, status: "READY_FOR_REVIEW", version: c0.version }, data: { status: "FINALIZED", finalizedAt: new Date(), finalizedById: ctx.user.id, version } }); // duplicate finalize loses here
        if (r.count !== 1) throw new AppError("CONFLICT", { message: "This consultation was just finalized or changed by someone else." });
        const [vitals, diagnoses, fresh] = await Promise.all([tx.consultationVitals.findMany({ where: { consultationId: id }, orderBy: { recordedAt: "asc" } }), tx.consultationDiagnosis.findMany({ where: { consultationId: id }, orderBy: { createdAt: "asc" } }), tx.consultation.findFirst({ where: { id } })]);
        const snapshot = JSON.stringify({ number: fresh.number, version, patientId: fresh.patientId, chiefComplaints: parseJson(fresh.chiefComplaints, []), symptoms: parseJson(fresh.symptoms, []), history: parseJson(fresh.history, {}), examination: parseJson(fresh.examination, {}), assessment: fresh.assessment, impression: fresh.impression, differential: fresh.differential, assessmentNotes: fresh.assessmentNotes, clinicalNotes: fresh.clinicalNotes, advice: fresh.advice, followUp: { required: fresh.followUpRequired, afterDays: fresh.followUpAfterDays, date: fresh.followUpDate, notes: fresh.followUpNotes }, vitals: vitals.map((v: Record<string, unknown>) => ({ ...v, tenantId: undefined })), diagnoses: diagnoses.map((d: Record<string, unknown>) => ({ ...d, tenantId: undefined })) });
        await tx.consultationVersion.create({ data: { tenantId: ctx.tenantId, consultationId: id, version, snapshot, contentHash: sha256(snapshot), reason: c0.amendReason ?? null, createdById: ctx.user.id } });
        await tx.consultation.updateMany({ where: { id }, data: { amendReason: null } });
        // the prescription (if it has medicines) is finalized in the SAME transaction, so the two can't disagree
        const rx = await finalizePrescriptionTx(ctx, tx, id, { requireReview: false, tz, reason: c0.amendReason ?? undefined, soft: true });
        return { version, rx };
      });
      await audit(AUDIT_ACTIONS.CONSULTATION_FINALIZED, { version: out.version, prescription: out.rx?.number ?? null });
      if (out.rx) await recordAudit({ action: AUDIT_ACTIONS.PRESCRIPTION_FINALIZED, tenantId: ctx.tenantId, actorId: ctx.user.id, entityType: "prescription", entityId: out.rx.id, metadata: { number: out.rx.number, version: out.rx.version, consultationId: id } });
      if (out.rx) await notifyPrescription(ctx.tenantId, id); // queued after commit; a messaging problem can never undo the finalization
      await autoBill(ctx, "consultation", id); // only when the clinic switched automatic draft invoices on
      await syncConsultationFollowUp(ctx, id); // the doctor's own follow-up plan becomes one follow-up task
      // OPD queue: complete the visit through the normal Phase 3 rules; if the queue has moved on (e.g. already completed) the consultation stays finalized
      let visitCompleted = false;
      try { await queueAction(ctx, c0.opdVisit.id, { action: "complete" }); visitCompleted = true; } catch { /* queue state decides */ }
      return { status: "FINALIZED", version: out.version, prescriptionNumber: out.rx?.number ?? null, visitCompleted };
    }
  }
}

/* -------------------------------------------------- vitals -------------------------------------------------- */
export async function addVitals(ctx: TenantRequestContext, id: string, raw: unknown) {
  const c = await loadConsultation(ctx, id, "vitals");
  const v = parseOrThrow(vitalsSchema, raw);
  const row = await db(ctx).consultationVitals.create({ data: { tenantId: ctx.tenantId, consultationId: id, patientId: c.patientId, systolic: v.systolic ?? null, diastolic: v.diastolic ?? null, pulse: v.pulse ?? null, temperature: v.temperature ?? null, tempUnit: v.tempUnit, spo2: v.spo2 ?? null, respRate: v.respRate ?? null, weightKg: v.weightKg ?? null, heightCm: v.heightCm ?? null, bmi: bmi(v.weightKg, v.heightCm), bloodSugar: v.bloodSugar ?? null, sugarType: v.sugarType ?? null, painScore: v.painScore ?? null, notes: v.notes ?? null, recordedById: ctx.user.id } });
  await recordAudit({ action: AUDIT_ACTIONS.VITALS_RECORDED, tenantId: ctx.tenantId, actorId: ctx.user.id, entityType: "consultation", entityId: id, metadata: { vitalsId: row.id } });
  return { id: row.id as string, bmi: row.bmi as number | null };
}

/* ------------------------------------------------- diagnoses ------------------------------------------------- */
export async function addDiagnosis(ctx: TenantRequestContext, id: string, raw: unknown) {
  const c = await loadConsultation(ctx, id, "write");
  const d = parseOrThrow(diagnosisSchema, raw);
  const row = await db(ctx).$transaction(async (tx: Client) => {
    if (d.type === "PRIMARY") await tx.consultationDiagnosis.updateMany({ where: { consultationId: id, type: "PRIMARY" }, data: { type: "SECONDARY" } });
    return tx.consultationDiagnosis.create({ data: { tenantId: ctx.tenantId, consultationId: id, patientId: c.patientId, name: d.name, code: d.code ?? null, codeSystem: d.codeSystem ?? null, type: d.type, notes: d.notes ?? null, createdById: ctx.user.id } });
  });
  await recordAudit({ action: AUDIT_ACTIONS.DIAGNOSIS_ADDED, tenantId: ctx.tenantId, actorId: ctx.user.id, entityType: "consultation", entityId: id, metadata: { diagnosisId: row.id, type: d.type } });
  return { id: row.id as string };
}
export async function updateDiagnosis(ctx: TenantRequestContext, id: string, diagnosisId: string, raw: unknown) {
  await loadConsultation(ctx, id, "write");
  const d = parseOrThrow(diagnosisSchema, raw);
  const ok = await db(ctx).$transaction(async (tx: Client) => {
    if (d.type === "PRIMARY") await tx.consultationDiagnosis.updateMany({ where: { consultationId: id, type: "PRIMARY", id: { not: diagnosisId } }, data: { type: "SECONDARY" } });
    return (await tx.consultationDiagnosis.updateMany({ where: { id: diagnosisId, consultationId: id }, data: { name: d.name, code: d.code ?? null, codeSystem: d.codeSystem ?? null, type: d.type, notes: d.notes ?? null } })).count === 1;
  });
  if (!ok) throw new AppError("NOT_FOUND");
  await recordAudit({ action: AUDIT_ACTIONS.DIAGNOSIS_UPDATED, tenantId: ctx.tenantId, actorId: ctx.user.id, entityType: "consultation", entityId: id, metadata: { diagnosisId, type: d.type } });
  return { updated: true };
}
export async function removeDiagnosis(ctx: TenantRequestContext, id: string, diagnosisId: string) {
  await loadConsultation(ctx, id, "write");
  const r = await db(ctx).consultationDiagnosis.deleteMany({ where: { id: diagnosisId, consultationId: id } });
  if (r.count !== 1) throw new AppError("NOT_FOUND");
  await recordAudit({ action: AUDIT_ACTIONS.DIAGNOSIS_REMOVED, tenantId: ctx.tenantId, actorId: ctx.user.id, entityType: "consultation", entityId: id, metadata: { diagnosisId } });
  return { removed: true };
}

/* ------------------------------------------- sidebar context (read-only) ------------------------------------------- */
export interface ConsultationContext {
  allergies: { allergen: string; reaction: string | null; severity: string }[];
  currentMedications: { name: string; strength: string | null; frequency: string | null; source: string }[];
  previousConsultations: { id: string; number: string; date: string; doctor: string; complaint: string | null; diagnoses: string[]; prescription: string | null; followUp: string | null }[];
  previousDiagnoses: string[];
  previousVitals: { date: string; bp: string | null; pulse: number | null; temperature: string | null; spo2: number | null; weightKg: number | null; heightCm: number | null; bmi: number | null }[];
  recentVisits: { id: string; date: string; doctor: string; type: string; status: string; token: string }[];
  recentPrescriptions: { number: string | null; date: string; medicines: string[] }[];
  documents: { available: boolean };
}
export async function consultationContext(ctx: TenantRequestContext, id: string): Promise<ConsultationContext> {
  const c = await loadConsultation(ctx, id, "read");
  const tz = await tenantTimezone(ctx.tenantId);
  const tdb = db(ctx);
  const day = (d: Date) => utcToZoned(d, tz).date;
  const [allergies, meds, prev, lastVitals, visits, rxs] = await Promise.all([
    tdb.patientAllergy.findMany({ where: { patientId: c.patientId, status: "ACTIVE" }, orderBy: { recordedAt: "desc" }, take: 10, select: { allergen: true, reaction: true, severity: true } }),
    tdb.patientMedication.findMany({ where: { patientId: c.patientId, active: true }, orderBy: { recordedAt: "desc" }, take: 20, select: { name: true, strength: true, frequency: true, source: true } }),
    tdb.consultation.findMany({ where: { patientId: c.patientId, status: "FINALIZED", id: { not: id } }, orderBy: { finalizedAt: "desc" }, take: 5, include: { doctor: { select: { name: true } }, diagnoses: { select: { name: true, type: true } }, prescription: { select: { number: true } } } }),
    tdb.consultationVitals.findMany({ where: { patientId: c.patientId, consultationId: { not: id } }, orderBy: { recordedAt: "desc" }, take: 3 }),
    tdb.opdVisit.findMany({ where: { patientId: c.patientId, id: { not: c.opdVisit.id } }, orderBy: { checkedInAt: "desc" }, take: 5, include: { doctor: { select: { name: true } } } }),
    tdb.prescription.findMany({ where: { patientId: c.patientId, currentVersion: { gt: 0 }, consultationId: { not: id } }, orderBy: { finalizedAt: "desc" }, take: 3, include: { versions: { orderBy: { version: "desc" }, take: 1 } } }),
  ]);
  return {
    allergies: allergies as { allergen: string; reaction: string | null; severity: string }[],
    currentMedications: meds as { name: string; strength: string | null; frequency: string | null; source: string }[],
    previousConsultations: prev.map((p: { id: string; number: string; finalizedAt: Date | null; chiefComplaints: string; followUpRequired: boolean; followUpAfterDays: number | null; doctor: { name: string }; diagnoses: { name: string; type: string }[]; prescription: { number: string | null } | null }) => ({ id: p.id, number: p.number, date: p.finalizedAt ? day(p.finalizedAt) : "", doctor: p.doctor.name, complaint: parseJson<{ text: string }[]>(p.chiefComplaints, [])[0]?.text ?? null, diagnoses: p.diagnoses.map((d) => d.name), prescription: p.prescription?.number ?? null, followUp: p.followUpRequired ? (p.followUpAfterDays ? `after ${p.followUpAfterDays} days` : "required") : null })),
    previousDiagnoses: [...new Set(prev.flatMap((p: { diagnoses: { name: string }[] }) => p.diagnoses.map((d) => d.name)))] as string[],
    previousVitals: lastVitals.map((v: { systolic: number | null; diastolic: number | null; pulse: number | null; temperature: number | null; tempUnit: string; spo2: number | null; weightKg: number | null; heightCm: number | null; bmi: number | null; recordedAt: Date }) => ({ date: day(v.recordedAt), bp: v.systolic ? `${v.systolic}/${v.diastolic}` : null, pulse: v.pulse, temperature: v.temperature != null ? `${v.temperature} °${v.tempUnit}` : null, spo2: v.spo2, weightKg: v.weightKg, heightCm: v.heightCm, bmi: v.bmi })),
    recentVisits: visits.map((v: { id: string; tokenDate: string; doctor: { name: string }; visitType: string; status: string; tokenLabel: string }) => ({ id: v.id, date: v.tokenDate, doctor: v.doctor.name, type: v.visitType, status: v.status, token: v.tokenLabel })),
    recentPrescriptions: rxs.map((r: { number: string | null; finalizedAt: Date | null; versions: { snapshot: string }[] }) => ({ number: r.number, date: r.finalizedAt ? day(r.finalizedAt) : "", medicines: parseJson<{ items?: { name: string; strength?: string }[] }>(r.versions[0]?.snapshot, {}).items?.map((i) => [i.name, i.strength].filter(Boolean).join(" ")) ?? [] })),
    documents: { available: false },
  };
}

/* ---------------------------------------------- templates ---------------------------------------------- */
/** Structural scaffolds only: headings the doctor fills in. They contain no findings and never claim anything about a patient. */
export const BUILTIN_TEMPLATES = [
  { key: "general", name: "General consultation", content: { chiefComplaint: "", history: "Onset and duration:\nAssociated symptoms:\nRelevant history:", examination: "General:\nSystems:", assessment: "", advice: "", clinicalNotes: "" } },
  { key: "fever", name: "Fever", content: { chiefComplaint: "Fever", history: "Duration:\nPattern:\nAssociated symptoms:", examination: "General:\nSystems:", assessment: "", advice: "", clinicalNotes: "" } },
  { key: "followup", name: "Follow-up", content: { chiefComplaint: "Follow-up", history: "Progress since last visit:\nAdherence to advice:", examination: "General:", assessment: "", advice: "", clinicalNotes: "" } },
  { key: "routine", name: "Routine check-up", content: { chiefComplaint: "Routine check-up", history: "Concerns raised:", examination: "General:\nSystems:", assessment: "", advice: "", clinicalNotes: "" } },
] as const;

export async function listTemplates(ctx: TenantRequestContext) {
  clinicalGuard(ctx);
  if (!ctx.permissions.has("consultation.edit")) throw new AppError("FORBIDDEN");
  const mine = ctx.user.role === "DOCTOR" ? await db(ctx).consultationTemplate.findMany({ where: { doctorUserId: ctx.user.id }, orderBy: { name: "asc" }, take: 50 }) : [];
  return { builtin: BUILTIN_TEMPLATES, mine: (mine as { id: string; name: string; content: string }[]).map((t) => ({ id: t.id, name: t.name, content: parseJson<Record<string, string>>(t.content, {}) })) };
}
export async function saveTemplate(ctx: TenantRequestContext, raw: unknown) {
  clinicalGuard(ctx);
  if (ctx.user.role !== "DOCTOR" || !ctx.permissions.has("consultation.edit")) throw new AppError("FORBIDDEN");
  const t = parseOrThrow(templateSchema, raw);
  const row = await db(ctx).consultationTemplate.create({ data: { tenantId: ctx.tenantId, doctorUserId: ctx.user.id, name: t.name, content: JSON.stringify(t.content) } });
  await recordAudit({ action: AUDIT_ACTIONS.CONSULTATION_TEMPLATE_CHANGED, tenantId: ctx.tenantId, actorId: ctx.user.id, entityType: "consultation_template", entityId: row.id, metadata: { change: "created" } });
  return { id: row.id as string };
}
export async function deleteTemplate(ctx: TenantRequestContext, id: string) {
  clinicalGuard(ctx);
  if (ctx.user.role !== "DOCTOR") throw new AppError("FORBIDDEN");
  const r = await db(ctx).consultationTemplate.deleteMany({ where: { id, doctorUserId: ctx.user.id } });
  if (r.count !== 1) throw new AppError("NOT_FOUND");
  await recordAudit({ action: AUDIT_ACTIONS.CONSULTATION_TEMPLATE_CHANGED, tenantId: ctx.tenantId, actorId: ctx.user.id, entityType: "consultation_template", entityId: id, metadata: { change: "deleted" } });
  return { deleted: true };
}
