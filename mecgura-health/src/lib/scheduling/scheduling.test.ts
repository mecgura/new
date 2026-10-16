import { describe, expect, it } from "vitest";
import { computeDaySlots, type SlotInput } from "./availability";
import { APPOINTMENT_STATUSES, APPOINTMENT_TRANSITIONS, canTransition, canVisitTransition, compareQueue, formatToken, OPD_STATUSES, SLOT_HOLDING } from "./states";
import { addDays, dayRangeUtc, hhmm, isValidDate, parseHhmm, todayIn, utcToZoned, zonedToUtc } from "./time";

const TZ = "Asia/Kolkata";
const NOW = new Date("2030-03-04T04:00:00Z"); // 09:30 IST, Monday 4 March 2030
const base = (over: Partial<SlotInput> = {}): SlotInput => ({
  date: "2030-03-05", tz: TZ, now: NOW, actor: "public",
  rules: { slotMinutes: 30, bufferMinutes: 0, maxPerDay: null, advanceDays: 30, minNoticeMinutes: 60 },
  windows: [{ start: 9 * 60, end: 11 * 60 }], clinicHours: null, blocks: [], booked: [], ...over,
});
const labels = (i: SlotInput) => computeDaySlots(i).slots.map((s) => s.label);

describe("timezone maths", () => {
  it("converts clinic-local time to UTC and back", () => {
    const d = zonedToUtc("2030-03-05", 9 * 60 + 30, TZ);
    expect(d.toISOString()).toBe("2030-03-05T04:00:00.000Z");
    expect(utcToZoned(d, TZ)).toMatchObject({ date: "2030-03-05", minutes: 570 });
  });
  it("'today' is the clinic's day, not the server's", () => {
    const lateUtc = new Date("2030-03-04T20:00:00Z"); // 01:30 next day in IST
    expect(todayIn(TZ, lateUtc)).toBe("2030-03-05");
    expect(todayIn("America/New_York", lateUtc)).toBe("2030-03-04");
  });
  it("day range handles DST days (23 / 25 hour days)", () => {
    const r = dayRangeUtc("2030-03-10", "America/New_York");
    expect((r.end.getTime() - r.start.getTime()) / 3600000).toBe(23);
  });
  it("helpers", () => {
    expect(addDays("2030-02-28", 1)).toBe("2030-03-01");
    expect(isValidDate("2030-02-30")).toBe(false);
    expect(hhmm(parseHhmm("07:05"))).toBe("07:05");
  });
});

describe("slot generation", () => {
  it("makes slots from working windows", () => expect(labels(base())).toEqual(["09:00", "09:30", "10:00", "10:30"]));
  it("two windows leave a break between them", () => expect(labels(base({ windows: [{ start: 540, end: 600 }, { start: 660, end: 720 }] }))).toEqual(["09:00", "09:30", "11:00", "11:30"]));
  it("buffer widens the step between slots", () => expect(labels(base({ rules: { ...base().rules, bufferMinutes: 15 } }))).toEqual(["09:00", "09:45", "10:30"]));
  it("a booked slot disappears; neighbours stay", () => {
    const b = zonedToUtc("2030-03-05", 9 * 60 + 30, TZ);
    expect(labels(base({ booked: [{ start: b, end: new Date(b.getTime() + 30 * 60000) }] }))).toEqual(["09:00", "10:00", "10:30"]);
  });
  it("blocked time removes slots; whole-day block says so", () => {
    const s = zonedToUtc("2030-03-05", 0, TZ), e = zonedToUtc("2030-03-06", 0, TZ);
    expect(computeDaySlots(base({ blocks: [{ start: s, end: e }] }))).toMatchObject({ slots: [], reason: "BLOCKED" });
    const mid = zonedToUtc("2030-03-05", 10 * 60, TZ);
    expect(labels(base({ blocks: [{ start: mid, end: new Date(mid.getTime() + 3600000) }] }))).toEqual(["09:00", "09:30"]);
  });
  it("max per day closes the day when reached", () => {
    const mk = (m: number) => { const s = zonedToUtc("2030-03-05", m, TZ); return { start: s, end: new Date(s.getTime() + 1800000) }; };
    expect(computeDaySlots(base({ rules: { ...base().rules, maxPerDay: 2 }, booked: [mk(540), mk(570)] })).reason).toBe("FULL");
  });
  it("no window that weekday = no schedule", () => expect(computeDaySlots(base({ windows: [] })).reason).toBe("NO_SCHEDULE"));
  it("past dates and the public booking horizon", () => {
    expect(computeDaySlots(base({ date: "2030-03-03" })).reason).toBe("PAST");
    expect(computeDaySlots(base({ date: "2030-06-30" })).reason).toBe("TOO_FAR");
    expect(computeDaySlots(base({ date: "2030-06-30", actor: "staff" })).reason).toBe("OK");
  });
  it("public booking respects minimum notice; staff don't have to", () => {
    const today = base({ date: "2030-03-04", windows: [{ start: 9 * 60, end: 12 * 60 }] }); // now = 09:30
    expect(labels(today)).toEqual(["10:30", "11:00", "11:30"]);
    expect(labels({ ...today, actor: "staff" })).toEqual(["09:30", "10:00", "10:30", "11:00", "11:30"]);
  });
  it("clinic opening hours and breaks further restrict slots", () => {
    expect(labels(base({ clinicHours: { open: true, from: 570, to: 630, breaks: [] } }))).toEqual(["09:30", "10:00"]);
    expect(labels(base({ clinicHours: { open: true, from: 540, to: 660, breaks: [{ from: 600, to: 630 }] } }))).toEqual(["09:00", "09:30", "10:30"]);
    expect(computeDaySlots(base({ clinicHours: { open: false, from: 0, to: 0, breaks: [] } })).reason).toBe("CLINIC_CLOSED");
  });
  it("slot instants are exact UTC ISO strings", () => expect(computeDaySlots(base()).slots[0].startsAt).toBe("2030-03-05T03:30:00.000Z"));
});

describe("state machines", () => {
  it("terminal states can't move", () => { for (const s of ["COMPLETED", "CANCELLED", "NO_SHOW"] as const) expect(APPOINTMENT_TRANSITIONS[s]).toEqual([]); });
  it("every target of every transition is a known status", () => { for (const [, to] of Object.entries(APPOINTMENT_TRANSITIONS)) for (const t of to) expect(APPOINTMENT_STATUSES).toContain(t); });
  it("key transitions", () => {
    expect(canTransition("REQUESTED", "CONFIRMED")).toBe(true);
    expect(canTransition("CONFIRMED", "COMPLETED")).toBe(false);
    expect(canTransition("CANCELLED", "CONFIRMED")).toBe(false);
    expect(canTransition("CONFIRMED", "NO_SHOW")).toBe(true);
    expect(canVisitTransition("WAITING", "IN_CONSULTATION")).toBe(false); // must be called first
    expect(canVisitTransition("CALLED", "IN_CONSULTATION")).toBe(true);
    expect(canVisitTransition("COMPLETED", "WAITING")).toBe(false);
    expect(OPD_STATUSES.length).toBe(7);
  });
  it("cancelled / no-show free the slot, everything else holds it", () => {
    expect(SLOT_HOLDING).not.toContain("CANCELLED"); expect(SLOT_HOLDING).not.toContain("NO_SHOW");
    expect(SLOT_HOLDING).toContain("CONFIRMED"); expect(SLOT_HOLDING).toContain("COMPLETED");
  });
});

describe("queue order and tokens", () => {
  it("emergency, then high priority, then arrival order", () => {
    const q = [{ id: "a", priority: "NORMAL", queueSeq: 1 }, { id: "b", priority: "HIGH", queueSeq: 2 }, { id: "c", priority: "EMERGENCY", queueSeq: 3 }, { id: "d", priority: "NORMAL", queueSeq: 4 }, { id: "e", priority: "EMERGENCY", queueSeq: 5 }];
    expect([...q].sort(compareQueue).map((x) => x.id)).toEqual(["c", "e", "b", "a", "d"]);
  });
  it("token formats", () => {
    expect(formatToken({ format: "NUMERIC", pad: 2, prefix: "", n: 7 })).toBe("07");
    expect(formatToken({ format: "NUMERIC", pad: 3, prefix: "A", n: 7 })).toBe("007");
    expect(formatToken({ format: "PREFIXED", pad: 3, prefix: "A", n: 7 })).toBe("A-007");
    expect(formatToken({ format: "PREFIXED", pad: 2, prefix: "", n: 12 })).toBe("12");
    expect(formatToken({ format: "NUMERIC", pad: 2, prefix: "", n: 123 })).toBe("123");
  });
});
