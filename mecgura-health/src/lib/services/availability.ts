import "server-only";
import { db } from "@/lib/db";
import { TENANT_ACCESS_STATUSES } from "@/lib/domain/constants";
import { AppError } from "@/lib/errors";
import { computeDaySlots, SLOT_MESSAGES, type ClinicDayHours, type Slot, type SlotReason } from "@/lib/scheduling/availability";
import { SLOT_HOLDING } from "@/lib/scheduling/states";
import { DAYS_KEYS_BY_WEEKDAY, dayRangeUtc, isValidDate, parseHhmm, utcToZoned, weekdayOf } from "@/lib/scheduling/time";
import { parseContent } from "@/lib/website/content";

/**
 * SERVER-SIDE availability. The browser only ever renders what this returns; creating/rescheduling an appointment
 * re-checks the chosen slot against the same function (assertSlotAvailable) before writing.
 */
export interface SlotResult { slots: Slot[]; reason: SlotReason; message: string; tz: string; slotMinutes: number | null }

async function clinicHours(tenantId: string, weekday: number): Promise<ClinicDayHours | null> {
  const w = await db.website.findUnique({ where: { tenantId }, select: { publishedContent: true, draftContent: true } });
  if (!w) return null;
  const content = parseContent(w.publishedContent ?? w.draftContent);
  const hours = content.clinic.hours;
  if (!Object.values(hours).some((d) => d.open)) return null; // clinic never configured its hours: don't invent a restriction
  const d = hours[DAYS_KEYS_BY_WEEKDAY[weekday]];
  return { open: d.open, from: parseHhmm(d.from), to: parseHhmm(d.to), breaks: d.breaks.map((b) => ({ from: parseHhmm(b.from), to: parseHhmm(b.to) })) };
}

export async function getSlots(tenantId: string, doctorUserId: string, date: string, actor: "public" | "staff", now = new Date(), exceptAppointmentId?: string): Promise<SlotResult> {
  const empty = (reason: SlotReason, tz = "Asia/Kolkata", message?: string): SlotResult => ({ slots: [], reason, message: message ?? SLOT_MESSAGES[reason], tz, slotMinutes: null });
  if (!isValidDate(date)) return empty("INVALID_DATE");
  const tenant = await db.tenant.findFirst({ where: { id: tenantId, deletedAt: null }, select: { timezone: true, status: true } });
  if (!tenant || !TENANT_ACCESS_STATUSES.includes(tenant.status)) return empty("NO_SCHEDULE", tenant?.timezone, "This clinic isn't taking appointments right now.");
  const tz = tenant.timezone;
  const doctor = await db.user.findFirst({ where: { id: doctorUserId, tenantId, role: { key: "DOCTOR" }, status: "ACTIVE", deletedAt: null }, select: { id: true } });
  const schedule = doctor ? await db.doctorSchedule.findUnique({ where: { doctorUserId } }) : null;
  if (!doctor || !schedule || schedule.tenantId !== tenantId) return empty("NO_SCHEDULE", tz, "This doctor hasn't set up a schedule yet.");
  if (actor === "public" && !schedule.onlineBooking) return empty("NO_SCHEDULE", tz, "Online booking isn't available for this doctor.");

  const weekday = weekdayOf(date);
  const { start, end } = dayRangeUtc(date, tz);
  const [windows, blocks, booked, ch] = await Promise.all([
    db.availabilityWindow.findMany({ where: { tenantId, doctorUserId, weekday }, select: { startMinutes: true, endMinutes: true } }),
    db.blockedTime.findMany({ where: { tenantId, OR: [{ doctorUserId }, { doctorUserId: null }], startsAt: { lt: end }, endsAt: { gt: start } }, select: { startsAt: true, endsAt: true } }),
    db.appointment.findMany({ where: { tenantId, doctorUserId, status: { in: [...SLOT_HOLDING] }, startsAt: { lt: end }, endsAt: { gt: start }, ...(exceptAppointmentId ? { id: { not: exceptAppointmentId } } : {}) }, select: { startsAt: true, endsAt: true } }),
    clinicHours(tenantId, weekday),
  ]);
  const r = computeDaySlots({
    date, tz, now, actor,
    rules: { slotMinutes: schedule.slotMinutes, bufferMinutes: schedule.bufferMinutes, maxPerDay: schedule.maxPerDay, advanceDays: schedule.advanceDays, minNoticeMinutes: schedule.minNoticeMinutes },
    windows: windows.map((w) => ({ start: w.startMinutes, end: w.endMinutes })), clinicHours: ch,
    blocks: blocks.map((b) => ({ start: b.startsAt, end: b.endsAt })), booked: booked.map((b) => ({ start: b.startsAt, end: b.endsAt })),
  });
  return { ...r, message: SLOT_MESSAGES[r.reason], tz, slotMinutes: schedule.slotMinutes };
}

/** Re-validates one chosen slot (exact start) server-side. Throws the human message the UI shows. */
export async function assertSlotAvailable(tenantId: string, doctorUserId: string, startsAt: Date, actor: "public" | "staff", exceptAppointmentId?: string) {
  const tenant = await db.tenant.findFirst({ where: { id: tenantId, deletedAt: null }, select: { timezone: true } });
  if (!tenant) throw new AppError("NOT_FOUND", { message: "This clinic isn't available right now." });
  const date = utcToZoned(startsAt, tenant.timezone).date;
  const res = await getSlots(tenantId, doctorUserId, date, actor, new Date(), exceptAppointmentId);
  const iso = startsAt.toISOString();
  const slot = res.slots.find((s) => s.startsAt === iso);
  if (!slot) throw new AppError("CONFLICT", { message: res.slots.length ? "Slot is no longer available. Please choose another time." : res.message || "Slot is no longer available." });
  return { slot, tz: tenant.timezone, slotMinutes: res.slotMinutes! };
}
