import "server-only";
import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";
import type { TenantRequestContext } from "@/lib/auth/context";
import { AppError } from "@/lib/errors";
import {
  ACTIVE_OPD, canVisitTransition, compareQueue, formatToken, VISIT_TO_APPOINTMENT,
  type AppointmentStatus, type OpdStatus, type Priority, type QueueType,
} from "@/lib/scheduling/states";
import { dayRangeUtc, timeInTz, todayIn } from "@/lib/scheduling/time";
import { rateLimit } from "@/lib/security/rate-limit";
import { tenantDb } from "@/lib/tenant/db";
import { parseOrThrow } from "@/lib/validation";
import { opdRegisterSchema, queueActionSchema, type PatientRef } from "@/lib/validation/scheduling";
import { setAppointmentStatus } from "./appointment-core";
import { activeTenant, ageLabel, assertTenantDoctor, isUniqueViolation, newPublicToken, nextCounter, tenantTimezone, type Client } from "./clinic-shared";
import { resolvePatientRef } from "./patients";

/* ------------------------------- settings ------------------------------- */
const DEFAULT_PREFIXES: Record<QueueType, string> = { GENERAL: "A", FOLLOW_UP: "F", EMERGENCY: "E", PROCEDURE: "P", ONLINE_APPOINTMENT: "O", WALK_IN: "W" };

export async function getOpdSettings(tenantId: string) {
  const s = await db.opdSettings.findUnique({ where: { tenantId } });
  let prefixes: Record<string, string> = {};
  try { prefixes = JSON.parse(s?.prefixes ?? "{}"); } catch { /* corrupt JSON -> defaults */ }
  return {
    tokenFormat: (s?.tokenFormat ?? "NUMERIC") as "NUMERIC" | "PREFIXED", tokenPad: s?.tokenPad ?? 2, prefixes: { ...DEFAULT_PREFIXES, ...prefixes } as Record<string, string>,
    voiceAnnouncement: s?.voiceAnnouncement ?? false, showNextOnDisplay: s?.showNextOnDisplay ?? true, onlineTokens: s?.onlineTokens ?? false,
    bookingMode: (s?.bookingMode ?? "AUTO_CONFIRM") as "AUTO_CONFIRM" | "REQUIRES_CONFIRMATION", displayKey: s?.displayKey ?? null,
  };
}
type OpdSettingsView = Awaited<ReturnType<typeof getOpdSettings>>;

/* -------------------------------- creation -------------------------------- */
interface NewVisit {
  tenantId: string; tz: string; settings: OpdSettingsView; patientId: string; doctorUserId: string; appointmentId?: string | null;
  visitType: string; queueType: QueueType; priority: Priority; note?: string | null; createdById: string;
}

/** Allocates the next token + arrival order and inserts the visit. MUST run inside a transaction. */
async function createVisitTx(tx: Client, v: NewVisit) {
  const tokenDate = todayIn(v.tz);
  const prefix = v.settings.tokenFormat === "PREFIXED" ? (v.settings.prefixes[v.queueType] ?? "") : "";
  const n = await nextCounter(tx, v.tenantId, `token:${tokenDate}:${prefix}`);
  const seq = await nextCounter(tx, v.tenantId, `queue:${tokenDate}`);
  return tx.opdVisit.create({
    data: {
      tenantId: v.tenantId, patientId: v.patientId, doctorUserId: v.doctorUserId, appointmentId: v.appointmentId ?? null, visitType: v.visitType, queueType: v.queueType,
      priority: v.priority, status: "WAITING", tokenDate, tokenPrefix: prefix, tokenNumber: n, tokenLabel: formatToken({ format: v.settings.tokenFormat, pad: v.settings.tokenPad, prefix, n }),
      publicToken: newPublicToken(), queueSeq: seq, note: v.note ?? null, createdById: v.createdById,
      priorityChangedAt: v.priority === "NORMAL" ? null : new Date(),
    },
  });
}

async function assertNotQueued(tdb: Client, tenantId: string, patientId: string, tz: string) {
  const open = await tdb.opdVisit.findFirst({ where: { tenantId, patientId, tokenDate: todayIn(tz), status: { in: [...ACTIVE_OPD] } }, select: { tokenLabel: true } });
  if (open) throw new AppError("CONFLICT", { message: `This patient is already in today's queue with token ${open.tokenLabel}.` });
}

async function auditVisit(ctx: TenantRequestContext, visit: { id: string; tokenLabel: string; doctorUserId: string; priority: string; queueType: string }, appointmentId?: string | null) {
  const base = { tenantId: ctx.tenantId, actorId: ctx.user.id, entityType: "opd_visit", entityId: visit.id };
  await recordAudit({ ...base, action: AUDIT_ACTIONS.OPD_CREATED, metadata: { queueNo: visit.tokenLabel, doctorUserId: visit.doctorUserId, queueType: visit.queueType, priority: visit.priority, appointmentId: appointmentId ?? null } });
  await recordAudit({ ...base, action: AUDIT_ACTIONS.TOKEN_ASSIGNED, metadata: { queueNo: visit.tokenLabel } });
  if (visit.priority === "EMERGENCY") await recordAudit({ ...base, action: AUDIT_ACTIONS.TOKEN_PRIORITY_CHANGED, metadata: { queueNo: visit.tokenLabel, from: null, to: "EMERGENCY", at: "registration" } });
}

async function createWithRetry(tdb: Client, v: NewVisit, after?: (tx: Client) => Promise<void>) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await tdb.$transaction(async (tx: Client) => {
        const visit = await createVisitTx(tx, v);
        if (after) await after(tx);
        return visit;
      });
    } catch (e) {
      if (!isUniqueViolation(e) || attempt === 2) throw e;
    }
  }
  throw new AppError("INTERNAL");
}

/** Walk-in / emergency / follow-up registration straight into the live queue. */
export async function registerVisit(ctx: TenantRequestContext, raw: unknown) {
  if (!ctx.permissions.has("opd.manage")) throw new AppError("FORBIDDEN");
  const input = parseOrThrow(opdRegisterSchema, raw);
  if (input.emergency && !ctx.permissions.has("opd.priority")) throw new AppError("FORBIDDEN", { message: "You can't register emergencies." });
  const tdb = tenantDb(ctx);
  await assertTenantDoctor(tdb, input.doctorUserId, ctx.tenantId);
  const [tz, settings] = await Promise.all([tenantTimezone(ctx.tenantId), getOpdSettings(ctx.tenantId)]);
  const patient = await resolvePatientRef(ctx, input.patient);
  await assertNotQueued(tdb, ctx.tenantId, patient.id, tz);
  const queueType: QueueType = input.emergency ? "EMERGENCY" : input.queueType;
  const visit = await createWithRetry(tdb, {
    tenantId: ctx.tenantId, tz, settings, patientId: patient.id, doctorUserId: input.doctorUserId, visitType: input.emergency ? "EMERGENCY" : input.visitType,
    queueType, priority: input.emergency ? "EMERGENCY" : "NORMAL", note: input.note, createdById: ctx.user.id,
  });
  await auditVisit(ctx, visit);
  return { id: visit.id, token: visit.tokenLabel as string, publicToken: visit.publicToken as string, priority: visit.priority as Priority };
}

type AppointmentRow = { id: string; status: string; doctorUserId: string; startsAt: Date; patientId: string | null; type: string; opdVisit: { id: string; status: string } | null };

/** Appointment -> clinic reception check-in. Creates the OPD visit + token and mirrors status onto the appointment. */
export async function checkInAppointment(ctx: TenantRequestContext, a: AppointmentRow, patientRef: PatientRef | undefined, opts: { queueType?: QueueType; priority?: Priority }) {
  const status = a.status as AppointmentStatus;
  if (a.opdVisit) throw new AppError("CONFLICT", { message: "This appointment is already checked in." });
  if (status !== "CONFIRMED") throw new AppError("CONFLICT", { message: status === "REQUESTED" ? "Confirm the appointment before checking the patient in." : "Only confirmed appointments can be checked in." });
  if ((opts.priority ?? "NORMAL") !== "NORMAL" && !ctx.permissions.has("opd.priority")) throw new AppError("FORBIDDEN");
  const tdb = tenantDb(ctx);
  const [tz, settings] = await Promise.all([tenantTimezone(ctx.tenantId), getOpdSettings(ctx.tenantId)]);
  if (todayIn(tz, a.startsAt) !== todayIn(tz)) throw new AppError("CONFLICT", { message: "Patients can only be checked in on the day of the appointment." });
  // identity: reuse the patient staff already linked; otherwise staff must resolve (verify or register) now
  const patientId = a.patientId ?? (patientRef ? (await resolvePatientRef(ctx, patientRef)).id : null);
  if (!patientId) throw new AppError("VALIDATION_ERROR", { fieldErrors: { patient: "Choose or register the patient." }, message: "Choose or register the patient." });
  await assertNotQueued(tdb, ctx.tenantId, patientId, tz);
  const queueType: QueueType = opts.queueType ?? (a.type === "FOLLOW_UP" ? "FOLLOW_UP" : "ONLINE_APPOINTMENT");
  let visit;
  try {
    visit = await createWithRetry(
      tdb, { tenantId: ctx.tenantId, tz, settings, patientId, doctorUserId: a.doctorUserId, appointmentId: a.id, visitType: a.type, queueType, priority: opts.priority ?? "NORMAL", createdById: ctx.user.id },
      async (tx) => {
        await setAppointmentStatus(tx, ctx.tenantId, a.id, "CONFIRMED", "CHECKED_IN", { patientId, checkedInAt: new Date() });
        await setAppointmentStatus(tx, ctx.tenantId, a.id, "CHECKED_IN", "WAITING");
      },
    );
  } catch (e) {
    if (isUniqueViolation(e)) throw new AppError("CONFLICT", { message: "This appointment is already checked in." });
    throw e;
  }
  await recordAudit({ action: AUDIT_ACTIONS.PATIENT_CHECKED_IN, tenantId: ctx.tenantId, actorId: ctx.user.id, entityType: "appointment", entityId: a.id, metadata: { queueNo: visit.tokenLabel } });
  await auditVisit(ctx, visit, a.id);
  return { status: "WAITING", token: visit.tokenLabel as string, visitId: visit.id as string };
}

/* ------------------------------ queue snapshot ------------------------------ */
const canSee = (ctx: TenantRequestContext) => ctx.permissions.has("opd.view") || ctx.permissions.has("opd.manage") || ctx.permissions.has("opd.call");

async function avgConsultMinutes(client: Client, tenantId: string, tokenDate: string, doctorUserId: string, fallback: number) {
  const done = await client.opdVisit.findMany({ where: { tenantId, tokenDate, doctorUserId, status: "COMPLETED", startedAt: { not: null }, completedAt: { not: null } }, select: { startedAt: true, completedAt: true }, take: 50, orderBy: { completedAt: "desc" } });
  if (!done.length) return fallback;
  const mins = done.map((d: { startedAt: Date; completedAt: Date }) => (d.completedAt.getTime() - d.startedAt.getTime()) / 60000);
  const avg = mins.reduce((s: number, m: number) => s + m, 0) / mins.length;
  return Math.min(60, Math.max(3, Math.round(avg)));
}

export interface QueueVisit {
  id: string; token: string; status: OpdStatus; priority: Priority; queueType: string; doctorUserId: string; patientName: string; patientCode: string; patientAge: string | null; patientGender: string | null;
  appointmentId: string | null; visitType: string; note: string | null; checkedInAt: string; waitedMinutes: number; estimatedWaitMinutes: number | null; stale: boolean; calledAt: string | null;
}

export async function queueSnapshot(ctx: TenantRequestContext, opts: { doctorUserId?: string; etag?: string } = {}) {
  if (!canSee(ctx)) throw new AppError("FORBIDDEN");
  const tz = await tenantTimezone(ctx.tenantId);
  const today = todayIn(tz);
  const tdb = tenantDb(ctx);
  // a doctor without queue-wide permission only ever sees their own queue
  const ownOnly = ctx.user.role === "DOCTOR" && !ctx.permissions.has("opd.manage");
  const doctorFilter = ownOnly ? ctx.user.id : opts.doctorUserId;
  const where = { OR: [{ tokenDate: today }, { tokenDate: { lt: today }, status: { in: [...ACTIVE_OPD] } }], ...(doctorFilter ? { doctorUserId: doctorFilter } : {}) };
  const agg = await tdb.opdVisit.aggregate({ where, _max: { updatedAt: true }, _count: { _all: true } });
  const etag = createHash("sha1").update(`${today}|${doctorFilter ?? "*"}|${agg._count._all}|${agg._max.updatedAt?.getTime() ?? 0}`).digest("hex").slice(0, 16);
  if (opts.etag && opts.etag === etag) return { notModified: true as const, etag };

  const [rows, doctors] = await Promise.all([
    tdb.opdVisit.findMany({ where, orderBy: { queueSeq: "asc" }, take: 400, include: { patient: { select: { code: true, name: true, gender: true, dateOfBirth: true, ageYears: true } } } }),
    tdb.user.findMany({ where: { role: { key: "DOCTOR" }, status: "ACTIVE", deletedAt: null, ...(doctorFilter ? { id: doctorFilter } : {}) }, select: { id: true, name: true, doctorSchedule: { select: { slotMinutes: true, roomLabel: true } } }, orderBy: { name: "asc" } }),
  ]);
  const now = Date.now();
  const avg = new Map<string, number>();
  for (const d of doctors) avg.set(d.id, await avgConsultMinutes(tdb, ctx.tenantId, today, d.id, d.doctorSchedule?.slotMinutes ?? 10));

  const visits: QueueVisit[] = [];
  const byDoctor = new Map<string, typeof rows>();
  for (const r of rows) byDoctor.set(r.doctorUserId, [...(byDoctor.get(r.doctorUserId) ?? []), r]);
  for (const [docId, list] of byDoctor) {
    const waiting = list.filter((r) => r.status === "WAITING").sort(compareQueue);
    const busy = list.some((r) => r.status === "IN_CONSULTATION" || r.status === "CALLED") ? 1 : 0;
    const perPatient = avg.get(docId) ?? 10;
    for (const r of list) {
      const idx = waiting.findIndex((w) => w.id === r.id);
      visits.push({
        id: r.id, token: r.tokenLabel, status: r.status as OpdStatus, priority: r.priority as Priority, queueType: r.queueType, doctorUserId: r.doctorUserId,
        patientName: r.patient.name, patientCode: r.patient.code, patientAge: ageLabel(r.patient), patientGender: r.patient.gender, appointmentId: r.appointmentId, visitType: r.visitType, note: r.note,
        checkedInAt: r.checkedInAt.toISOString(), waitedMinutes: ["WAITING", "ON_HOLD", "SKIPPED"].includes(r.status) ? Math.max(0, Math.round((now - r.checkedInAt.getTime()) / 60000)) : 0,
        estimatedWaitMinutes: idx >= 0 ? (idx + busy) * perPatient : null, stale: r.tokenDate < today, calledAt: r.calledAt?.toISOString() ?? null,
      });
    }
  }
  const docView = doctors.map((d) => ({ id: d.id, name: d.name, room: d.doctorSchedule?.roomLabel ?? null, avgConsultMinutes: avg.get(d.id) ?? 10 }));
  return { notModified: false as const, etag, tz, date: today, doctors: docView, visits };
}

/* -------------------------------- queue actions -------------------------------- */
const DOCTOR_ACTIONS = new Set(["call", "start", "hold", "resume", "skip", "complete", "recall", "requeue"]);

async function loadVisit(ctx: TenantRequestContext, id: string) {
  const v = await tenantDb(ctx).opdVisit.findFirst({ where: { id }, include: { appointment: { select: { id: true, status: true } } } });
  if (!v) throw new AppError("NOT_FOUND");
  // a doctor without queue-wide control can only act on their own queue
  if (!ctx.permissions.has("opd.manage") && v.doctorUserId !== ctx.user.id) throw new AppError("NOT_FOUND");
  return v;
}

const AUDIT_FOR: Record<string, string> = { call: AUDIT_ACTIONS.TOKEN_CALLED, hold: AUDIT_ACTIONS.TOKEN_HELD, resume: AUDIT_ACTIONS.TOKEN_RESUMED, skip: AUDIT_ACTIONS.TOKEN_SKIPPED };

/** Atomically moves a visit (and its appointment) to a new status; one doctor can only have one patient called/in consultation. */
async function moveVisit(ctx: TenantRequestContext, v: Awaited<ReturnType<typeof loadVisit>>, to: OpdStatus, action: string, data: Record<string, unknown> = {}) {
  const from = v.status as OpdStatus;
  if (!canVisitTransition(from, to)) throw new AppError("CONFLICT", { message: `A ${from.toLowerCase().replace(/_/g, " ")} patient can't be moved to ${to.toLowerCase().replace(/_/g, " ")}.` });
  const tdb = tenantDb(ctx);
  await tdb.$transaction(async (tx: Client) => {
    if (to === "CALLED") {
      await nextCounter(tx, ctx.tenantId, `doclock:${v.doctorUserId}`); // row lock: serialises two desks calling for the same doctor
      const busy = await tx.opdVisit.findFirst({ where: { tenantId: ctx.tenantId, doctorUserId: v.doctorUserId, status: { in: ["CALLED", "IN_CONSULTATION"] }, id: { not: v.id } }, select: { tokenLabel: true } });
      if (busy) throw new AppError("CONFLICT", { message: `Token ${busy.tokenLabel} is already with the doctor. Complete or hold it first.` });
    }
    const res = await tx.opdVisit.updateMany({ where: { id: v.id, tenantId: ctx.tenantId, status: from }, data: { status: to, ...data } });
    if (res.count !== 1) throw new AppError("CONFLICT", { message: "This token was just changed by someone else. Refresh and try again." });
    if (v.appointment) {
      const target = VISIT_TO_APPOINTMENT[to];
      if (v.appointment.status !== target) await setAppointmentStatus(tx, ctx.tenantId, v.appointment.id, v.appointment.status as AppointmentStatus, target, to === "COMPLETED" ? { completedAt: new Date() } : {});
    }
  });
  await recordAudit({ action: (AUDIT_FOR[action] ?? AUDIT_ACTIONS.OPD_STATUS_CHANGED) as never, tenantId: ctx.tenantId, actorId: ctx.user.id, entityType: "opd_visit", entityId: v.id, metadata: { queueNo: v.tokenLabel, from, to, action } });
  return { status: to };
}

export async function queueAction(ctx: TenantRequestContext, visitId: string, raw: unknown) {
  const input = parseOrThrow(queueActionSchema, raw);
  const manage = ctx.permissions.has("opd.manage");
  if (!manage && input.action !== "priority" && !(ctx.permissions.has("opd.call") && DOCTOR_ACTIONS.has(input.action))) throw new AppError("FORBIDDEN");
  if (input.action === "priority" && !ctx.permissions.has("opd.priority")) throw new AppError("FORBIDDEN", { message: "You can't change queue priority." });
  const v = await loadVisit(ctx, visitId);
  const tdb = tenantDb(ctx);
  const now = new Date();
  const only = (from: string, msg: string) => { if (v.status !== from) throw new AppError("CONFLICT", { message: msg }); };

  switch (input.action) {
    case "call": return moveVisit(ctx, v, "CALLED", "call", { calledAt: now });
    case "recall": only("CALLED", "Only a called patient can be sent back to waiting."); return moveVisit(ctx, v, "WAITING", "recall");
    case "start": return moveVisit(ctx, v, "IN_CONSULTATION", "start", { startedAt: now });
    case "hold": return moveVisit(ctx, v, "ON_HOLD", "hold", { heldAt: now });
    case "resume": only("ON_HOLD", "Only patients on hold can be resumed. Use “back to end of queue” for skipped patients."); return moveVisit(ctx, v, "WAITING", "resume"); // keeps its original position
    case "skip": return moveVisit(ctx, v, "SKIPPED", "skip", { skippedAt: now });
    case "complete": return moveVisit(ctx, v, "COMPLETED", "complete", { completedAt: now });
    case "cancel": {
      if (!manage) throw new AppError("FORBIDDEN");
      return moveVisit(ctx, v, "CANCELLED", "cancel", { note: input.reason ?? v.note });
    }
    case "requeue": {
      if (v.status !== "SKIPPED") throw new AppError("CONFLICT", { message: "Only skipped patients can be put back at the end of the queue." });
      const seq = await tdb.$transaction((tx: Client) => nextCounter(tx, ctx.tenantId, `queue:${v.tokenDate}`));
      return moveVisit(ctx, v, "WAITING", "requeue", { queueSeq: seq });
    }
    case "priority": {
      if (!ctx.permissions.has("opd.priority")) throw new AppError("FORBIDDEN", { message: "You can't change queue priority." });
      if (!["WAITING", "ON_HOLD", "CALLED"].includes(v.status)) throw new AppError("CONFLICT", { message: "Priority can only be changed while the patient is waiting." });
      const to = input.priority!;
      if (to === v.priority) return { priority: to };
      const r = await tdb.opdVisit.updateMany({ where: { id: v.id, status: v.status, priority: v.priority }, data: { priority: to, priorityChangedAt: now, ...(to === "EMERGENCY" ? { queueType: "EMERGENCY" } : {}) } });
      if (r.count !== 1) throw new AppError("CONFLICT", { message: "This token was just changed by someone else. Refresh and try again." });
      await recordAudit({ action: AUDIT_ACTIONS.TOKEN_PRIORITY_CHANGED, tenantId: ctx.tenantId, actorId: ctx.user.id, entityType: "opd_visit", entityId: v.id, metadata: { queueNo: v.tokenLabel, from: v.priority, to, reason: input.reason ?? null } });
      return { priority: to };
    }
    case "reassign": {
      if (!manage) throw new AppError("FORBIDDEN");
      if (!["WAITING", "ON_HOLD", "SKIPPED"].includes(v.status)) throw new AppError("CONFLICT", { message: "Only waiting patients can be moved to another doctor." });
      await assertTenantDoctor(tdb, input.doctorUserId!, ctx.tenantId);
      if (input.doctorUserId === v.doctorUserId) throw new AppError("VALIDATION_ERROR", { message: "That patient is already with this doctor." });
      const r = await tdb.opdVisit.updateMany({ where: { id: v.id, status: v.status, doctorUserId: v.doctorUserId }, data: { doctorUserId: input.doctorUserId! } });
      if (r.count !== 1) throw new AppError("CONFLICT", { message: "This token was just changed by someone else. Refresh and try again." });
      await recordAudit({ action: AUDIT_ACTIONS.OPD_DOCTOR_CHANGED, tenantId: ctx.tenantId, actorId: ctx.user.id, entityType: "opd_visit", entityId: v.id, metadata: { queueNo: v.tokenLabel, from: v.doctorUserId, to: input.doctorUserId } });
      return { doctorUserId: input.doctorUserId };
    }
  }
}

/** "Call next": the highest-priority, earliest waiting patient of ONE doctor (emergency, then high, then arrival order). */
export async function callNext(ctx: TenantRequestContext, doctorUserId?: string) {
  const manage = ctx.permissions.has("opd.manage");
  if (!manage && !ctx.permissions.has("opd.call")) throw new AppError("FORBIDDEN");
  const doctor = manage ? doctorUserId : ctx.user.id;
  if (!doctor) throw new AppError("VALIDATION_ERROR", { message: "Choose a doctor." });
  if (!manage && doctorUserId && doctorUserId !== ctx.user.id) throw new AppError("FORBIDDEN");
  const tdb = tenantDb(ctx);
  await assertTenantDoctor(tdb, doctor, ctx.tenantId);
  const tz = await tenantTimezone(ctx.tenantId);
  const waiting = await tdb.opdVisit.findMany({ where: { doctorUserId: doctor, status: "WAITING", tokenDate: { lte: todayIn(tz) } }, select: { id: true, priority: true, queueSeq: true } });
  if (!waiting.length) throw new AppError("NOT_FOUND", { message: "No patients are waiting." });
  const next = [...waiting].sort(compareQueue)[0];
  const v = await loadVisit(ctx, next.id);
  const res = await moveVisit(ctx, v, "CALLED", "call", { calledAt: new Date() });
  return { ...res, visitId: v.id, token: v.tokenLabel };
}

/* --------------------------- public display + token page --------------------------- */
const slim = (r: { tokenLabel: string; status: string; priority: string }) => ({ token: r.tokenLabel, status: r.status, emergency: r.priority === "EMERGENCY" });

/** Waiting-room screen. NO patient names, phones or ids — only tokens. Access is by the clinic's secret display key. */
export async function displaySnapshot(displayKey: string) {
  if (!/^[A-Za-z0-9_-]{10,40}$/.test(displayKey)) throw new AppError("NOT_FOUND");
  const lim = await rateLimit(`display:${displayKey}`, { limit: 90, windowMs: 60_000 });
  if (!lim.allowed) throw new AppError("RATE_LIMITED");
  const s = await db.opdSettings.findUnique({ where: { displayKey } });
  if (!s) throw new AppError("NOT_FOUND");
  const tenant = await activeTenant(s.tenantId);
  const today = todayIn(tenant.timezone);
  const [rows, doctors, settings] = await Promise.all([
    db.opdVisit.findMany({ where: { tenantId: s.tenantId, tokenDate: today, status: { in: ["WAITING", "CALLED", "IN_CONSULTATION"] } }, orderBy: { queueSeq: "asc" }, select: { tokenLabel: true, status: true, priority: true, queueSeq: true, doctorUserId: true, calledAt: true }, take: 300 }),
    db.user.findMany({ where: { tenantId: s.tenantId, role: { key: "DOCTOR" }, status: "ACTIVE", deletedAt: null, doctorSchedule: { isNot: null } }, select: { id: true, name: true, doctorSchedule: { select: { roomLabel: true } } }, orderBy: { name: "asc" } }),
    getOpdSettings(s.tenantId),
  ]);
  const announcements: { id: string; token: string; doctor: string; room: string | null }[] = [];
  const out = doctors.map((d) => {
    const mine = rows.filter((r) => r.doctorUserId === d.id);
    const serving = mine.filter((r) => r.status !== "WAITING").map(slim);
    const waiting = mine.filter((r) => r.status === "WAITING").sort(compareQueue);
    for (const r of mine.filter((r) => r.status === "CALLED")) announcements.push({ id: `${r.tokenLabel}@${r.calledAt?.getTime() ?? 0}`, token: r.tokenLabel, doctor: d.name, room: d.doctorSchedule?.roomLabel ?? null });
    return { name: d.name, room: d.doctorSchedule?.roomLabel ?? null, serving, next: settings.showNextOnDisplay ? waiting.slice(0, 3).map((r) => r.tokenLabel) : [], waitingCount: waiting.length };
  });
  return { clinicName: tenant.name, date: today, time: timeInTz(new Date(), tenant.timezone), voice: settings.voiceAnnouncement, doctors: out, announcements };
}

const PATIENT_STATUS: Record<string, string> = {
  WAITING: "Waiting — please stay nearby", CALLED: "Your token has been called — please go to the doctor's room", IN_CONSULTATION: "You are with the doctor",
  COMPLETED: "Visit completed", ON_HOLD: "On hold — the clinic will call you shortly", SKIPPED: "Your turn was skipped — please check with the reception", CANCELLED: "This token was cancelled",
};

/** Patient-facing token status by the unguessable public token; the clinic must match the HOST's clinic. */
export async function tokenStatus(tenantId: string, publicToken: string) {
  if (!/^[A-Za-z0-9_-]{8,24}$/.test(publicToken)) throw new AppError("NOT_FOUND");
  const v = await db.opdVisit.findFirst({ where: { publicToken, tenantId }, select: { id: true, tokenLabel: true, status: true, priority: true, doctorUserId: true, tokenDate: true, queueSeq: true, doctor: { select: { name: true, doctorSchedule: { select: { roomLabel: true, slotMinutes: true } } } } } });
  if (!v) throw new AppError("NOT_FOUND", { message: "We couldn't find this token." });
  const tenant = await activeTenant(tenantId);
  const active = ["WAITING", "ON_HOLD", "SKIPPED"].includes(v.status);
  let ahead: number | null = null, estimate: number | null = null, nowServing: string | null = null;
  if (v.tokenDate === todayIn(tenant.timezone)) {
    const [waiting, current] = await Promise.all([
      db.opdVisit.findMany({ where: { tenantId, doctorUserId: v.doctorUserId, tokenDate: v.tokenDate, status: "WAITING" }, select: { priority: true, queueSeq: true } }),
      db.opdVisit.findFirst({ where: { tenantId, doctorUserId: v.doctorUserId, tokenDate: v.tokenDate, status: { in: ["CALLED", "IN_CONSULTATION"] } }, select: { tokenLabel: true } }),
    ]);
    nowServing = current?.tokenLabel ?? null;
    if (v.status === "WAITING") {
      ahead = waiting.filter((w) => compareQueue(w, v) < 0).length;
      const avg = await avgConsultMinutes(db, tenantId, v.tokenDate, v.doctorUserId, v.doctor.doctorSchedule?.slotMinutes ?? 10);
      estimate = (ahead + (current ? 1 : 0)) * avg;
    }
  }
  return {
    token: v.tokenLabel, status: v.status, message: PATIENT_STATUS[v.status] ?? "", active, emergency: v.priority === "EMERGENCY", doctorName: v.doctor.name, room: v.doctor.doctorSchedule?.roomLabel ?? null,
    clinicName: tenant.name, date: v.tokenDate, patientsAhead: ahead, estimatedWaitMinutes: estimate, nowServing,
  };
}

/* ------------------------------- dashboard stats ------------------------------- */
export async function opdStats(ctx: TenantRequestContext) {
  const tz = await tenantTimezone(ctx.tenantId);
  const today = todayIn(tz);
  const tdb = tenantDb(ctx);
  const ownOnly = ctx.user.role === "DOCTOR" && !ctx.permissions.has("opd.manage");
  const mine = ownOnly ? { doctorUserId: ctx.user.id } : {};
  const { start, end } = dayRangeUtc(today, tz);
  const [visits, appts, next] = await Promise.all([
    tdb.opdVisit.groupBy({ by: ["status"], where: { tokenDate: today, ...mine }, _count: { _all: true } }),
    tdb.appointment.groupBy({ by: ["status"], where: { startsAt: { gte: start, lt: end }, ...mine }, _count: { _all: true } }),
    tdb.appointment.findFirst({ where: { startsAt: { gte: new Date() }, status: { in: ["REQUESTED", "CONFIRMED"] }, ...mine }, orderBy: { startsAt: "asc" }, select: { startsAt: true } }),
  ]);
  type G = { status: string; _count: { _all: number } };
  const v = (s: string) => (visits as G[]).find((x) => x.status === s)?._count._all ?? 0;
  const a = (s: string) => (appts as G[]).find((x) => x.status === s)?._count._all ?? 0;
  return {
    appointmentsToday: (appts as G[]).reduce((n, x) => n + x._count._all, 0), requested: a("REQUESTED"), confirmed: a("CONFIRMED"), noShows: a("NO_SHOW"), cancelled: a("CANCELLED"),
    waiting: v("WAITING") + v("ON_HOLD") + v("SKIPPED"), inConsultation: v("CALLED") + v("IN_CONSULTATION"), completed: v("COMPLETED"),
    nextAppointmentAt: next?.startsAt.toISOString() ?? null, tz,
  };
}
