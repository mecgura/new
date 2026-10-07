import type { Tone } from "@/components/ui";

export const ORDER_STATUS_LABEL: Record<string, string> = {
  ORDERED: "Ordered", CONFIRMED: "Confirmed", SAMPLE_PENDING: "Sample pending", SAMPLE_COLLECTED: "Sample collected", SAMPLE_RECEIVED: "Sample received", PROCESSING: "Processing",
  RESULT_READY: "Result ready", REPORT_GENERATED: "Report generated", DOCTOR_REVIEWED: "Doctor reviewed", CANCELLED: "Cancelled",
};
export const ORDER_STATUS_TONE: Record<string, Tone> = {
  ORDERED: "neutral", CONFIRMED: "neutral", SAMPLE_PENDING: "warning", SAMPLE_COLLECTED: "info", SAMPLE_RECEIVED: "info", PROCESSING: "primary", RESULT_READY: "warning", REPORT_GENERATED: "success", DOCTOR_REVIEWED: "success", CANCELLED: "danger",
};
export const ITEM_STATUS_LABEL: Record<string, string> = { ORDERED: "Waiting for sample", SAMPLE_COLLECTED: "Collected", SAMPLE_RECEIVED: "Received", PROCESSING: "Processing", RESULT_READY: "Result ready", RECOLLECTION_REQUIRED: "Recollection needed", CANCELLED: "Cancelled" };
export const SAMPLE_STATUS_LABEL: Record<string, string> = { COLLECTED: "Collected", RECEIVED: "Received", REJECTED: "Rejected", PROCESSING: "Processing", COMPLETED: "Completed" };
export const SAMPLE_STATUS_TONE: Record<string, Tone> = { COLLECTED: "info", RECEIVED: "info", REJECTED: "danger", PROCESSING: "primary", COMPLETED: "success" };
export const REPORT_STATUS_LABEL: Record<string, string> = { DRAFT: "Sent back for correction", UNDER_REVIEW: "Under review", VERIFIED: "Verified", RELEASED: "Released", AMENDED: "Being amended", CANCELLED: "Cancelled" };
export const PRIORITY_LABEL: Record<string, string> = { NORMAL: "Normal", HIGH: "High", URGENT: "Urgent", STAT: "STAT" };
export const PRIORITY_TONE: Record<string, Tone> = { NORMAL: "neutral", HIGH: "warning", URGENT: "danger", STAT: "emergency" };
export const EVENT_LABEL: Record<string, string> = { COLLECTED: "Collected", RECEIVED: "Received", REJECTED: "Rejected", RECOLLECTION_REQUESTED: "Recollection requested", PROCESSING_STARTED: "Processing started", PROCESSING_COMPLETED: "Processing completed", CREATED: "Created" };
export const FLAG_LABEL: Record<string, string> = { LOW: "Low", HIGH: "High", CRITICAL: "Critical", NORMAL: "Normal", POSITIVE: "Positive", NEGATIVE: "Negative", ABNORMAL: "Abnormal" };
export const FLAG_TONE: Record<string, Tone> = { LOW: "warning", HIGH: "warning", CRITICAL: "danger", NORMAL: "success", POSITIVE: "warning", NEGATIVE: "success", ABNORMAL: "warning" };
export const fmt = (iso: string | null | undefined) => (iso ? iso.slice(0, 16).replace("T", " ") + " UTC" : "—");
