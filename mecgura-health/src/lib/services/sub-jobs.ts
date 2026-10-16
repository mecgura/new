import "server-only";
import { db } from "@/lib/db";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { priceFor, parseJson, snapshotOfPlan } from "@/lib/subscriptions/catalog";
import { dunningStep } from "@/lib/subscriptions/dunning";
import { addDaysUtc, addInterval } from "@/lib/subscriptions/period";
import { recordUsageHistory, usageSnapshot, violationsFor } from "./entitlements";
import { dateText, issueInvoice, money, outstandingOf, overdueSweep, voidInvoice } from "./sub-billing";
import { getPolicy } from "./sub-config";
import { notifySubscription } from "./sub-notify";
import { logEvent, transition, SYSTEM } from "./sub-state";
import { invalidateEntitlements } from "./entitlements";

export interface SubJobSummary { overdueInvoices: number; trialsEnded: number; trialsEnding: number; renewalsIssued: number; freeRenewed: number; pastDue: number; grace: number; suspended: number; cancelled: number; expired: number; stalePending: number; errors: number }
const DAY = 86_400_000;
const emptySummary = (): SubJobSummary => ({ overdueInvoices: 0, trialsEnded: 0, trialsEnding: 0, renewalsIssued: 0, freeRenewed: 0, pastDue: 0, grace: 0, suspended: 0, cancelled: 0, expired: 0, stalePending: 0, errors: 0 });
const STALE_PENDING_DAYS = 14;

/**
 * The billing clock. Safe to run as often as you like and from several workers at once: every step re-reads state, moves a subscription only through
 * the guarded state machine (compare-and-set), and issues invoices / notifications under idempotency keys. `now` is injectable for tests.
 */
export async function runSubscriptionJobs(now = new Date()): Promise<SubJobSummary> {
  const s = emptySummary(); const policy = await getPolicy();
  const step = async (name: string, fn: () => Promise<void>) => { try { await fn(); } catch (e) { s.errors++; logger.error("subscription job step failed", { step: name, error: e }); } };

  await step("overdue", async () => { s.overdueInvoices = await overdueSweep(now); });

  await step("trials", async () => {
    for (const sub of await db.subscription.findMany({ where: { managed: true, status: "TRIAL", trialEnd: { lte: now } } })) {
      await db.$transaction((tx) => transition(tx, sub, "EXPIRED", { endsAt: sub.trialEnd, nextBillingDate: null }, SYSTEM, "trial ended without a paid plan")); s.trialsEnded++;
      await notifySubscription(sub.tenantId, "SUBSCRIPTION_TRIAL_ENDED", `trial-ended:${sub.id}:${sub.trialEnd?.getTime()}`);
    }
    for (const sub of await db.subscription.findMany({ where: { managed: true, status: "TRIAL", trialEnd: { gt: now, lte: addDaysUtc(now, 3) } }, include: { plan: true } })) {
      await notifySubscription(sub.tenantId, "SUBSCRIPTION_TRIAL_ENDING", `trial-ending:${sub.id}:${sub.trialEnd?.getTime()}`, { plan: sub.plan.name, date: dateText(sub.trialEnd!) }); s.trialsEnding++;
    }
  });

  await step("period-end", async () => {
    for (const sub of await db.subscription.findMany({ where: { managed: true, status: "ACTIVE", currentPeriodEnd: { lte: now } } })) {
      if (sub.cancelAtPeriodEnd) {
        await db.$transaction((tx) => transition(tx, sub, "CANCELLED", { endsAt: sub.currentPeriodEnd, nextBillingDate: null, scheduledChange: null }, SYSTEM, "cancelled at period end")); s.cancelled++;
        for (const i of await db.saasInvoice.findMany({ where: { subscriptionId: sub.id, status: { in: ["ISSUED", "OVERDUE"] }, paidMinor: 0, kind: "RENEWAL" } })) await voidInvoice(i.id, SYSTEM, "subscription ended");
      } else if (!sub.autoRenew) {
        await db.$transaction((tx) => transition(tx, sub, "EXPIRED", { endsAt: sub.currentPeriodEnd, nextBillingDate: null }, SYSTEM, "not renewed")); s.expired++;
      } else if (sub.priceMinor === 0) { // free plans simply roll over
        const end = addInterval(sub.currentPeriodEnd!, sub.billingInterval);
        await db.$transaction(async (tx) => { await tx.subscription.update({ where: { id: sub.id }, data: { currentPeriodStart: sub.currentPeriodEnd, currentPeriodEnd: end, nextBillingDate: end, endsAt: end } }); await logEvent(tx, { tenantId: sub.tenantId, subscriptionId: sub.id, type: "RENEWED", actor: SYSTEM, note: "free plan" }); }); s.freeRenewed++;
      }
    }
  });

  await step("renewal-invoices", async () => {
    for (const sub of await db.subscription.findMany({ where: { managed: true, status: "ACTIVE", cancelAtPeriodEnd: false, autoRenew: true, priceMinor: { gt: 0 }, currentPeriodEnd: { lte: addDaysUtc(now, policy.renewalInvoiceLeadDays) } }, include: { plan: true } })) {
      const periodStart = sub.currentPeriodEnd!; let planName = sub.plan.name; let intv = sub.billingInterval; let unit = sub.priceMinor; let change: { planId: string; billingInterval: string; planVersion: number } | null = null;
      const sched = parseJson<{ planId: string; billingInterval: string } | null>(sub.scheduledChange, null);
      if (sched) {
        const np = await db.plan.findUnique({ where: { id: sched.planId } });
        const bad = !np || np.status === "ARCHIVED" ? "the plan is no longer available" : violationsFor(snapshotOfPlan(np).limits, (await usageSnapshot(sub.tenantId, now)).rows).length ? "usage is above the new plan's limits" : null;
        if (bad || !np) { await db.$transaction(async (tx) => { await tx.subscription.update({ where: { id: sub.id }, data: { scheduledChange: null } }); await logEvent(tx, { tenantId: sub.tenantId, subscriptionId: sub.id, type: "CHANGE_BLOCKED", actor: SYSTEM, note: bad ?? "" }); }); }
        else { planName = np.name; intv = sched.billingInterval; unit = priceFor(np, intv); change = { planId: np.id, billingInterval: intv, planVersion: np.version }; }
      }
      const periodEnd = addInterval(periodStart, intv);
      const r = await issueInvoice({ tenantId: sub.tenantId, subscriptionId: sub.id, kind: "RENEWAL", periodStart, periodEnd, items: [{ description: `${planName} — ${intv === "YEARLY" ? "annual" : "monthly"} renewal (${dateText(periodStart)} to ${dateText(periodEnd)})`, unitMinor: unit }], dedupeKey: `RENEWAL:${sub.id}:${periodStart.getTime()}`, change, planName, now, dueAt: new Date(Math.max(periodStart.getTime(), now.getTime() + DAY)) });
      if (r.created) s.renewalsIssued++;
    }
  });

  await step("dunning", async () => {
    const subs = await db.subscription.findMany({ where: { managed: true, status: { in: ["ACTIVE", "PAST_DUE", "GRACE"] } } });
    for (const first of subs) {
      const inv = await db.saasInvoice.findFirst({ where: { subscriptionId: first.id, kind: "RENEWAL", status: { in: ["ISSUED", "OVERDUE", "PARTIALLY_PAID"] } }, orderBy: { dueAt: "asc" } }); if (!inv?.dueAt) continue;
      let sub = first;
      for (let n = 0; n < 4; n++) { // a late run may need to walk several stages in one go
        const st = dunningStep({ status: sub.status, dueAt: inv.dueAt, now, graceStart: sub.gracePeriodStart, policy });
        const vars = { number: inv.invoiceNumber, amount: money(outstandingOf(inv)), date: dateText(inv.dueAt) };
        if (st === "NONE") break;
        if (st === "REMINDER") { await notifySubscription(sub.tenantId, "SUBSCRIPTION_RENEWAL_UPCOMING", `remind:${inv.id}`, vars); break; }
        if (st === "OVERDUE") { await db.$transaction((tx) => transition(tx, sub, "PAST_DUE", { lastPaymentFailedAt: sub.lastPaymentFailedAt ?? now }, SYSTEM, `invoice ${inv.invoiceNumber} overdue`)); s.pastDue++; await notifySubscription(sub.tenantId, "SUBSCRIPTION_PAYMENT_OVERDUE", `overdue:${inv.id}`, vars); }
        else if (st === "GRACE") { const end = addDaysUtc(now, policy.graceDays); await db.$transaction((tx) => transition(tx, sub, "GRACE", { gracePeriodStart: now, gracePeriodEnd: end, dunningStage: 1 }, SYSTEM, "grace period")); s.grace++; await notifySubscription(sub.tenantId, "SUBSCRIPTION_GRACE_STARTED", `grace:${inv.id}`, { ...vars, date: dateText(end) }); }
        else if (st === "GRACE_ENDING") { await notifySubscription(sub.tenantId, "SUBSCRIPTION_GRACE_STARTED", `grace-ending:${inv.id}`, { ...vars, date: dateText(sub.gracePeriodEnd ?? now) }); break; }
        else if (st === "SUSPEND") { await db.$transaction((tx) => transition(tx, sub, "SUSPENDED", { suspendedAt: now, dunningStage: 2 }, SYSTEM, "grace period ended unpaid")); s.suspended++; await notifySubscription(sub.tenantId, "SUBSCRIPTION_SUSPENDED", `suspended:${inv.id}`, vars); await recordAudit({ action: AUDIT_ACTIONS.SUBSCRIPTION_STATUS_CHANGED, tenantId: sub.tenantId, entityType: "subscription", entityId: sub.id, metadata: { to: "SUSPENDED", by: "billing job" } }); }
        sub = (await db.subscription.findUnique({ where: { id: sub.id } }))!;
      }
    }
  });

  await step("stale-pending", async () => {
    for (const sub of await db.subscription.findMany({ where: { managed: true, status: "PENDING_PAYMENT", startsAt: { lt: new Date(now.getTime() - STALE_PENDING_DAYS * DAY) } } })) {
      for (const i of await db.saasInvoice.findMany({ where: { subscriptionId: sub.id, status: { in: ["ISSUED", "OVERDUE"] }, paidMinor: 0 } })) await voidInvoice(i.id, SYSTEM, "never paid");
      await db.$transaction((tx) => transition(tx, sub, "CANCELLED", { cancelledAt: now, endsAt: now, cancellationReason: "OTHER", cancellationNotes: "First invoice was never paid." }, SYSTEM, "first invoice unpaid")); s.stalePending++;
    }
  });

  await step("usage-history", async () => { for (const sub of await db.subscription.findMany({ where: { managed: true, status: { in: ["TRIAL", "ACTIVE", "PAST_DUE", "GRACE"] } }, take: 200, select: { tenantId: true } })) await recordUsageHistory(sub.tenantId, now); });
  invalidateEntitlements();
  return s;
}
