import { addDays, dayRangeUtc, hhmm, todayIn, utcToZoned, zonedToUtc } from "./time";

/**
 * Pure slot generator (unit-tested). The DB layer feeds it real data; it NEVER offers:
 * past slots, slots inside the minimum notice, beyond the booking horizon, blocked times, breaks (gaps between working
 * windows), clinic-closed periods, already-booked slots, or anything once the day's cap is reached.
 */
export interface SlotRules { slotMinutes: number; bufferMinutes: number; maxPerDay: number | null; advanceDays: number; minNoticeMinutes: number }
export interface Interval { start: Date; end: Date }
export interface ClinicDayHours { open: boolean; from: number; to: number; breaks: { from: number; to: number }[] }

export type SlotReason = "OK" | "INVALID_DATE" | "PAST" | "TOO_FAR" | "NO_SCHEDULE" | "CLINIC_CLOSED" | "BLOCKED" | "FULL" | "FULLY_BOOKED";
export interface Slot { startsAt: string; endsAt: string; label: string }

export interface SlotInput {
  date: string; tz: string; now: Date; rules: SlotRules;
  /** working windows for that weekday, clinic-local minutes */
  windows: { start: number; end: number }[];
  /** clinic opening hours for that weekday when the clinic has configured any (null = not configured -> no extra limit) */
  clinicHours: ClinicDayHours | null;
  blocks: Interval[]; booked: Interval[];
  /** staff may book inside the notice period / beyond the public horizon; the public may not */
  actor: "public" | "staff";
}

const hit = (slot: Interval, list: Interval[]) => list.some((i) => slot.start < i.end && slot.end > i.start);

export function computeDaySlots(i: SlotInput): { slots: Slot[]; reason: SlotReason } {
  const { date, tz, now, rules } = i;
  const today = todayIn(tz, now);
  if (date < today) return { slots: [], reason: "PAST" };
  if (i.actor === "public" && date > addDays(today, rules.advanceDays)) return { slots: [], reason: "TOO_FAR" };
  if (!i.windows.length) return { slots: [], reason: "NO_SCHEDULE" };
  if (i.clinicHours && !i.clinicHours.open) return { slots: [], reason: "CLINIC_CLOSED" };

  const earliest = new Date(now.getTime() + (i.actor === "public" ? rules.minNoticeMinutes : 0) * 60000);
  const step = rules.slotMinutes + rules.bufferMinutes;
  const candidates: Interval[] = [];
  for (const w of [...i.windows].sort((a, b) => a.start - b.start)) {
    for (let t = w.start; t + rules.slotMinutes <= w.end; t += step) {
      const start = zonedToUtc(date, t, tz);
      // a local time that doesn't exist (DST gap) comes back shifted: skip it rather than offer a wrong time
      if (utcToZoned(start, tz).minutes !== t) continue;
      candidates.push({ start, end: new Date(start.getTime() + rules.slotMinutes * 60000) });
    }
  }
  if (!candidates.length) return { slots: [], reason: "NO_SCHEDULE" };

  let pool = candidates;
  if (i.clinicHours) {
    const ch = i.clinicHours;
    pool = pool.filter((s) => {
      const a = utcToZoned(s.start, tz).minutes, b = a + rules.slotMinutes;
      return a >= ch.from && b <= ch.to && !ch.breaks.some((br) => a < br.to && b > br.from);
    });
    if (!pool.length) return { slots: [], reason: "CLINIC_CLOSED" };
  }
  pool = pool.filter((s) => !hit(s, i.blocks));
  if (!pool.length) return { slots: [], reason: "BLOCKED" };

  if (rules.maxPerDay != null) {
    const { start, end } = dayRangeUtc(date, tz);
    const used = i.booked.filter((b) => b.start >= start && b.start < end).length;
    if (used >= rules.maxPerDay) return { slots: [], reason: "FULL" };
  }
  const free = pool.filter((s) => !hit(s, i.booked) && s.start >= earliest);
  if (!free.length) return { slots: [], reason: pool.every((s) => s.start < earliest) ? "PAST" : "FULLY_BOOKED" };
  return { slots: free.map((s) => ({ startsAt: s.start.toISOString(), endsAt: s.end.toISOString(), label: hhmm(utcToZoned(s.start, tz).minutes) })), reason: "OK" };
}

export const SLOT_MESSAGES: Record<SlotReason, string> = {
  OK: "", INVALID_DATE: "Choose a valid date.", PAST: "No slots are left for this date.", TOO_FAR: "That date is too far ahead to book online.",
  NO_SCHEDULE: "The doctor doesn't see patients on this day.", CLINIC_CLOSED: "The clinic is closed at these times.", BLOCKED: "The doctor is unavailable on this date.",
  FULL: "This day is fully booked.", FULLY_BOOKED: "No slots available for this date.",
};
