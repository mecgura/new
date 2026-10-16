import "server-only";
import { createHmac } from "node:crypto";
import { COLLECTIBLE, dueOf, isOverdue } from "@/lib/billing/money";
import { AppError } from "@/lib/errors";
import type { PatientContext } from "@/lib/portal/ctx";
import { PRE_VISIT } from "@/lib/scheduling/states";
import { dayRangeUtc, formatInTz, todayIn, utcToZoned } from "@/lib/scheduling/time";
import { rateLimit } from "@/lib/security/rate-limit";
import { parseOrThrow } from "@/lib/validation";
import { bookSchema, cancelSchema, rescheduleSchema } from "@/lib/validation/portal";
import { db as rootDb } from "@/lib/db";
import { emitAppointmentEvent } from "@/lib/events/appointments";
import { isUniqueViolation, type Client } from "./clinic-shared";
import { assertSlotAvailable, getSlots } from "./availability";
import { insertAppointment, setAppointmentStatus, slotLockKey, SLOT_TAKEN } from "./appointment-core";
import { onAppointmentClosed } from "./followups";
import { tokenStatus } from "./opd";
import { AUDIT_ACTIONS, PAGE, clinicContact, doctorNames, iso, loadPortalSettings, paudit, pdb } from "./portal-core";

/* The portal reads through DTOs. Every query is scoped by `patientId: ctx.patientId` (from the session -> account chain) on top of tenantDb(ctx);
   no function takes a patient id from the caller, and fields that are staff-only (notes, internal statuses, audit data, staff ids) are never selected. */

const parse = <T,>(s: string | null | undefined, d: T): T => { try { return s ? (JSON.parse(s) as T) : d; } catch { return d; } };
const pageOf = (n: unknown) => Math.max(1, Math.floor(Number(n) || 1));

/* -------------------------------------------------- appointments -------------------------------------------------- */
export const APPT_GROUPS: Record<string, string[]> = { upcoming: ["REQUESTED", "CONFIRMED", "CHECKED_IN", "WAITING", "CALLED", "IN_CONSULTATION", "ON_HOLD", "SKIPPED"], completed: ["COMPLETED"], cancelled: ["CANCELLED", "NO_SHOW"] };
export interface AppointmentDto { id: string; doctorName: string; date: string; time: string; startsAt: string; type: string; status: string; bookedOnline: boolean; reason: string | null; serviceName: string | null; canCancel: boolean; canReschedule: boolean }
function apptDto(a: Record<string, any>, doctors: Map<string, string>, tz: string, now: Date, settings: { allowCancel: boolean; allowReschedule: boolean; changeCutoffHours: number }, services?: Map<string, string>): AppointmentDto {
  const z = utcToZoned(a.startsAt, tz); const ok = PRE_VISIT.includes(a.status) && (a.startsAt.getTime() - now.getTime()) >= settings.changeCutoffHours * 3_600_000;
  return { id: a.publicId, doctorName: doctors.get(a.doctorUserId) ?? "Doctor", date: z.date, time: formatInTz(a.startsAt, tz, { hour: "2-digit", minute: "2-digit", hour12: true }), startsAt: a.startsAt.toISOString(), type: a.type, status: a.status, bookedOnline: a.source === "PORTAL" || a.source === "WEBSITE", reason: a.reason ?? null, serviceName: a.serviceId ? services?.get(a.serviceId) ?? null : null, canCancel: ok && settings.allowCancel, canReschedule: ok && settings.allowReschedule };
}
export async function listAppointments(ctx: PatientContext, q: { group?: string; page?: number } = {}) {
  const tdb = pdb(ctx); const settings = await loadPortalSettings(tdb, ctx.tenantId); const group = q.group && APPT_GROUPS[q.group] ? q.group : "upcoming"; const page = pageOf(q.page);
  const where = { patientId: ctx.patientId, status: { in: APPT_GROUPS[group] } };
  const [total, rows] = await Promise.all([tdb.appointment.count({ where }), tdb.appointment.findMany({ where, orderBy: { startsAt: group === "upcoming" ? "asc" : "desc" }, skip: (page - 1) * PAGE, take: PAGE, select: { publicId: true, doctorUserId: true, startsAt: true, type: true, status: true, source: true, reason: true, serviceId: true } })]);
  const names = await doctorNames(tdb, rows.map((r: { doctorUserId: string }) => r.doctorUserId)); const now = new Date();
  return { group, rows: rows.map((r: Record<string, unknown>) => apptDto(r, names, ctx.tenant.timezone, now, settings)) as AppointmentDto[], total: total as number, page, pageSize: PAGE };
}
export async function getAppointment(ctx: PatientContext, publicId: string) {
  const tdb = pdb(ctx); const settings = await loadPortalSettings(tdb, ctx.tenantId);
  const a = await tdb.appointment.findFirst({ where: { publicId, patientId: ctx.patientId }, select: { publicId: true, doctorUserId: true, startsAt: true, endsAt: true, type: true, status: true, source: true, reason: true, serviceId: true, confirmedAt: true, cancelledAt: true } });
  if (!a) throw new AppError("NOT_FOUND", { message: "We couldn't find that appointment." });
  const names = await doctorNames(tdb, [a.doctorUserId]); const svc = a.serviceId ? await tdb.websiteService.findFirst({ where: { id: a.serviceId }, select: { id: true, title: true } }) : null;
  const dto = apptDto(a, names, ctx.tenant.timezone, new Date(), settings, svc ? new Map([[svc.id, svc.title]]) : undefined);
  const spec = await tdb.doctorProfile.findFirst({ where: { userId: a.doctorUserId }, select: { specialization: true } });
  return { ...dto, doctorHandle: handle(ctx.tenantId, a.doctorUserId), doctorSpecialization: (spec?.specialization ?? null) as string | null, endsAt: iso(a.endsAt), clinic: clinicContact(ctx), policy: { allowCancel: settings.allowCancel, allowReschedule: settings.allowReschedule, cutoffHours: settings.changeCutoffHours, text: settings.allowCancel || settings.allowReschedule ? `You can ${[settings.allowCancel && "cancel", settings.allowReschedule && "reschedule"].filter(Boolean).join(" or ")} online up to ${settings.changeCutoffHours} hour${settings.changeCutoffHours === 1 ? "" : "s"} before the appointment. After that, please call the clinic.` : "Please call the clinic to cancel or reschedule." } };
}

const handle = (tenantId: string, doctorId: string) => createHmac("sha256", process.env.AUTH_SECRET ?? "dev-secret").update(`doc|${tenantId}|${doctorId}`).digest("base64url").slice(0, 14);
async function bookableDoctors(ctx: PatientContext) {
  const rows = await pdb(ctx).user.findMany({ where: { role: { key: "DOCTOR" }, status: "ACTIVE", deletedAt: null, doctorSchedule: { is: { onlineBooking: true } } }, orderBy: { name: "asc" }, select: { id: true, name: true, doctorProfile: { select: { specialization: true } }, doctorSchedule: { select: { advanceDays: true } } } });
  return rows.map((d: Record<string, any>) => ({ id: d.id as string, handle: handle(ctx.tenantId, d.id), name: d.name as string, specialization: (d.doctorProfile?.specialization ?? null) as string | null, advanceDays: (d.doctorSchedule?.advanceDays ?? 30) as number }));
}
async function doctorByHandle(ctx: PatientContext, h: string) {
  const d = (await bookableDoctors(ctx)).find((x: { handle: string }) => x.handle === h);
  if (!d) throw new AppError("NOT_FOUND", { message: "This doctor isn't available for online booking." });
  return d as { id: string; name: string };
}
export async function bookingOptions(ctx: PatientContext) {
  const tdb = pdb(ctx); const settings = await loadPortalSettings(tdb, ctx.tenantId);
  if (!settings.allowBooking) return { enabled: false, message: "Online booking isn't available at this clinic. Please call to book.", clinic: clinicContact(ctx), doctors: [], services: [], tz: ctx.tenant.timezone };
  const [doctors, services] = await Promise.all([bookableDoctors(ctx), tdb.websiteService.findMany({ where: { status: "PUBLISHED", deletedAt: null }, orderBy: { title: "asc" }, select: { id: true, title: true } })]);
  return { enabled: true, message: null as string | null, clinic: clinicContact(ctx), tz: ctx.tenant.timezone, doctors: doctors.map((d: { handle: string; name: string; specialization: string | null; advanceDays: number }) => ({ doctor: d.handle, name: d.name, specialization: d.specialization, advanceDays: d.advanceDays })) as { doctor: string; name: string; specialization: string | null; advanceDays: number }[], services: services.map((s: { id: string; title: string }) => ({ id: s.id, title: s.title })) as { id: string; title: string }[] };
}
/** Real availability from the Phase 3 engine (working hours, breaks, blocked time, notice, existing bookings) — never invented. */
export async function bookingSlots(ctx: PatientContext, doctorHandle: string, date: string) {
  const settings = await loadPortalSettings(pdb(ctx), ctx.tenantId); if (!settings.allowBooking) throw new AppError("FORBIDDEN", { message: "Online booking isn't available." });
  const lim = await rateLimit(`portal:slots:${ctx.user.id}`, { limit: 90, windowMs: 60_000 }); if (!lim.allowed) throw new AppError("RATE_LIMITED");
  const d = await doctorByHandle(ctx, doctorHandle); const r = await getSlots(ctx.tenantId, d.id, date, "public");
  return { tz: r.tz, reason: r.reason, message: r.message, slots: r.slots.map((s) => ({ startsAt: s.startsAt, label: s.label })) };
}
const MAX_UPCOMING = 5;
export async function bookAppointment(ctx: PatientContext, raw: unknown) {
  const body = raw as Record<string, unknown>; const v = parseOrThrow(bookSchema, { ...body, doctorId: body.doctor ?? body.doctorId });
  const tdb = pdb(ctx); const settings = await loadPortalSettings(tdb, ctx.tenantId);
  if (!settings.allowBooking) throw new AppError("FORBIDDEN", { message: "Online booking isn't available at this clinic. Please call to book." });
  const lim = await rateLimit(`portal:book:${ctx.user.id}`, { limit: 8, windowMs: 60 * 60_000 }); if (!lim.allowed) throw new AppError("RATE_LIMITED", { message: "Too many booking attempts. Please try again later or call the clinic." });
  const doctor = await doctorByHandle(ctx, v.doctorId);
  const upcoming = await tdb.appointment.count({ where: { patientId: ctx.patientId, status: { in: ["REQUESTED", "CONFIRMED"] }, startsAt: { gte: new Date() } } });
  if (upcoming >= MAX_UPCOMING) throw new AppError("CONFLICT", { message: `You already have ${MAX_UPCOMING} upcoming appointments. Please cancel one or call the clinic.` });
  let serviceId: string | null = null;
  if (v.serviceId) { const s = await tdb.websiteService.findFirst({ where: { id: v.serviceId, status: "PUBLISHED", deletedAt: null }, select: { id: true } }); if (!s) throw new AppError("VALIDATION_ERROR", { message: "Choose a service from the list.", fieldErrors: { serviceId: "Choose a service from the list." } }); serviceId = s.id; }
  const { slotMinutes } = await assertSlotAvailable(ctx.tenantId, doctor.id, v.startsAt, "public");
  const opd = await rootDb.opdSettings.findUnique({ where: { tenantId: ctx.tenantId }, select: { bookingMode: true } });
  const confirmed = (opd?.bookingMode ?? "AUTO_CONFIRM") === "AUTO_CONFIRM";
  const a = await insertAppointment(tdb, { tenantId: ctx.tenantId, doctorUserId: doctor.id, startsAt: v.startsAt, endsAt: new Date(v.startsAt.getTime() + slotMinutes * 60_000), type: "ONLINE_APPOINTMENT", source: "PORTAL", status: confirmed ? "CONFIRMED" : "REQUESTED", confirmedAt: confirmed ? new Date() : null, serviceId, patientId: ctx.patientId, reason: v.reason ?? null, createdById: ctx.user.id });
  await paudit(ctx, AUDIT_ACTIONS.PORTAL_APPOINTMENT_BOOKED, "appointment", a.id, { publicId: a.publicId, status: a.status, doctorUserId: doctor.id, startsAt: a.startsAt.toISOString() });
  await emitAppointmentEvent("appointment.created", ctx.tenantId, a.id);
  return { id: a.publicId as string, status: a.status as string, doctorName: doctor.name, startsAt: a.startsAt.toISOString() };
}
async function changeable(ctx: PatientContext, publicId: string, what: "cancel" | "reschedule") {
  const tdb = pdb(ctx); const settings = await loadPortalSettings(tdb, ctx.tenantId);
  const a = await tdb.appointment.findFirst({ where: { publicId, patientId: ctx.patientId }, include: { opdVisit: { select: { id: true, status: true } } } });
  if (!a) throw new AppError("NOT_FOUND", { message: "We couldn't find that appointment." });
  const phone = ctx.tenant.contactPhone ? ` Please call the clinic on ${ctx.tenant.contactPhone}.` : " Please call the clinic.";
  if (what === "cancel" ? !settings.allowCancel : !settings.allowReschedule) throw new AppError("FORBIDDEN", { message: `This clinic doesn't allow ${what === "cancel" ? "cancelling" : "rescheduling"} online.${phone}` });
  if (!PRE_VISIT.includes(a.status)) throw new AppError("CONFLICT", { message: "Only appointments that haven't started can be changed." });
  if (a.startsAt.getTime() - Date.now() < settings.changeCutoffHours * 3_600_000) throw new AppError("CONFLICT", { message: `It's too close to the appointment time to ${what} online.${phone}` });
  return a as Record<string, any>;
}
export async function cancelAppointment(ctx: PatientContext, publicId: string, raw: unknown) {
  const v = parseOrThrow(cancelSchema, raw); const a = await changeable(ctx, publicId, "cancel"); const tdb = pdb(ctx);
  await tdb.$transaction(async (tx: Client) => {
    await setAppointmentStatus(tx, ctx.tenantId, a.id, a.status, "CANCELLED", { cancelledAt: new Date(), cancelledById: ctx.user.id, cancellationReason: `PATIENT_REQUEST${v.reason ? `: ${v.reason}` : ""}` });
    if (a.opdVisit && ["WAITING", "ON_HOLD", "SKIPPED"].includes(a.opdVisit.status)) await tx.opdVisit.updateMany({ where: { id: a.opdVisit.id, status: a.opdVisit.status }, data: { status: "CANCELLED" } });
  });
  await paudit(ctx, AUDIT_ACTIONS.PORTAL_APPOINTMENT_CANCELLED, "appointment", a.id, { publicId });
  await onAppointmentClosed(ctx, a as never, "CANCELLED");
  await emitAppointmentEvent("appointment.cancelled", ctx.tenantId, a.id);
  return { status: "CANCELLED" };
}
export async function rescheduleAppointment(ctx: PatientContext, publicId: string, raw: unknown) {
  const body = raw as Record<string, unknown>; const v = parseOrThrow(rescheduleSchema, { ...body, doctorId: body.doctor ?? body.doctorId });
  const a = await changeable(ctx, publicId, "reschedule"); const tdb = pdb(ctx);
  const doctor = v.doctorId ? await doctorByHandle(ctx, v.doctorId) : { id: a.doctorUserId as string, name: "" };
  if (doctor.id === a.doctorUserId && v.startsAt.getTime() === a.startsAt.getTime()) throw new AppError("VALIDATION_ERROR", { message: "That's the current time. Choose a different slot." });
  const { slotMinutes } = await assertSlotAvailable(ctx.tenantId, doctor.id, v.startsAt, "public", a.id);
  try {
    const r = await tdb.appointment.updateMany({ where: { id: a.id, status: a.status, patientId: ctx.patientId }, data: { doctorUserId: doctor.id, startsAt: v.startsAt, endsAt: new Date(v.startsAt.getTime() + slotMinutes * 60_000), slotLock: slotLockKey(doctor.id, v.startsAt) } });
    if (r.count !== 1) throw new AppError("CONFLICT", { message: "This appointment was just changed. Please refresh and try again." });
  } catch (e) { if (isUniqueViolation(e)) throw new AppError("CONFLICT", { message: SLOT_TAKEN }); throw e; }
  await paudit(ctx, AUDIT_ACTIONS.PORTAL_APPOINTMENT_RESCHEDULED, "appointment", a.id, { publicId, oldStartsAt: a.startsAt.toISOString(), newStartsAt: v.startsAt.toISOString() });
  await emitAppointmentEvent("appointment.rescheduled", ctx.tenantId, a.id);
  return { startsAt: v.startsAt.toISOString() };
}

/* -------------------------------------------------- live OPD token -------------------------------------------------- */
/** Today's tokens of THIS patient. Uses the Phase 3 token status: only this patient's token, the doctor, a count of people ahead and the token number now being served — never another patient's name or details. */
export async function myOpd(ctx: PatientContext) {
  const today = todayIn(ctx.tenant.timezone);
  const visits = await pdb(ctx).opdVisit.findMany({ where: { patientId: ctx.patientId, tokenDate: today }, orderBy: { queueSeq: "desc" }, take: 3, select: { publicToken: true } });
  const items = [];
  for (const v of visits as { publicToken: string }[]) { try { const t = await tokenStatus(ctx.tenantId, v.publicToken); items.push({ token: t.token, status: t.status, message: t.message, active: t.active, emergency: t.emergency, doctorName: t.doctorName, room: t.room, patientsAhead: t.patientsAhead, estimatedWaitMinutes: t.estimatedWaitMinutes, nowServing: t.nowServing }); } catch { /* a token that can't be resolved is simply not shown */ } }
  return { updatedAt: new Date().toISOString(), date: today, clinicName: ctx.tenant.name, items };
}

/* -------------------------------------------------- consultations -------------------------------------------------- */
interface Complaint { text?: string; duration?: string }
function consultDto(c: Record<string, any>, doctors: Map<string, string>, tz: string, showDx: boolean) {
  const when = c.finalizedAt ?? c.startedAt;
  return {
    id: c.id as string, number: c.number as string, date: utcToZoned(when, tz).date, doctorName: doctors.get(c.doctorUserId) ?? "Doctor", status: c.status as string,
    // PATIENT-VISIBLE only: complaints (text + duration), diagnoses (if the clinic allows), advice, follow-up plan. History / examination / assessment / clinical notes are never selected.
    complaints: parse<Complaint[]>(c.chiefComplaints, []).map((x) => [x.text, x.duration && `for ${x.duration}`].filter(Boolean).join(" ")).filter(Boolean) as string[],
    diagnoses: (showDx ? (c.diagnoses ?? []).map((d: { name: string }) => d.name) : null) as string[] | null,
    advice: (c.advice ?? null) as string | null,
    followUp: c.followUpRequired ? { afterDays: (c.followUpAfterDays ?? null) as number | null, date: (c.followUpDate ?? null) as string | null } : null,
    hasPrescription: !!c.prescription && c.prescription.currentVersion > 0,
  };
}
const CONSULT_SELECT = { id: true, number: true, doctorUserId: true, status: true, startedAt: true, finalizedAt: true, chiefComplaints: true, advice: true, followUpRequired: true, followUpAfterDays: true, followUpDate: true, diagnoses: { select: { name: true } }, prescription: { select: { currentVersion: true } } } as const;
export async function listConsultations(ctx: PatientContext, q: { page?: number } = {}) {
  const tdb = pdb(ctx); const settings = await loadPortalSettings(tdb, ctx.tenantId); const page = pageOf(q.page);
  const where = { patientId: ctx.patientId, status: "FINALIZED" };
  const [total, rows] = await Promise.all([tdb.consultation.count({ where }), tdb.consultation.findMany({ where, orderBy: { finalizedAt: "desc" }, skip: (page - 1) * PAGE, take: PAGE, select: CONSULT_SELECT })]);
  const names = await doctorNames(tdb, rows.map((r: { doctorUserId: string }) => r.doctorUserId));
  return { rows: rows.map((r: Record<string, unknown>) => consultDto(r, names, ctx.tenant.timezone, settings.showDiagnoses)) as ReturnType<typeof consultDto>[], total: total as number, page, pageSize: PAGE, showsDiagnoses: settings.showDiagnoses };
}
export async function getConsultation(ctx: PatientContext, id: string) {
  const tdb = pdb(ctx); const settings = await loadPortalSettings(tdb, ctx.tenantId);
  const c = await tdb.consultation.findFirst({ where: { id, patientId: ctx.patientId, status: "FINALIZED" }, select: CONSULT_SELECT });
  if (!c) throw new AppError("NOT_FOUND", { message: "We couldn't find that consultation." });
  const names = await doctorNames(tdb, [c.doctorUserId]);
  await paudit(ctx, AUDIT_ACTIONS.PORTAL_RECORD_VIEWED, "consultation", id, { kind: "consultation" });
  return consultDto(c, names, ctx.tenant.timezone, settings.showDiagnoses);
}

/* -------------------------------------------------- prescriptions -------------------------------------------------- */
/** Finalized prescriptions only (a version exists). Read from the immutable approved snapshot — never from rows a doctor may be editing. */
export async function listPrescriptions(ctx: PatientContext, q: { page?: number; from?: string; to?: string } = {}) {
  const tdb = pdb(ctx); const page = pageOf(q.page);
  const range = q.from || q.to ? { finalizedAt: { ...(q.from && /^\d{4}-\d{2}-\d{2}$/.test(q.from) ? { gte: new Date(`${q.from}T00:00:00Z`) } : {}), ...(q.to && /^\d{4}-\d{2}-\d{2}$/.test(q.to) ? { lt: new Date(Date.parse(`${q.to}T00:00:00Z`) + 86_400_000) } : {}) } } : {};
  const where = { patientId: ctx.patientId, currentVersion: { gt: 0 }, ...range };
  const [total, rows] = await Promise.all([tdb.prescription.count({ where }), tdb.prescription.findMany({ where, orderBy: { finalizedAt: "desc" }, skip: (page - 1) * PAGE, take: PAGE, select: { id: true, number: true, finalizedAt: true, doctorUserId: true, versions: { orderBy: { version: "desc" }, take: 1, select: { snapshot: true, version: true } } } })]);
  const names = await doctorNames(tdb, rows.map((r: { doctorUserId: string }) => r.doctorUserId));
  return { rows: rows.map((r: Record<string, any>) => { const s = parse<{ items?: { name: string; strength?: string | null }[] }>(r.versions[0]?.snapshot, {}); return { id: r.id as string, number: r.number as string | null, date: r.finalizedAt ? utcToZoned(r.finalizedAt, ctx.tenant.timezone).date : null, doctorName: names.get(r.doctorUserId) ?? "Doctor", version: (r.versions[0]?.version ?? 1) as number, medicines: (s.items ?? []).map((i) => [i.name, i.strength].filter(Boolean).join(" ")) }; }) as { id: string; number: string | null; date: string | null; doctorName: string; version: number; medicines: string[] }[], total: total as number, page, pageSize: PAGE };
}

/* -------------------------------------------------- lab reports -------------------------------------------------- */
export const RELEASED_REPORT = { currentVersion: { gt: 0 }, status: { in: ["RELEASED", "AMENDED"] } } as const;
export async function listReports(ctx: PatientContext, q: { page?: number; q?: string; from?: string; to?: string } = {}) {
  const tdb = pdb(ctx); const page = pageOf(q.page); const text = (q.q ?? "").trim().slice(0, 60);
  const range = q.from || q.to ? { releasedAt: { ...(q.from && /^\d{4}-\d{2}-\d{2}$/.test(q.from) ? { gte: new Date(`${q.from}T00:00:00Z`) } : {}), ...(q.to && /^\d{4}-\d{2}-\d{2}$/.test(q.to) ? { lt: new Date(Date.parse(`${q.to}T00:00:00Z`) + 86_400_000) } : {}) } } : {};
  const where: Record<string, unknown> = { patientId: ctx.patientId, ...RELEASED_REPORT, ...range, ...(text ? { order: { is: { items: { some: { testNameSnapshot: { contains: text } } } } } } : {}) };
  const [total, rows] = await Promise.all([tdb.labReport.count({ where }), tdb.labReport.findMany({ where, orderBy: { releasedAt: "desc" }, skip: (page - 1) * PAGE, take: PAGE, select: { id: true, reportNumber: true, releasedAt: true, currentVersion: true, status: true, doctorUserId: true, order: { select: { items: { select: { testNameSnapshot: true } } } } } })]);
  const names = await doctorNames(tdb, rows.map((r: { doctorUserId: string }) => r.doctorUserId));
  return { rows: rows.map((r: Record<string, any>) => ({ id: r.id as string, reportNumber: r.reportNumber as string, date: r.releasedAt ? utcToZoned(r.releasedAt, ctx.tenant.timezone).date : null, doctorName: names.get(r.doctorUserId) ?? "Doctor", version: r.currentVersion as number, amended: r.currentVersion > 1, tests: r.order.items.map((i: { testNameSnapshot: string }) => i.testNameSnapshot) as string[] })) as { id: string; reportNumber: string; date: string | null; doctorName: string; version: number; amended: boolean; tests: string[] }[], total: total as number, page, pageSize: PAGE };
}

/* -------------------------------------------------- follow-ups -------------------------------------------------- */
/** Operational statuses are translated; staff-only statuses (declined, no response, cancelled, expired) are not shown at all. */
function patientFollowUpStatus(status: string, due: string, today: string): string | null {
  switch (status) { case "PENDING": return due > today ? "UPCOMING" : "DUE"; case "DUE": case "IN_PROGRESS": case "CONTACTED": return due > today ? "UPCOMING" : "DUE"; case "APPOINTMENT_BOOKED": return "APPOINTMENT_BOOKED"; case "COMPLETED": return "COMPLETED"; case "RESCHEDULED": return "RESCHEDULED"; default: return null; }
}
export async function listFollowUps(ctx: PatientContext, q: { group?: string } = {}) {
  const tdb = pdb(ctx); const today = todayIn(ctx.tenant.timezone);
  const rows = await tdb.followUp.findMany({ where: { patientId: ctx.patientId, status: { in: ["PENDING", "DUE", "IN_PROGRESS", "CONTACTED", "APPOINTMENT_BOOKED", "COMPLETED", "RESCHEDULED"] } }, orderBy: { dueDate: "asc" }, take: 80, select: { id: true, title: true, dueDate: true, status: true, priority: true, doctorUserId: true, appointmentId: true, completedAt: true } });
  const names = await doctorNames(tdb, rows.map((r: { doctorUserId: string | null }) => r.doctorUserId));
  const apptIds = rows.map((r: { appointmentId: string | null }) => r.appointmentId).filter(Boolean) as string[];
  const appts = apptIds.length ? await tdb.appointment.findMany({ where: { id: { in: apptIds }, patientId: ctx.patientId }, select: { id: true, publicId: true, startsAt: true } }) : [];
  const all = rows.map((r: Record<string, any>) => { const st = patientFollowUpStatus(r.status, r.dueDate, today); if (!st) return null; const ap = appts.find((a: { id: string }) => a.id === r.appointmentId); return { id: r.id as string, title: r.title as string, dueDate: r.dueDate as string, status: st, important: r.priority === "HIGH" || r.priority === "URGENT", doctorName: r.doctorUserId ? names.get(r.doctorUserId) ?? null : null, appointment: ap ? { id: ap.publicId as string, date: utcToZoned(ap.startsAt, ctx.tenant.timezone).date } : null }; }).filter(Boolean) as { id: string; title: string; dueDate: string; status: string; important: boolean; doctorName: string | null; appointment: { id: string; date: string } | null }[];
  const group = q.group === "completed" ? "completed" : "upcoming";
  const rowsOut = all.filter((f) => (group === "completed" ? f.status === "COMPLETED" : f.status !== "COMPLETED"));
  return { group, rows: group === "completed" ? rowsOut.reverse() : rowsOut };
}

/* -------------------------------------------------- billing -------------------------------------------------- */
const PAID_PAYMENT = ["SUCCESS", "PARTIALLY_REFUNDED", "REFUNDED"];
export async function listInvoices(ctx: PatientContext, q: { filter?: string; page?: number } = {}) {
  const tdb = pdb(ctx); const page = pageOf(q.page); const today = todayIn(ctx.tenant.timezone);
  const filter = ["paid", "unpaid", "overdue"].includes(q.filter ?? "") ? q.filter! : "all";
  const rows = (await tdb.invoice.findMany({ where: { patientId: ctx.patientId, status: { not: "DRAFT" } }, orderBy: [{ invoiceDate: "desc" }, { createdAt: "desc" }], take: 300, select: { id: true, invoiceNumber: true, invoiceDate: true, dueDate: true, status: true, currency: true, totalMinor: true, collectedMinor: true, refundedMinor: true } })) as Record<string, any>[];
  const view = rows.map((i) => { const overdue = isOverdue(i as never, today); const due = i.status === "CANCELLED" ? 0 : dueOf(i as never); return { id: i.id as string, invoiceNumber: i.invoiceNumber as string, date: i.invoiceDate as string, dueDate: i.dueDate as string | null, status: (overdue ? "OVERDUE" : i.status) as string, currency: i.currency as string, totalMinor: i.totalMinor as number, paidMinor: Math.max(0, i.collectedMinor - i.refundedMinor) as number, outstandingMinor: due as number }; });
  const f = view.filter((i) => (filter === "paid" ? i.status === "PAID" : filter === "unpaid" ? i.outstandingMinor > 0 && i.status !== "CANCELLED" : filter === "overdue" ? i.status === "OVERDUE" : true));
  return { filter, rows: f.slice((page - 1) * PAGE, page * PAGE), total: f.length, page, pageSize: PAGE, outstandingMinor: view.reduce((a, i) => a + i.outstandingMinor, 0) };
}
export async function getInvoice(ctx: PatientContext, id: string) {
  const tdb = pdb(ctx); const today = todayIn(ctx.tenant.timezone);
  const i = await tdb.invoice.findFirst({ where: { id, patientId: ctx.patientId, status: { not: "DRAFT" } }, include: { items: { orderBy: { position: "asc" }, select: { descriptionSnapshot: true, quantity: true, unitPriceMinor: true, discountMinor: true, invoiceDiscountMinor: true, taxMinor: true, taxRateBp: true, lineTotalMinor: true } }, payments: { where: { status: { in: PAID_PAYMENT } }, orderBy: { createdAt: "asc" }, select: { id: true, receiptNumber: true, method: true, paymentDate: true, amountMinor: true, status: true } } } });
  if (!i) throw new AppError("NOT_FOUND", { message: "We couldn't find that bill." });
  await paudit(ctx, AUDIT_ACTIONS.PORTAL_RECORD_VIEWED, "invoice", id, { kind: "invoice" });
  const overdue = isOverdue(i as never, today);
  return {
    id: i.id as string, invoiceNumber: i.invoiceNumber as string, date: i.invoiceDate as string, dueDate: i.dueDate as string | null, status: (overdue ? "OVERDUE" : i.status) as string, currency: i.currency as string,
    subtotalMinor: i.subtotalMinor as number, discountMinor: i.discountMinor as number, taxMinor: i.taxMinor as number, totalMinor: i.totalMinor as number, paidMinor: Math.max(0, i.collectedMinor - i.refundedMinor) as number, outstandingMinor: (i.status === "CANCELLED" ? 0 : dueOf(i)) as number,
    items: i.items.map((x: Record<string, any>) => ({ description: x.descriptionSnapshot as string, quantity: x.quantity as number, unitPriceMinor: x.unitPriceMinor as number, discountMinor: (x.discountMinor + x.invoiceDiscountMinor) as number, taxMinor: x.taxMinor as number, totalMinor: x.lineTotalMinor as number })) as { description: string; quantity: number; unitPriceMinor: number; discountMinor: number; taxMinor: number; totalMinor: number }[],
    payments: i.payments.map((p: Record<string, any>) => ({ id: p.id as string, receiptNumber: p.receiptNumber as string | null, method: p.method as string, date: p.paymentDate as string, amountMinor: p.amountMinor as number })) as { id: string; receiptNumber: string | null; method: string; date: string; amountMinor: number }[],
    canPayOnline: false as boolean, payMessage: COLLECTIBLE.includes(i.status) && dueOf(i) > 0 ? "Online payment isn't available yet. Please pay at the clinic." : null as string | null,
  };
}
export async function listPayments(ctx: PatientContext, q: { page?: number } = {}) {
  const tdb = pdb(ctx); const page = pageOf(q.page); const where = { patientId: ctx.patientId, status: { in: PAID_PAYMENT } };
  const [total, rows] = await Promise.all([tdb.payment.count({ where }), tdb.payment.findMany({ where, orderBy: [{ paymentDate: "desc" }, { createdAt: "desc" }], skip: (page - 1) * PAGE, take: PAGE, select: { id: true, receiptNumber: true, method: true, paymentDate: true, amountMinor: true, status: true, invoice: { select: { invoiceNumber: true, currency: true } } } })]);
  return { rows: rows.map((p: Record<string, any>) => ({ id: p.id as string, receiptNumber: p.receiptNumber as string | null, invoiceNumber: p.invoice.invoiceNumber as string, currency: p.invoice.currency as string, method: p.method as string, date: p.paymentDate as string, amountMinor: p.amountMinor as number, status: p.status as string })) as { id: string; receiptNumber: string | null; invoiceNumber: string; currency: string; method: string; date: string; amountMinor: number; status: string }[], total: total as number, page, pageSize: PAGE };
}

/* -------------------------------------------------- documents -------------------------------------------------- */
export interface DocumentDto { kind: "prescription" | "report" | "invoice" | "receipt"; id: string; title: string; subtitle: string | null; date: string | null }
/** Everything the patient may open or download, newest first: finalized prescriptions, released reports, issued bills and receipts. (There is no separate upload store yet.) */
export async function listDocuments(ctx: PatientContext, q: { kind?: string; page?: number } = {}) {
  const tdb = pdb(ctx); const tz = ctx.tenant.timezone; const page = pageOf(q.page);
  const [rx, rep, inv, pay] = await Promise.all([
    tdb.prescription.findMany({ where: { patientId: ctx.patientId, currentVersion: { gt: 0 } }, orderBy: { finalizedAt: "desc" }, take: 40, select: { id: true, number: true, finalizedAt: true } }),
    tdb.labReport.findMany({ where: { patientId: ctx.patientId, ...RELEASED_REPORT }, orderBy: { releasedAt: "desc" }, take: 40, select: { id: true, reportNumber: true, releasedAt: true, order: { select: { items: { select: { testNameSnapshot: true } } } } } }),
    tdb.invoice.findMany({ where: { patientId: ctx.patientId, status: { notIn: ["DRAFT"] } }, orderBy: { invoiceDate: "desc" }, take: 40, select: { id: true, invoiceNumber: true, invoiceDate: true } }),
    tdb.payment.findMany({ where: { patientId: ctx.patientId, status: { in: PAID_PAYMENT }, receiptNumber: { not: null } }, orderBy: { createdAt: "desc" }, take: 40, select: { id: true, receiptNumber: true, paymentDate: true } }),
  ]);
  const all: DocumentDto[] = [
    ...rx.map((r: Record<string, any>) => ({ kind: "prescription" as const, id: r.id, title: `Prescription ${r.number ?? ""}`.trim(), subtitle: null, date: r.finalizedAt ? utcToZoned(r.finalizedAt, tz).date : null })),
    ...rep.map((r: Record<string, any>) => ({ kind: "report" as const, id: r.id, title: `Lab report ${r.reportNumber}`, subtitle: r.order.items.map((i: { testNameSnapshot: string }) => i.testNameSnapshot).slice(0, 3).join(", "), date: r.releasedAt ? utcToZoned(r.releasedAt, tz).date : null })),
    ...inv.map((r: Record<string, any>) => ({ kind: "invoice" as const, id: r.id, title: `Bill ${r.invoiceNumber}`, subtitle: null, date: r.invoiceDate as string })),
    ...pay.map((r: Record<string, any>) => ({ kind: "receipt" as const, id: r.id, title: `Receipt ${r.receiptNumber}`, subtitle: null, date: r.paymentDate as string })),
  ].filter((d) => !q.kind || d.kind === q.kind).sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  return { rows: all.slice((page - 1) * PAGE, page * PAGE), total: all.length, page, pageSize: PAGE };
}

/* -------------------------------------------------- timeline -------------------------------------------------- */
export async function myTimeline(ctx: PatientContext) {
  const tdb = pdb(ctx); const tz = ctx.tenant.timezone; type E = { id: string; at: string; title: string; detail?: string; kind: string; href?: string };
  const [appts, cons, rx, rep, fu, inv, pay] = await Promise.all([
    tdb.appointment.findMany({ where: { patientId: ctx.patientId }, orderBy: { startsAt: "desc" }, take: 15, select: { publicId: true, startsAt: true, status: true, createdAt: true } }),
    tdb.consultation.findMany({ where: { patientId: ctx.patientId, status: "FINALIZED" }, orderBy: { finalizedAt: "desc" }, take: 10, select: { id: true, number: true, finalizedAt: true } }),
    tdb.prescription.findMany({ where: { patientId: ctx.patientId, currentVersion: { gt: 0 } }, orderBy: { finalizedAt: "desc" }, take: 10, select: { id: true, number: true, finalizedAt: true } }),
    tdb.labReport.findMany({ where: { patientId: ctx.patientId, ...RELEASED_REPORT }, orderBy: { releasedAt: "desc" }, take: 10, select: { id: true, reportNumber: true, releasedAt: true } }),
    tdb.followUp.findMany({ where: { patientId: ctx.patientId, status: { in: ["PENDING", "DUE", "IN_PROGRESS", "CONTACTED", "APPOINTMENT_BOOKED", "COMPLETED", "RESCHEDULED"] } }, orderBy: { createdAt: "desc" }, take: 8, select: { id: true, title: true, createdAt: true } }),
    tdb.invoice.findMany({ where: { patientId: ctx.patientId, status: { not: "DRAFT" } }, orderBy: { issuedAt: "desc" }, take: 10, select: { id: true, invoiceNumber: true, issuedAt: true, createdAt: true } }),
    tdb.payment.findMany({ where: { patientId: ctx.patientId, status: { in: PAID_PAYMENT } }, orderBy: { createdAt: "desc" }, take: 10, select: { id: true, receiptNumber: true, createdAt: true } }),
  ]);
  const ev: E[] = [];
  for (const a of appts as Record<string, any>[]) { const lbl = a.status === "COMPLETED" ? "Appointment completed" : a.status === "CANCELLED" ? "Appointment cancelled" : a.status === "NO_SHOW" ? "Appointment missed" : "Appointment booked"; ev.push({ id: `a-${a.publicId}`, at: a.startsAt.toISOString(), title: lbl, detail: formatInTz(a.startsAt, tz, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }), kind: "appointment", href: `/portal/appointments/${a.publicId}` }); }
  for (const c of cons as Record<string, any>[]) ev.push({ id: `c-${c.id}`, at: (c.finalizedAt as Date).toISOString(), title: "Consultation completed", detail: c.number, kind: "consultation", href: `/portal/consultations/${c.id}` });
  for (const r of rx as Record<string, any>[]) ev.push({ id: `p-${r.id}`, at: (r.finalizedAt as Date).toISOString(), title: "Prescription available", detail: r.number ?? undefined, kind: "prescription", href: `/portal/prescriptions/${r.id}` });
  for (const r of rep as Record<string, any>[]) ev.push({ id: `r-${r.id}`, at: (r.releasedAt as Date).toISOString(), title: "Lab report released", detail: r.reportNumber, kind: "report", href: `/portal/reports/${r.id}` });
  for (const f of fu as Record<string, any>[]) ev.push({ id: `f-${f.id}`, at: f.createdAt.toISOString(), title: "Follow-up planned", detail: f.title, kind: "follow-up", href: "/portal/follow-ups" });
  for (const i of inv as Record<string, any>[]) ev.push({ id: `i-${i.id}`, at: (i.issuedAt ?? i.createdAt).toISOString(), title: "Bill issued", detail: i.invoiceNumber, kind: "billing", href: `/portal/billing/invoices/${i.id}` });
  for (const p of pay as Record<string, any>[]) ev.push({ id: `pay-${p.id}`, at: p.createdAt.toISOString(), title: "Payment received", detail: p.receiptNumber ?? undefined, kind: "billing", href: "/portal/billing?view=payments" });
  return { events: ev.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 40) };
}

/* -------------------------------------------------- dashboard -------------------------------------------------- */
export async function dashboard(ctx: PatientContext) {
  const tdb = pdb(ctx); const tz = ctx.tenant.timezone; const today = todayIn(tz); const { start, end } = dayRangeUtc(today, tz); const now = new Date();
  const settings = await loadPortalSettings(tdb, ctx.tenantId);
  const apptSel = { publicId: true, doctorUserId: true, startsAt: true, type: true, status: true, source: true, reason: true, serviceId: true } as const;
  const [next, todays, rx, rep, fu, invs, unread, patient] = await Promise.all([
    tdb.appointment.findFirst({ where: { patientId: ctx.patientId, status: { in: ["REQUESTED", "CONFIRMED"] }, startsAt: { gte: now } }, orderBy: { startsAt: "asc" }, select: apptSel }),
    tdb.appointment.findMany({ where: { patientId: ctx.patientId, status: { in: APPT_GROUPS.upcoming }, startsAt: { gte: start, lt: end } }, orderBy: { startsAt: "asc" }, take: 3, select: apptSel }),
    tdb.prescription.findFirst({ where: { patientId: ctx.patientId, currentVersion: { gt: 0 } }, orderBy: { finalizedAt: "desc" }, select: { id: true, number: true, finalizedAt: true, doctorUserId: true, versions: { orderBy: { version: "desc" }, take: 1, select: { snapshot: true } } } }),
    tdb.labReport.findFirst({ where: { patientId: ctx.patientId, ...RELEASED_REPORT }, orderBy: { releasedAt: "desc" }, select: { id: true, reportNumber: true, releasedAt: true, order: { select: { items: { select: { testNameSnapshot: true } } } } } }),
    tdb.followUp.findFirst({ where: { patientId: ctx.patientId, status: { in: ["PENDING", "DUE", "IN_PROGRESS", "CONTACTED", "RESCHEDULED"] } }, orderBy: { dueDate: "asc" }, select: { id: true, title: true, dueDate: true, status: true } }),
    tdb.invoice.findMany({ where: { patientId: ctx.patientId, status: { in: [...COLLECTIBLE] } }, select: { totalMinor: true, collectedMinor: true, status: true, dueDate: true, currency: true } }),
    tdb.notification.count({ where: { userId: ctx.user.id, readAt: null } }),
    tdb.patient.findFirst({ where: { id: ctx.patientId }, select: { phone: true, email: true, dateOfBirth: true, gender: true, addressLine: true, city: true, emergencyContactName: true, emergencyContactPhone: true } }),
  ]);
  const doctors = await doctorNames(tdb, [next?.doctorUserId, ...todays.map((t: { doctorUserId: string }) => t.doctorUserId), rx?.doctorUserId]);
  const dto = (a: Record<string, unknown> | null) => (a ? apptDto(a, doctors, tz, now, settings) : null);
  const owing = (invs as Record<string, any>[]).filter((i) => dueOf(i as never) > 0);
  const fields = patient ? [patient.phone, patient.email, patient.dateOfBirth, patient.gender, patient.addressLine, patient.city, patient.emergencyContactName, patient.emergencyContactPhone] : [];
  const opd = await myOpd(ctx);
  return {
    greetingName: ctx.patient.preferredName ?? ctx.patient.name.split(" ")[0], patient: { name: ctx.patient.name, code: ctx.patient.code }, clinicName: ctx.tenant.name,
    profileCompletion: fields.length ? Math.round((fields.filter(Boolean).length / fields.length) * 100) : 0,
    nextAppointment: dto(next), todaysAppointments: todays.map((t: Record<string, unknown>) => dto(t)!) as AppointmentDto[], opdToken: opd.items.find((i) => i.active) ?? null,
    latestPrescription: rx ? { id: rx.id as string, number: rx.number as string | null, date: rx.finalizedAt ? utcToZoned(rx.finalizedAt, tz).date : null, doctorName: doctors.get(rx.doctorUserId) ?? "Doctor", medicineCount: parse<{ items?: unknown[] }>(rx.versions[0]?.snapshot, {}).items?.length ?? 0 } : null,
    latestReport: rep ? { id: rep.id as string, reportNumber: rep.reportNumber as string, date: rep.releasedAt ? utcToZoned(rep.releasedAt, tz).date : null, tests: rep.order.items.map((i: { testNameSnapshot: string }) => i.testNameSnapshot) as string[] } : null,
    upcomingFollowUp: fu ? { id: fu.id as string, title: fu.title as string, dueDate: fu.dueDate as string, due: fu.dueDate <= today } : null,
    outstanding: { totalMinor: owing.reduce((a, i) => a + dueOf(i as never), 0), count: owing.length, overdue: owing.some((i) => isOverdue(i as never, today)), currency: (invs[0]?.currency ?? "INR") as string },
    unreadNotifications: unread as number, canBook: settings.allowBooking,
  };
}
