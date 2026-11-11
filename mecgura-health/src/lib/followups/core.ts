/** Pure follow-up rules: vocabularies, status groups, date helpers. Nothing here makes a medical decision. */
export const FOLLOWUP_TYPES = ["CONSULTATION_FOLLOW_UP", "REPORT_REVIEW", "MEDICATION_REVIEW", "PROCEDURE_FOLLOW_UP", "MISSED_APPOINTMENT", "NO_SHOW", "ROUTINE_RECALL", "MANUAL_FOLLOW_UP", "DOCUMENT_PENDING", "INVESTIGATION_PENDING", "OTHER"] as const;
export type FollowUpType = (typeof FOLLOWUP_TYPES)[number];
/** Types a doctor (clinical access) closes; everything else is operational and reception can complete it. */
export const CLINICAL_TYPES: readonly string[] = ["REPORT_REVIEW", "MEDICATION_REVIEW", "PROCEDURE_FOLLOW_UP"];
export const FOLLOWUP_STATUSES = ["PENDING", "DUE", "IN_PROGRESS", "CONTACTED", "APPOINTMENT_BOOKED", "COMPLETED", "PATIENT_DECLINED", "NO_RESPONSE", "RESCHEDULED", "CANCELLED", "EXPIRED"] as const;
export type FollowUpStatus = (typeof FOLLOWUP_STATUSES)[number];
/** Still needs work. COMPLETED / PATIENT_DECLINED / CANCELLED / EXPIRED are closed. */
export const OPEN_STATUSES: readonly string[] = ["PENDING", "DUE", "IN_PROGRESS", "CONTACTED", "APPOINTMENT_BOOKED", "NO_RESPONSE", "RESCHEDULED"];
export const DONE_STATUSES: readonly string[] = ["COMPLETED", "PATIENT_DECLINED"];
export const CLOSED_OTHER: readonly string[] = ["CANCELLED", "EXPIRED"];
export const PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;
export const SOURCES = ["CONSULTATION", "PRESCRIPTION", "REPORT", "DOCTOR_ORDER", "MANUAL", "RECALL", "NO_SHOW", "CANCELLATION"] as const;
export const CONTACT_METHODS = ["PHONE", "IN_PERSON", "WHATSAPP", "SMS", "EMAIL", "OTHER"] as const;
export const CONTACT_OUTCOMES = ["CONTACTED", "NO_RESPONSE", "CALL_BACK_REQUESTED", "APPOINTMENT_BOOKED", "PATIENT_DECLINED", "WRONG_NUMBER", "MESSAGE_SENT", "OTHER"] as const;
export const COMPLETION_OUTCOMES = ["COMPLETED", "APPOINTMENT_BOOKED", "PATIENT_DECLINED", "NO_RESPONSE", "RESCHEDULED", "NOT_REQUIRED", "OTHER"] as const;
export const RECALL_FREQUENCIES = ["ONE_TIME", "MONTHLY", "QUARTERLY", "HALF_YEARLY", "YEARLY", "CUSTOM"] as const;
export const RECALL_STATUSES = ["ACTIVE", "FOLLOW_UP_CREATED", "COMPLETED", "CANCELLED"] as const;
/** Which patient communication preference governs each contact method (in-person/other have none). */
export const METHOD_PREF: Record<string, "prefPhone" | "prefWhatsapp" | "prefSms" | "prefEmail" | null> = { PHONE: "prefPhone", WHATSAPP: "prefWhatsapp", SMS: "prefSms", EMAIL: "prefEmail", IN_PERSON: null, OTHER: null };
/** A logged contact outcome moves the follow-up only this far; it NEVER completes it, and a manual "appointment booked" note is not a booking. */
export const OUTCOME_STATUS: Record<string, string | null> = { CONTACTED: "CONTACTED", NO_RESPONSE: "NO_RESPONSE", CALL_BACK_REQUESTED: "CONTACTED", MESSAGE_SENT: "CONTACTED", APPOINTMENT_BOOKED: null, PATIENT_DECLINED: null, WRONG_NUMBER: "NO_RESPONSE", OTHER: null };
export const EDITABLE_STATUS_FOR_START: readonly string[] = ["PENDING", "DUE", "NO_RESPONSE", "RESCHEDULED", "CONTACTED"];

export const isOpen = (status: string) => OPEN_STATUSES.includes(status);
export const PRIORITY_RANK: Record<string, number> = { URGENT: 0, HIGH: 1, NORMAL: 2, LOW: 3 };

/** YYYY-MM-DD arithmetic (UTC calendar math on date strings, no time zones involved). */
export function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(d, last));
  return t.toISOString().slice(0, 10);
}
export const FREQUENCY_MONTHS: Record<string, number> = { MONTHLY: 1, QUARTERLY: 3, HALF_YEARLY: 6, YEARLY: 12 };
export function nextRecallDate(date: string, frequency: string, customMonths?: number | null): string | null {
  const months = frequency === "CUSTOM" ? customMonths ?? 0 : FREQUENCY_MONTHS[frequency] ?? 0;
  return months > 0 ? addMonths(date, months) : null;
}
export const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
/** "overdue" is computed from the due date, never stored. */
export function dueBucket(dueDate: string, today: string, status: string): "closed" | "overdue" | "today" | "upcoming" {
  if (!isOpen(status)) return "closed";
  return dueDate < today ? "overdue" : dueDate === today ? "today" : "upcoming";
}
