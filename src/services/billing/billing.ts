import type { Invoice, Plan, Prisma, Subscription } from "@prisma/client";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { audit } from "@/lib/audit";
import { notify } from "@/lib/notifications";
import { ACTIVE_NUMBER_STATUSES } from "@/lib/catalog";
import { limitLabel, limitsOf, parseFeatures, wouldExceed, FEATURES } from "@/lib/plans";
import { currentPlan } from "@/lib/services/usage";
import type { OrgAccess } from "@/lib/session";
import { getGateway, availableGateways } from "@/providers/payments/registry";
import { GatewayError, type CheckoutSession, type GatewayEvent, type SubscriptionEvent } from "@/providers/payments/types";
import { applySubscriptionEvent, autopayAfterPlanChange, autopayOnCancel, autopayOverview, liveAutopay } from "@/services/billing/autopay";
import { getBillingSettings } from "@/services/billing/settings";
import { billingState } from "@/services/billing/entitlements";
import { creditWallet } from "@/services/wallet";
import { isEmailConfigured, sendMail } from "@/lib/mailer";
import { siteConfig } from "@/config/site";

const DAY = 86_400_000;

// ---------------------------------------------------------------------------
// Dates and money
// ---------------------------------------------------------------------------

/** Same calendar day next month (31 Jan → 28/29 Feb). */
export function addMonth(d: Date, n = 1): Date {
  const r = new Date(d);
  const day = r.getUTCDate();
  r.setUTCDate(1);
  r.setUTCMonth(r.getUTCMonth() + n);
  const last = new Date(Date.UTC(r.getUTCFullYear(), r.getUTCMonth() + 1, 0)).getUTCDate();
  r.setUTCDate(Math.min(day, last));
  return r;
}

export type Interval = "month" | "year";
/** One billing period later. */
export const addPeriod = (d: Date, interval: string) => addMonth(d, interval === "year" ? 12 : 1);
/** What the plan costs for one period of `interval` (paise). 0 = not offered. */
export const planPrice = (p: Pick<Plan, "priceMonthly" | "priceYearly">, interval: string) => (interval === "year" ? p.priceYearly : p.priceMonthly);
/** Monthly-equivalent price (MRR). */
export const monthlyEquivalent = (p: Pick<Plan, "priceMonthly" | "priceYearly">, interval: string) => (interval === "year" ? Math.round(p.priceYearly / 12) : p.priceMonthly);
/** What this subscription bills each period (older rows have no periodPrice: they are monthly). */
export const periodAmount = (s: Pick<Subscription, "periodPrice" | "priceMonthly">) => s.periodPrice || s.priceMonthly;
const per = (interval: string) => (interval === "year" ? "1 year" : "1 month");

/** Tax on a paise amount, rounded to the nearest paisa. */
export const taxOn = (subtotal: number, taxBps: number) => Math.round((subtotal * taxBps) / 10_000);

/** Price of the unused part of a billing period (paise), by whole days. */
export function prorate(amount: number, start: Date, end: Date, now: Date): number {
  const total = Math.max(1, Math.round((end.getTime() - start.getTime()) / DAY));
  const left = Math.max(0, Math.min(total, Math.ceil((end.getTime() - now.getTime()) / DAY)));
  return Math.round((amount * left) / total);
}

// ---------------------------------------------------------------------------
// Invoices
// ---------------------------------------------------------------------------

type InvoiceInput = { organizationId: string; subscriptionId?: string | null; kind: "subscription" | "upgrade" | "renewal" | "topup"; description: string; lines: { description: string; amount: number }[]; periodStart?: Date | null; periodEnd?: Date | null; targetPlanId?: string | null; targetInterval?: Interval | null; dueAt?: Date };

async function nextNumber(tx: Prisma.TransactionClient, at: Date): Promise<string> {
  const year = at.getUTCFullYear();
  const seq = await tx.invoiceSequence.upsert({ where: { year }, update: { last: { increment: 1 } }, create: { year, last: 1 } });
  return `INV-${year}-${String(seq.last).padStart(6, "0")}`;
}

export async function createInvoice(input: InvoiceInput) {
  const [settings, org] = await Promise.all([getBillingSettings(), db.organization.findUniqueOrThrow({ where: { id: input.organizationId }, select: { name: true, contactEmail: true } })]);
  const subtotal = input.lines.reduce((n, l) => n + l.amount, 0);
  const taxBps = Math.round(settings.taxPercent * 100);
  const taxAmount = taxOn(subtotal, taxBps);
  const now = new Date();
  return db.$transaction(async (tx) =>
    tx.invoice.create({
      data: {
        organizationId: input.organizationId,
        subscriptionId: input.subscriptionId ?? null,
        number: await nextNumber(tx, now),
        kind: input.kind,
        description: input.description.slice(0, 200),
        subtotal,
        taxBps,
        taxAmount,
        total: subtotal + taxAmount,
        lines: JSON.stringify(input.lines),
        issuer: JSON.stringify({ name: settings.companyName, address: settings.companyAddress, taxId: settings.taxId, email: settings.supportEmail, footer: settings.footer, paymentInstructions: settings.paymentInstructions }),
        billTo: JSON.stringify({ name: org.name, email: org.contactEmail }),
        periodStart: input.periodStart ?? null,
        periodEnd: input.periodEnd ?? null,
        targetPlanId: input.targetPlanId ?? null,
        targetInterval: input.targetInterval ?? null,
        issuedAt: now,
        dueAt: input.dueAt ?? new Date(now.getTime() + settings.dueDays * DAY),
      },
    })
  );
}

const parse = <T,>(raw: string, fallback: T): T => {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

export function invoiceDto(i: Invoice & { payments?: { status: string; gateway: string; failureReason: string; createdAt: Date }[] }) {
  const overdue = i.status === "open" && i.dueAt.getTime() < Date.now();
  const lastPayment = i.payments?.[0];
  return {
    id: i.id,
    number: i.number,
    kind: i.kind,
    status: i.status,
    displayStatus: i.status === "open" ? (overdue ? "overdue" : lastPayment?.status === "failed" ? "payment_failed" : "open") : i.status,
    description: i.description,
    currency: i.currency,
    subtotal: i.subtotal,
    taxBps: i.taxBps,
    taxAmount: i.taxAmount,
    total: i.total,
    lines: parse<{ description: string; amount: number }[]>(i.lines, []),
    issuer: parse<{ name?: string; address?: string; taxId?: string; email?: string; footer?: string; paymentInstructions?: string }>(i.issuer, {}),
    billTo: parse<{ name?: string; email?: string }>(i.billTo, {}),
    periodStart: i.periodStart,
    periodEnd: i.periodEnd,
    issuedAt: i.issuedAt,
    dueAt: i.dueAt,
    paidAt: i.paidAt,
    paidVia: i.paidVia,
    paymentNote: i.paymentNote,
    lastPaymentFailure: lastPayment?.status === "failed" ? lastPayment.failureReason || "The payment didn't go through." : null,
  };
}
export type InvoiceDto = ReturnType<typeof invoiceDto>;

const invoiceInclude = { payments: { orderBy: { createdAt: "desc" }, take: 3, select: { status: true, gateway: true, failureReason: true, createdAt: true } } } satisfies Prisma.InvoiceInclude;

export async function listInvoices(organizationId: string, f: { page: number; pageSize: number; status?: string }) {
  const where: Prisma.InvoiceWhereInput = { organizationId, ...(f.status ? { status: f.status } : {}) };
  const [rows, total] = await Promise.all([
    db.invoice.findMany({ where, orderBy: { issuedAt: "desc" }, skip: (f.page - 1) * f.pageSize, take: f.pageSize, include: invoiceInclude }),
    db.invoice.count({ where }),
  ]);
  return { invoices: rows.map(invoiceDto), total };
}

export async function getInvoice(organizationId: string, id: string) {
  const i = await db.invoice.findFirst({ where: { id, organizationId }, include: invoiceInclude });
  if (!i) throw new ApiError("NOT_FOUND", "Invoice not found.");
  return invoiceDto(i);
}

// ---------------------------------------------------------------------------
// Subscription helpers
// ---------------------------------------------------------------------------

async function ownersOf(organizationId: string) {
  return db.organizationMember.findMany({ where: { organizationId, role: "CLIENT_OWNER" }, select: { userId: true } });
}
async function tellOwners(organizationId: string, title: string, body = "", type: "info" | "success" | "warning" = "info") {
  for (const o of await ownersOf(organizationId)) await notify({ userId: o.userId, organizationId, type, title, body, link: "/billing" });
}

/** Ends the active subscription and starts a new one on `plan`. History is kept (one row per plan period). */
async function switchPlan(organizationId: string, plan: Plan, opts: { billingMode: "invoiced" | "complimentary" | "trial"; periodStart: Date; periodEnd: Date | null; reason: string; interval?: Interval; trialEndsAt?: Date | null }) {
  const fresh = await replaceSubscription(organizationId, plan, opts);
  await autopayAfterPlanChange(organizationId); // the mandate follows the new row if the charge is the same, else it's cancelled
  return fresh;
}

async function replaceSubscription(organizationId: string, plan: Plan, opts: { billingMode: "invoiced" | "complimentary" | "trial"; periodStart: Date; periodEnd: Date | null; reason: string; interval?: Interval; trialEndsAt?: Date | null }) {
  const now = new Date();
  const interval = opts.interval ?? "month";
  return db.$transaction(async (tx) => {
    await tx.subscription.updateMany({ where: { organizationId, status: "active" }, data: { status: "ended", endedAt: now, endReason: opts.reason } });
    return tx.subscription.create({
      data: {
        organizationId,
        planId: plan.id,
        // A trial earns nothing: it is 0 in MRR until it converts (the paid period is a new row).
        priceMonthly: opts.billingMode === "trial" ? 0 : monthlyEquivalent(plan, interval),
        interval,
        periodPrice: planPrice(plan, interval),
        trialEndsAt: opts.trialEndsAt ?? null,
        startedAt: now,
        billingMode: opts.billingMode,
        currentPeriodStart: opts.periodStart,
        currentPeriodEnd: opts.periodEnd,
      },
    });
  });
}

/** One free trial per workspace: never trialled before and never paid for a plan. */
export async function trialEligible(organizationId: string) {
  const [trialled, paid] = await Promise.all([
    db.subscription.count({ where: { organizationId, trialEndsAt: { not: null } } }),
    db.invoice.count({ where: { organizationId, status: "paid", kind: { in: ["subscription", "upgrade", "renewal"] } } }),
  ]);
  return trialled === 0 && paid === 0;
}

/** Does the workspace's current usage fit inside `plan`? Returns the reasons it doesn't. */
export async function fitProblems(organizationId: string, plan: Plan): Promise<string[]> {
  const [seats, numbers, automations] = await Promise.all([
    db.organizationMember.count({ where: { organizationId } }),
    db.whatsAppAccount.count({ where: { organizationId, status: { in: ACTIVE_NUMBER_STATUSES } } }),
    db.automation.count({ where: { organizationId, status: "active" } }),
  ]);
  const out: string[] = [];
  if (wouldExceed(seats, plan.maxUsers, 0)) out.push(`You have ${seats} team members; ${plan.name} allows ${limitLabel(plan.maxUsers)}.`);
  if (wouldExceed(numbers, plan.maxWhatsAppNumbers, 0)) out.push(`You have ${numbers} WhatsApp numbers; ${plan.name} allows ${limitLabel(plan.maxWhatsAppNumbers)}.`);
  if (wouldExceed(automations, plan.maxAutomations, 0)) out.push(`You have ${automations} active automations; ${plan.name} allows ${limitLabel(plan.maxAutomations)}.`);
  return out;
}

// ---------------------------------------------------------------------------
// Overview (client)
// ---------------------------------------------------------------------------

const planDto = (p: Plan) => ({ selfServe: p.selfServe, id: p.id, name: p.name, slug: p.slug, description: p.description, priceMonthly: p.priceMonthly, priceYearly: p.priceYearly, trialDays: p.trialDays, yearlySavingPct: p.priceYearly > 0 && p.priceMonthly > 0 ? Math.max(0, Math.round((1 - p.priceYearly / (p.priceMonthly * 12)) * 100)) : 0, currency: p.currency, limits: limitsOf(p), features: parseFeatures(p.features).map((k) => ({ key: k, label: FEATURES[k] })) });

type PaymentStatus = "not_billed" | "none" | "paid" | "pending" | "past_due" | "failed";

export async function getBillingOverview(organizationId: string) {
  const [sub, state, gateways, settings, openInvoices, lastPaid, canTrial, autopay] = await Promise.all([
    currentPlan(organizationId),
    billingState(organizationId),
    availableGateways(),
    getBillingSettings(),
    db.invoice.findMany({ where: { organizationId, status: "open" }, orderBy: { dueAt: "asc" }, include: invoiceInclude }),
    db.invoice.findFirst({ where: { organizationId, status: "paid" }, orderBy: { paidAt: "desc" } }),
    trialEligible(organizationId),
    autopayOverview(organizationId),
  ]);
  const plans = await db.plan.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: "asc" }, { priceMonthly: "asc" }] });
  const pending = sub?.pendingPlanId ? await db.plan.findUnique({ where: { id: sub.pendingPlanId } }) : null;

  let paymentStatus: PaymentStatus = "none";
  if (openInvoices.length) {
    const first = openInvoices[0];
    paymentStatus = first.dueAt.getTime() < Date.now() ? "past_due" : first.payments[0]?.status === "failed" ? "failed" : "pending";
  } else if (sub && sub.billingMode === "trial") paymentStatus = "not_billed";
  else if (sub && sub.billingMode !== "invoiced") paymentStatus = "not_billed";
  else if (lastPaid) paymentStatus = "paid";

  const canceled = !sub ? await db.subscription.findFirst({ where: { organizationId, status: "ended", endReason: "canceled" }, orderBy: { endedAt: "desc" }, include: { plan: true } }) : null;
  const rank = (p: { priceMonthly: number }) => p.priceMonthly;
  return {
    subscription: sub
      ? {
          plan: planDto(sub.plan),
          priceMonthly: sub.priceMonthly,
          interval: sub.interval,
          periodPrice: periodAmount(sub),
          trialEndsAt: sub.billingMode === "trial" ? sub.trialEndsAt : null,
          billingMode: sub.billingMode,
          startedAt: sub.startedAt,
          currentPeriodStart: sub.currentPeriodStart,
          nextBillingDate: (sub.billingMode === "invoiced" || sub.billingMode === "trial") && !sub.cancelAtPeriodEnd ? sub.currentPeriodEnd : null,
          endsAt: sub.cancelAtPeriodEnd ? sub.currentPeriodEnd : null,
          cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
          pendingPlan: pending ? { id: pending.id, name: pending.name, interval: sub.pendingInterval ?? sub.interval, takesEffectAt: sub.currentPeriodEnd } : null,
        }
      : null,
    canceledPlan: canceled ? { name: canceled.plan.name, endedAt: canceled.endedAt } : null,
    state: state.state,
    stateMessage: state.reason,
    paymentStatus,
    openInvoices: openInvoices.map(invoiceDto),
    plans: plans.map((p) => ({ ...planDto(p), relation: sub && p.id === sub.planId ? "current" : !p.selfServe ? "contact" : !sub ? "new" : rank(p) > rank(sub.plan) ? "upgrade" : "downgrade" })),
    trialAvailable: canTrial,
    gateways,
    onlinePaymentsConnected: gateways.length > 0,
    tax: { percent: settings.taxPercent },
    autopay,
    supportEmail: settings.supportEmail,
    paymentInstructions: settings.paymentInstructions,
  };
}

// ---------------------------------------------------------------------------
// Upgrade / downgrade / cancel / resume
// ---------------------------------------------------------------------------

/** Preview what choosing `planId` would do — nothing is changed. */
export async function previewChange(organizationId: string, planId: string, interval: Interval = "month") {
  const [sub, plan, settings] = await Promise.all([currentPlan(organizationId), db.plan.findUnique({ where: { id: planId } }), getBillingSettings()]);
  if (!plan || !plan.isActive) throw new ApiError("VALIDATION_ERROR", "Choose an available plan.", { details: { planId: ["Not available"] } });
  if (interval === "year" && plan.priceYearly <= 0) throw new ApiError("VALIDATION_ERROR", `${plan.name} isn't offered with yearly billing.`, { details: { interval: ["Not offered"] } });
  if (sub?.planId === plan.id && sub.interval === interval) throw new ApiError("CONFLICT", "You're already on this plan.");
  if (!plan.selfServe) throw new ApiError("CONFLICT", `${plan.name} is arranged with our team. Contact MECGURA to move to it.`);
  const problems = await fitProblems(organizationId, plan);
  const now = new Date();
  const price = planPrice(plan, interval);
  // Free trial: first plan of a workspace that never trialled or paid, while not on a paid period.
  const onPaid = sub && sub.billingMode === "invoiced" && periodAmount(sub) > 0;
  if (plan.trialDays > 0 && price > 0 && !onPaid && sub?.billingMode !== "trial" && (await trialEligible(organizationId))) {
    const trialEndsAt = new Date(now.getTime() + plan.trialDays * DAY);
    return { plan: planDto(plan), interval, direction: "trial" as const, amount: 0, tax: 0, total: 0, effective: "now" as const, effectiveAt: null, trialEndsAt, firstCharge: price, problems, blocked: false };
  }
  const subInterval = sub?.interval ?? "month";
  const currentMonthly = sub ? (sub.billingMode === "trial" ? monthlyEquivalent(sub.plan, subInterval) : sub.priceMonthly) : 0;
  const longer = sub && interval === "year" && subInterval === "month";
  // Yearly → monthly always waits for the end of the paid year.
  const shorter = Boolean(sub && sub.billingMode === "invoiced" && subInterval === "year" && interval === "month");
  const upgrade = !shorter && (!sub || sub.billingMode === "trial" || monthlyEquivalent(plan, interval) > currentMonthly || Boolean(longer && monthlyEquivalent(plan, interval) >= Math.round(currentMonthly * 0.7)));
  let amount = 0;
  let effective: "now" | "on_payment" | "period_end" = "now";
  if (upgrade) {
    if (!sub || sub.billingMode !== "invoiced" || !sub.currentPeriodEnd || !sub.currentPeriodStart) amount = price;
    else if (interval !== subInterval) amount = price - prorate(periodAmount(sub), sub.currentPeriodStart, sub.currentPeriodEnd, now); // a fresh year, less the unused part of this month
    else amount = prorate(price, sub.currentPeriodStart, sub.currentPeriodEnd, now) - prorate(periodAmount(sub), sub.currentPeriodStart, sub.currentPeriodEnd, now);
    amount = Math.max(0, amount);
    effective = amount > 0 ? "on_payment" : "now";
  } else {
    effective = sub && sub.billingMode === "invoiced" && sub.currentPeriodEnd ? "period_end" : "now";
  }
  const tax = taxOn(amount, Math.round(settings.taxPercent * 100));
  return { plan: planDto(plan), interval, direction: upgrade ? (sub ? ("upgrade" as const) : ("new" as const)) : ("downgrade" as const), amount, tax, total: amount + tax, effective, effectiveAt: effective === "period_end" ? (sub?.currentPeriodEnd ?? null) : null, trialEndsAt: null, firstCharge: null, problems, blocked: !upgrade && problems.length > 0 };
}

export async function changePlan(access: OrgAccess, planId: string, req?: Request, interval: Interval = "month") {
  const orgId = access.organizationId;
  const pv = await previewChange(orgId, planId, interval);
  const plan = await db.plan.findUniqueOrThrow({ where: { id: planId } });
  const sub = await currentPlan(orgId);
  if (pv.direction === "downgrade" && pv.problems.length) throw new ApiError("CONFLICT", `You can't move to ${plan.name} yet. ${pv.problems.join(" ")}`, { details: { plan: pv.problems } });
  const now = new Date();

  // ---- Free trial: no invoice now; the first one is created when the trial ends.
  if (pv.direction === "trial") {
    if (pv.problems.length) throw new ApiError("CONFLICT", `You can't move to ${plan.name} yet. ${pv.problems.join(" ")}`, { details: { plan: pv.problems } });
    await switchPlan(orgId, plan, { billingMode: "trial", periodStart: now, periodEnd: pv.trialEndsAt, trialEndsAt: pv.trialEndsAt, interval, reason: "replaced" });
    await audit({ action: "billing.trial_started", actorUserId: access.user.id, organizationId: orgId, targetType: "plan", targetId: plan.id, metadata: { plan: plan.slug, interval, endsAt: pv.trialEndsAt }, req });
    await tellOwners(orgId, `Your ${plan.trialDays}-day free trial of ${plan.name} has started`, "No payment needed until it ends. You can cancel any time in Billing.", "success");
    return { result: "trial" as const, trialEndsAt: pv.trialEndsAt, plan: planDto(plan) };
  }

  // ---- Downgrade
  if (pv.direction === "downgrade" && sub) {
    if (pv.effective === "period_end") {
      await db.subscription.update({ where: { id: sub.id }, data: { pendingPlanId: plan.id, pendingInterval: interval, cancelAtPeriodEnd: false, canceledAt: null } });
      await audit({ action: "billing.downgrade_scheduled", actorUserId: access.user.id, organizationId: orgId, targetType: "plan", targetId: plan.id, metadata: { from: sub.plan.slug, to: plan.slug, at: sub.currentPeriodEnd }, req });
      return { result: "scheduled" as const, effectiveAt: sub.currentPeriodEnd, plan: planDto(plan) };
    }
    await switchPlan(orgId, plan, { billingMode: sub.billingMode === "invoiced" ? "invoiced" : "complimentary", periodStart: now, periodEnd: sub.billingMode === "invoiced" ? addPeriod(now, interval) : null, reason: "replaced", interval });
    await audit({ action: "plan.changed", actorUserId: access.user.id, organizationId: orgId, targetType: "plan", targetId: plan.id, metadata: { from: sub.plan.slug, to: plan.slug, self_service: true }, req });
    return { result: "changed" as const, plan: planDto(plan) };
  }

  // ---- Upgrade / first plan
  if (pv.amount === 0) {
    await activateUpgrade(orgId, plan.id, access.user.id, req, interval);
    return { result: "changed" as const, plan: planDto(plan) };
  }
  const existing = await db.invoice.findFirst({ where: { organizationId: orgId, status: "open", targetPlanId: plan.id, targetInterval: interval } });
  if (existing) return { result: "invoice" as const, invoice: invoiceDto(existing), plan: planDto(plan) };
  const invoicedPeriod = sub && sub.billingMode === "invoiced" && sub.currentPeriodEnd && sub.currentPeriodStart;
  const samePeriod = invoicedPeriod && sub.interval === interval;
  const yearly = interval === "year";
  const inv = await createInvoice({
    organizationId: orgId,
    subscriptionId: sub?.id ?? null,
    kind: sub ? "upgrade" : "subscription",
    description: samePeriod ? `Upgrade to ${plan.name} (prorated)` : `${plan.name} plan — ${yearly ? "1 year" : "first month"}`,
    lines: [
      {
        description: samePeriod
          ? `${plan.name} plan, remainder of current period (prorated, less unused ${sub.plan.name})`
          : invoicedPeriod
            ? `${plan.name} plan — ${per(interval)} (less unused part of current ${sub.plan.name} period)`
            : `${plan.name} plan — ${per(interval)}`,
        amount: pv.amount,
      },
    ],
    periodStart: now,
    periodEnd: samePeriod ? sub.currentPeriodEnd : addPeriod(now, interval),
    targetPlanId: plan.id,
    targetInterval: interval,
  });
  await audit({ action: "billing.invoice_created", actorUserId: access.user.id, organizationId: orgId, targetType: "invoice", targetId: inv.id, metadata: { number: inv.number, total: inv.total, kind: inv.kind }, req });
  return { result: "invoice" as const, invoice: invoiceDto(inv), plan: planDto(plan) };
}

/** Puts the workspace on `planId` now. Called when an upgrade invoice is paid, or when the amount due is zero. */
async function activateUpgrade(organizationId: string, planId: string, actorUserId: string | null, req?: Request, interval: Interval = "month") {
  const plan = await db.plan.findUniqueOrThrow({ where: { id: planId } });
  const sub = await currentPlan(organizationId);
  const now = new Date();
  // Mid-period upgrades on the same interval keep the renewal date; a first plan, a new interval or a re-subscription starts a fresh period.
  const keep = sub && sub.billingMode === "invoiced" && sub.interval === interval && sub.currentPeriodEnd && sub.currentPeriodEnd > now;
  const billed = planPrice(plan, interval) > 0;
  await switchPlan(organizationId, plan, {
    billingMode: billed ? "invoiced" : "complimentary",
    periodStart: keep ? sub.currentPeriodStart! : now,
    periodEnd: billed ? (keep ? sub.currentPeriodEnd! : addPeriod(now, interval)) : null,
    reason: "replaced",
    interval,
  });
  await audit({ action: "plan.changed", actorUserId, organizationId, targetType: "plan", targetId: plan.id, metadata: { from: sub?.plan.slug ?? null, to: plan.slug, self_service: true }, req });
  await tellOwners(organizationId, `Your plan is now ${plan.name}`, "", "success");
}

export async function cancelSubscription(access: OrgAccess, req?: Request) {
  const sub = await currentPlan(access.organizationId);
  if (!sub) throw new ApiError("CONFLICT", "There's no active plan to cancel.");
  if (sub.cancelAtPeriodEnd) throw new ApiError("CONFLICT", "This plan is already set to end.");
  const now = new Date();
  if ((sub.billingMode === "invoiced" || sub.billingMode === "trial") && sub.currentPeriodEnd && sub.currentPeriodEnd > now) {
    await db.subscription.update({ where: { id: sub.id }, data: { cancelAtPeriodEnd: true, canceledAt: now, pendingPlanId: null, pendingInterval: null } });
    await autopayOnCancel(access.organizationId); // nothing is charged at period end
    await audit({ action: "billing.canceled", actorUserId: access.user.id, organizationId: access.organizationId, targetType: "subscription", targetId: sub.id, metadata: { plan: sub.plan.slug, endsAt: sub.currentPeriodEnd }, req });
    return { result: "scheduled" as const, endsAt: sub.currentPeriodEnd };
  }
  await db.subscription.update({ where: { id: sub.id }, data: { status: "ended", endedAt: now, endReason: "canceled", canceledAt: now, cancelAtPeriodEnd: false } });
  await db.invoice.updateMany({ where: { organizationId: access.organizationId, status: "open" }, data: { status: "void", voidedAt: now } });
  await autopayOnCancel(access.organizationId);
  await audit({ action: "billing.canceled", actorUserId: access.user.id, organizationId: access.organizationId, targetType: "subscription", targetId: sub.id, metadata: { plan: sub.plan.slug, immediate: true }, req });
  return { result: "ended" as const, endsAt: now };
}

/** Undo a scheduled cancellation or downgrade. */
export async function resumeSubscription(access: OrgAccess, req?: Request) {
  const sub = await currentPlan(access.organizationId);
  if (!sub || (!sub.cancelAtPeriodEnd && !sub.pendingPlanId)) throw new ApiError("CONFLICT", "Nothing is scheduled to change.");
  await db.subscription.update({ where: { id: sub.id }, data: { cancelAtPeriodEnd: false, canceledAt: null, pendingPlanId: null, pendingInterval: null } });
  await audit({ action: "billing.resumed", actorUserId: access.user.id, organizationId: access.organizationId, targetType: "subscription", targetId: sub.id, req });
}

// ---------------------------------------------------------------------------
// Paying
// ---------------------------------------------------------------------------

/**
 * Marks an invoice paid and applies what it was for. The ONLY places that call this are a verified gateway
 * confirmation and an admin recording money actually received — there is no "pay" shortcut.
 */
export async function markInvoicePaid(invoiceId: string, via: string, note: string, actorUserId: string | null, req?: Request) {
  const now = new Date();
  const flipped = await db.invoice.updateMany({ where: { id: invoiceId, status: "open" }, data: { status: "paid", paidAt: now, paidVia: via, paymentNote: note.slice(0, 300) } });
  if (!flipped.count) return false; // already paid or void — never applied twice
  const inv = await db.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
  if (inv.targetPlanId) await activateUpgrade(inv.organizationId, inv.targetPlanId, actorUserId, req, inv.targetInterval === "year" ? "year" : "month");
  // Prepaid credit: the wallet gets the pre-tax amount. The key makes a repeated webhook add it only once.
  if (inv.kind === "topup") {
    await creditWallet(inv.organizationId, { actorUserId, req }, { amount: inv.subtotal, reason: "topup", reference: inv.number, note: `Online payment (${via})`, idempotencyKey: `topup:${inv.id}` });
  }
  await audit({ action: "billing.invoice_paid", actorUserId, organizationId: inv.organizationId, targetType: "invoice", targetId: inv.id, metadata: { number: inv.number, total: inv.total, via }, req });
  await tellOwners(inv.organizationId, `Payment received for ${inv.number}`, "Thank you!", "success");
  return true;
}

export async function startPayment(access: OrgAccess, invoiceId: string, gatewayId: string): Promise<CheckoutSession & { paymentId: string }> {
  const inv = await db.invoice.findFirst({ where: { id: invoiceId, organizationId: access.organizationId } });
  if (!inv) throw new ApiError("NOT_FOUND", "Invoice not found.");
  if (inv.status !== "open") throw new ApiError("CONFLICT", inv.status === "paid" ? "This invoice is already paid." : "This invoice is void.");
  const gateway = getGateway(gatewayId);
  if (!gateway || !(await gateway.isConfigured())) {
    throw new ApiError("CONFLICT", "Online payments aren't connected yet. Pay by bank transfer / UPI to the details on the invoice and MECGURA will record it, or contact support.");
  }
  const org = await db.organization.findUniqueOrThrow({ where: { id: access.organizationId }, select: { name: true, contactEmail: true } });
  try {
    const session = await gateway.createCheckout({ invoiceId: inv.id, invoiceNumber: inv.number, amount: inv.total, currency: inv.currency, organizationId: inv.organizationId, customer: { name: org.name, email: org.contactEmail || access.user.email }, description: inv.description });
    const p = await db.payment.create({ data: { organizationId: inv.organizationId, invoiceId: inv.id, gateway: gateway.id, gatewayRef: session.reference, amount: inv.total, currency: inv.currency, status: "created" } });
    return { ...session, paymentId: p.id };
  } catch (e) {
    if (e instanceof GatewayError) throw new ApiError("SERVICE_UNAVAILABLE", e.message);
    throw new ApiError("SERVICE_UNAVAILABLE", "The payment provider didn't respond. Try again in a moment.");
  }
}

/** The browser came back from the provider's widget: verify its proof server-side before believing it. */
export async function completeClientPayment(access: OrgAccess, paymentId: string, data: Record<string, string>) {
  const p = await db.payment.findFirst({ where: { id: paymentId, organizationId: access.organizationId } });
  if (!p) throw new ApiError("NOT_FOUND", "Payment not found.");
  const gateway = getGateway(p.gateway);
  if (!gateway?.verifyClientReturn) throw new ApiError("CONFLICT", "This payment is confirmed by the provider directly; it will update shortly.");
  let event: GatewayEvent;
  try {
    event = await gateway.verifyClientReturn(data, p.gatewayRef);
  } catch (e) {
    throw new ApiError("VALIDATION_ERROR", e instanceof GatewayError ? e.message : "Payment verification failed.");
  }
  await applyGatewayEvents(p.gateway, [event]);
  const inv = await db.invoice.findUniqueOrThrow({ where: { id: p.invoiceId }, include: invoiceInclude });
  return invoiceDto(inv);
}

/**
 * Applies provider events. Each (gateway, eventId) is processed once. A success only counts when the
 * reference is a payment we created and the reported amount (if any) matches the invoice.
 */
const isSubscriptionEvent = (e: GatewayEvent | SubscriptionEvent): e is SubscriptionEvent => e.type === "subscription.status" || e.type === "subscription.charged";

export async function applyGatewayEvents(gatewayId: string, events: (GatewayEvent | SubscriptionEvent)[]) {
  const results: { eventId: string; outcome: string }[] = [];
  for (const ev of events) {
    const seen = await db.paymentEvent.create({ data: { gateway: gatewayId, eventId: ev.eventId, type: ev.type } }).catch(() => null);
    if (!seen) {
      results.push({ eventId: ev.eventId, outcome: "duplicate" });
      continue;
    }
    const outcome = isSubscriptionEvent(ev) ? await applySubscriptionEvent(ev) : await applyOne(gatewayId, ev);
    await db.paymentEvent.update({ where: { id: seen.id }, data: { processedAt: new Date(), outcome } });
    results.push({ eventId: ev.eventId, outcome });
  }
  return results;
}

async function applyOne(gatewayId: string, ev: GatewayEvent): Promise<string> {
  const p = await db.payment.findFirst({ where: { gateway: gatewayId, gatewayRef: ev.reference } });
  if (!p) return "unknown_reference";
  const inv = await db.invoice.findUniqueOrThrow({ where: { id: p.invoiceId } });
  const now = new Date();
  if (ev.type === "payment.failed") {
    if (p.status === "succeeded") return "ignored_already_paid";
    await db.payment.update({ where: { id: p.id }, data: { status: "failed", gatewayPaymentId: ev.paymentId, failureCode: ev.failureCode ?? "", failureReason: ev.failureReason ?? "", completedAt: now } });
    await audit({ action: "billing.payment_failed", organizationId: p.organizationId, targetType: "invoice", targetId: inv.id, metadata: { number: inv.number, gateway: gatewayId, code: ev.failureCode ?? "" } });
    await tellOwners(p.organizationId, `Payment failed for ${inv.number}`, ev.failureReason || "Please try again or use another method.", "warning");
    return "failed";
  }
  if ((ev.amount !== null && ev.amount !== inv.total) || (ev.currency && ev.currency !== inv.currency)) {
    await db.payment.update({ where: { id: p.id }, data: { status: "failed", gatewayPaymentId: ev.paymentId, failureCode: "amount_mismatch", failureReason: "The amount received doesn't match the invoice.", completedAt: now } });
    await audit({ action: "billing.payment_failed", organizationId: p.organizationId, targetType: "invoice", targetId: inv.id, metadata: { number: inv.number, gateway: gatewayId, code: "amount_mismatch", reported: ev.amount } });
    return "amount_mismatch";
  }
  await db.payment.update({ where: { id: p.id }, data: { status: "succeeded", gatewayPaymentId: ev.paymentId, failureCode: "", failureReason: "", completedAt: now } });
  const applied = await markInvoicePaid(inv.id, gatewayId, ev.paymentId, null);
  return applied ? "paid" : "invoice_not_open";
}

/** Admin recorded money actually received outside a gateway (bank transfer, UPI, cheque). */
export async function recordManualPayment(adminUserId: string, invoiceId: string, input: { reference: string }, req?: Request) {
  const inv = await db.invoice.findUnique({ where: { id: invoiceId } });
  if (!inv) throw new ApiError("NOT_FOUND", "Invoice not found.");
  if (inv.status !== "open") throw new ApiError("CONFLICT", inv.status === "paid" ? "This invoice is already paid." : "This invoice is void.");
  await db.payment.create({ data: { organizationId: inv.organizationId, invoiceId: inv.id, gateway: "manual", gatewayRef: input.reference.slice(0, 100), amount: inv.total, currency: inv.currency, status: "succeeded", completedAt: new Date() } });
  await markInvoicePaid(inv.id, "manual", input.reference, adminUserId, req);
  return invoiceDto(await db.invoice.findUniqueOrThrow({ where: { id: inv.id }, include: invoiceInclude }));
}

export async function voidInvoice(adminUserId: string, invoiceId: string, req?: Request) {
  const inv = await db.invoice.findUnique({ where: { id: invoiceId } });
  if (!inv) throw new ApiError("NOT_FOUND", "Invoice not found.");
  if (inv.status !== "open") throw new ApiError("CONFLICT", "Only open invoices can be voided.");
  await db.invoice.update({ where: { id: inv.id }, data: { status: "void", voidedAt: new Date() } });
  await audit({ action: "billing.invoice_voided", actorUserId: adminUserId, organizationId: inv.organizationId, targetType: "invoice", targetId: inv.id, metadata: { number: inv.number }, req });
}

// ---------------------------------------------------------------------------
// Admin assigns a plan (contract) — optionally billed
// ---------------------------------------------------------------------------

/** Called by the admin "assign plan" flow right after the new subscription row exists. */
export async function startBilling(sub: Subscription, plan: Plan, billingMode: "invoiced" | "complimentary") {
  const now = new Date();
  const invoiced = billingMode === "invoiced" && plan.priceMonthly > 0;
  await db.subscription.update({ where: { id: sub.id }, data: { billingMode: invoiced ? "invoiced" : "complimentary", interval: "month", periodPrice: plan.priceMonthly, currentPeriodStart: now, currentPeriodEnd: invoiced ? addMonth(now) : null } });
  if (!invoiced) return null;
  return createInvoice({ organizationId: sub.organizationId, subscriptionId: sub.id, kind: "subscription", description: `${plan.name} plan — first month`, lines: [{ description: `${plan.name} plan — 1 month`, amount: plan.priceMonthly }], periodStart: now, periodEnd: addMonth(now) });
}

// ---------------------------------------------------------------------------
// The billing cycle (scheduler)
// ---------------------------------------------------------------------------

/**
 * Idempotent. Per active subscription whose period has ended: honour a scheduled cancellation, convert a free
 * trial into its first paid period, apply a scheduled downgrade (if usage still fits), otherwise renew —
 * invoiced plans get the next invoice (monthly or yearly). Also sends trial-ending and payment reminders.
 */
export async function runBillingCycle(now = new Date()) {
  const out = { initialized: 0, renewed: 0, invoices: 0, canceled: 0, downgraded: 0, overdueNotices: 0, trialsConverted: 0, trialReminders: 0, reminders: 0 };
  const subs = await db.subscription.findMany({ where: { status: "active" }, include: { plan: true } });
  const settings = await getBillingSettings();
  const due = (from: Date) => new Date(from.getTime() + settings.dueDays * DAY);
  for (const sub of subs) {
    if (!sub.currentPeriodStart || (!sub.currentPeriodEnd && sub.billingMode !== "complimentary")) {
      await db.subscription.update({ where: { id: sub.id }, data: { currentPeriodStart: sub.currentPeriodStart ?? now, currentPeriodEnd: sub.billingMode === "complimentary" ? null : addPeriod(now, sub.interval) } });
      out.initialized++; // legacy rows start counting from now — nobody is billed for the past
      continue;
    }
    // Trial ending in 3 days: tell the owners once, with the first charge.
    if (sub.billingMode === "trial" && sub.currentPeriodEnd && !sub.trialReminderAt && !sub.cancelAtPeriodEnd && sub.currentPeriodEnd.getTime() - now.getTime() <= 3 * DAY && sub.currentPeriodEnd > now) {
      await db.subscription.update({ where: { id: sub.id }, data: { trialReminderAt: now } });
      const amount = planPrice(sub.plan, sub.interval);
      await tellOwners(sub.organizationId, `Your free trial of ${sub.plan.name} ends on ${fmtDay(sub.currentPeriodEnd)}`, `Then ${fmtInr(amount)} ${sub.interval === "year" ? "per year" : "per month"} (+ tax). Cancel any time in Billing before then to pay nothing.`, "info");
      out.trialReminders++;
    }
    if (!sub.currentPeriodEnd || sub.currentPeriodEnd > now) continue;

    if (sub.cancelAtPeriodEnd) {
      await db.subscription.update({ where: { id: sub.id }, data: { status: "ended", endedAt: now, endReason: "canceled" } });
      await db.invoice.updateMany({ where: { organizationId: sub.organizationId, status: "open", dueAt: { gt: now } }, data: { status: "void", voidedAt: now } });
      await tellOwners(sub.organizationId, sub.billingMode === "trial" ? "Your free trial has ended" : "Your subscription has ended", "Choose a plan in Billing to keep sending.", "warning");
      out.canceled++;
      continue;
    }

    // Trial over: the first paid period starts now (a new row, so MRR history stays true).
    if (sub.billingMode === "trial") {
      const start = sub.currentPeriodEnd;
      const price = planPrice(sub.plan, sub.interval);
      const interval: Interval = sub.interval === "year" ? "year" : "month";
      const fresh = await switchPlan(sub.organizationId, sub.plan, { billingMode: price > 0 ? "invoiced" : "complimentary", periodStart: start, periodEnd: price > 0 ? addPeriod(start, interval) : null, reason: "trial_converted", interval });
      if (price > 0) {
        await createInvoice({ organizationId: sub.organizationId, subscriptionId: fresh.id, kind: "subscription", description: `${sub.plan.name} plan — ${interval === "year" ? "1 year" : fmtMonth(start)}`, lines: [{ description: `${sub.plan.name} plan — ${per(interval)} (after free trial)`, amount: price }], periodStart: start, periodEnd: addPeriod(start, interval), dueAt: due(start) });
        out.invoices++;
      }
      await audit({ action: "billing.trial_converted", organizationId: sub.organizationId, targetType: "subscription", targetId: fresh.id, metadata: { plan: sub.plan.slug, interval } });
      await tellOwners(sub.organizationId, `Your free trial ended — ${sub.plan.name} continues`, price > 0 ? "Your first invoice is in Billing." : "", "info");
      out.trialsConverted++;
      continue;
    }

    let plan = sub.plan;
    if (sub.pendingPlanId) {
      const next = await db.plan.findUnique({ where: { id: sub.pendingPlanId } });
      const nextInterval: Interval = (sub.pendingInterval ?? sub.interval) === "year" ? "year" : "month";
      if (next && planPrice(next, nextInterval) >= 0 && (await fitProblems(sub.organizationId, next)).length === 0) {
        const nextPrice = planPrice(next, nextInterval);
        const fresh = await switchPlan(sub.organizationId, next, { billingMode: "invoiced", periodStart: sub.currentPeriodEnd, periodEnd: addPeriod(sub.currentPeriodEnd, nextInterval), reason: "replaced", interval: nextInterval });
        plan = next;
        out.downgraded++;
        await tellOwners(sub.organizationId, `Your plan is now ${next.name}`, "The scheduled change took effect.");
        if (nextPrice > 0) {
          await createInvoice({ organizationId: sub.organizationId, subscriptionId: fresh.id, kind: "renewal", description: `${next.name} plan — ${nextInterval === "year" ? "1 year" : fmtMonth(sub.currentPeriodEnd)}`, lines: [{ description: `${next.name} plan — ${per(nextInterval)}`, amount: nextPrice }], periodStart: sub.currentPeriodEnd, periodEnd: addPeriod(sub.currentPeriodEnd, nextInterval), dueAt: due(sub.currentPeriodEnd) });
          out.invoices++;
        }
        continue;
      }
      await db.subscription.update({ where: { id: sub.id }, data: { pendingPlanId: null, pendingInterval: null } });
      await tellOwners(sub.organizationId, "Your scheduled plan change was cancelled", "Your usage no longer fits the lower plan, so you stay on your current plan.", "warning");
    }
    const end = addPeriod(sub.currentPeriodEnd, sub.interval);
    await db.subscription.update({ where: { id: sub.id }, data: { currentPeriodStart: sub.currentPeriodEnd, currentPeriodEnd: sub.billingMode === "invoiced" ? end : null } });
    out.renewed++;
    const amount = periodAmount(sub);
    if (sub.billingMode === "invoiced" && amount > 0) {
      await createInvoice({ organizationId: sub.organizationId, subscriptionId: sub.id, kind: "renewal", description: `${plan.name} plan — ${sub.interval === "year" ? `1 year from ${fmtDay(sub.currentPeriodEnd)}` : fmtMonth(sub.currentPeriodEnd)}`, lines: [{ description: `${plan.name} plan — ${per(sub.interval)}`, amount }], periodStart: sub.currentPeriodEnd, periodEnd: end, dueAt: due(sub.currentPeriodEnd) });
      out.invoices++;
    }
  }
  const r = await sendPaymentReminders(now);
  out.reminders = r.sent;
  out.overdueNotices = r.overdue;
  return out;
}

/**
 * Payment reminders for open plan invoices, each sent once: 3 days before the due date, on/after it,
 * 3 days late and 7 days late (final). In-app for owners, plus email when email is configured.
 * When auto-pay (Razorpay Subscriptions) is on, the before-due reminder says it will be charged automatically;
 * the overdue reminders still go out if a charge didn't arrive.
 */
export async function sendPaymentReminders(now = new Date()) {
  const settings = await getBillingSettings();
  const open = await db.invoice.findMany({ where: { status: "open", kind: { not: "topup" }, remindersSent: { lt: 4 }, dueAt: { lte: new Date(now.getTime() + 3 * DAY) } } });
  let sent = 0;
  let overdue = 0;
  for (const inv of open) {
    const late = now.getTime() - inv.dueAt.getTime();
    let level = late >= 7 * DAY ? 4 : late >= 3 * DAY ? 3 : late >= 0 ? 2 : 1;
    if (level === 3 && inv.remindersSent < 2) level = 2; // the first notice after the due date is always "overdue"
    if (level <= inv.remindersSent) continue;
    // Claim the level so two scheduler runs never send the same reminder.
    const claimed = await db.invoice.updateMany({ where: { id: inv.id, remindersSent: inv.remindersSent }, data: { remindersSent: level, lastReminderAt: now, ...(level >= 2 && !inv.overdueNotifiedAt ? { overdueNotifiedAt: now } : {}) } });
    if (!claimed.count) continue;
    const amount = fmtInr(inv.total);
    const auto = level === 1 && inv.kind !== "upgrade" ? await liveAutopay(inv.organizationId) : null;
    const msg =
      auto && (auto.status === "active" || auto.status === "authenticated")
        ? { title: `Invoice ${inv.number} will be paid by auto-pay`, body: `${amount} will be charged automatically on the billing date. Nothing to do.`, type: "info" as const }
        : level === 1
        ? { title: `Invoice ${inv.number} is due on ${fmtDay(inv.dueAt)}`, body: `${amount}. Pay online in Billing to avoid any interruption.`, type: "info" as const }
        : level === 2
          ? { title: `Invoice ${inv.number} is overdue`, body: `${amount}. Pay within ${settings.graceDays} days to avoid your sending being paused.`, type: "warning" as const }
          : level === 3
            ? { title: `Reminder: invoice ${inv.number} is still unpaid`, body: `${amount} was due on ${fmtDay(inv.dueAt)}. Pay in Billing, or reply to us if something's wrong.`, type: "warning" as const }
            : { title: `Final reminder: invoice ${inv.number}`, body: `${amount} is 7 days overdue. Sending is paused after ${settings.graceDays} days overdue until it's paid.`, type: "warning" as const };
    await tellOwners(inv.organizationId, msg.title, msg.body, msg.type);
    if (isEmailConfigured()) {
      const owners = await db.organizationMember.findMany({ where: { organizationId: inv.organizationId, role: "CLIENT_OWNER" }, select: { user: { select: { email: true } } } });
      for (const o of owners) await sendMail(o.user.email, msg.title, `${msg.body}\n\nPay here: ${siteConfig.url}/billing\n\n— MECGURA`).catch(() => null);
    }
    sent++;
    if (level === 2) overdue++;
  }
  return { sent, overdue };
}

const fmtDay = (d: Date) => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }).format(d);
const fmtInr = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const fmtMonth = (d: Date) => new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric", timeZone: "UTC" }).format(d);


// ---------------------------------------------------------------------------
// Wallet top-up (client pays online, credit is added when the payment is confirmed)
// ---------------------------------------------------------------------------

export const MIN_TOPUP = 10_000; // ₹100
export const MAX_TOPUP = 5_000_000; // ₹50,000

/** Creates an open invoice for prepaid service credit. It is paid through the normal invoice checkout; the wallet is credited only once the gateway confirms payment. */
export async function createTopupInvoice(access: OrgAccess, amount: number, req?: Request) {
  if (!Number.isInteger(amount) || amount < MIN_TOPUP || amount > MAX_TOPUP) throw new ApiError("VALIDATION_ERROR", "Enter an amount between ₹100 and ₹50,000.", { details: { amountRupees: ["Between ₹100 and ₹50,000"] } });
  const open = await db.invoice.count({ where: { organizationId: access.organizationId, kind: "topup", status: "open" } });
  if (open >= 5) throw new ApiError("CONFLICT", "You have several unpaid top-up invoices. Pay or ask MECGURA to void them first.");
  const inv = await createInvoice({ organizationId: access.organizationId, kind: "topup", description: "Prepaid service credit (wallet top-up)", lines: [{ description: "Prepaid service credit", amount }] });
  await audit({ action: "billing.invoice_created", actorUserId: access.user.id, organizationId: access.organizationId, targetType: "invoice", targetId: inv.id, metadata: { number: inv.number, total: inv.total, kind: "topup" }, req });
  return invoiceDto(await db.invoice.findUniqueOrThrow({ where: { id: inv.id }, include: invoiceInclude }));
}
