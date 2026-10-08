import { createHash } from "node:crypto";

export function parseJson<T>(s: string | null | undefined, fallback: T): T {
  try { return s ? (JSON.parse(s) as T) : fallback; } catch { return fallback; }
}
/** Stable-ish content hash stored next to every immutable version; lets anyone verify a snapshot wasn't altered. */
export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export interface RxItemSnap {
  name: string; genericName?: string | null; brandName?: string | null; strength?: string | null; dose?: string | null; route?: string | null; frequency?: string | null;
  morning: boolean; afternoon: boolean; evening: boolean; night: boolean; foodTiming?: string | null; durationDays?: number | null; quantity?: number | null; quantityUnit?: string | null;
  startDate?: string | null; endDate?: string | null; instructions?: string | null;
}
export interface PrescriptionSnapshot {
  number: string; version: number; finalizedAt: string; reason?: string | null;
  doctor: { name: string; qualification: string | null; specialization: string | null; registrationNumber: string | null };
  patient: { code: string; name: string; age: string | null; gender: string | null; phone: string | null };
  consultation: { number: string; date: string };
  diagnoses: { name: string; code?: string | null; type: string }[];
  items: RxItemSnap[];
  advice: string | null;
  followUp: { required: boolean; afterDays: number | null; date: string | null; notes: string | null };
}
