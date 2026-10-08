import { addDays, zonedToUtc } from "@/lib/scheduling/time";

/** Global analytics date ranges, resolved in the CLINIC'S timezone (never the browser's). Pure + unit-tested. */
export const RANGE_PRESETS = ["today", "yesterday", "last7", "last30", "thisMonth", "lastMonth", "thisQuarter", "thisYear", "custom"] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number];
export const PRESET_LABEL: Record<RangePreset, string> = {
  today: "Today", yesterday: "Yesterday", last7: "Last 7 days", last30: "Last 30 days", thisMonth: "This month", lastMonth: "Last month", thisQuarter: "This quarter", thisYear: "This year", custom: "Custom",
};
export const MAX_RANGE_DAYS = 366;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ms = (d: string) => Date.parse(`${d}T00:00:00Z`);
export const daysInclusive = (from: string, to: string) => Math.round((ms(to) - ms(from)) / 86_400_000) + 1;
const validDate = (d: string) => { if (!DATE.test(d)) return false; const t = ms(d); return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === d; };

export interface Window { from: string; to: string; start: Date; end: Date; days: number }
export interface ResolvedRange extends Window { preset: RangePreset; label: string; timezone: string; previous: Window | null }
export class RangeError_ extends Error {}

const win = (from: string, to: string, tz: string): Window => ({ from, to, start: zonedToUtc(from, 0, tz), end: zonedToUtc(addDays(to, 1), 0, tz), days: daysInclusive(from, to) });

/** from/to are INCLUSIVE local dates; start/end are the matching UTC instants ([start, end)). */
export function resolveRange(input: { preset?: string; from?: string; to?: string; compare?: boolean }, tz: string, today: string): ResolvedRange {
  const preset: RangePreset = (RANGE_PRESETS as readonly string[]).includes(input.preset ?? "") ? (input.preset as RangePreset) : "last30";
  let from: string; let to: string;
  const y = Number(today.slice(0, 4)); const m = Number(today.slice(5, 7));
  switch (preset) {
    case "today": from = to = today; break;
    case "yesterday": from = to = addDays(today, -1); break;
    case "last7": from = addDays(today, -6); to = today; break;
    case "last30": from = addDays(today, -29); to = today; break;
    case "thisMonth": from = `${today.slice(0, 7)}-01`; to = today; break;
    case "lastMonth": { const first = `${today.slice(0, 7)}-01`; to = addDays(first, -1); from = `${to.slice(0, 7)}-01`; break; }
    case "thisQuarter": { const qm = Math.floor((m - 1) / 3) * 3 + 1; from = `${y}-${String(qm).padStart(2, "0")}-01`; to = today; break; }
    case "thisYear": from = `${y}-01-01`; to = today; break;
    default: {
      from = input.from ?? ""; to = input.to ?? "";
      if (!validDate(from) || !validDate(to)) throw new RangeError_("Choose a valid start and end date.");
      if (from > to) throw new RangeError_("The start date is after the end date.");
      if (daysInclusive(from, to) > MAX_RANGE_DAYS) throw new RangeError_("Choose a range of one year or less.");
    }
  }
  const cur = win(from, to, tz);
  const previous = input.compare ? win(addDays(from, -cur.days), addDays(from, -1), tz) : null;
  return { ...cur, preset, label: PRESET_LABEL[preset], timezone: tz, previous };
}

/* ----------------------------------------------------- comparison ----------------------------------------------------- */
export interface Comparison {
  current: number; previous: number; delta: number;
  /** percentage change in TENTHS of a percent (integer maths), null when it would be misleading */
  pctTenths: number | null;
  state: "up" | "down" | "flat" | "na";
  /** why the percentage is not shown */
  reason?: "previous-zero" | "insufficient-history";
}
/** Previous period zero, or the clinic had no history then => "N/A" instead of a misleading percentage. */
export function compareValues(current: number, previous: number, opts: { insufficientHistory?: boolean } = {}): Comparison {
  const delta = current - previous;
  if (opts.insufficientHistory) return { current, previous, delta, pctTenths: null, state: "na", reason: "insufficient-history" };
  if (previous === 0) return { current, previous, delta, pctTenths: null, state: current === 0 ? "flat" : "na", reason: current === 0 ? undefined : "previous-zero" };
  const pctTenths = Math.round((delta * 1000) / Math.abs(previous));
  return { current, previous, delta, pctTenths, state: delta === 0 ? "flat" : delta > 0 ? "up" : "down" };
}
export const formatPct = (tenths: number | null) => (tenths === null ? "N/A" : `${tenths > 0 ? "+" : ""}${(tenths / 10).toFixed(1)}%`);

/** n/d as a percentage with one decimal (integer maths); null when the denominator is zero => callers show "N/A". */
export function rate(n: number, d: number): number | null { return d > 0 ? Math.round((n * 1000) / d) / 10 : null; }
