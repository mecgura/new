import { rate } from "./range";

/** Rule-based clinic insights. Deterministic thresholds, plain counts, NO AI, NO prediction, NO medical advice. Pure. */
export interface Thresholds { noShowRatePct: number; cancellationRatePct: number; avgWaitingMinutes: number; overdueFollowUps: number; labTurnaroundHours: number; overdueInvoices: number; failedCommunicationPct: number; expiringBatches: number; minSample: number }
export const DEFAULT_THRESHOLDS: Thresholds = { noShowRatePct: 15, cancellationRatePct: 25, avgWaitingMinutes: 30, overdueFollowUps: 5, labTurnaroundHours: 48, overdueInvoices: 5, failedCommunicationPct: 10, expiringBatches: 1, minSample: 10 };
export const THRESHOLD_META: Record<keyof Thresholds, { label: string; min: number; max: number; unit: string }> = {
  noShowRatePct: { label: "No-show rate", min: 1, max: 100, unit: "%" }, cancellationRatePct: { label: "Cancellation rate", min: 1, max: 100, unit: "%" },
  avgWaitingMinutes: { label: "Average waiting time", min: 5, max: 600, unit: "min" }, overdueFollowUps: { label: "Overdue follow-ups", min: 1, max: 10000, unit: "" },
  labTurnaroundHours: { label: "Lab turnaround", min: 1, max: 720, unit: "hours" }, overdueInvoices: { label: "Overdue invoices", min: 1, max: 10000, unit: "" },
  failedCommunicationPct: { label: "Failed messages", min: 1, max: 100, unit: "%" }, expiringBatches: { label: "Expiring batches", min: 1, max: 10000, unit: "" },
  minSample: { label: "Minimum sample size for rate rules", min: 1, max: 1000, unit: "" },
};
export function parseThresholds(json: string | null | undefined): Thresholds {
  let raw: Record<string, unknown> = {}; try { raw = json ? JSON.parse(json) : {}; } catch { raw = {}; }
  const out = { ...DEFAULT_THRESHOLDS };
  for (const k of Object.keys(DEFAULT_THRESHOLDS) as (keyof Thresholds)[]) { const v = raw[k]; const m = THRESHOLD_META[k]; if (typeof v === "number" && Number.isInteger(v) && v >= m.min && v <= m.max) out[k] = v; }
  return out;
}

export interface InsightInput {
  appointments?: { total: number; noShow: number; cancelled: number; due: number };
  waiting?: { avgMin: number | null; samples: number };
  followUps?: { overdue: number };
  lab?: { avgHours: number | null; samples: number };
  billing?: { overdueInvoices: number };
  pharmacy?: { belowReorder: number; outOfStock: number; expiringBatches: number; expiredBatches: number };
  communication?: { total: number; failed: number };
}
export interface Insight { key: string; severity: "info" | "attention" | "critical"; title: string; detail: string; value: number; threshold: number; domain: "operations" | "lab" | "financial" | "pharmacy" | "communication"; href: string }

export function evaluateInsights(i: InsightInput, t: Thresholds): Insight[] {
  const out: Insight[] = [];
  if (i.appointments) {
    const r = rate(i.appointments.noShow, i.appointments.due);
    if (r !== null && i.appointments.due >= t.minSample && r >= t.noShowRatePct) out.push({ key: "no-show-rate", severity: r >= t.noShowRatePct * 2 ? "critical" : "attention", domain: "operations", title: "No-show rate is above your threshold", detail: `${i.appointments.noShow} of ${i.appointments.due} due appointments were no-shows (${r}%). Your threshold is ${t.noShowRatePct}%.`, value: r, threshold: t.noShowRatePct, href: "/analytics/reports/appointments?status=NO_SHOW" });
    const c = rate(i.appointments.cancelled, i.appointments.total);
    if (c !== null && i.appointments.total >= t.minSample && c >= t.cancellationRatePct) out.push({ key: "cancellation-rate", severity: "attention", domain: "operations", title: "Cancellation rate is above your threshold", detail: `${i.appointments.cancelled} of ${i.appointments.total} appointments were cancelled (${c}%). Your threshold is ${t.cancellationRatePct}%.`, value: c, threshold: t.cancellationRatePct, href: "/analytics/reports/appointments?status=CANCELLED" });
  }
  if (i.waiting && i.waiting.avgMin !== null && i.waiting.samples >= Math.min(t.minSample, 5) && i.waiting.avgMin >= t.avgWaitingMinutes)
    out.push({ key: "waiting-time", severity: "attention", domain: "operations", title: "Average waiting time is above your threshold", detail: `Average wait was ${i.waiting.avgMin} min across ${i.waiting.samples} visits. Your threshold is ${t.avgWaitingMinutes} min.`, value: i.waiting.avgMin, threshold: t.avgWaitingMinutes, href: "/analytics/opd" });
  if (i.followUps && i.followUps.overdue >= t.overdueFollowUps) out.push({ key: "overdue-followups", severity: i.followUps.overdue >= t.overdueFollowUps * 3 ? "critical" : "attention", domain: "operations", title: "Follow-ups are overdue", detail: `${i.followUps.overdue} open follow-ups are past their due date. Your threshold is ${t.overdueFollowUps}.`, value: i.followUps.overdue, threshold: t.overdueFollowUps, href: "/followups" });
  if (i.lab && i.lab.avgHours !== null && i.lab.samples >= Math.min(t.minSample, 3) && i.lab.avgHours >= t.labTurnaroundHours)
    out.push({ key: "lab-turnaround", severity: "attention", domain: "lab", title: "Average lab turnaround is above your threshold", detail: `Average turnaround was ${i.lab.avgHours} h across ${i.lab.samples} released reports. Your threshold is ${t.labTurnaroundHours} h.`, value: i.lab.avgHours, threshold: t.labTurnaroundHours, href: "/analytics/lab" });
  if (i.billing && i.billing.overdueInvoices >= t.overdueInvoices) out.push({ key: "overdue-invoices", severity: "attention", domain: "financial", title: "Invoices are overdue", detail: `${i.billing.overdueInvoices} invoices are past their due date. Your threshold is ${t.overdueInvoices}.`, value: i.billing.overdueInvoices, threshold: t.overdueInvoices, href: "/billing/outstanding" });
  if (i.pharmacy) {
    if (i.pharmacy.outOfStock > 0) out.push({ key: "out-of-stock", severity: "critical", domain: "pharmacy", title: "Medicines are out of stock", detail: `${i.pharmacy.outOfStock} active medicines have no sellable stock.`, value: i.pharmacy.outOfStock, threshold: 1, href: "/analytics/pharmacy" });
    if (i.pharmacy.belowReorder > 0) out.push({ key: "below-reorder", severity: "attention", domain: "pharmacy", title: "Medicines are below their reorder level", detail: `${i.pharmacy.belowReorder} medicines are at or below their reorder level.`, value: i.pharmacy.belowReorder, threshold: 1, href: "/analytics/pharmacy" });
    if (i.pharmacy.expiringBatches >= t.expiringBatches) out.push({ key: "expiring-batches", severity: "attention", domain: "pharmacy", title: "Batches are near expiry", detail: `${i.pharmacy.expiringBatches} stocked batches expire inside the clinic's near-expiry window.`, value: i.pharmacy.expiringBatches, threshold: t.expiringBatches, href: "/analytics/reports/pharmacy-expiry" });
    if (i.pharmacy.expiredBatches > 0) out.push({ key: "expired-batches", severity: "critical", domain: "pharmacy", title: "Expired batches still hold stock", detail: `${i.pharmacy.expiredBatches} expired batches still show a stock balance.`, value: i.pharmacy.expiredBatches, threshold: 1, href: "/analytics/reports/pharmacy-expiry" });
  }
  if (i.communication) {
    const f = rate(i.communication.failed, i.communication.total);
    if (f !== null && i.communication.total >= t.minSample && f >= t.failedCommunicationPct) out.push({ key: "failed-messages", severity: "attention", domain: "communication", title: "Message failures are above your threshold", detail: `${i.communication.failed} of ${i.communication.total} messages failed (${f}%). Your threshold is ${t.failedCommunicationPct}%.`, value: f, threshold: t.failedCommunicationPct, href: "/analytics/communication" });
  }
  const rank = { critical: 0, attention: 1, info: 2 } as const;
  return out.sort((a, b) => rank[a.severity] - rank[b.severity] || a.key.localeCompare(b.key));
}
