/** Pure laboratory rules: statuses, reference-range selection, flags. No medical interpretation lives here. */
export const ORDER_STATUSES = ["ORDERED", "CONFIRMED", "SAMPLE_PENDING", "SAMPLE_COLLECTED", "SAMPLE_RECEIVED", "PROCESSING", "RESULT_READY", "REPORT_GENERATED", "DOCTOR_REVIEWED", "CANCELLED"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];
export const PRIORITIES = ["NORMAL", "HIGH", "URGENT", "STAT"] as const;
export const PRIORITY_RANK: Record<string, number> = { STAT: 0, URGENT: 1, HIGH: 2, NORMAL: 3 };
export const RESULT_TYPES = ["NUMERIC", "TEXT", "QUALITATIVE"] as const;
export const FLAGS = ["LOW", "HIGH", "NORMAL", "CRITICAL", "POSITIVE", "NEGATIVE", "ABNORMAL"] as const;
export const CONFIG_KINDS = ["CATEGORY", "SAMPLE_TYPE", "DEPARTMENT", "REJECTION_REASON"] as const;
/** Starting lists offered to a new clinic. They are only suggestions: every list is editable, nothing depends on these names. */
export const SUGGESTED_CONFIG: Record<(typeof CONFIG_KINDS)[number], string[]> = {
  CATEGORY: ["Pathology", "Radiology", "Cardiology", "Microbiology", "Biochemistry", "Hematology", "Urine", "Stool", "Other"],
  SAMPLE_TYPE: ["Blood", "Urine", "Stool", "Saliva", "Swab", "Sputum", "Serum", "Plasma", "Other"],
  DEPARTMENT: [],
  REJECTION_REASON: ["Insufficient sample", "Incorrect container", "Improper labeling", "Damaged sample", "Contaminated sample", "Delayed sample", "Other"],
};

export interface RangeRule { gender?: string | null; minAgeYears?: number | null; maxAgeYears?: number | null; low?: number | null; high?: number | null; criticalLow?: number | null; criticalHigh?: number | null; text?: string | null }
export interface ParamSnap { name: string; resultType: string; unit?: string | null; options?: { value: string; flag?: string | null }[]; ranges?: RangeRule[] }
export interface TestSnap { code: string; name: string; shortName?: string | null; category: string; sampleType?: string | null; department?: string | null; preparation?: string | null; turnaroundHours?: number | null; parameters: ParamSnap[] }

/** The configured rule for this patient (gender + age), if any. Most specific match wins; no match = no range (never invented). */
export function pickRange(ranges: RangeRule[] | undefined, gender: string | null | undefined, ageYears: number | null | undefined): RangeRule | null {
  const list = ranges ?? [];
  const fits = (r: RangeRule) => (!r.gender || r.gender === gender) && (r.minAgeYears == null || (ageYears != null && ageYears >= r.minAgeYears)) && (r.maxAgeYears == null || (ageYears != null && ageYears <= r.maxAgeYears));
  const score = (r: RangeRule) => (r.gender ? 1 : 0) + (r.minAgeYears != null ? 1 : 0) + (r.maxAgeYears != null ? 1 : 0);
  return list.filter(fits).sort((a, b) => score(b) - score(a))[0] ?? null;
}
export const rangeText = (r: RangeRule | null, unit?: string | null): string | null => {
  if (!r) return null;
  if (r.text) return r.text;
  if (r.low != null && r.high != null) return `${r.low} – ${r.high}${unit ? ` ${unit}` : ""}`;
  if (r.low != null) return `≥ ${r.low}${unit ? ` ${unit}` : ""}`;
  if (r.high != null) return `≤ ${r.high}${unit ? ` ${unit}` : ""}`;
  return null;
};
/** Flag ONLY from configured data: numeric vs the configured limits, or the configured qualitative option flag. Otherwise null. */
export function computeFlag(p: ParamSnap, value: string, numeric: number | null, range: RangeRule | null): string | null {
  if (p.resultType === "QUALITATIVE") return p.options?.find((o) => o.value.toLowerCase() === value.trim().toLowerCase())?.flag ?? null;
  if (p.resultType !== "NUMERIC" || numeric == null || !range) return null;
  if (range.criticalLow != null && numeric < range.criticalLow) return "CRITICAL";
  if (range.criticalHigh != null && numeric > range.criticalHigh) return "CRITICAL";
  if (range.low != null && numeric < range.low) return "LOW";
  if (range.high != null && numeric > range.high) return "HIGH";
  return range.low != null || range.high != null ? "NORMAL" : null;
}
export const NO_RANGE = "Reference range not configured.";

/** Order status is derived from the items/report after every action, so it can never contradict them. */
export function deriveOrderStatus(o: { status: string; confirmed: boolean }, items: { status: string; resultStatus: string }[], report: { status: string } | null, reviewed: boolean): OrderStatus {
  if (o.status === "CANCELLED") return "CANCELLED";
  const live = items.filter((i) => i.status !== "CANCELLED");
  if (report && report.status !== "CANCELLED" && report.status !== "DRAFT" && reviewed) return "DOCTOR_REVIEWED";
  if (report && report.status !== "CANCELLED" && report.status !== "DRAFT") return "REPORT_GENERATED";
  if (live.length && live.every((i) => i.status === "RESULT_READY")) return "RESULT_READY";
  if (live.some((i) => i.status === "PROCESSING" || i.status === "RESULT_READY" || i.resultStatus === "DRAFT")) return "PROCESSING";
  if (live.length && live.every((i) => i.status === "SAMPLE_RECEIVED")) return "SAMPLE_RECEIVED";
  if (live.some((i) => i.status === "SAMPLE_RECEIVED")) return "SAMPLE_RECEIVED";
  if (live.some((i) => i.status === "SAMPLE_COLLECTED")) return "SAMPLE_COLLECTED";
  return o.confirmed ? "SAMPLE_PENDING" : "ORDERED";
}
