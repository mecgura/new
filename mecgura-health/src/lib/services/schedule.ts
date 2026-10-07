import "server-only";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";
import type { TenantRequestContext } from "@/lib/auth/context";
import { AppError } from "@/lib/errors";
import { SLOT_HOLDING } from "@/lib/scheduling/states";
import { hhmm, parseHhmm, zonedToUtc, utcToZoned } from "@/lib/scheduling/time";
import { tenantDb } from "@/lib/tenant/db";
import { parseOrThrow } from "@/lib/validation";
import { blockedTimeSchema, opdSettingsSchema, scheduleSchema } from "@/lib/validation/scheduling";
import { assertTenantDoctor, newDisplayKey, tenantTimezone } from "./clinic-shared";
import { getOpdSettings } from "./opd";

const manages = (ctx: TenantRequestContext) => ctx.permissions.has("schedule.manage");
/** A doctor may edit only their own schedule; admins/managers may edit anyone's (of THIS clinic). */
function assertCanEdit(ctx: TenantRequestContext, doctorUserId: string) {
  if (manages(ctx)) return;
  if (ctx.permissions.has("schedule.own") && doctorUserId === ctx.user.id) return;
  throw new AppError("FORBIDDEN");
}
const canView = (ctx: TenantRequestContext) => manages(ctx) || ctx.permissions.has("schedule.own") || ctx.permissions.has("appointments.view");

export async function listSchedules(ctx: TenantRequestContext) {
  if (!canView(ctx)) throw new AppError("FORBIDDEN");
  const tdb = tenantDb(ctx);
  const onlyMine = !manages(ctx) && !ctx.permissions.has("appointments.create") && !ctx.permissions.has("appointments.edit");
  const doctors = await tdb.user.findMany({
    where: { role: { key: "DOCTOR" }, status: "ACTIVE", deletedAt: null, ...(onlyMine ? { id: ctx.user.id } : {}) },
    select: { id: true, name: true, doctorSchedule: true }, orderBy: { name: "asc" },
  });
  const windows = await tdb.availabilityWindow.findMany({ where: { doctorUserId: { in: doctors.map((d) => d.id) } }, orderBy: [{ weekday: "asc" }, { startMinutes: "asc" }] });
  return doctors.map((d) => ({
    doctorUserId: d.id, doctorName: d.name, configured: !!d.doctorSchedule,
    slotMinutes: d.doctorSchedule?.slotMinutes ?? 15, bufferMinutes: d.doctorSchedule?.bufferMinutes ?? 0, maxPerDay: d.doctorSchedule?.maxPerDay ?? null,
    onlineBooking: d.doctorSchedule?.onlineBooking ?? false, advanceDays: d.doctorSchedule?.advanceDays ?? 30, minNoticeMinutes: d.doctorSchedule?.minNoticeMinutes ?? 60, roomLabel: d.doctorSchedule?.roomLabel ?? null,
    windows: windows.filter((w) => w.doctorUserId === d.id).map((w) => ({ weekday: w.weekday, start: hhmm(w.startMinutes), end: hhmm(w.endMinutes) })),
    editable: manages(ctx) || (ctx.permissions.has("schedule.own") && d.id === ctx.user.id),
  }));
}

export async function saveSchedule(ctx: TenantRequestContext, doctorUserId: string, raw: unknown) {
  assertCanEdit(ctx, doctorUserId);
  const input = parseOrThrow(scheduleSchema, raw);
  const tdb = tenantDb(ctx);
  await assertTenantDoctor(tdb, doctorUserId, ctx.tenantId);
  const data = { slotMinutes: input.slotMinutes, bufferMinutes: input.bufferMinutes, maxPerDay: input.maxPerDay ?? null, onlineBooking: input.onlineBooking, advanceDays: input.advanceDays, minNoticeMinutes: input.minNoticeMinutes, roomLabel: input.roomLabel ?? null };
  await tdb.$transaction(async (tx: import("./clinic-shared").Client) => {
    await tx.doctorSchedule.upsert({ where: { doctorUserId }, update: data, create: { tenantId: ctx.tenantId, doctorUserId, ...data } });
    await tx.availabilityWindow.deleteMany({ where: { tenantId: ctx.tenantId, doctorUserId } });
    if (input.windows.length) await tx.availabilityWindow.createMany({ data: input.windows.map((w) => ({ tenantId: ctx.tenantId, doctorUserId, weekday: w.weekday, startMinutes: parseHhmm(w.start), endMinutes: parseHhmm(w.end) })) });
  });
  await recordAudit({ action: AUDIT_ACTIONS.SCHEDULE_UPDATED, tenantId: ctx.tenantId, actorId: ctx.user.id, entityType: "doctor_schedule", entityId: doctorUserId, metadata: { slotMinutes: input.slotMinutes, onlineBooking: input.onlineBooking, windows: input.windows.length } });
  return { saved: true };
}

/* ------------------------------- blocked time ------------------------------- */
export async function listBlocks(ctx: TenantRequestContext) {
  if (!canView(ctx)) throw new AppError("FORBIDDEN");
  const tz = await tenantTimezone(ctx.tenantId);
  const rows = await tenantDb(ctx).blockedTime.findMany({ where: { endsAt: { gte: new Date() }, ...(manages(ctx) || ctx.permissions.has("appointments.create") ? {} : { OR: [{ doctorUserId: ctx.user.id }, { doctorUserId: null }] }) }, orderBy: { startsAt: "asc" }, take: 200 });
  return rows.map((b) => {
    const s = utcToZoned(b.startsAt, tz), e = utcToZoned(b.endsAt, tz);
    return { id: b.id, doctorUserId: b.doctorUserId, kind: b.kind, reason: b.reason, startDate: s.date, startTime: hhmm(s.minutes), endDate: e.date, endTime: hhmm(e.minutes), editable: b.doctorUserId ? manages(ctx) || b.doctorUserId === ctx.user.id : manages(ctx) };
  });
}

export async function createBlock(ctx: TenantRequestContext, raw: unknown) {
  const input = parseOrThrow(blockedTimeSchema, raw);
  const doctorUserId = input.doctorUserId || null;
  if (doctorUserId) assertCanEdit(ctx, doctorUserId); else if (!manages(ctx)) throw new AppError("FORBIDDEN");
  const tdb = tenantDb(ctx);
  if (doctorUserId) await assertTenantDoctor(tdb, doctorUserId, ctx.tenantId);
  const tz = await tenantTimezone(ctx.tenantId);
  const startsAt = zonedToUtc(input.startDate, parseHhmm(input.startTime), tz);
  const endsAt = zonedToUtc(input.endDate, parseHhmm(input.endTime), tz);
  const b = await tdb.blockedTime.create({ data: { tenantId: ctx.tenantId, doctorUserId, startsAt, endsAt, kind: input.kind, reason: input.reason ?? null, createdById: ctx.user.id } });
  // existing bookings are NOT silently cancelled: staff are told how many need attention
  const clash = await tdb.appointment.count({ where: { status: { in: [...SLOT_HOLDING] }, startsAt: { lt: endsAt }, endsAt: { gt: startsAt }, ...(doctorUserId ? { doctorUserId } : {}) } });
  await recordAudit({ action: AUDIT_ACTIONS.BLOCKED_TIME_CREATED, tenantId: ctx.tenantId, actorId: ctx.user.id, entityType: "blocked_time", entityId: b.id, metadata: { doctorUserId, kind: input.kind, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), existingAppointments: clash } });
  return { id: b.id, existingAppointments: clash };
}

export async function deleteBlock(ctx: TenantRequestContext, id: string) {
  const tdb = tenantDb(ctx);
  const b = await tdb.blockedTime.findFirst({ where: { id } });
  if (!b) throw new AppError("NOT_FOUND");
  if (b.doctorUserId) assertCanEdit(ctx, b.doctorUserId); else if (!manages(ctx)) throw new AppError("FORBIDDEN");
  await tdb.blockedTime.deleteMany({ where: { id } });
  await recordAudit({ action: AUDIT_ACTIONS.BLOCKED_TIME_REMOVED, tenantId: ctx.tenantId, actorId: ctx.user.id, entityType: "blocked_time", entityId: id, metadata: { doctorUserId: b.doctorUserId, kind: b.kind } });
  return { deleted: true };
}

/* ------------------------------- OPD settings ------------------------------- */
export async function readOpdSettings(ctx: TenantRequestContext) {
  if (!manages(ctx) && !ctx.permissions.has("opd.view") && !ctx.permissions.has("opd.manage")) throw new AppError("FORBIDDEN");
  const s = await getOpdSettings(ctx.tenantId);
  return { ...s, displayEnabled: !!s.displayKey, displayPath: s.displayKey && manages(ctx) ? `/display/${s.displayKey}` : null, displayKey: undefined };
}

export async function saveOpdSettings(ctx: TenantRequestContext, raw: unknown) {
  if (!manages(ctx)) throw new AppError("FORBIDDEN");
  const input = parseOrThrow(opdSettingsSchema, raw);
  const tdb = tenantDb(ctx);
  const cur = await tdb.opdSettings.findFirst({ where: { tenantId: ctx.tenantId }, select: { displayKey: true } });
  const displayKey = !input.displayEnabled ? null : input.rotateDisplayKey || !cur?.displayKey ? newDisplayKey() : cur.displayKey;
  const data = { tokenFormat: input.tokenFormat, tokenPad: input.tokenPad, prefixes: JSON.stringify(input.prefixes), voiceAnnouncement: input.voiceAnnouncement, showNextOnDisplay: input.showNextOnDisplay, onlineTokens: input.onlineTokens, bookingMode: input.bookingMode, displayKey };
  await tdb.opdSettings.upsert({ where: { tenantId: ctx.tenantId }, update: data, create: { tenantId: ctx.tenantId, ...data } });
  await recordAudit({ action: AUDIT_ACTIONS.OPD_SETTINGS_UPDATED, tenantId: ctx.tenantId, actorId: ctx.user.id, entityType: "opd_settings", entityId: ctx.tenantId, metadata: { numberStyle: input.tokenFormat, bookingMode: input.bookingMode, displayEnabled: input.displayEnabled, displayKeyRotated: !!input.rotateDisplayKey } });
  return { saved: true, displayPath: displayKey ? `/display/${displayKey}` : null };
}
