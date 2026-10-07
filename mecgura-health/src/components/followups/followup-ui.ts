import type { Tone } from "@/components/ui";

export const STATUS_LABEL: Record<string, string> = { PENDING: "Pending", DUE: "Due", IN_PROGRESS: "In progress", CONTACTED: "Contacted", APPOINTMENT_BOOKED: "Appointment booked", COMPLETED: "Completed", PATIENT_DECLINED: "Patient declined", NO_RESPONSE: "No response", RESCHEDULED: "Rescheduled", CANCELLED: "Cancelled", EXPIRED: "Expired" };
export const STATUS_TONE: Record<string, Tone> = { PENDING: "neutral", DUE: "warning", IN_PROGRESS: "info", CONTACTED: "info", APPOINTMENT_BOOKED: "primary", COMPLETED: "success", PATIENT_DECLINED: "neutral", NO_RESPONSE: "warning", RESCHEDULED: "neutral", CANCELLED: "danger", EXPIRED: "neutral" };
export const TYPE_LABEL: Record<string, string> = { CONSULTATION_FOLLOW_UP: "Consultation follow-up", REPORT_REVIEW: "Report review", MEDICATION_REVIEW: "Medication review", PROCEDURE_FOLLOW_UP: "Procedure follow-up", MISSED_APPOINTMENT: "Missed appointment", NO_SHOW: "No-show", ROUTINE_RECALL: "Routine recall", MANUAL_FOLLOW_UP: "Manual follow-up", DOCUMENT_PENDING: "Document pending", INVESTIGATION_PENDING: "Investigation pending", OTHER: "Other" };
export const PRIORITY_LABEL: Record<string, string> = { LOW: "Low", NORMAL: "Normal", HIGH: "High", URGENT: "Urgent" };
export const PRIORITY_TONE: Record<string, Tone> = { LOW: "neutral", NORMAL: "info", HIGH: "warning", URGENT: "danger" };
export const SOURCE_LABEL: Record<string, string> = { CONSULTATION: "Consultation", PRESCRIPTION: "Prescription", REPORT: "Lab report", DOCTOR_ORDER: "Doctor order", MANUAL: "Manual", RECALL: "Recall", NO_SHOW: "No-show", CANCELLATION: "Cancellation" };
export const METHOD_LABEL: Record<string, string> = { PHONE: "Phone", IN_PERSON: "In person", WHATSAPP: "WhatsApp", SMS: "SMS", EMAIL: "Email", OTHER: "Other" };
export const FREQ_LABEL: Record<string, string> = { ONE_TIME: "One time", MONTHLY: "Monthly", QUARTERLY: "Quarterly", HALF_YEARLY: "Half-yearly", YEARLY: "Yearly", CUSTOM: "Custom" };
export const EVENT_LABEL: Record<string, string> = { CREATED: "Created", EDITED: "Updated", ASSIGNED: "Assigned", REASSIGNED: "Reassigned", STARTED: "Started", CONTACTED: "Patient contacted", RESCHEDULED: "Rescheduled", APPOINTMENT_BOOKED: "Appointment booked", APPOINTMENT_RELEASED: "Appointment released", COMPLETED: "Completed", CANCELLED: "Cancelled" };
export const pretty = (code: string) => (code ? code[0] + code.slice(1).toLowerCase().replace(/_/g, " ") : "");
export const dateLabel = (d: string | null | undefined) => (d ? new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }) : "—");
export const when = (iso: string | null | undefined) => (iso ? iso.slice(0, 16).replace("T", " ") + " UTC" : "—");
export const dueText = (dueDate: string, overdueDays: number) => (overdueDays > 0 ? `${dateLabel(dueDate)} · ${overdueDays} day${overdueDays === 1 ? "" : "s"} overdue` : dateLabel(dueDate));
