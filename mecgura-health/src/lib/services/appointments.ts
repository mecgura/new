import "server-only";
import { db } from "@/lib/db";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";
import type { TenantRequestContext } from "@/lib/auth/context";
import { AppError } from "@/lib/errors";
import { emitAppointmentEvent } from "@/lib/events/appointments";
import { PRE_VISIT, type AppointmentStatus } from "@/lib/scheduling/states";
import { addDays, dayRangeUtc, timeInTz, utcToZoned } from "@/lib/scheduling/time";
import { rateLimit } from "@/lib/security/rate-limit";
import { tenantDb } from "@/lib/tenant/db";
import { parseOrThrow } from "@/lib/validation";
import { appointmentActionSchema, calendarQuerySchema, publicBookingSchema, staffAppointmentSchema } from "@/lib/validation/scheduling";
import { createHmac } from "node:crypto";
import { assertSlotAvailable } from "./availability";
import { insertAppointment, setAppointmentStatus, slotLockKey, SLOT_TAKEN } from "./appointment-core";
import { activeTenant, assertTenantDoctor, isUniqueViolation, shortName, tenantTimezone, type Client } from "./clinic-shared";
import { checkInAppointment } from "./opd";
import { resolvePatientRef } from "./patients";

const seesAll = (ctx: TenantRequestContext) => ctx.permissions.has("appointments.create") || ctx.permissions.has("appointments.edit") || ctx.user.role !== "DOCTOR";
/** Doctors see only their own appointments; front-desk/admin/assisting roles see the clinic's. */
const scope = (ctx: TenantRequestContext) => (seesAll(ctx) ? {} : { doctorUserId: ctx.user.id });

const include = { doctor: { select: { id: true, name: true } }, patient: { select: { id: true, code: true, name: true } }, opdVisit: { select: { id: true, tokenLabel: true, status: true } } } as const;
type Row = Awaited<ReturnType<typeof loadRows>>[number];
async function loadRows(ctx: TenantRequestContext, where: object) {
  return tenantDb(ctx).appointment.findMany({ where: { ...scope(ctx), ...where }, orderBy: { startsAt: "asc" }, take: 500, include });
}

export async function toView(ctx: TenantRequestContext, rows: Row[], tz: string, full = false) {
  const serviceIds = [...new Set(rows.map((r) => r.serviceId).filter((x): x is string => !!x))];
  const services = serviceIds.length ? await tenantDb(ctx).websiteService.findMany({ where: { id: { in: serviceIds } }, select: { id: true, title: true } }) : [];
  const titles = new Map(services.map((s) => [s.id, s.title]));
  return rows.map((a) => {
    const name = a.patient?.name ?? a.contactName ?? "Patient";
    return {
      id: a.id, publicId: a.publicId, type: a.type, source: a.source, status: a.status as AppointmentStatus,
      startsAt: a.startsAt.toISOString(), endsAt: a.endsAt.toISOString(), date: utcToZoned(a.startsAt, tz).date, time: timeInTz(a.startsAt, tz),
      doctor: a.doctor, patientLabel: full ? name : shortName(name), patientCode: a.patient?.code ?? null, hasPatient: !!a.patientId,
      serviceTitle: a.serviceId ? (titles.get(a.serviceId) ?? null) : null, tokenLabel: a.opdVisit?.tokenLabel ?? null, queueStatus: a.opdVisit?.status ?? null,
      ...(full ? { reason: a.reason, notes: a.notes, contactPhone: a.contactPhone, contactEmail: a.contactEmail, cancellationReason: a.cancellationReason, checkedInAt: a.checkedInAt?.toISOString() ?? null } : {}),
    };
  });
}
export type AppointmentView = Awaited<ReturnType<typeof toView>>[number];

export async function listAppointments(ctx: TenantRequestContext, raw: unknown) {
  if (!ctx.permissions.has("appointments.view")) throw new AppError("FORBIDDEN");
  const q = parseOrThrow(calendarQuerySchema, raw);
  const tz = await tenantTimezone(ctx.tenantId);
  const range = { gte: dayRangeUtc(q.from, tz).start, lt: dayRangeUtc(addDays(q.to, 1), tz).start };
  const statuses = q.status ? q.status.split(",").slice(0, 11) : undefined;
  const rows = await loadRows(ctx, {
    startsAt: range, ...(q.doctorUserId ? { doctorUserId: q.doctorUserId } : {}), ...(q.type ? { type: q.type } : {}),
    ...(statuses ? { status: { in: statuses } } : {}), ...(q.serviceId ? { serviceId: q.serviceId } : {}),
  });
  return { tz, appointments: await toView(ctx, rows, tz) };
}

export async function getAppointment(ctx: TenantRequestContext, id: string) {
  if (!ctx.permissions.has("appointments.view")) throw new AppError("FORBIDDEN");
  const tz = await tenantTimezone(ctx.tenantId);
  const rows = await loadRows(ctx, { id });
  if (!rows.length) throw new AppError("NOT_FOUND");
  return (await toView(ctx, rows, tz, true))[0];
}

async function checkService(ctx: TenantRequestContext, serviceId?: string) {
  if (!serviceId) return;
  if (!(await tenantDb(ctx).websiteService.findFirst({ where: { id: serviceId, deletedAt: null }, select: { id: true } }))) throw new AppError("VALIDATION_ERROR", { fieldErrors: { serviceId: "Choose a service from this clinic." } });
}

/** Reception/admin books an appointment. Patient identity is resolved HERE, by staff, server-side. */
export async function createStaffAppointment(ctx: TenantRequestContext, raw: unknown) {
  if (!ctx.permissions.has("appointments.create")) throw new AppError("FORBIDDEN");
  const input = parseOrThrow(staffAppointmentSchema, raw);
  await assertTenantDoctor(tenantDb(ctx), input.doctorUserId, ctx.tenantId);
  await checkService(ctx, input.serviceId);
  const { slotMinutes } = await assertSlotAvailable(ctx.tenantId, input.doctorUserId, input.startsAt, "staff");
  const patient = input.patient ? await resolvePatientRef(ctx, input.patient) : null;
  const a = await insertAppointment(tenantDb(ctx), {
    tenantId: ctx.tenantId, doctorUserId: input.doctorUserId, startsAt: input.startsAt, endsAt: new Date(input.startsAt.getTime() + slotMinutes * 60000),
    type: input.type, source: input.source, status: "CONFIRMED", confirmedAt: new Date(), serviceId: input.serviceId ?? null, reason: input.reason ?? null, notes: input.notes ?? null,
    patientId: patient?.id ?? null, contactName: patient ? null : input.contactName ?? null, contactPhone: patient ? null : input.contactPhone ?? null, createdById: ctx.user.id,
  });
  await recordAudit({ action: AUDIT_ACTIONS.APPOINTMENT_CREATED, tenantId: ctx.tenantId, actorId: ctx.user.id, entityType: "appointment", entityId: a.id, metadata: { publicId: a.publicId, type: a.type, source: a.source, doctorUserId: a.doctorUserId, startsAt: a.startsAt.toISOString() } });
  await emitAppointmentEvent("appointment.created", ctx.tenantId, a.id);
  return { id: a.id, publicId: a.publicId };
}

async function load(ctx: TenantRequestContext, id: string) {
  const a = await tenantDb(ctx).appointment.findFirst({ where: { id, ...scope(ctx) }, include: { opdVisit: { select: { id: true, status: true } } } });
  if (!a) throw new AppError("NOT_FOUND"); // another clinic's id (or another doctor's) simply doesn't exist for the caller
  return a;
}

export async function appointmentAction(ctx: TenantRequestContext, id: string, raw: unknown) {
  const input = parseOrThrow(appointmentActionSchema, raw);
  const a = await load(ctx, id);
  const status = a.status as AppointmentStatus;
  const tdb = tenantDb(ctx);
  const audit = (action: Parameters<typeof recordAudit>[0]["action"], metadata?: Record<string, unknown>) => recordAudit({ action, tenantId: ctx.tenantId, actorId: ctx.user.id, entityType: "appointment", entityId: id, metadata });

  switch (input.action) {
    case "confirm": {
      if (!ctx.permissions.has("appointments.edit")) throw new AppError("FORBIDDEN");
      await setAppointmentStatus(tdb, ctx.tenantId, id, status, "CONFIRMED", { confirmedAt: new Date() });
      await audit(AUDIT_ACTIONS.APPOINTMENT_STATUS_CHANGED, { from: status, to: "CONFIRMED" });
      await emitAppointmentEvent("appointment.confirmed", ctx.tenantId, id);
      return { status: "CONFIRMED" };
    }
    case "cancel": {
      if (!ctx.permissions.has("appointments.edit")) throw new AppError("FORBIDDEN");
      await tdb.$transaction(async (tx: Client) => {
        await setAppointmentStatus(tx, ctx.tenantId, id, status, "CANCELLED", { cancelledAt: new Date(), cancelledById: ctx.user.id, cancellationReason: input.reasonKind === "OTHER" ? (input.reason ?? "Other") : input.reasonKind + (input.reason ? `: ${input.reason}` : "") });
        if (a.opdVisit && ["WAITING", "ON_HOLD", "SKIPPED"].includes(a.opdVisit.status)) await tx.opdVisit.updateMany({ where: { id: a.opdVisit.id, status: a.opdVisit.status }, data: { status: "CANCELLED" } });
      });
      await audit(AUDIT_ACTIONS.APPOINTMENT_CANCELLED, { from: status, reasonKind: input.reasonKind });
      await emitAppointmentEvent("appointment.cancelled", ctx.tenantId, id);
      return { status: "CANCELLED" };
    }
    case "reschedule": {
      if (!ctx.permissions.has("appointments.edit")) throw new AppError("FORBIDDEN");
      if (!PRE_VISIT.includes(status)) throw new AppError("CONFLICT", { message: "Only appointments that haven't started can be rescheduled." });
      const doctorUserId = input.doctorUserId ?? a.doctorUserId;
      if (doctorUserId !== a.doctorUserId) await assertTenantDoctor(tdb, doctorUserId, ctx.tenantId);
      if (doctorUserId === a.doctorUserId && input.startsAt.getTime() === a.startsAt.getTime()) throw new AppError("VALIDATION_ERROR", { message: "That's the current time. Choose a different slot." });
      const { slotMinutes } = await assertSlotAvailable(ctx.tenantId, doctorUserId, input.startsAt, "staff", id);
      const endsAt = new Date(input.startsAt.getTime() + slotMinutes * 60000);
      try {
        const r = await tdb.appointment.updateMany({ where: { id, status }, data: { doctorUserId, startsAt: input.startsAt, endsAt, slotLock: slotLockKey(doctorUserId, input.startsAt) } });
        if (r.count !== 1) throw new AppError("CONFLICT", { message: "This appointment was just changed by someone else. Refresh and try again." });
      } catch (e) {
        if (isUniqueViolation(e)) throw new AppError("CONFLICT", { message: SLOT_TAKEN });
        throw e;
      }
      await audit(AUDIT_ACTIONS.APPOINTMENT_RESCHEDULED, { oldStartsAt: a.startsAt.toISOString(), newStartsAt: input.startsAt.toISOString(), oldDoctor: a.doctorUserId, newDoctor: doctorUserId });
      await emitAppointmentEvent("appointment.rescheduled", ctx.tenantId, id);
      return { startsAt: input.startsAt.toISOString() };
    }
    case "check-in": {
      if (!ctx.permissions.has("opd.manage")) throw new AppError("FORBIDDEN");
      return checkInAppointment(ctx, a, input.patient, { queueType: input.queueType, priority: input.priority });
    }
    case "no-show": {
      if (!ctx.permissions.has("appointments.edit")) throw new AppError("FORBIDDEN");
      await setAppointmentStatus(tdb, ctx.tenantId, id, status, "NO_SHOW", { noShowAt: new Date(), noShowById: ctx.user.id, noShowReason: input.reason ?? null });
      await audit(AUDIT_ACTIONS.APPOINTMENT_NO_SHOW, { from: status });
      return { status: "NO_SHOW" };
    }
    case "update": {
      if (!ctx.permissions.has("appointments.edit")) throw new AppError("FORBIDDEN");
      await tdb.appointment.update({ where: { id }, data: { notes: input.notes ?? null, reason: input.reason ?? a.reason } });
      await audit(AUDIT_ACTIONS.APPOINTMENT_UPDATED, { fields: ["notes", "reason"] });
      return { updated: true };
    }
  }
}

/* ---------------------------- public website booking ---------------------------- */

/** Doctors and services a visitor can book on the clinic's website (published profile + online booking switched on). */
export async function publicBookingOptions(tenantId: string) {
  const t = await activeTenant(tenantId);
  const w = await db.website.findUnique({ where: { tenantId }, select: { status: true } });
  if (w?.status !== "PUBLISHED") return { tz: t.timezone, doctors: [], services: [], bookingMode: "AUTO_CONFIRM" as const };
  const [doctors, services, settings] = await Promise.all([
    db.doctorPublicProfile.findMany({ where: { tenantId, status: "PUBLISHED", user: { status: "ACTIVE", deletedAt: null, tenantId, doctorSchedule: { is: { onlineBooking: true } } } }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], include: { user: { select: { name: true, doctorProfile: { select: { specialization: true } }, doctorSchedule: { select: { slotMinutes: true, advanceDays: true } } } } } }),
    db.websiteService.findMany({ where: { tenantId, status: "PUBLISHED", deletedAt: null }, orderBy: [{ sortOrder: "asc" }, { title: "asc" }], select: { slug: true, title: true } }),
    db.opdSettings.findUnique({ where: { tenantId }, select: { bookingMode: true } }),
  ]);
  return {
    tz: t.timezone, clinicName: t.name, bookingMode: (settings?.bookingMode ?? "AUTO_CONFIRM") as "AUTO_CONFIRM" | "REQUIRES_CONFIRMATION",
    doctors: doctors.map((d) => ({ slug: d.slug, name: d.user.name, specialization: d.user.doctorProfile?.specialization ?? null, advanceDays: d.user.doctorSchedule?.advanceDays ?? 30 })),
    services,
  };
}

async function doctorBySlug(tenantId: string, slug: string) {
  const p = await db.doctorPublicProfile.findFirst({ where: { tenantId, slug, status: "PUBLISHED", user: { status: "ACTIVE", deletedAt: null, tenantId } }, select: { userId: true, user: { select: { name: true } } } });
  if (!p) throw new AppError("NOT_FOUND", { message: "This doctor isn't available for online booking." });
  return { id: p.userId, name: p.user.name };
}

export async function publicSlots(tenantId: string, doctorSlug: string, date: string) {
  const { getSlots } = await import("./availability");
  const d = await doctorBySlug(tenantId, doctorSlug);
  const r = await getSlots(tenantId, d.id, date, "public");
  return { tz: r.tz, reason: r.reason, message: r.message, slots: r.slots.map((s) => ({ startsAt: s.startsAt, label: s.label })) };
}

/**
 * Anonymous booking from the clinic website. The clinic comes from the HOST; the doctor from a PUBLISHED public
 * profile; the slot is re-validated server-side; the patient is NOT linked to any existing record (staff resolve identity
 * at check-in) — a visitor can never select someone else's patient record.
 */
export async function createPublicBooking(tenantId: string, raw: unknown, ip: string | null) {
  const tenant = await activeTenant(tenantId);
  const w = await db.website.findUnique({ where: { tenantId }, select: { status: true } });
  if (w?.status !== "PUBLISHED") throw new AppError("NOT_FOUND", { message: "Online booking isn't available right now." });
  const ipKey = createHmac("sha256", process.env.AUTH_SECRET ?? "dev").update(ip ?? "?").digest("hex").slice(0, 20);
  const [perIp, perClinic] = await Promise.all([rateLimit(`book:${tenantId}:${ipKey}`, { limit: 6, windowMs: 60 * 60_000 }), rateLimit(`book:${tenantId}:all`, { limit: 300, windowMs: 60 * 60_000 })]);
  if (!perIp.allowed || !perClinic.allowed) throw new AppError("RATE_LIMITED", { message: "Too many booking attempts. Please try again later or call the clinic." });
  const input = parseOrThrow(publicBookingSchema, raw);
  if (input.website_url) throw new AppError("VALIDATION_ERROR", { message: "Couldn't complete the booking." }); // honeypot
  const doctor = await doctorBySlug(tenantId, input.doctor);
  let serviceId: string | null = null;
  if (input.service) {
    const s = await db.websiteService.findFirst({ where: { tenantId, slug: input.service, status: "PUBLISHED", deletedAt: null }, select: { id: true } });
    if (!s) throw new AppError("VALIDATION_ERROR", { fieldErrors: { service: "Choose a service from the list." } });
    serviceId = s.id;
  }
  const { slotMinutes } = await assertSlotAvailable(tenantId, doctor.id, input.startsAt, "public");
  const settings = await db.opdSettings.findUnique({ where: { tenantId }, select: { bookingMode: true } });
  const confirmed = (settings?.bookingMode ?? "AUTO_CONFIRM") === "AUTO_CONFIRM";
  const a = await insertAppointment(db, {
    tenantId, doctorUserId: doctor.id, startsAt: input.startsAt, endsAt: new Date(input.startsAt.getTime() + slotMinutes * 60000),
    type: "ONLINE_APPOINTMENT", source: "WEBSITE", status: confirmed ? "CONFIRMED" : "REQUESTED", confirmedAt: confirmed ? new Date() : null, serviceId,
    contactName: input.name, contactPhone: input.phone, contactEmail: input.email ?? null, contactDob: input.dateOfBirth ?? null, contactGender: input.gender ?? null,
    reason: input.reason ?? null,
  });
  await recordAudit({ action: AUDIT_ACTIONS.APPOINTMENT_CREATED, tenantId, entityType: "appointment", entityId: a.id, metadata: { publicId: a.publicId, source: "WEBSITE", status: a.status, doctorUserId: doctor.id, startsAt: a.startsAt.toISOString() }, ip: null, userAgent: null });
  await emitAppointmentEvent("appointment.created", tenantId, a.id);
  return { appointmentId: a.publicId, status: a.status as "CONFIRMED" | "REQUESTED", doctorName: doctor.name, clinicName: tenant.name, startsAt: a.startsAt.toISOString(), tz: tenant.timezone };
}
