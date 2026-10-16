import "server-only";
import { db } from "@/lib/db";
import type { RequestContext } from "@/lib/auth/context";
import { STATUS_LABEL, STATUSES, type SubStatus } from "@/lib/subscriptions/state";
import { guard } from "./platform-core";

/**
 * Subscription analytics — every number is computed from real subscription / invoice / payment rows. Definitions (also shown in the UI):
 *  MRR            = monthly-equivalent price of subscriptions that are ACTIVE, PAST_DUE or GRACE (yearly ÷ 12, rounded). Trials, suspended, paused and free plans add nothing.
 *  ARR            = MRR × 12.
 *  Churned        = subscriptions that went from a paying/suspended state to CANCELLED or EXPIRED in the last 30 days.
 *  Churn rate     = churned ÷ (paying now + churned), shown only when that denominator is above zero.
 *  Outstanding    = unpaid balance of ISSUED / OVERDUE / PARTIALLY_PAID invoices.
 *  Revenue/month  = payments that SUCCEEDED, by UTC month of payment, less refunds PROCESSED in the same month.
 */
const PAYING = ["ACTIVE", "PAST_DUE", "GRACE"];
export const monthlyEquivalent = (priceMinor: number, interval: string) => (interval === "YEARLY" ? Math.round(priceMinor / 12) : priceMinor);
const DAY = 86_400_000;

export async function subscriptionAnalytics(ctx: RequestContext, now = new Date()) {
  guard(ctx); const since = new Date(now.getTime() - 30 * DAY);
  const subs = await db.subscription.findMany({ where: { managed: true }, select: { status: true, priceMinor: true, billingInterval: true, planId: true, snapshot: true } });
  const byStatus = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<string, number>; let mrr = 0; const dist = new Map<string, { name: string; count: number; mrr: number }>();
  for (const s of subs) {
    byStatus[s.status] = (byStatus[s.status] ?? 0) + 1; const live = ["TRIAL", ...PAYING, "PAUSED", "SUSPENDED"].includes(s.status);
    if (live) { const name = (() => { try { return (JSON.parse(s.snapshot) as { name?: string }).name ?? "Plan"; } catch { return "Plan"; } })(); const d = dist.get(s.planId) ?? { name, count: 0, mrr: 0 }; d.count++; if (PAYING.includes(s.status)) d.mrr += monthlyEquivalent(s.priceMinor, s.billingInterval); dist.set(s.planId, d); }
    if (PAYING.includes(s.status)) mrr += monthlyEquivalent(s.priceMinor, s.billingInterval);
  }
  const payingNow = PAYING.reduce((a, k) => a + (byStatus[k] ?? 0), 0);
  const [churnEv, upgrades, renewalSwaps, failed, outstanding, overdue, refunds, payments, procRefunds] = await Promise.all([
    db.subscriptionEvent.count({ where: { type: { in: ["STATUS_CANCELLED", "STATUS_EXPIRED"] }, fromStatus: { in: [...PAYING, "SUSPENDED", "PAUSED"] }, createdAt: { gte: since } } }),
    db.subscriptionEvent.count({ where: { type: "PLAN_UPGRADED", createdAt: { gte: since } } }),
    db.subscriptionEvent.count({ where: { type: "RENEWED", toPlanId: { not: null }, createdAt: { gte: since } } }),
    db.saasPayment.aggregate({ where: { status: "FAILED", createdAt: { gte: since } }, _count: { _all: true }, _sum: { amountMinor: true } }),
    db.saasInvoice.aggregate({ where: { status: { in: ["ISSUED", "OVERDUE", "PARTIALLY_PAID"] } }, _sum: { totalMinor: true, paidMinor: true }, _count: { _all: true } }),
    db.saasInvoice.aggregate({ where: { status: "OVERDUE" }, _sum: { totalMinor: true, paidMinor: true }, _count: { _all: true } }),
    db.saasRefund.aggregate({ where: { status: "PROCESSED", processedAt: { gte: since } }, _sum: { amountMinor: true }, _count: { _all: true } }),
    db.saasPayment.findMany({ where: { status: { in: ["SUCCEEDED", "PARTIALLY_REFUNDED", "REFUNDED"] }, paidAt: { gte: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1)) } }, select: { paidAt: true, amountMinor: true } }),
    db.saasRefund.findMany({ where: { status: "PROCESSED", processedAt: { gte: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1)) } }, select: { processedAt: true, amountMinor: true } }),
  ]);
  const months: { month: string; collectedMinor: number; refundedMinor: number; netMinor: number }[] = [];
  for (let i = 11; i >= 0; i--) { const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1)); months.push({ month: d.toISOString().slice(0, 7), collectedMinor: 0, refundedMinor: 0, netMinor: 0 }); }
  const slot = (d: Date | null) => months.find((m) => m.month === d?.toISOString().slice(0, 7));
  for (const p of payments) { const m = slot(p.paidAt); if (m) m.collectedMinor += p.amountMinor; }
  for (const r of procRefunds) { const m = slot(r.processedAt); if (m) m.refundedMinor += r.amountMinor; }
  for (const m of months) m.netMinor = m.collectedMinor - m.refundedMinor;
  const denom = payingNow + churnEv;
  return {
    mrrMinor: mrr, arrMinor: mrr * 12, payingCount: payingNow, trialCount: byStatus.TRIAL ?? 0, totalManaged: subs.length,
    byStatus: STATUSES.map((s) => ({ status: s, label: STATUS_LABEL[s as SubStatus], count: byStatus[s] ?? 0 })),
    churned30d: churnEv, churnRatePct: denom > 0 ? Math.round((churnEv / denom) * 1000) / 10 : null, upgrades30d: upgrades, planChangesAtRenewal30d: renewalSwaps,
    failedPayments30d: { count: failed._count._all, amountMinor: failed._sum.amountMinor ?? 0 },
    outstanding: { count: outstanding._count._all, amountMinor: (outstanding._sum.totalMinor ?? 0) - (outstanding._sum.paidMinor ?? 0) }, overdue: { count: overdue._count._all, amountMinor: (overdue._sum.totalMinor ?? 0) - (overdue._sum.paidMinor ?? 0) },
    refunds30d: { count: refunds._count._all, amountMinor: refunds._sum.amountMinor ?? 0 },
    planDistribution: [...dist.values()].sort((a, b) => b.count - a.count), revenueByMonth: months,
    hasData: subs.length > 0 || payments.length > 0,
  };
}
