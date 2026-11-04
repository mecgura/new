import type { Autopay, Subscription } from "@prisma/client";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { audit } from "@/lib/audit";
import { notify } from "@/lib/notifications";
import { getRazorpay } from "@/lib/razorpay";
import { getSetting, setSetting } from "@/lib/settings";
import { currentPlan } from "@/lib/services/usage";
import type { OrgAccess } from "@/lib/session";
import { getBillingSettings } from "@/services/billing/settings";
import { markInvoicePaid, periodAmount, runBillingCycle, taxOn } from "@/services/billing/billing";
import type { SubscriptionEvent } from "@/providers/payments/types";

/**
 * Card / UPI AutoPay through Razorpay Subscriptions.
 *
 * - MECGURA never marks anything paid on its own: only a signed `subscription.charged` webhook (or a Razorpay
 *   fetch that shows the same) pays an invoice, and only when the amount matches.
 * - Which methods the customer sees (card, UPI AutoPay, eMandate) is decided by what is enabled on the Razorpay
 *   account; we record the method Razorpay reports after authorisation.
 * - If Subscriptions isn't enabled on the account, Razorpay refuses the request and we show its message.
 */

/** Statuses where the mandate can still charge (or is waiting to). */
export const LIVE_AUTOPAY = ["created", "authenticated", "active", "pending"] as const;
const isLive = (s: string) => (LIVE_AUTOPAY as readonly string[]).includes(s);
/** Mandates charging above this need the customer to approve each debit (RBI e-mandate rule). */
export const AFA_LIMIT = 1_500_000; // ₹15,000 in paise
const DAY = 86_400_000;

type RzpSub = { id: string; status?: string; plan_id?: string; short_url?: string; payment_method?: string; paid_count?: number; charge_at?: number; start_at?: number; current_end?: number };
type RzpError = { error?: { description?: string }; statusCode?: number; message?: string };
const rzpMessage = (e: unknown) => {
  const x = e as RzpError;
  return (x?.error?.description || x?.message || "Razorpay didn't respond.").slice(0, 300);
};

async function ownersOf(organizationId: string) {
  return db.organizationMember.findMany({ where: { organizationId, role: "CLIENT_OWNER" }, select: { userId: true } });
}
async function tellOwners(organizationId: string, title: string, body = "", type: "info" | "success" | "warning" = "info") {
  for (const o of await ownersOf(organizationId)) await notify({ userId: o.userId, organizationId, type, title, body, link: "/billing" });
}

/** Per-period charge for a subscription, including tax at today's rate — the same total its invoices get. */
export async function chargeAmount(sub: Pick<Subscription, "periodPrice" | "priceMonthly">) {
  const settings = await getBillingSettings();
  const subtotal = periodAmount(sub);
  return subtotal + taxOn(subtotal, Math.round(settings.taxPercent * 100));
}

export async function liveAutopay(organizationId: string) {
  return db.autopay.findFirst({ where: { organizationId, status: { in: [...LIVE_AUTOPAY] } }, orderBy: { createdAt: "desc" } });
}

export function autopayDto(a: Autopay | null) {
  if (!a) return null;
  return {
    id: a.id,
    status: a.status,
    method: a.method,
    amount: a.amount,
    interval: a.interval,
    authorizeUrl: a.status === "created" ? a.shortUrl : "",
    startAt: a.startAt,
    chargedCount: a.chargedCount,
    lastChargedAt: a.lastChargedAt,
    lastFailureReason: a.lastFailureReason,
    needsApprovalEachDebit: a.amount > AFA_LIMIT,
    syncedAt: a.syncedAt,
  };
}

/** What the Billing page shows: can auto-pay be offered, and the current mandate. */
export async function autopayOverview(organizationId: string) {
  const [rz, sub, live] = await Promise.all([getRazorpay(), currentPlan(organizationId), liveAutopay(organizationId)]);
  const billable = Boolean(sub && (sub.billingMode === "invoiced" || sub.billingMode === "trial") && periodAmount(sub) > 0 && !sub.cancelAtPeriodEnd);
  const last = live ?? (await db.autopay.findFirst({ where: { organizationId }, orderBy: { createdAt: "desc" } }));
  return {
    available: Boolean(rz) && billable,
    reason: !rz ? "Online payments aren't connected yet." : !billable ? "Auto-pay is for paid monthly or yearly plans that renew." : "",
    nextChargeAmount: sub && billable ? await chargeAmount(sub) : null,
    mandate: autopayDto(last),
  };
}

/** Razorpay plan for (plan, interval, amount), created once and remembered. */
async function razorpayPlanFor(rz: NonNullable<Awaited<ReturnType<typeof getRazorpay>>>, sub: Subscription & { plan: { slug: string; name: string } }, amount: number) {
  const key = `rzp_plan:${rz.mode}:${sub.plan.slug}:${sub.interval}:${amount}`;
  const known = (await getSetting(key)).trim();
  if (known) return known;
  const plan = (await rz.client.plans.create({
    period: sub.interval === "year" ? "yearly" : "monthly",
    interval: 1,
    item: { name: `MECGURA ${sub.plan.name} (${sub.interval === "year" ? "yearly" : "monthly"})`.slice(0, 100), amount, currency: "INR", description: "MECGURA plan subscription" },
    notes: { mecgura_plan: sub.plan.slug, interval: sub.interval },
  })) as { id: string };
  await setSetting(key, plan.id);
  return plan.id;
}

/**
 * Starts an auto-pay mandate for the current plan. Returns Razorpay's hosted link where the customer
 * authorises the card / UPI AutoPay mandate. The first charge is at the next billing date.
 */
export async function startAutopay(access: OrgAccess, req?: Request) {
  const { organizationId } = access;
  const rz = await getRazorpay();
  if (!rz) throw new ApiError("CONFLICT", "Online payments aren't connected yet, so auto-pay can't be turned on.");
  const sub = await currentPlan(organizationId);
  if (!sub || !(sub.billingMode === "invoiced" || sub.billingMode === "trial") || periodAmount(sub) <= 0) throw new ApiError("CONFLICT", "Auto-pay is for paid plans that renew monthly or yearly.");
  if (sub.cancelAtPeriodEnd) throw new ApiError("CONFLICT", "Your plan is set to end. Choose “Keep my plan” first.");
  const existing = await liveAutopay(organizationId);
  if (existing && existing.status !== "created") throw new ApiError("CONFLICT", "Auto-pay is already on for this plan.");
  const amount = await chargeAmount(sub);
  // A link that wasn't used yet for the same amount can simply be shown again.
  if (existing && existing.amount === amount && existing.subscriptionId === sub.id && existing.shortUrl) return autopayDto(existing)!;
  if (existing) await cancelAtRazorpay(existing, "replaced", access.user.id, req);

  const now = Date.now();
  // First automatic charge on the next billing date; open invoices for the current period are paid the normal way.
  const startAt = sub.currentPeriodEnd && sub.currentPeriodEnd.getTime() > now + 10 * 60_000 ? sub.currentPeriodEnd : null;
  const totalCount = sub.interval === "year" ? 10 : 120;
  let rsub: RzpSub;
  try {
    const planId = await razorpayPlanFor(rz, sub, amount);
    rsub = (await rz.client.subscriptions.create({
      plan_id: planId,
      total_count: totalCount,
      quantity: 1,
      customer_notify: 1,
      ...(startAt ? { start_at: Math.floor(startAt.getTime() / 1000) } : {}),
      notes: { organization: organizationId, subscription: sub.id },
    })) as RzpSub;
    const row = await db.autopay.create({
      data: { organizationId, subscriptionId: sub.id, gatewaySubId: rsub.id, gatewayPlanId: planId, status: rsub.status || "created", amount, interval: sub.interval, shortUrl: rsub.short_url ?? "", startAt },
    });
    await audit({ action: "billing.autopay_started", actorUserId: access.user.id, organizationId, targetType: "autopay", targetId: row.id, metadata: { gatewaySubId: rsub.id, amount, interval: sub.interval }, req });
    return autopayDto(row)!;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    const msg = rzpMessage(e);
    await audit({ action: "billing.autopay_failed", actorUserId: access.user.id, organizationId, targetType: "subscription", targetId: sub.id, metadata: { error: msg }, req });
    throw new ApiError("SERVICE_UNAVAILABLE", `Razorpay couldn't start auto-pay: ${msg}${/subscription|feature|not enabled|not allowed/i.test(msg) ? " (Subscriptions may not be enabled on the MECGURA Razorpay account yet.)" : ""}`);
  }
}

/** Cancels the mandate at Razorpay (best effort) and records why. */
async function cancelAtRazorpay(a: Autopay, reason: string, actorUserId: string | null = null, req?: Request) {
  const rz = await getRazorpay();
  let note = "";
  if (rz && a.status !== "cancelled" && a.status !== "completed" && a.status !== "expired") {
    try {
      await rz.client.subscriptions.cancel(a.gatewaySubId, false);
    } catch (e) {
      note = rzpMessage(e);
    }
  }
  await db.autopay.update({ where: { id: a.id }, data: { status: "cancelled", cancelledAt: new Date(), endReason: reason, ...(note ? { lastFailureReason: `Cancel at Razorpay: ${note}` } : {}) } });
  await audit({ action: "billing.autopay_cancelled", actorUserId, organizationId: a.organizationId, targetType: "autopay", targetId: a.id, metadata: { reason, gatewaySubId: a.gatewaySubId, ...(note ? { providerError: note } : {}) }, req });
  return note;
}

export async function stopAutopay(access: OrgAccess, req?: Request) {
  const a = await liveAutopay(access.organizationId);
  if (!a) throw new ApiError("CONFLICT", "Auto-pay isn't on.");
  const note = await cancelAtRazorpay(a, "customer", access.user.id, req);
  if (note) throw new ApiError("SERVICE_UNAVAILABLE", `Auto-pay is off in MECGURA, but Razorpay reported: ${note}. Contact support so no further charge happens.`);
}

/**
 * Called whenever the workspace's active subscription row changes (plan change, trial conversion, admin assignment,
 * cancellation). The mandate follows the new row when the charge stays the same; otherwise it is cancelled
 * and the owners are asked to turn auto-pay on again for the new amount.
 */
export async function autopayAfterPlanChange(organizationId: string) {
  const a = await liveAutopay(organizationId);
  if (!a) return "none";
  const sub = await currentPlan(organizationId);
  if (sub && a.subscriptionId === sub.id) return "unchanged";
  const billable = sub && (sub.billingMode === "invoiced" || sub.billingMode === "trial") && periodAmount(sub) > 0 && !sub.cancelAtPeriodEnd;
  if (sub && billable && sub.interval === a.interval && (await chargeAmount(sub)) === a.amount) {
    await db.autopay.update({ where: { id: a.id }, data: { subscriptionId: sub.id } });
    return "kept";
  }
  await cancelAtRazorpay(a, sub ? "plan_changed" : "subscription_ended");
  if (sub && billable) await tellOwners(organizationId, "Turn auto-pay on again for your new plan", "Your plan or price changed, so the old auto-pay mandate was cancelled. Turn it on again in Billing.", "warning");
  return "cancelled";
}

/** Auto-pay is cancelled when the customer schedules a cancellation, so nothing is charged at period end. */
export async function autopayOnCancel(organizationId: string) {
  const a = await liveAutopay(organizationId);
  if (a) await cancelAtRazorpay(a, "subscription_ended");
}

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------



const STATUS_FROM_EVENT: Record<string, string> = {
  "subscription.authenticated": "authenticated",
  "subscription.activated": "active",
  "subscription.charged": "active",
  "subscription.pending": "pending",
  "subscription.halted": "halted",
  "subscription.cancelled": "cancelled",
  "subscription.completed": "completed",
  "subscription.paused": "halted",
  "subscription.resumed": "active",
};

/** Applies one verified (and de-duplicated) Razorpay subscription event. Returns an outcome label. */
export async function applySubscriptionEvent(ev: SubscriptionEvent): Promise<string> {
  const a = await db.autopay.findUnique({ where: { gatewaySubId: ev.subscriptionRef } });
  if (!a) return "unknown_subscription";
  const now = new Date();
  const status = STATUS_FROM_EVENT[ev.event] ?? ev.status ?? a.status;
  const wasCancelled = a.status === "cancelled" && status !== "cancelled";
  await db.autopay.update({
    where: { id: a.id },
    data: {
      // Once we've cancelled a mandate, a late activation event doesn't revive it.
      status: wasCancelled ? a.status : status,
      method: ev.method || a.method,
      shortUrl: status === "created" ? a.shortUrl : "",
      ...(ev.paidCount !== null ? { chargedCount: Math.max(a.chargedCount, ev.paidCount) } : {}),
      ...(status === "pending" || status === "halted" ? { lastFailureReason: ev.failureReason || (status === "halted" ? "Auto-pay stopped after repeated failed charges." : "A charge failed; Razorpay will retry.") } : {}),
      syncedAt: now,
    },
  });
  if (ev.type === "subscription.charged") return chargeToInvoice(a, ev);
  if (status === "authenticated" && a.status === "created") await tellOwners(a.organizationId, "Auto-pay is set up", `Your plan will be charged automatically${a.startAt ? " from the next billing date" : ""}.`, "success");
  if (status === "pending") await tellOwners(a.organizationId, "Auto-pay charge failed", "Razorpay will retry. Check your card / UPI app, or pay the invoice in Billing.", "warning");
  if (status === "halted") {
    await tellOwners(a.organizationId, "Auto-pay has stopped", "Charges kept failing, so auto-pay stopped. Pay the open invoice in Billing and turn auto-pay on again.", "warning");
    await audit({ action: "billing.autopay_halted", organizationId: a.organizationId, targetType: "autopay", targetId: a.id, metadata: { gatewaySubId: a.gatewaySubId } });
  }
  if (status === "cancelled" && a.status !== "cancelled") await db.autopay.update({ where: { id: a.id }, data: { cancelledAt: now, endReason: a.endReason || "provider" } });
  return `status:${status}`;
}

/** A successful automatic charge pays the matching open plan invoice (creating this period's invoice first if it's due). */
async function chargeToInvoice(a: Autopay, ev: SubscriptionEvent): Promise<string> {
  const now = new Date();
  if (!ev.paymentId) return "charged_without_payment";
  if (await db.payment.findFirst({ where: { gateway: "razorpay_autopay", gatewayPaymentId: ev.paymentId } })) return "duplicate_payment";
  const find = () =>
    db.invoice.findFirst({
      where: { organizationId: a.organizationId, status: "open", kind: { in: ["subscription", "renewal"] }, ...(a.subscriptionId ? { subscriptionId: a.subscriptionId } : {}) },
      orderBy: { dueAt: "asc" },
    });
  let inv = await find();
  if (!inv) {
    // Razorpay charged on the billing date before our scheduler issued the invoice: run the (idempotent) cycle now.
    await runBillingCycle(now);
    inv = await find();
  }
  const record = async (status: "succeeded" | "failed", invoiceId: string, failureCode = "", failureReason = "") =>
    db.payment.create({ data: { organizationId: a.organizationId, invoiceId, gateway: "razorpay_autopay", gatewayRef: a.gatewaySubId, gatewayPaymentId: ev.paymentId, amount: ev.amount ?? 0, currency: ev.currency ?? "INR", status, failureCode, failureReason, completedAt: now } });
  await db.autopay.update({ where: { id: a.id }, data: { lastChargedAt: now, lastFailureReason: "" } });
  if (!inv) {
    await audit({ action: "billing.autopay_unmatched", organizationId: a.organizationId, targetType: "autopay", targetId: a.id, metadata: { paymentId: ev.paymentId, amount: ev.amount } });
    await notifyAdmins(`Auto-pay charge without an open invoice`, `Razorpay payment ${ev.paymentId} (${a.gatewaySubId}). Check Admin → Billing → Auto-pay.`);
    return "unmatched_charge";
  }
  if ((ev.amount !== null && ev.amount !== inv.total) || (ev.currency && ev.currency !== inv.currency)) {
    await record("failed", inv.id, "amount_mismatch", `Auto-pay charged ${ev.amount} but the invoice is ${inv.total}.`);
    await audit({ action: "billing.payment_failed", organizationId: a.organizationId, targetType: "invoice", targetId: inv.id, metadata: { number: inv.number, gateway: "razorpay_autopay", code: "amount_mismatch", reported: ev.amount } });
    await notifyAdmins(`Auto-pay amount mismatch on ${inv.number}`, `Charged ${ev.amount} paise, invoice total ${inv.total}. Reconcile in Admin → Billing.`);
    return "amount_mismatch";
  }
  await record("succeeded", inv.id);
  const applied = await markInvoicePaid(inv.id, "razorpay_autopay", ev.paymentId, null);
  return applied ? "paid" : "invoice_not_open";
}

async function notifyAdmins(title: string, body: string) {
  const admins = await db.user.findMany({ where: { role: "SUPER_ADMIN", status: "active" }, select: { id: true } });
  for (const u of admins) await notify({ userId: u.id, type: "warning", title, body, link: "/admin/billing" });
}

// ---------------------------------------------------------------------------
// Reconciliation (admin)
// ---------------------------------------------------------------------------

/** Re-reads one mandate from Razorpay so the status shown is the provider's, not a guess. */
export async function syncAutopay(id: string) {
  const a = await db.autopay.findUnique({ where: { id } });
  if (!a) throw new ApiError("NOT_FOUND", "Auto-pay mandate not found.");
  const rz = await getRazorpay();
  if (!rz) throw new ApiError("CONFLICT", "Razorpay isn't connected.");
  let r: RzpSub;
  try {
    r = (await rz.client.subscriptions.fetch(a.gatewaySubId)) as RzpSub;
  } catch (e) {
    throw new ApiError("SERVICE_UNAVAILABLE", `Razorpay: ${rzpMessage(e)}`);
  }
  const paid = r.paid_count ?? a.chargedCount;
  const updated = await db.autopay.update({
    where: { id: a.id },
    data: { status: a.status === "cancelled" ? "cancelled" : r.status || a.status, method: r.payment_method || a.method, chargedCount: paid, syncedAt: new Date() },
  });
  const recorded = await db.payment.count({ where: { gateway: "razorpay_autopay", gatewayRef: a.gatewaySubId, status: "succeeded" } });
  return { mandate: autopayDto(updated)!, providerStatus: r.status ?? "", providerPaidCount: paid, recordedPaid: recorded, mismatch: paid !== recorded };
}

export async function adminAutopayList() {
  const rows = await db.autopay.findMany({ orderBy: { createdAt: "desc" }, take: 200, include: { organization: { select: { name: true } } } });
  const counts = await db.payment.groupBy({ by: ["gatewayRef"], where: { gateway: "razorpay_autopay", status: "succeeded" }, _count: { _all: true } });
  const paid = new Map(counts.map((c) => [c.gatewayRef, c._count._all]));
  const problems = await db.payment.findMany({ where: { gateway: "razorpay_autopay", status: "failed" }, orderBy: { createdAt: "desc" }, take: 50, select: { id: true, organizationId: true, gatewayRef: true, gatewayPaymentId: true, amount: true, failureCode: true, failureReason: true, createdAt: true } });
  return {
    mandates: rows.map((r) => ({ ...autopayDto(r)!, organization: r.organization.name, organizationId: r.organizationId, gatewaySubId: r.gatewaySubId, endReason: r.endReason, createdAt: r.createdAt, recordedPaid: paid.get(r.gatewaySubId) ?? 0, countMismatch: (paid.get(r.gatewaySubId) ?? 0) !== r.chargedCount })),
    problems,
    stale: rows.filter((r) => isLive(r.status) && (!r.syncedAt || Date.now() - r.syncedAt.getTime() > 35 * DAY)).length,
  };
}
