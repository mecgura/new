/** Small pure statistics helpers. Durations are never negative; missing data stays missing (null), never zero. */
export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b); const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}
export function average(values: number[]): number | null { return values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null; }
export function minutesBetween(a: Date | null | undefined, b: Date | null | undefined): number | null {
  if (!a || !b) return null; const d = (b.getTime() - a.getTime()) / 60000; return d < 0 ? null : Math.round(d);
}
export interface DurationStats { samples: number; averageMin: number | null; medianMin: number | null; maxMin: number | null; available: boolean }
export function durationStats(values: (number | null)[]): DurationStats {
  const v = values.filter((x): x is number => x !== null && x >= 0);
  return { samples: v.length, averageMin: average(v), medianMin: median(v), maxMin: v.length ? Math.max(...v) : null, available: v.length > 0 };
}

export const AGE_GROUPS = ["0–12", "13–18", "19–30", "31–45", "46–60", "61–75", "76+"] as const;
export function ageGroup(age: number | null): (typeof AGE_GROUPS)[number] | null {
  if (age === null || age < 0 || age > 130) return null;
  return age <= 12 ? "0–12" : age <= 18 ? "13–18" : age <= 30 ? "19–30" : age <= 45 ? "31–45" : age <= 60 ? "46–60" : age <= 75 ? "61–75" : "76+";
}
/** Age on `onDate` (YYYY-MM-DD) from a date of birth, else the stored age. */
export function ageOf(p: { dateOfBirth?: Date | null; ageYears?: number | null }, onDate: string): number | null {
  if (p.dateOfBirth) {
    const b = p.dateOfBirth; let a = Number(onDate.slice(0, 4)) - b.getUTCFullYear();
    const m = Number(onDate.slice(5, 7)) - (b.getUTCMonth() + 1); const d = Number(onDate.slice(8, 10)) - b.getUTCDate();
    if (m < 0 || (m === 0 && d < 0)) a -= 1; return a;
  }
  return typeof p.ageYears === "number" ? p.ageYears : null;
}

export interface Slice { key: string; label: string; count: number }
export function tally<T>(rows: T[], keyOf: (r: T) => string | null | undefined, opts: { missing?: string; labels?: Record<string, string>; order?: readonly string[]; top?: number } = {}): Slice[] {
  const m = new Map<string, number>();
  for (const r of rows) { const k = keyOf(r)?.trim() || opts.missing || "Not recorded"; m.set(k, (m.get(k) ?? 0) + 1); }
  let out = [...m.entries()].map(([key, count]) => ({ key, label: opts.labels?.[key] ?? key, count }));
  const idx = (k: string) => { const i = opts.order?.indexOf(k) ?? -1; return i < 0 ? 999 : i; };
  out = out.sort((a, b) => (opts.order ? idx(a.key) - idx(b.key) : 0) || b.count - a.count || a.label.localeCompare(b.label));
  return opts.top ? out.slice(0, opts.top) : out;
}
export const titleCase = (s: string) => s.toLowerCase().replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

/** Zero-filled per-day series between two local dates (inclusive). */
export function dailySeries(from: string, to: string, counts: Map<string, number>): { date: string; value: number }[] {
  const out: { date: string; value: number }[] = []; const end = Date.parse(`${to}T00:00:00Z`);
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= end; t += 86_400_000) { const d = new Date(t).toISOString().slice(0, 10); out.push({ date: d, value: counts.get(d) ?? 0 }); }
  return out;
}
/** integer rounded division for minor units */
export const divRound = (n: number, d: number) => (d > 0 ? Math.floor((2 * n + d) / (2 * d)) : 0);
