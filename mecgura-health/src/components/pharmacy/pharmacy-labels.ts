import type { Tone } from "@/components/ui";

/** Labels, tones and formatters. Plain module (no React) so server pages and client components can both import it. */
export const LEDGER_LABEL: Record<string, string> = { OPENING: "Opening stock", PURCHASE: "Purchase", DISPENSE: "Dispensed", RETURN: "Return (restocked)", SALE_RETURN: "Patient return (restocked)", PURCHASE_RETURN: "Returned to supplier", ADJUSTMENT_IN: "Adjustment in", ADJUSTMENT_OUT: "Adjustment out", DAMAGE: "Damaged", EXPIRY: "Expired — written off", TRANSFER_IN: "Transfer in", TRANSFER_OUT: "Transfer out", REVERSAL: "Reversal" };
export const BATCH_LABEL: Record<string, string> = { ACTIVE: "Active", LOW_STOCK: "Low stock", EXPIRED: "Expired", BLOCKED: "Blocked", DEPLETED: "Depleted" };
export const BATCH_TONE: Record<string, Tone> = { ACTIVE: "success", LOW_STOCK: "warning", EXPIRED: "danger", BLOCKED: "danger", DEPLETED: "neutral" };
export const STOCK_LABEL: Record<string, string> = { IN_STOCK: "In stock", LOW_STOCK: "Low stock", OUT_OF_STOCK: "Out of stock" };
export const STOCK_TONE: Record<string, Tone> = { IN_STOCK: "success", LOW_STOCK: "warning", OUT_OF_STOCK: "danger" };
export const PURCHASE_LABEL: Record<string, string> = { DRAFT: "Draft", RECEIVED: "Received", COMPLETED: "Completed", CANCELLED: "Cancelled" };
export const PURCHASE_TONE: Record<string, Tone> = { DRAFT: "neutral", RECEIVED: "info", COMPLETED: "success", CANCELLED: "danger" };
export const DISPENSING_LABEL: Record<string, string> = { PENDING: "Pending", PARTIALLY_DISPENSED: "Partly dispensed", DISPENSED: "Dispensed", CANCELLED: "Cancelled" };
export const DISPENSING_TONE: Record<string, Tone> = { PENDING: "warning", PARTIALLY_DISPENSED: "info", DISPENSED: "success", CANCELLED: "danger" };
export const RETURN_LABEL: Record<string, string> = { REQUESTED: "Requested", APPROVED: "Approved", RECEIVED: "Received", RESTOCKED: "Restocked", DISPOSED: "Disposed", REJECTED: "Rejected" };
export const RETURN_TONE: Record<string, Tone> = { REQUESTED: "warning", APPROVED: "info", RECEIVED: "info", RESTOCKED: "success", DISPOSED: "neutral", REJECTED: "danger" };
export const RETURN_TYPE_LABEL: Record<string, string> = { PATIENT_RETURN: "Patient return", PURCHASE_RETURN: "Return to supplier", OTHER: "Other" };
export const REASON_LABEL: Record<string, string> = { PHYSICAL_COUNT_CORRECTION: "Physical count correction", DAMAGE: "Damage", DATA_CORRECTION: "Data correction", OTHER: "Other" };
export const CONDITION_LABEL: Record<string, string> = { SEALED: "Sealed and intact", OPENED: "Opened", DAMAGED: "Damaged", EXPIRED: "Expired" };
export const dayLabel = (d: string | null | undefined) => (d ? new Date(`${d.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }) : "—");
export const stamp = (iso: string | null | undefined) => (iso ? iso.slice(0, 16).replace("T", " ") + " UTC" : "—");
export const daysText = (d: number) => (d < 0 ? `expired ${-d} day${d === -1 ? "" : "s"} ago` : d === 0 ? "expires today" : `${d} day${d === 1 ? "" : "s"} left`);
export const toTone = (d: number, near: number): Tone => (d < 0 ? "danger" : d <= near ? "warning" : "success");
