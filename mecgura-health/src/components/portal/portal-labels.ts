import { formatMoney } from "@/lib/billing/money";
import type { Tone } from "@/components/ui";

/** Plain module (no React) — shared by server pages and client components. */
export const money = (minor: number, currency = "INR") => formatMoney(minor, currency);
export const dayLabel = (d: string | null | undefined) => (d ? new Date(`${d.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "—");
export const shortDay = (d: string | null | undefined) => (d ? new Date(`${d.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" }) : "—");
export const APPT_STATUS: Record<string, [string, Tone]> = { REQUESTED: ["Awaiting confirmation", "warning"], CONFIRMED: ["Confirmed", "success"], CHECKED_IN: ["Checked in", "info"], WAITING: ["Waiting", "info"], CALLED: ["Called", "info"], IN_CONSULTATION: ["With the doctor", "info"], COMPLETED: ["Completed", "neutral"], CANCELLED: ["Cancelled", "danger"], NO_SHOW: ["Missed", "danger"], ON_HOLD: ["On hold", "warning"], SKIPPED: ["Skipped", "warning"] };
export const APPT_TYPE: Record<string, string> = { ONLINE_APPOINTMENT: "Online booking", WALK_IN: "Walk-in", FOLLOW_UP: "Follow-up visit", EMERGENCY: "Emergency", OPD: "OPD visit", PROCEDURE: "Procedure", OTHER: "Visit" };
export const OPD_STATUS: Record<string, [string, Tone]> = { WAITING: ["Waiting", "info"], CALLED: ["Called", "success"], IN_CONSULTATION: ["With the doctor", "success"], ON_HOLD: ["On hold", "warning"], COMPLETED: ["Completed", "neutral"], SKIPPED: ["Skipped", "warning"], CANCELLED: ["Cancelled", "danger"] };
export const INVOICE_STATUS: Record<string, [string, Tone]> = { ISSUED: ["Unpaid", "warning"], PARTIALLY_PAID: ["Partly paid", "warning"], PAID: ["Paid", "success"], OVERDUE: ["Overdue", "danger"], CANCELLED: ["Cancelled", "neutral"], REFUNDED: ["Refunded", "neutral"], PARTIALLY_REFUNDED: ["Partly refunded", "info"] };
export const FOLLOWUP_STATUS: Record<string, [string, Tone]> = { UPCOMING: ["Upcoming", "info"], DUE: ["Due now", "warning"], APPOINTMENT_BOOKED: ["Appointment booked", "success"], COMPLETED: ["Completed", "neutral"], RESCHEDULED: ["Rescheduled", "info"] };
export const REQUEST_STATUS: Record<string, [string, Tone]> = { PENDING: ["Waiting for the clinic", "warning"], UNDER_REVIEW: ["Being reviewed", "info"], APPROVED: ["Approved", "success"], REJECTED: ["Not approved", "danger"], CANCELLED: ["Cancelled", "neutral"] };
export const REQUEST_KIND: Record<string, string> = { PROFILE_CORRECTION: "Profile correction", MEDICAL_CORRECTION: "Medical information correction", ACCOUNT_DEACTIVATION: "Account deactivation", SUPPORT: "Message to the clinic" };
export const METHOD: Record<string, string> = { CASH: "Cash", UPI: "UPI", CARD: "Card", BANK_TRANSFER: "Bank transfer", ONLINE: "Online", CHEQUE: "Cheque", OTHER: "Other" };
export const DOC_KIND: Record<string, string> = { prescription: "Prescription", report: "Lab report", invoice: "Bill", receipt: "Receipt" };
export const docHref = (kind: string, id: string) => `/portal/${kind === "prescription" ? "prescriptions" : kind === "report" ? "reports" : kind === "invoice" ? "billing/invoices" : "billing/receipts"}/${id}`;
