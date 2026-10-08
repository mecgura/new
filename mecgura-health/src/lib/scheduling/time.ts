/**
 * Clinic-timezone arithmetic without dependencies. Appointments are stored as UTC instants; every "day", "weekday"
 * and "HH:MM" the product shows or reasons about is the CLINIC's local time (Tenant.timezone) — never the server's.
 * DST is handled by asking Intl for the zone's real offset at the instant concerned.
 */
const dtfCache = new Map<string, Intl.DateTimeFormat>();
function dtf(tz: string) {
  let f = dtfCache.get(tz);
  if (!f) { f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }); dtfCache.set(tz, f); }
  return f;
}

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export function isValidDate(d: string): boolean {
  if (!DATE_RE.test(d)) return false;
  const t = new Date(`${d}T00:00:00Z`);
  return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === d;
}
export function isValidTimezone(tz: string): boolean {
  try { dtf(tz); return true; } catch { return false; }
}

/** Offset (minutes east of UTC) of `tz` at the instant `date`. */
export function tzOffsetMinutes(date: Date, tz: string): number {
  const p: Record<string, string> = {};
  for (const part of dtf(tz).formatToParts(date)) p[part.type] = part.value;
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
}

/** Clinic-local calendar day + minutes-after-midnight -> UTC instant. (Non-existent DST-gap times shift forward.) */
export function zonedToUtc(date: string, minutes: number, tz: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const naive = Date.UTC(y, m - 1, d, 0, minutes);
  let guess = naive - tzOffsetMinutes(new Date(naive), tz) * 60000;
  guess = naive - tzOffsetMinutes(new Date(guess), tz) * 60000; // second pass settles DST edges
  return new Date(guess);
}

export interface Zoned { date: string; minutes: number; weekday: number }
/** UTC instant -> clinic-local day, minutes after midnight and weekday (0 = Sunday). */
export function utcToZoned(instant: Date, tz: string): Zoned {
  const p: Record<string, string> = {};
  for (const part of dtf(tz).formatToParts(instant)) p[part.type] = part.value;
  const date = `${p.year}-${p.month}-${p.day}`;
  return { date, minutes: (+p.hour % 24) * 60 + +p.minute, weekday: new Date(`${date}T00:00:00Z`).getUTCDay() };
}

export const todayIn = (tz: string, now = new Date()) => utcToZoned(now, tz).date;
export function addDays(date: string, n: number): string {
  const t = new Date(`${date}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10);
}
export const weekdayOf = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();

/** [start, end) UTC range of a clinic-local day. */
export function dayRangeUtc(date: string, tz: string): { start: Date; end: Date } {
  return { start: zonedToUtc(date, 0, tz), end: zonedToUtc(addDays(date, 1), 0, tz) };
}

export const hhmm = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
export const parseHhmm = (s: string) => { const [h, m] = s.split(":").map(Number); return h * 60 + m; };

/** Formats an instant in the clinic's timezone. */
export function formatInTz(instant: Date, tz: string, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }): string {
  return new Intl.DateTimeFormat("en-IN", { timeZone: tz, ...opts }).format(instant);
}
export const timeInTz = (instant: Date, tz: string) => formatInTz(instant, tz, { hour: "2-digit", minute: "2-digit", hour12: false });
export const dateInTz = (instant: Date, tz: string) => formatInTz(instant, tz, { weekday: "short", day: "numeric", month: "short", year: "numeric" });

/** weekday index (0 = Sunday) -> key used by the website's opening-hours document */
export const DAYS_KEYS_BY_WEEKDAY = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;
