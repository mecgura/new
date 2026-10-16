import { formatMoney } from "@/lib/billing/money";
export const rupees = (minor: number, currency = "INR") => formatMoney(minor, currency);
/** Dates are shown in the viewer's clinic timezone when given, otherwise India time, always with the zone named. */
export function when(d: string | Date | null | undefined, tz = "Asia/Kolkata", withTime = false) {
  if (!d) return "—"; const x = typeof d === "string" ? new Date(d) : d; if (Number.isNaN(x.getTime())) return "—";
  return new Intl.DateTimeFormat("en-IN", { timeZone: tz, day: "2-digit", month: "short", year: "numeric", ...(withTime ? { hour: "2-digit", minute: "2-digit", hour12: true } : {}) }).format(x);
}
export const STATUS_TONE: Record<string, "success" | "warning" | "danger" | "neutral" | "info" | "primary"> = { ACTIVE: "success", TRIAL: "info", PENDING_PAYMENT: "warning", PAST_DUE: "warning", GRACE: "warning", PAUSED: "neutral", SUSPENDED: "danger", CANCELLED: "neutral", EXPIRED: "neutral", PAID: "success", ISSUED: "info", OVERDUE: "danger", PARTIALLY_PAID: "warning", VOID: "neutral", REFUNDED: "neutral", PARTIALLY_REFUNDED: "neutral", SUCCEEDED: "success", FAILED: "danger", PENDING: "warning", PROCESSED: "success", REQUESTED: "warning", APPROVED: "info", REJECTED: "neutral", DRAFT: "neutral", INACTIVE: "neutral", ARCHIVED: "neutral" };
export const label = (s: string) => s.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
