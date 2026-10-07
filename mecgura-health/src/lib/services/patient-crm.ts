import { isLabStaffView } from "./lab-orders";
import "server-only";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";
import type { TenantRequestContext } from "@/lib/auth/context";
import { AppError } from "@/lib/errors";
import { ACTIVE_OPD, type AppointmentStatus } from "@/lib/scheduling/states";
import { timeInTz, todayIn, utcToZoned } from "@/lib/scheduling/time";
import { rateLimit } from "@/lib/security/rate-limit";
import { tenantDb } from "@/lib/tenant/db";
import { parseOrThrow } from "@/lib/validation";
import { archiveSchema, patientListSchema, patientRegisterSchema, patientUpdateSchema, timelineQuerySchema } from "@/lib/validation/patients";
import { ageLabel, isUniqueViolation, maskPhone, nextCounter, tenantTimezone, type Client } from "./clinic-shared";
import { findDuplicates } from "./patients";
import { changedKeys, containsCI } from "./shared";

/**
 * Patient CRM. Three access tiers, each a superset of the one before:
 *   identity  (patients.identity)  name + patient ID only          — billing / lab workflows
 *   view      (patients.view)      demographics, contact, visits   — reception, doctors, nurses
 *   clinical  (patients.clinical)  allergies, history, medicines, family history, clinical notes
 * Every query goes through tenantDb(ctx): another clinic's patient simply doesn't exist for the caller.
 */
export const PAGE = 20;
const hasView = (ctx: TenantRequestContext) => ctx.permissions.has("patients.view");
const hasIdentity = (ctx: TenantRequestContext) => hasView(ctx) || ctx.permissions.has("patients.identity");
export const hasClinical = (ctx: TenantRequestContext) => ctx.permissions.has("patients.clinical");

export function accessFor(ctx: TenantRequestContext) {
  return {
    view: hasView(ctx), clinical: hasClinical(ctx), clinicalEdit: ctx.permissions.has("patients.clinical_edit"),
    edit: ctx.permissions.has("patients.edit"), archive: ctx.permissions.has("patients.archive"), export: ctx.permissions.has("patients.export"),
    appointments: ctx.permissions.has("appointments.create"), opd: ctx.permissions.has("opd.manage"),
    consultations: ctx.permissions.has("consultation.view") && ctx.permissions.has("patients.clinical") && ctx.user.role !== "SUPER_ADMIN",
  };
}

/** Loads one patient of THIS clinic or throws NOT_FOUND (same answer for "doesn't exist" and "belongs to another clinic"). */
export async function loadPatient(ctx: TenantRequestContext, id: string, tier: "identity" | "view" | "clinical" = "view") {
  if (tier === "identity" ? !hasIdentity(ctx) : tier === "view" ? !hasView(ctx) : !hasClinical(ctx)) throw new AppError("FORBIDDEN");
  const p = await tenantDb(ctx).patient.findFirst({ where: { id } });
  if (!p) throw new AppError("NOT_FOUND", { message: "Patient not found." });
  return p;
}
export async function loadWritablePatient(ctx: TenantRequestContext, id: string, tier: "view" | "clinical" = "view") {
  const p = await loadPatient(ctx, id, tier);
  if (p.status === "ARCHIVED") throw new AppError("CONFLICT", { message: "This patient is archived and read-only. Restore the patient to make changes." });
  return p;
}

const dobStr = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const toDate = (s?: string) => (s ? new Date(`${s}T00:00:00Z`) : null);

/* ---------------------------------- list ---------------------------------- */
export async function listPatients(ctx: TenantRequestContext, raw: unknown) {
  if (!hasView(ctx)) throw new AppError("FORBIDDEN");
  const q = parseOrThrow(patientListSchema, raw);
  if (q.q) {
    const lim = await rateLimit(`plist:${ctx.user.id}`, { limit: 90, windowMs: 60_000 });
    if (!lim.allowed) throw new AppError("RATE_LIMITED");
  }
  const tdb = tenantDb(ctx);
  const and: object[] = [];
  if (q.status !== "ALL") and.push({ status: q.status });
  if (q.recent) and.push({ createdAt: { gte: new Date(Date.now() - 7 * 86_400_000) } });
  if (q.q) {
    const digits = q.q.replace(/\D/g, "");
    const or: object[] = [{ name: containsCI(q.q) }, { code: containsCI(q.q) }, { email: containsCI(q.q) }];
    if (digits.length >= 4) or.push({ phone: { contains: digits.length === 10 ? `+91${digits}` : digits } }, { alternatePhone: { contains: digits } });
    if (/^\d{4}-\d{2}-\d{2}$/.test(q.q)) or.push({ dateOfBirth: new Date(`${q.q}T00:00:00Z`) });
    and.push({ OR: or });
  }
  const where = and.length ? { AND: and } : {};
  const [total, rows] = await Promise.all([
    tdb.patient.count({ where }),
    tdb.patient.findMany({ where, orderBy: q.q ? [{ name: "asc" }] : [{ createdAt: "desc" }], skip: (q.page - 1) * PAGE, take: PAGE,
      select: { id: true, code: true, name: true, gender: true, phone: true, dateOfBirth: true, ageYears: true, status: true, createdAt: true } }),
  ]);
  const last = rows.length ? await tdb.opdVisit.groupBy({ by: ["patientId"], where: { patientId: { in: rows.map((r) => r.id) }, status: { not: "CANCELLED" } }, _max: { checkedInAt: true } }) : [];
  const lastBy = new Map((last as { patientId: string; _max: { checkedInAt: Date | null } }[]).map((l) => [l.patientId, l._max.checkedInAt]));
  return {
    page: q.page, pageSize: PAGE, total,
    rows: rows.map((p) => ({ id: p.id, code: p.code, name: p.name, age: ageLabel(p), gender: p.gender, phoneMasked: maskPhone(p.phone), status: p.status, lastVisit: lastBy.get(p.id)?.toISOString() ?? null, createdAt: p.createdAt.toISOString() })),
  };
}

/* ---------------------------------- profile ---------------------------------- */
export async function getPatientProfile(ctx: TenantRequestContext, id: string) {
  const p = await loadPatient(ctx, id, "identity");
  const access = accessFor(ctx);
  await recordAudit({ action: AUDIT_ACTIONS.PATIENT_VIEWED, tenantId: ctx.tenantId, actorId: ctx.user.id, entityType: "patient", entityId: id, metadata: { tier: access.clinical ? "clinical" : access.view ? "view" : "identity" } });
  if (!access.view) return { tier: "identity" as const, access, patient: { id: p.id, code: p.code, name: p.name, status: p.status } };

  const tz = await tenantTimezone(ctx.tenantId);
  const tdb = tenantDb(ctx);
  const today = todayIn(tz);
  const [totalVisits, lastVisit, nextAppt, todayVisit, consents, group, allergyAlerts] = await Promise.all([
    tdb.opdVisit.count({ where: { patientId: id, status: { not: "CANCELLED" } } }),
    tdb.opdVisit.findFirst({ where: { patientId: id, status: "COMPLETED" }, orderBy: { completedAt: "desc" }, select: { completedAt: true, checkedInAt: true, doctor: { select: { name: true } } } }),
    tdb.appointment.findFirst({ where: { patientId: id, startsAt: { gte: new Date() }, status: { in: ["REQUESTED", "CONFIRMED"] } }, orderBy: { startsAt: "asc" }, select: { id: true, startsAt: true, status: true, doctor: { select: { name: true } } } }),
    tdb.opdVisit.findFirst({ where: { patientId: id, tokenDate: today, status: { not: "CANCELLED" } }, orderBy: { queueSeq: "desc" }, select: { id: true, tokenLabel: true, status: true, priority: true, doctor: { select: { name: true } } } }),
    tdb.patientConsent.findMany({ where: { patientId: id }, orderBy: { recordedAt: "desc" }, take: 30 }),
    p.familyGroupId ? tdb.patient.count({ where: { familyGroupId: p.familyGroupId, id: { not: id } } }) : Promise.resolve(0),
    access.clinical ? tdb.patientAllergy.findMany({ where: { patientId: id, status: "ACTIVE" }, orderBy: { recordedAt: "desc" }, take: 10, select: { allergen: true, reaction: true, severity: true } }) : Promise.resolve([]),
  ]);
  const consentState: Record<string, { status: string; version: string; recordedAt: string }> = {};
  for (const c of consents) if (!consentState[c.type]) consentState[c.type] = { status: c.status, version: c.version, recordedAt: c.recordedAt.toISOString() };

  return {
    tier: "full" as const,
    access,
    patient: {
      id: p.id, code: p.code, name: p.name, preferredName: p.preferredName, status: p.status, gender: p.gender, age: ageLabel(p), dateOfBirth: dobStr(p.dateOfBirth), ageYears: p.ageYears,
      phone: p.phone, alternatePhone: p.alternatePhone, email: p.email, addressLine: p.addressLine, city: p.city, state: p.state, country: p.country, pincode: p.pincode,
      bloodGroup: p.bloodGroup, maritalStatus: p.maritalStatus, occupation: p.occupation,
      emergencyContact: p.emergencyContactName ? { name: p.emergencyContactName, relation: p.emergencyContactRelation, phone: p.emergencyContactPhone } : null,
      prefs: { phone: p.prefPhone, whatsapp: p.prefWhatsapp, sms: p.prefSms, email: p.prefEmail },
      archivedAt: p.archivedAt?.toISOString() ?? null, archivedReason: p.archivedReason, registeredAt: p.createdAt.toISOString(), familyMembers: group,
    },
    overview: {
      totalVisits, lastVisitAt: (lastVisit?.completedAt ?? lastVisit?.checkedInAt)?.toISOString() ?? null, lastVisitDoctor: lastVisit?.doctor.name ?? null,
      nextAppointment: nextAppt ? { id: nextAppt.id, startsAt: nextAppt.startsAt.toISOString(), when: `${utcToZoned(nextAppt.startsAt, tz).date} ${timeInTz(nextAppt.startsAt, tz)}`, doctor: nextAppt.doctor.name, status: nextAppt.status } : null,
      todayVisit: todayVisit ? { token: todayVisit.tokenLabel, status: todayVisit.status, priority: todayVisit.priority, doctor: todayVisit.doctor.name } : null,
    },
    consents: consentState,
    alerts: access.clinical ? { allergies: allergyAlerts } : null,
  };
}

/* ---------------------------------- register / edit ---------------------------------- */
const detailData = (v: ReturnType<typeof patientUpdateSchema.parse>) => ({
  name: v.name, preferredName: v.preferredName ?? null, phone: v.phone, alternatePhone: v.alternatePhone ?? null, email: v.email?.toLowerCase() ?? null, gender: v.gender ?? null,
  dateOfBirth: toDate(v.dateOfBirth), ageYears: v.dateOfBirth ? null : (v.ageYears ?? null),
  addressLine: v.addressLine ?? null, city: v.city ?? null, state: v.state ?? null, country: v.country ?? null, pincode: v.pincode ?? null,
  bloodGroup: v.bloodGroup ?? null, maritalStatus: v.maritalStatus ?? null, occupation: v.occupation ?? null,
  emergencyContactName: v.emergencyContactName ?? null, emergencyContactRelation: v.emergencyContactRelation ?? null, emergencyContactPhone: v.emergencyContactPhone ?? null,
  prefPhone: v.prefPhone, prefWhatsapp: v.prefWhatsapp, prefSms: v.prefSms, prefEmail: v.prefEmail,
});

export async function registerPatient(ctx: TenantRequestContext, raw: unknown) {
  if (!ctx.permissions.has("patients.create")) throw new AppError("FORBIDDEN");
  const input = parseOrThrow(patientRegisterSchema, raw);
  const dupes = await findDuplicates(ctx, { phone: input.phone, email: input.email, name: input.name, dateOfBirth: input.dateOfBirth });
  if (dupes.length && !input.allowDuplicate) throw new AppError("CONFLICT", { message: "Possible existing patient found. Use the existing patient, or confirm this is a new patient.", fieldErrors: { _duplicates: dupes.map((d) => `${d.code}`).join(", ") } });
  const tdb = tenantDb(ctx);
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const p = await tdb.$transaction(async (tx: Client) => {
        const n = await nextCounter(tx, ctx.tenantId, "patient");
        const created = await tx.patient.create({ data: { ...detailData(input), code: `P-${String(n).padStart(6, "0")}`, createdById: ctx.user.id }, select: { id: true, code: true } });
        if (input.privacyAcknowledged) await tx.patientConsent.create({ data: { tenantId: ctx.tenantId, patientId: created.id, type: "PRIVACY", status: "GRANTED", version: "clinic-notice-v1", recordedById: ctx.user.id } });
        return created;
      });
      await recordAudit({ action: AUDIT_ACTIONS.PATIENT_REGISTERED, tenantId: ctx.tenantId, actorId: ctx.user.id, entityType: "patient", entityId: p.id, metadata: { code: p.code, duplicateConfirmed: dupes.length > 0, privacyAcknowledged: input.privacyAcknowledged } });
      if (input.privacyAcknowledged) await recordAudit({ action: AUDIT_ACTIONS.PATIENT_CONSENT_RECORDED, tenantId: ctx.tenantId, actorId: ctx.user.id, entityType: "patient", entityId: p.id, metadata: { type: "PRIVACY", status: "GRANTED" } });
      return { id: p.id, code: p.code as string };
    } catch (e) {
      if (!isUniqueViolation(e) || attempt === 4) throw e;
    }
  }
  throw new AppError("INTERNAL");
}

export async function updatePatient(ctx: TenantRequestContext, id: string, raw: unknown) {
  if (!ctx.permissions.has("patients.edit")) throw new AppError("FORBIDDEN");
  const before = await loadWritablePatient(ctx, id);
  const input = parseOrThrow(patientUpdateSchema, raw);
  const data = detailData(input);
  const norm = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v instanceof Date ? v.toISOString() : v]));
  const keys = changedKeys(norm(before as unknown as Record<string, unknown>), norm(data));
  if (!keys.length) return { updated: false };
  await tenantDb(ctx).patient.update({ where: { id }, data });
  await recordAudit({ action: AUDIT_ACTIONS.PATIENT_UPDATED, tenantId: ctx.tenantId, actorId: ctx.user.id, entityType: "patient", entityId: id, metadata: { fields: keys } });
  return { updated: true };
}

export async function setPatientStatus(ctx: TenantRequestContext, id: string, status: unknown) {
  if (!ctx.permissions.has("patients.edit")) throw new AppError("FORBIDDEN");
  if (status !== "ACTIVE" && status !== "INACTIVE") throw new AppError("VALIDATION_ERROR", { message: "Choose active or inactive." });
  const p = await loadWritablePatient(ctx, id);
  if (p.status === status) return { status };
  await tenantDb(ctx).patient.update({ where: { id }, data: { status } });
  await recordAudit({ action: AUDIT_ACTIONS.PATIENT_UPDATED, tenantId: ctx.tenantId, actorId: ctx.user.id, entityType: "patient", entityId: id, metadata: { fields: ["status"], to: status } });
  return { status };
}

export async function archivePatient(ctx: TenantRequestContext, id: string, raw: unknown) {
  if (!ctx.permissions.has("patients.archive")) throw new AppError("FORBIDDEN");
  const { reason } = parseOrThrow(archiveSchema, raw);
  const p = await loadPatient(ctx, id);
  if (p.status === "ARCHIVED") throw new AppError("CONFLICT", { message: "This patient is already archived." });
  const tdb = tenantDb(ctx);
  const [queued, open] = await Promise.all([
    tdb.opdVisit.count({ where: { patientId: id, status: { in: [...ACTIVE_OPD] } } }),
    tdb.appointment.count({ where: { patientId: id, startsAt: { gte: new Date() }, status: { in: ["REQUESTED", "CONFIRMED"] satisfies AppointmentStatus[] } } }),
  ]);
  if (queued) throw new AppError("CONFLICT", { message: "This patient is in today's queue. Complete or cancel the visit before archiving." });
  if (open) throw new AppError("CONFLICT", { message: `This patient has ${open} upcoming appointment(s). Cancel or complete them before archiving.` });
  await tdb.patient.update({ where: { id }, data: { status: "ARCHIVED", archivedAt: new Date(), archivedReason: reason ?? null } });
  await recordAudit({ action: AUDIT_ACTIONS.PATIENT_ARCHIVED, tenantId: ctx.tenantId, actorId: ctx.user.id, entityType: "patient", entityId: id, metadata: { hasReason: !!reason } });
  return { status: "ARCHIVED" };
}

export async function restorePatient(ctx: TenantRequestContext, id: string) {
  if (!ctx.permissions.has("patients.archive")) throw new AppError("FORBIDDEN");
  const p = await loadPatient(ctx, id);
  if (p.status !== "ARCHIVED") throw new AppError("CONFLICT", { message: "This patient isn't archived." });
  await tenantDb(ctx).patient.update({ where: { id }, data: { status: "ACTIVE", archivedAt: null, archivedReason: null } });
  await recordAudit({ action: AUDIT_ACTIONS.PATIENT_RESTORED, tenantId: ctx.tenantId, actorId: ctx.user.id, entityType: "patient", entityId: id });
  return { status: "ACTIVE" };
}

/* ---------------------------------- visits / appointments ---------------------------------- */
export async function listPatientVisits(ctx: TenantRequestContext, id: string, page = 1) {
  await loadPatient(ctx, id, "view");
  const tz = await tenantTimezone(ctx.tenantId);
  const tdb = tenantDb(ctx);
  const p = Math.max(1, Math.min(page, 500));
  const [total, rows] = await Promise.all([
    tdb.opdVisit.count({ where: { patientId: id } }),
    tdb.opdVisit.findMany({ where: { patientId: id }, orderBy: { checkedInAt: "desc" }, skip: (p - 1) * 15, take: 15, include: { doctor: { select: { name: true } }, appointment: { select: { publicId: true } } } }),
  ]);
  return {
    page: p, pageSize: 15, total,
    visits: rows.map((v) => ({
      id: v.id, date: v.tokenDate, doctor: v.doctor.name, visitType: v.visitType, token: v.tokenLabel, status: v.status, priority: v.priority, appointmentRef: v.appointment?.publicId ?? null,
      checkedInAt: timeInTz(v.checkedInAt, tz), calledAt: v.calledAt ? timeInTz(v.calledAt, tz) : null, startedAt: v.startedAt ? timeInTz(v.startedAt, tz) : null, completedAt: v.completedAt ? timeInTz(v.completedAt, tz) : null,
      // visit notes belong to the consultation module (Phase 5); only the queue note is shown here
      note: v.note,
    })),
  };
}

export async function listPatientAppointments(ctx: TenantRequestContext, id: string) {
  await loadPatient(ctx, id, "view");
  if (!ctx.permissions.has("appointments.view")) throw new AppError("FORBIDDEN");
  const tz = await tenantTimezone(ctx.tenantId);
  const rows = await tenantDb(ctx).appointment.findMany({ where: { patientId: id }, orderBy: { startsAt: "desc" }, take: 60, include: { doctor: { select: { name: true } }, opdVisit: { select: { tokenLabel: true } } } });
  const now = Date.now();
  const view = rows.map((a) => ({ id: a.id, publicId: a.publicId, date: utcToZoned(a.startsAt, tz).date, time: timeInTz(a.startsAt, tz), doctor: a.doctor.name, type: a.type, status: a.status, token: a.opdVisit?.tokenLabel ?? null, upcoming: a.startsAt.getTime() >= now && ["REQUESTED", "CONFIRMED"].includes(a.status) }));
  return { upcoming: view.filter((a) => a.upcoming).reverse(), past: view.filter((a) => !a.upcoming) };
}

/* ---------------------------------- timeline ---------------------------------- */
export interface TimelineEvent { id: string; type: string; category: "patient" | "appointments" | "opd" | "clinical" | "reports"; at: string; title: string; detail?: string; href?: string }
const T_PAGE = 20;

/**
 * Chronological timeline built from records that already exist (patient, appointments, OPD visits, clinical records, audit of
 * the patient file). Future modules add their own event sources and categories; nothing here is invented.
 */
export async function patientTimeline(ctx: TenantRequestContext, id: string, raw: unknown) {
  const p = await loadPatient(ctx, id, "view");
  const q = parseOrThrow(timelineQuerySchema, raw);
  const tz = await tenantTimezone(ctx.tenantId);
  const tdb = tenantDb(ctx);
  const ev: TimelineEvent[] = [];
  const when = (d: Date) => `${utcToZoned(d, tz).date} ${timeInTz(d, tz)}`;
  const want = (c: TimelineEvent["category"]) => q.filter === "all" || q.filter === c;
  const clinical = hasClinical(ctx);

  if (q.filter === "all") ev.push({ id: `p-${p.id}`, type: "PATIENT_CREATED", category: "patient", at: p.createdAt.toISOString(), title: "Patient registered", detail: p.code });
  if (want("appointments") && ctx.permissions.has("appointments.view")) {
    const appts = await tdb.appointment.findMany({ where: { patientId: id }, orderBy: { createdAt: "desc" }, take: 100, include: { doctor: { select: { name: true } } } });
    for (const a of appts) {
      ev.push({ id: `a-${a.id}-c`, type: "APPOINTMENT_CREATED", category: "appointments", at: a.createdAt.toISOString(), title: `Appointment booked for ${when(a.startsAt)}`, detail: a.doctor.name });
      if (a.checkedInAt) ev.push({ id: `a-${a.id}-i`, type: "APPOINTMENT_CHECKED_IN", category: "appointments", at: a.checkedInAt.toISOString(), title: "Checked in", detail: a.doctor.name });
      if (a.cancelledAt) ev.push({ id: `a-${a.id}-x`, type: "APPOINTMENT_CANCELLED", category: "appointments", at: a.cancelledAt.toISOString(), title: "Appointment cancelled", detail: when(a.startsAt) });
      if (a.noShowAt) ev.push({ id: `a-${a.id}-n`, type: "APPOINTMENT_NO_SHOW", category: "appointments", at: a.noShowAt.toISOString(), title: "Marked as no-show", detail: when(a.startsAt) });
    }
  }
  if (want("opd")) {
    const visits = await tdb.opdVisit.findMany({ where: { patientId: id }, orderBy: { checkedInAt: "desc" }, take: 100, include: { doctor: { select: { name: true } } } });
    for (const v of visits) {
      const d = v.doctor.name;
      ev.push({ id: `v-${v.id}-t`, type: "TOKEN_ASSIGNED", category: "opd", at: v.checkedInAt.toISOString(), title: `OPD token ${v.tokenLabel}${v.priority === "EMERGENCY" ? " (emergency)" : ""}`, detail: d });
      if (v.calledAt) ev.push({ id: `v-${v.id}-c`, type: "OPD_CALLED", category: "opd", at: v.calledAt.toISOString(), title: `Token ${v.tokenLabel} called`, detail: d });
      if (v.startedAt) ev.push({ id: `v-${v.id}-s`, type: "OPD_STARTED", category: "opd", at: v.startedAt.toISOString(), title: "Consultation started", detail: d });
      if (v.completedAt) ev.push({ id: `v-${v.id}-d`, type: "OPD_COMPLETED", category: "opd", at: v.completedAt.toISOString(), title: "Visit completed", detail: d });
    }
  }
  if (want("clinical") && clinical) {
    const [al, hi, me] = await Promise.all([
      tdb.patientAllergy.findMany({ where: { patientId: id }, orderBy: { recordedAt: "desc" }, take: 50, select: { id: true, allergen: true, recordedAt: true } }),
      tdb.patientHistory.findMany({ where: { patientId: id }, orderBy: { recordedAt: "desc" }, take: 50, select: { id: true, title: true, category: true, recordedAt: true } }),
      tdb.patientMedication.findMany({ where: { patientId: id }, orderBy: { recordedAt: "desc" }, take: 50, select: { id: true, name: true, recordedAt: true } }),
    ]);
    for (const a of al) ev.push({ id: `al-${a.id}`, type: "ALLERGY_RECORDED", category: "clinical", at: a.recordedAt.toISOString(), title: "Allergy recorded", detail: a.allergen });
    for (const h of hi) ev.push({ id: `hi-${h.id}`, type: "HISTORY_ADDED", category: "clinical", at: h.recordedAt.toISOString(), title: "Medical history entry added", detail: h.title });
    for (const m of me) ev.push({ id: `me-${m.id}`, type: "MEDICATION_RECORDED", category: "clinical", at: m.recordedAt.toISOString(), title: "Medicine recorded in summary", detail: m.name });
  }
  if (want("clinical") && clinical && ctx.permissions.has("consultation.view") && ctx.user.role !== "SUPER_ADMIN") {
    const [cons, vit, dx, rxs] = await Promise.all([
      tdb.consultation.findMany({ where: { patientId: id }, orderBy: { startedAt: "desc" }, take: 40, include: { doctor: { select: { name: true } } } }),
      tdb.consultationVitals.findMany({ where: { patientId: id }, orderBy: { recordedAt: "desc" }, take: 60, select: { id: true, consultationId: true, recordedAt: true } }),
      tdb.consultationDiagnosis.findMany({ where: { patientId: id }, orderBy: { createdAt: "desc" }, take: 60, select: { id: true, consultationId: true, name: true, createdAt: true } }),
      tdb.prescription.findMany({ where: { patientId: id }, take: 40, include: { versions: { select: { version: true, createdAt: true } } } }),
    ]);
    const link = (cid: string) => `/consultations/${cid}`;
    for (const c of cons) {
      ev.push({ id: `cs-${c.id}`, type: "CONSULTATION_STARTED", category: "clinical", at: c.startedAt.toISOString(), title: "Consultation started", detail: `${c.doctor.name} · ${c.number}`, href: link(c.id) });
      if (c.finalizedAt) ev.push({ id: `cf-${c.id}`, type: "CONSULTATION_FINALIZED", category: "clinical", at: c.finalizedAt.toISOString(), title: "Consultation finalized", detail: c.doctor.name, href: link(c.id) });
    }
    for (const v of vit) ev.push({ id: `vi-${v.id}`, type: "VITALS_RECORDED", category: "clinical", at: v.recordedAt.toISOString(), title: "Vitals recorded", href: link(v.consultationId) });
    for (const d of dx) ev.push({ id: `dx-${d.id}`, type: "DIAGNOSIS_ADDED", category: "clinical", at: d.createdAt.toISOString(), title: "Diagnosis added", detail: d.name, href: link(d.consultationId) });
    for (const r of rxs) {
      ev.push({ id: `rc-${r.id}`, type: "PRESCRIPTION_CREATED", category: "clinical", at: r.createdAt.toISOString(), title: "Prescription drafted", href: link(r.consultationId) });
      for (const v of r.versions) ev.push({ id: `rf-${r.id}-${v.version}`, type: "PRESCRIPTION_FINALIZED", category: "clinical", at: v.createdAt.toISOString(), title: v.version > 1 ? `Prescription amended (version ${v.version})` : "Prescription finalized", detail: r.number ?? undefined, href: link(r.consultationId) });
    }
    const orders = await tdb.doctorOrder.findMany({ where: { patientId: id }, orderBy: { createdAt: "desc" }, take: 40, select: { id: true, consultationId: true, title: true, createdAt: true } });
    for (const o of orders) ev.push({ id: `or-${o.id}`, type: "ORDER_CREATED", category: "clinical", at: o.createdAt.toISOString(), title: "Doctor order created", detail: o.title, href: link(o.consultationId) });
  }
  if (want("reports") && ctx.permissions.has("tests.view") && (ctx.user.role === "DOCTOR" || isLabStaffView(ctx)) && ctx.user.role !== "SUPER_ADMIN") {
    // lab events only: no results, no values
    const labs = await tdb.investigationOrder.findMany({ where: { patientId: id, ...(ctx.user.role === "DOCTOR" ? { doctorUserId: ctx.user.id } : {}) }, orderBy: { orderedAt: "desc" }, take: 40, include: { items: { select: { testNameSnapshot: true } }, samples: { select: { id: true, sampleNumber: true, collectedAt: true, rejectedAt: true, status: true } }, report: { select: { id: true, reportNumber: true, releasedAt: true, currentVersion: true } } } });
    for (const o of labs) {
      const names = o.items.map((i: { testNameSnapshot: string }) => i.testNameSnapshot).slice(0, 3).join(", ");
      ev.push({ id: `lo-${o.id}`, type: "LAB_ORDERED", category: "reports", at: o.orderedAt.toISOString(), title: `Investigation ordered (${o.orderNumber})`, detail: names, href: `/lab/orders/${o.id}` });
      for (const sm of o.samples as { id: string; sampleNumber: string; collectedAt: Date; rejectedAt: Date | null }[]) {
        ev.push({ id: `ls-${sm.id}`, type: "SAMPLE_COLLECTED", category: "reports", at: sm.collectedAt.toISOString(), title: "Sample collected", detail: sm.sampleNumber, href: `/lab/orders/${o.id}` });
        if (sm.rejectedAt) ev.push({ id: `lr-${sm.id}`, type: "SAMPLE_REJECTED", category: "reports", at: sm.rejectedAt.toISOString(), title: "Sample rejected — recollection needed", detail: sm.sampleNumber, href: `/lab/orders/${o.id}` });
      }
      if (o.report?.releasedAt && o.report.currentVersion > 0) ev.push({ id: `lp-${o.report.id}`, type: "REPORT_RELEASED", category: "reports", at: o.report.releasedAt.toISOString(), title: o.report.currentVersion > 1 ? `Report amended (version ${o.report.currentVersion})` : "Report released", detail: o.report.reportNumber, href: `/lab/reports/${o.report.id}` });
    }
  }
  if (q.filter === "all") {
    const logs = await (await import("@/lib/db")).db.auditLog.findMany({ where: { tenantId: ctx.tenantId, entityType: "patient", entityId: id, action: { in: [AUDIT_ACTIONS.PATIENT_UPDATED, AUDIT_ACTIONS.PATIENT_ARCHIVED, AUDIT_ACTIONS.PATIENT_RESTORED, AUDIT_ACTIONS.PATIENT_CONSENT_RECORDED] } }, orderBy: { createdAt: "desc" }, take: 50, select: { id: true, action: true, createdAt: true } });
    const label: Record<string, [string, string]> = { [AUDIT_ACTIONS.PATIENT_UPDATED]: ["PATIENT_UPDATED", "Patient details updated"], [AUDIT_ACTIONS.PATIENT_ARCHIVED]: ["PATIENT_ARCHIVED", "Patient archived"], [AUDIT_ACTIONS.PATIENT_RESTORED]: ["PATIENT_RESTORED", "Patient restored"], [AUDIT_ACTIONS.PATIENT_CONSENT_RECORDED]: ["CONSENT_RECORDED", "Consent recorded"] };
    for (const l of logs) ev.push({ id: `l-${l.id}`, type: label[l.action][0], category: "patient", at: l.createdAt.toISOString(), title: label[l.action][1] });
  }
  ev.sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id));
  const available = q.filter === "all" || q.filter === "appointments" || q.filter === "opd" || q.filter === "clinical" || q.filter === "reports";
  return { filter: q.filter, available, restricted: q.filter === "clinical" && !clinical, page: q.page, pageSize: T_PAGE, total: ev.length, events: ev.slice((q.page - 1) * T_PAGE, q.page * T_PAGE) };
}

/* ---------------------------------- export ---------------------------------- */
/** Basic export of the patient's file. Admin permission, tenant scoped, audited. Returned to the browser as a download (no stored file, no URL). */
export async function exportPatient(ctx: TenantRequestContext, id: string) {
  if (!ctx.permissions.has("patients.export")) throw new AppError("FORBIDDEN");
  const profile = await getPatientProfile(ctx, id);
  const tdb = tenantDb(ctx);
  const clinical = hasClinical(ctx);
  const [visits, appointments, allergies, medications, history, familyHistory] = await Promise.all([
    tdb.opdVisit.findMany({ where: { patientId: id }, orderBy: { checkedInAt: "asc" }, select: { tokenDate: true, tokenLabel: true, status: true, visitType: true, checkedInAt: true, completedAt: true } }),
    tdb.appointment.findMany({ where: { patientId: id }, orderBy: { startsAt: "asc" }, select: { publicId: true, startsAt: true, status: true, type: true } }),
    clinical ? tdb.patientAllergy.findMany({ where: { patientId: id } }) : Promise.resolve([]),
    clinical ? tdb.patientMedication.findMany({ where: { patientId: id } }) : Promise.resolve([]),
    clinical ? tdb.patientHistory.findMany({ where: { patientId: id } }) : Promise.resolve([]),
    clinical ? tdb.patientFamilyHistory.findMany({ where: { patientId: id } }) : Promise.resolve([]),
  ]);
  await recordAudit({ action: AUDIT_ACTIONS.PATIENT_EXPORTED, tenantId: ctx.tenantId, actorId: ctx.user.id, entityType: "patient", entityId: id, metadata: { includesClinical: clinical } });
  const strip = <T extends { tenantId?: string }>(r: T) => { const { tenantId: _t, ...rest } = r; void _t; return rest; };
  return { exportedAt: new Date().toISOString(), patient: profile.patient, consents: profile.tier === "full" ? profile.consents : undefined, visits, appointments, ...(clinical ? { allergies: allergies.map(strip), medications: medications.map(strip), history: history.map(strip), familyHistory: familyHistory.map(strip) } : {}) };
}
