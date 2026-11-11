import "server-only";
import { z } from "zod";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";
import type { RequestContext, TenantRequestContext } from "@/lib/auth/context";
import { db as rawDb } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { DEFAULT_THRESHOLDS, THRESHOLD_META, evaluateInsights, parseThresholds, type InsightInput, type Thresholds } from "@/lib/analytics/insights";
import type { Comparison } from "@/lib/analytics/range";
import { rate } from "@/lib/analytics/range";
import { clearAnalyticsCache, db, runDomain, canDomain } from "./analytics-core";
import { appointmentAnalytics, followUpAnalytics, opdAnalytics, patientAnalytics } from "./analytics-people";
import { clinicalAnalytics, labAnalytics } from "./analytics-clinical";
import { billingAnalytics, communicationAnalytics, pharmacyAnalytics } from "./analytics-business";

/* ------------------------------------------------------------- settings ------------------------------------------------------------- */
export async function loadThresholds(ctx: TenantRequestContext): Promise<Thresholds> {
  const row = await db(ctx).analyticsSettings.findFirst({ where: {}, select: { thresholds: true } });
  return parseThresholds(row?.thresholds);
}
export async function getAnalyticsSettings(ctx: TenantRequestContext) {
  if (!ctx.permissions.has("analytics.view")) throw new AppError("FORBIDDEN");
  return { thresholds: await loadThresholds(ctx), defaults: DEFAULT_THRESHOLDS, meta: THRESHOLD_META, canConfigure: ctx.permissions.has("analytics.configure") };
}
const thresholdSchema = z.object(Object.fromEntries((Object.keys(DEFAULT_THRESHOLDS) as (keyof Thresholds)[]).map((k) => [k, z.number().int().min(THRESHOLD_META[k].min).max(THRESHOLD_META[k].max)])) as Record<keyof Thresholds, z.ZodNumber>).partial().strict();
export async function updateAnalyticsSettings(ctx: TenantRequestContext, raw: unknown) {
  if (!ctx.permissions.has("analytics.configure")) throw new AppError("FORBIDDEN", { message: "Only clinic admins can change insight thresholds." });
  const p = thresholdSchema.safeParse(raw);
  if (!p.success) throw new AppError("VALIDATION_ERROR", { message: "One of the thresholds is out of range.", fieldErrors: Object.fromEntries(p.error.issues.map((i) => [String(i.path[0] ?? "thresholds"), "Out of range."])) });
  const next = { ...(await loadThresholds(ctx)), ...p.data };
  await db(ctx).analyticsSettings.upsert({ where: { tenantId: ctx.tenantId }, update: { thresholds: JSON.stringify(next), updatedById: ctx.user.id }, create: { tenantId: ctx.tenantId, thresholds: JSON.stringify(next), updatedById: ctx.user.id } });
  clearAnalyticsCache(ctx.tenantId);
  await recordAudit({ action: AUDIT_ACTIONS.ANALYTICS_CONFIG_CHANGED, tenantId: ctx.tenantId, actorId: ctx.user.id, entityType: "analytics_settings", entityId: ctx.tenantId, metadata: { fields: Object.keys(p.data) } });
  return { saved: true, thresholds: next };
}

/* ---------------------------------------------------------- command center ---------------------------------------------------------- */
export interface Kpi { key: string; label: string; value: number | null; format: "count" | "money" | "minutes" | "percent"; comparison?: Comparison | null; note?: string; href?: string; unavailable?: string; snapshot?: boolean }
const kpi = (k: Kpi): Kpi => k;

/** KPIs the viewer is allowed to see. Each section is only built (and only queried) when the viewer holds its permission. */
export function commandCenter(ctx: TenantRequestContext, raw: unknown) {
  return runDomain(ctx, raw, "command-center", [], async () => {
    const has = (d: Parameters<typeof canDomain>[1]) => canDomain(ctx, d);
    const [pat, appt, opd, fu, cons, lab, bill, pharm] = await Promise.all([
      has("patients") ? patientAnalytics(ctx, raw, true) : null, has("operations") ? appointmentAnalytics(ctx, raw) : null, has("operations") ? opdAnalytics(ctx, raw) : null,
      has("operations") ? followUpAnalytics(ctx, raw) : null, has("clinical") ? clinicalAnalytics(ctx, raw, true) : null, has("lab") ? labAnalytics(ctx, raw, true) : null,
      has("financial") ? billingAnalytics(ctx, raw, true) : null, has("pharmacy") ? pharmacyAnalytics(ctx, raw) : null,
    ]);
    const kpis: Kpi[] = []; let currency: string | null = null;
    if (pat) kpis.push(kpi({ key: "patients", label: "Total patients", value: pat.totals.patients, format: "count", snapshot: true, note: pat.basis, href: "/patients" }), kpi({ key: "newPatients", label: "New patients", value: pat.totals.newPatients, format: "count", comparison: pat.totals.newComparison, href: "/analytics/patients" }));
    if (appt) kpis.push(
      kpi({ key: "appointments", label: "Appointments", value: appt.totals.total, format: "count", comparison: appt.comparison?.total, href: "/analytics/appointments" }),
      kpi({ key: "cancelled", label: "Cancelled", value: appt.totals.cancelled, format: "count", comparison: appt.comparison?.cancelled, href: appt.drill.cancelled }),
      kpi({ key: "noShows", label: "No-shows", value: appt.totals.noShow, format: "count", comparison: appt.comparison?.noShow, href: appt.drill.noShow }));
    if (opd) kpis.push(kpi({ key: "completedVisits", label: "Completed visits", value: opd.totals.completed, format: "count", comparison: opd.comparison?.completed, href: "/analytics/opd" }),
      kpi({ key: "avgWaiting", label: "Average waiting time", value: opd.waiting.averageMin, format: "minutes", unavailable: opd.waiting.available ? undefined : "Data unavailable", href: "/analytics/opd" }),
      kpi({ key: "avgConsult", label: "Average consultation time", value: opd.consultation.averageMin, format: "minutes", unavailable: opd.consultation.available ? undefined : "Data unavailable", href: "/analytics/opd" }));
    if (fu) kpis.push(kpi({ key: "followUpsDue", label: "Follow-ups due", value: fu.backlog.overdue + fu.backlog.dueToday, format: "count", snapshot: true, note: `${fu.backlog.overdue} overdue · ${fu.backlog.dueToday} due today`, href: "/followups" }));
    if (lab) kpis.push(kpi({ key: "pendingLab", label: "Pending lab reports", value: lab.totals.pending, format: "count", snapshot: true, href: "/analytics/lab" }));
    if (pharm) kpis.push(kpi({ key: "lowStock", label: "Low or out of stock", value: pharm.stock.lowStock + pharm.stock.outOfStock, format: "count", snapshot: true, note: `${pharm.stock.outOfStock} out of stock`, href: "/analytics/pharmacy" }));
    if (bill) { currency = bill.currency; kpis.push(
      kpi({ key: "revenue", label: "Revenue (billed)", value: bill.totals.netBilledMinor, format: "money", comparison: bill.comparison?.netBilled, note: "Net of discounts, including tax. Not profit.", href: "/analytics/billing" }),
      kpi({ key: "collected", label: "Collected", value: bill.totals.collectedMinor, format: "money", comparison: bill.comparison?.collected, href: "/analytics/billing" }),
      kpi({ key: "outstanding", label: "Outstanding", value: bill.outstandingNow.totalMinor, format: "money", snapshot: true, note: `${bill.outstandingNow.overdueInvoices} overdue invoices`, href: "/billing/outstanding" })); }
    const critical = await db(ctx).notification.count({ where: { userId: ctx.user.id, priority: "CRITICAL", readAt: null, archivedAt: null } });
    kpis.push(kpi({ key: "critical", label: "Critical alerts", value: critical, format: "count", snapshot: true, note: "Unread critical notifications for you", href: "/notifications" }));
    return { kpis, currency, sections: { patients: !!pat, operations: !!appt, clinical: !!cons, lab: !!lab, financial: !!bill, pharmacy: !!pharm, communication: has("communication") } };
  }, { audit: false, extraKey: ctx.user.id }); // contains the viewer's own unread-alert count, so it must never be shared between users
}

/* ------------------------------------------------------------- insights ------------------------------------------------------------- */
export function clinicInsights(ctx: TenantRequestContext, raw: unknown) {
  return runDomain(ctx, raw, "insights", [], async () => {
    const th = await loadThresholds(ctx); const has = (d: Parameters<typeof canDomain>[1]) => canDomain(ctx, d);
    const [appt, opd, fu, lab, bill, pharm, comm] = await Promise.all([
      has("operations") ? appointmentAnalytics(ctx, raw) : null, has("operations") ? opdAnalytics(ctx, raw) : null, has("operations") ? followUpAnalytics(ctx, raw) : null,
      has("lab") ? labAnalytics(ctx, raw, true) : null, has("financial") ? billingAnalytics(ctx, raw, true) : null, has("pharmacy") ? pharmacyAnalytics(ctx, raw) : null, has("communication") ? communicationAnalytics(ctx, raw) : null,
    ]);
    const input: InsightInput = {
      appointments: appt ? { total: appt.totals.total, noShow: appt.totals.noShow, cancelled: appt.totals.cancelled, due: appt.totals.due } : undefined,
      waiting: opd ? { avgMin: opd.waiting.averageMin, samples: opd.waiting.samples } : undefined, followUps: fu ? { overdue: fu.backlog.overdue } : undefined,
      lab: lab ? { avgHours: lab.turnaround.orderedToReleased.averageHours, samples: lab.turnaround.orderedToReleased.samples } : undefined,
      billing: bill ? { overdueInvoices: bill.outstandingNow.overdueInvoices } : undefined,
      pharmacy: pharm ? { belowReorder: pharm.stock.lowStock, outOfStock: pharm.stock.outOfStock, expiringBatches: pharm.stock.nearExpiryBatches, expiredBatches: pharm.stock.expiredBatchesWithStock } : undefined,
      communication: comm ? { total: comm.totals.messages, failed: comm.totals.failed } : undefined,
    };
    return { insights: evaluateInsights(input, th), thresholds: th, evaluated: Object.entries(input).filter(([, v]) => v).map(([k]) => k), method: "Fixed rules compared with your thresholds. No AI, no prediction, no medical advice." };
  }, { audit: false });
}

/* ------------------------------------------------------------ scorecard ------------------------------------------------------------ */
export interface ScoreItem { key: string; group: string; label: string; value: number | null; unit: "percent" | "minutes" | "hours" | "count"; definition: string; unavailable?: string; sample?: string }
/** Individual metrics with their own definitions. Deliberately NO combined or arbitrary overall score. */
export function operationsScorecard(ctx: TenantRequestContext, raw: unknown) {
  return runDomain(ctx, raw, "scorecard", [], async () => {
    const has = (d: Parameters<typeof canDomain>[1]) => canDomain(ctx, d);
    const [appt, opd, fu, lab, bill, pharm, comm] = await Promise.all([
      has("operations") ? appointmentAnalytics(ctx, raw) : null, has("operations") ? opdAnalytics(ctx, raw) : null, has("operations") ? followUpAnalytics(ctx, raw) : null,
      has("lab") ? labAnalytics(ctx, raw, true) : null, has("financial") ? billingAnalytics(ctx, raw, true) : null, has("pharmacy") ? pharmacyAnalytics(ctx, raw) : null, has("communication") ? communicationAnalytics(ctx, raw) : null,
    ]);
    const items: ScoreItem[] = [];
    if (appt) items.push(
      { key: "noShowRate", group: "Appointments", label: "No-show rate", value: appt.rates.noShowPct, unit: "percent", definition: appt.rates.noShowDefinition, unavailable: appt.rates.noShowPct === null ? "N/A — no due appointments" : undefined, sample: `${appt.totals.due} due` },
      { key: "cancellationRate", group: "Appointments", label: "Cancellation rate", value: appt.rates.cancellationPct, unit: "percent", definition: appt.rates.cancellationDefinition, unavailable: appt.rates.cancellationPct === null ? "N/A — no appointments" : undefined, sample: `${appt.totals.total} appointments` },
      { key: "completionRate", group: "Appointments", label: "Completion rate", value: rate(appt.totals.completed, appt.totals.due), unit: "percent", definition: "Completed ÷ appointments that were due.", sample: `${appt.totals.due} due` });
    if (opd) items.push(
      { key: "avgWait", group: "Patient flow", label: "Average waiting time", value: opd.waiting.averageMin, unit: "minutes", definition: opd.waiting.definition, unavailable: opd.waiting.available ? undefined : "Data unavailable", sample: `${opd.waiting.samples} visits` },
      { key: "medianWait", group: "Patient flow", label: "Median waiting time", value: opd.waiting.medianMin, unit: "minutes", definition: opd.waiting.definition, unavailable: opd.waiting.available ? undefined : "Data unavailable", sample: `${opd.waiting.samples} visits` },
      { key: "avgConsult", group: "Patient flow", label: "Average consultation time", value: opd.consultation.averageMin, unit: "minutes", definition: opd.consultation.definition, unavailable: opd.consultation.available ? undefined : "Data unavailable", sample: `${opd.consultation.samples} visits` });
    if (fu) items.push({ key: "followUpCompletion", group: "Follow-ups", label: "Follow-up completion rate", value: fu.completion.ratePct, unit: "percent", definition: fu.completion.definition, unavailable: fu.completion.ratePct === null ? "N/A — no follow-ups due" : undefined, sample: `${fu.completion.denominator} due` },
      { key: "overdueFollowUps", group: "Follow-ups", label: "Overdue follow-ups (now)", value: fu.backlog.overdue, unit: "count", definition: fu.backlog.definition });
    if (lab) items.push({ key: "labTat", group: "Laboratory", label: "Average lab turnaround", value: lab.turnaround.orderedToReleased.averageHours, unit: "hours", definition: lab.turnaround.definition, unavailable: lab.turnaround.orderedToReleased.available ? undefined : "Data unavailable", sample: `${lab.turnaround.orderedToReleased.samples} reports` },
      { key: "sampleRejection", group: "Laboratory", label: "Sample rejection rate", value: lab.rejection.ratePct, unit: "percent", definition: lab.rejection.definition, unavailable: lab.rejection.ratePct === null ? "N/A — no samples collected" : undefined });
    if (bill) items.push({ key: "paidShare", group: "Billing", label: "Invoices paid in full", value: rate(bill.totals.paid, bill.totals.invoices), unit: "percent", definition: "Invoices with status Paid ÷ invoices billed in the period.", unavailable: bill.totals.invoices === 0 ? "N/A — no invoices" : undefined, sample: `${bill.totals.invoices} invoices` });
    if (pharm) items.push({ key: "stockouts", group: "Pharmacy", label: "Medicines out of stock (now)", value: pharm.stock.outOfStock, unit: "count", definition: pharm.stock.definition }, { key: "lowStock", group: "Pharmacy", label: "Medicines at or below reorder level (now)", value: pharm.stock.lowStock, unit: "count", definition: pharm.stock.definition });
    if (comm) items.push({ key: "msgFailure", group: "Communication", label: "Message failure rate", value: comm.totals.failureRatePct, unit: "percent", definition: "Failed ÷ messages created in the period.", unavailable: comm.totals.failureRatePct === null ? "N/A — no messages" : undefined, sample: `${comm.totals.messages} messages` });
    return { items, note: "Each measure stands on its own with its own definition. There is deliberately no combined or overall score." };
  }, { audit: false });
}

/* ------------------------------------------------------------ platform (minimal) ------------------------------------------------------------ */
/** Super Admin only: clinic counts and platform status. Nothing clinical, no per-clinic data. */
export async function platformAnalytics(ctx: RequestContext) {
  if (!ctx.permissions.has("platform.manage")) throw new AppError("FORBIDDEN");
  const rows = await rawDb.tenant.groupBy({ by: ["status"], where: { deletedAt: null }, _count: { _all: true } });
  const total = rows.reduce((a, r) => a + r._count._all, 0); const n = (s: string) => rows.find((r) => r.status === s)?._count._all ?? 0;
  return { clinics: total, active: n("ACTIVE"), trial: n("TRIAL"), suspended: n("SUSPENDED"), inactive: n("INACTIVE"), status: "operational" as const, generatedAt: new Date().toISOString(), note: "Platform-level counts only. Advanced tenant analytics arrive with the platform lifecycle phase." };
}
