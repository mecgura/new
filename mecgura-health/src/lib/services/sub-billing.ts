import "server-only";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";
import { AppError } from "@/lib/errors";
import { formatNumber } from "@/lib/subscriptions/numbering";
import { computeInvoice } from "@/lib/subscriptions/tax";
import { snapshotOfPlan, parseJson } from "@/lib/subscriptions/catalog";
import { addDaysUtc } from "@/lib/subscriptions/period";
import { providerByKey } from "@/lib/subscriptions/providers/registry";
import { invalidateEntitlements } from "./entitlements";
import { getPolicy, getTax, getVendor } from "./sub-config";
import { notifySubscription } from "./sub-notify";
import { logEvent, transition, SYSTEM, type Actor, type Tx } from "./sub-state";
import { uniqueViolation } from "./shared";

/* ------------------------------------------------------------ numbering (atomic, platform-wide, gap-free on rollback) ------------------------------------------------------------ */
export async function nextNumber(tx: Tx, kind: "INV" | "REC" | "RFD", now: Date): Promise<string> {
  const year = now.getUTCFullYear(); const key = `${kind}:${year}`;
  const row = await tx.platformCounter.upsert({ where: { key }, create: { key, value: 1 }, update: { value: { increment: 1 } } });
  return formatNumber(kind, year, row.value);
}

/* ------------------------------------------------------------------------- invoices ------------------------------------------------------------------------- */
export interface IssueInput {
  tenantId: string; subscriptionId: string; kind: "NEW" | "RENEWAL" | "UPGRADE" | "OTHER"; periodStart: Date; periodEnd: Date; items: { description: string; quantity?: number; unitMinor: number }[];
  discountMinor?: number; dedupeKey: string; change?: { planId: string; billingInterval: string; planVersion: number } | null; planName: string; createdById?: string | null; now?: Date; dueDays?: number; dueAt?: Date;
}
export const outstandingOf = (i: { totalMinor: number; paidMinor: number }) => Math.max(0, i.totalMinor - i.paidMinor);

/** Issues an invoice for one subscription purpose. Idempotent on `dedupeKey`: asking twice returns the first invoice. Tax and party details are SNAPSHOTTED. */
export async function issueInvoice(i: IssueInput) {
  const existing = await db.saasInvoice.findUnique({ where: { dedupeKey: i.dedupeKey } }); if (existing) return { invoice: existing, created: false };
  const now = i.now ?? new Date(); const [policy, tax, vendor, profile, tenant] = await Promise.all([getPolicy(), getTax(), getVendor(), db.subscriptionBillingProfile.findUnique({ where: { tenantId: i.tenantId } }), db.tenant.findUnique({ where: { id: i.tenantId }, select: { name: true, legalName: true, contactEmail: true, contactPhone: true, address: true, city: true, state: true, pincode: true } })]);
  const lines = i.items.map((x) => ({ ...x, quantity: x.quantity ?? 1 })); const math = computeInvoice(lines.map((l) => l.quantity * l.unitMinor), i.discountMinor ?? 0, tax, profile?.stateCode ?? null);
  const billTo = { name: profile?.legalName ?? tenant?.legalName ?? tenant?.name ?? "", billingName: profile?.billingName ?? null, email: profile?.billingEmail ?? tenant?.contactEmail ?? null, phone: profile?.billingPhone ?? tenant?.contactPhone ?? null, address: profile?.addressLine ?? tenant?.address ?? null, city: profile?.city ?? tenant?.city ?? null, state: profile?.state ?? tenant?.state ?? null, stateCode: profile?.stateCode ?? null, pincode: profile?.pincode ?? tenant?.pincode ?? null, gstin: profile?.gstin ?? null, taxId: profile?.taxId ?? null };
  const dueAt = i.dueAt ?? addDaysUtc(now, i.dueDays ?? policy.invoiceDueDays); const zero = math.totalMinor === 0;
  try {
    const invoice = await db.$transaction(async (tx) => {
      const invoiceNumber = await nextNumber(tx, "INV", now);
      return tx.saasInvoice.create({
        data: {
          tenantId: i.tenantId, subscriptionId: i.subscriptionId, invoiceNumber, kind: i.kind, status: zero ? "PAID" : "ISSUED", currency: "INR", periodStart: i.periodStart, periodEnd: i.periodEnd,
          subtotalMinor: math.subtotalMinor, discountMinor: math.discountMinor, taxMinor: math.taxMinor, totalMinor: math.totalMinor, paidMinor: 0, taxMode: math.taxMode,
          taxSnapshot: JSON.stringify({ enabled: tax.enabled, name: tax.name, rateBp: tax.rateBp, mode: tax.mode, lines: math.taxLines, placeOfSupply: math.placeOfSupply, vendorStateCode: tax.vendorStateCode }), vendorSnapshot: JSON.stringify(vendor), billToSnapshot: JSON.stringify(billTo),
          planName: i.planName, dedupeKey: i.dedupeKey, changeJson: i.change ? JSON.stringify(i.change) : null, issuedAt: now, dueAt, paidAt: zero ? now : null, createdById: i.createdById ?? null,
          items: { create: lines.map((l, n) => ({ tenantId: i.tenantId, position: n, description: l.description.slice(0, 200), quantity: l.quantity, unitMinor: l.unitMinor, totalMinor: l.quantity * l.unitMinor })) },
        },
      });
    });
    await recordAudit({ action: AUDIT_ACTIONS.SUBSCRIPTION_INVOICE_ISSUED, tenantId: i.tenantId, actorId: i.createdById ?? null, entityType: "saas_invoice", entityId: invoice.id, metadata: { number: invoice.invoiceNumber, kind: i.kind, totalMinor: invoice.totalMinor } });
    if (!zero) await notifySubscription(i.tenantId, i.kind === "RENEWAL" ? "SUBSCRIPTION_RENEWAL_UPCOMING" : "SUBSCRIPTION_INVOICE_ISSUED", `invoice:${invoice.id}`, { number: invoice.invoiceNumber, amount: money(invoice.totalMinor), date: dateText(dueAt) });
    return { invoice, created: true };
  } catch (e) { if (uniqueViolation(e)) { const again = await db.saasInvoice.findUnique({ where: { dedupeKey: i.dedupeKey } }); if (again) return { invoice: again, created: false }; } throw e; }
}
export const money = (minor: number) => `₹${(minor / 100).toLocaleString("en-IN", { minimumFractionDigits: minor % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
export const dateText = (d: Date) => d.toISOString().slice(0, 10);

export async function voidInvoice(invoiceId: string, actor: Actor, reason: string) {
  const inv = await db.saasInvoice.findUnique({ where: { id: invoiceId } }); if (!inv) throw new AppError("NOT_FOUND", { message: "That invoice doesn't exist." });
  if (inv.paidMinor > 0 || !["ISSUED", "OVERDUE", "DRAFT"].includes(inv.status)) throw new AppError("CONFLICT", { message: "Only an unpaid invoice can be voided. Paid invoices are corrected with a refund." });
  const r = await db.saasInvoice.updateMany({ where: { id: invoiceId, status: inv.status, paidMinor: 0 }, data: { status: "VOID", voidedAt: new Date() } });
  if (r.count === 0) throw new AppError("CONFLICT", { message: "The invoice changed while you were working." });
  await db.saasPayment.updateMany({ where: { invoiceId, status: "PENDING" }, data: { status: "CANCELLED" } });
  await recordAudit({ action: AUDIT_ACTIONS.SUBSCRIPTION_INVOICE_VOIDED, tenantId: inv.tenantId, actorId: actor.id, entityType: "saas_invoice", entityId: invoiceId, metadata: { number: inv.invoiceNumber, reasonLength: reason.length } });
}

/* --------------------------------------------------------------------- payments (the money path) --------------------------------------------------------------------- */
export interface PaymentInput {
  invoiceId: string; provider: string; providerPaymentId: string | null; providerOrderId?: string | null; amountMinor: number; currency?: string; method?: string; reference?: string | null;
  paidAt?: Date; actor: Actor; idempotencyKey: string; metadata?: Record<string, unknown>; now?: Date;
}
export interface PaymentOutcome { duplicate: boolean; paymentId: string; invoiceStatus: string; activated: string | null; receiptNumber: string | null; tenantId: string; overpaidMinor: number }

/**
 * Records a CONFIRMED payment against an invoice and — only when the invoice becomes fully paid — moves the subscription forward.
 * Safe to call any number of times, concurrently, for the same real-world payment: the unique keys on SaasPayment (idempotencyKey and
 * provider+providerPaymentId) let exactly ONE call win; the others return `duplicate: true` and change nothing.
 * Callers must only pass payments proven by the provider (verified webhook / provider lookup) or recorded by an authorised Super Admin.
 */
export async function applyPayment(p: PaymentInput): Promise<PaymentOutcome> {
  if (!Number.isSafeInteger(p.amountMinor) || p.amountMinor <= 0) throw new AppError("VALIDATION_ERROR", { message: "The payment amount must be a positive whole number of paise." });
  const now = p.now ?? new Date();
  const inv0 = await db.saasInvoice.findUnique({ where: { id: p.invoiceId } }); if (!inv0) throw new AppError("NOT_FOUND", { message: "That invoice doesn't exist." });
  if ((p.currency ?? "INR") !== inv0.currency) throw new AppError("VALIDATION_ERROR", { message: "The payment currency doesn't match the invoice." });
  const prior = await db.saasPayment.findFirst({ where: { OR: [{ idempotencyKey: p.idempotencyKey }, ...(p.providerPaymentId ? [{ provider: p.provider, providerPaymentId: p.providerPaymentId }] : [])] } });
  if (prior?.status === "SUCCEEDED" || prior?.status === "REFUNDED" || prior?.status === "PARTIALLY_REFUNDED") return { duplicate: true, paymentId: prior.id, invoiceStatus: inv0.status, activated: null, receiptNumber: prior.receiptNumber, tenantId: prior.tenantId, overpaidMinor: 0 };
  let out: PaymentOutcome;
  try {
    out = await db.$transaction(async (tx) => {
      // 1. the gate: claim a pending checkout row (compare-and-set) or insert a new row (unique keys)
      let payment: { id: string };
      const pending = p.providerOrderId ? await tx.saasPayment.findFirst({ where: { invoiceId: p.invoiceId, provider: p.provider, providerOrderId: p.providerOrderId, status: { in: ["PENDING", "FAILED"] } } }) : prior && prior.status !== "SUCCEEDED" ? prior : null;
      const base = { status: "SUCCEEDED", amountMinor: p.amountMinor, method: p.method ?? "ONLINE", providerPaymentId: p.providerPaymentId, providerOrderId: p.providerOrderId ?? null, transactionReference: p.reference ?? null, paidAt: p.paidAt ?? now, failureReason: null, recordedById: p.actor.id, metadata: JSON.stringify(p.metadata ?? {}) };
      if (pending) {
        const r = await tx.saasPayment.updateMany({ where: { id: pending.id, status: pending.status }, data: base });
        if (r.count === 0) throw new AppError("CONFLICT", { message: "duplicate" });
        payment = pending;
      } else {
        payment = await tx.saasPayment.create({ data: { ...base, tenantId: inv0.tenantId, subscriptionId: inv0.subscriptionId, invoiceId: inv0.id, currency: inv0.currency, provider: p.provider, idempotencyKey: p.idempotencyKey, attempt: (await tx.saasPayment.count({ where: { invoiceId: inv0.id } })) + 1 } });
      }
      // 2. receipt + invoice totals (atomic increment, then derive the status from what is actually stored)
      const receiptNumber = await nextNumber(tx, "REC", now);
      await tx.saasPayment.update({ where: { id: payment.id }, data: { receiptNumber } });
      await tx.saasInvoice.update({ where: { id: inv0.id }, data: { paidMinor: { increment: p.amountMinor } } });
      const inv = (await tx.saasInvoice.findUnique({ where: { id: inv0.id } }))!;
      const paidInFull = inv.paidMinor >= inv.totalMinor; const overpaid = Math.max(0, inv.paidMinor - inv.totalMinor);
      let status = inv.status;
      if (inv.status === "VOID") status = "VOID"; // money for a voided invoice is kept on record and flagged for a refund; it never activates anything
      else if (paidInFull) status = "PAID"; else if (inv.status !== "PAID") status = "PARTIALLY_PAID";
      await tx.saasInvoice.update({ where: { id: inv.id }, data: { status, paidAt: paidInFull && !inv.paidAt ? p.paidAt ?? now : inv.paidAt } });
      // 3. activation only for a fully paid, live invoice
      const activated = status === "PAID" && inv.status !== "PAID" ? await settlePaidInvoice(tx, inv, p.actor, now) : null;
      return { duplicate: false, paymentId: payment.id, invoiceStatus: status, activated, receiptNumber, tenantId: inv.tenantId, overpaidMinor: overpaid };
    });
  } catch (e) {
    if (uniqueViolation(e) || (e instanceof AppError && e.message === "duplicate")) {
      const again = await db.saasPayment.findFirst({ where: { OR: [{ idempotencyKey: p.idempotencyKey }, ...(p.providerPaymentId ? [{ provider: p.provider, providerPaymentId: p.providerPaymentId }] : [])] } });
      if (again) return { duplicate: true, paymentId: again.id, invoiceStatus: inv0.status, activated: null, receiptNumber: again.receiptNumber, tenantId: again.tenantId, overpaidMinor: 0 };
    }
    throw e;
  }
  invalidateEntitlements(out.tenantId);
  await recordAudit({ action: AUDIT_ACTIONS.SUBSCRIPTION_PAYMENT_RECORDED, tenantId: out.tenantId, actorId: p.actor.id, entityType: "saas_payment", entityId: out.paymentId, metadata: { invoiceId: p.invoiceId, amountMinor: p.amountMinor, provider: p.provider, source: p.actor.source, overpaidMinor: out.overpaidMinor } });
  const sub = await db.subscription.findUnique({ where: { id: inv0.subscriptionId }, select: { snapshot: true } }); const plan = parseJson<{ name?: string }>(sub?.snapshot, {}).name ?? "";
  await notifySubscription(out.tenantId, "SUBSCRIPTION_PAYMENT_SUCCEEDED", `pay:${out.paymentId}`, { amount: money(p.amountMinor), number: inv0.invoiceNumber, receipt: out.receiptNumber ?? "" });
  if (out.activated === "ACTIVATED") await notifySubscription(out.tenantId, "SUBSCRIPTION_ACTIVATED", `activated:${inv0.id}`, { plan, date: dateText(inv0.periodEnd) });
  else if (out.activated === "REACTIVATED") await notifySubscription(out.tenantId, "SUBSCRIPTION_REACTIVATED", `reactivated:${inv0.id}`, { plan });
  else if (out.activated === "UPGRADED") await notifySubscription(out.tenantId, "SUBSCRIPTION_PLAN_UPGRADED", `upgraded:${inv0.id}`, { plan });
  return out;
}

/** Plan columns for a change that an invoice carries (renewal at a new plan, or an upgrade). Uses the plan as it is NOW and snapshots it. */
export async function planChangePatch(tx: Tx, change: { planId: string; billingInterval: string }) {
  const plan = await tx.plan.findUnique({ where: { id: change.planId } }); if (!plan) return null;
  const price = change.billingInterval === "YEARLY" ? plan.annualPriceMinor : plan.monthlyPriceMinor;
  return { plan, patch: { planId: plan.id, billingInterval: change.billingInterval, priceMinor: price, planVersion: plan.version, currency: plan.currency, snapshot: JSON.stringify(snapshotOfPlan(plan)), scheduledChange: null } satisfies Prisma.SubscriptionUncheckedUpdateManyInput };
}

/** Called inside the payment transaction when an invoice has just become fully PAID. Returns what happened (for notifications). */
export async function settlePaidInvoice(tx: Tx, inv: { id: string; tenantId: string; subscriptionId: string; kind: string; periodStart: Date; periodEnd: Date; changeJson: string | null }, actor: Actor, now: Date): Promise<string | null> {
  const sub = await tx.subscription.findUnique({ where: { id: inv.subscriptionId } }); if (!sub) return null;
  const change = parseJson<{ planId: string; billingInterval: string } | null>(inv.changeJson, null); const swap = change ? await planChangePatch(tx, change) : null;
  const periodPatch = { currentPeriodStart: inv.periodStart, currentPeriodEnd: inv.periodEnd, nextBillingDate: inv.periodEnd, failedPaymentCount: 0, dunningStage: 0, lastPaymentFailedAt: null, gracePeriodStart: null, gracePeriodEnd: null, suspendedAt: null, pausedAt: null, cancelAtPeriodEnd: false, cancelledAt: null, cancellationReason: null, cancellationNotes: null, endsAt: inv.periodEnd } satisfies Prisma.SubscriptionUncheckedUpdateManyInput;
  if (inv.kind === "UPGRADE") {
    if (sub.status !== "ACTIVE" && sub.status !== "PAST_DUE" && sub.status !== "GRACE") return null;
    if (!swap) return null;
    await tx.subscription.update({ where: { id: sub.id }, data: swap.patch });
    await logEvent(tx, { tenantId: sub.tenantId, subscriptionId: sub.id, type: "PLAN_UPGRADED", fromPlanId: sub.planId, toPlanId: swap.plan.id, actor, note: `v${swap.plan.version}` });
    return "UPGRADED";
  }
  // NEW (first payment or trial conversion) and RENEWAL both open/extend a paid period.
  const was = sub.status;
  if (was === "ACTIVE") { await tx.subscription.update({ where: { id: sub.id }, data: { ...periodPatch, ...(swap?.patch ?? {}), source: sub.source } }); await logEvent(tx, { tenantId: sub.tenantId, subscriptionId: sub.id, type: "RENEWED", actor, fromPlanId: swap ? sub.planId : null, toPlanId: swap?.plan.id ?? null }); return "RENEWED"; }
  if (["PENDING_PAYMENT", "TRIAL", "PAST_DUE", "GRACE", "SUSPENDED"].includes(was)) {
    await transition(tx, sub, "ACTIVE", { ...periodPatch, trialUsed: sub.trialUsed || was === "TRIAL" || !!sub.trialStart, startsAt: was === "PENDING_PAYMENT" || was === "TRIAL" ? now : sub.startsAt, ...(swap?.patch ?? {}) }, actor, `invoice ${inv.id}`);
    return was === "PENDING_PAYMENT" || was === "TRIAL" ? "ACTIVATED" : "REACTIVATED";
  }
  return null; // cancelled / expired / paused: the money is recorded, the Super Admin decides (the state machine forbids a silent jump back)
}

/* A payment attempt that the provider says FAILED. Recorded once per provider payment; never overwrites a success. */
export async function recordFailedPayment(o: { invoiceId: string; provider: string; providerPaymentId: string | null; providerOrderId?: string | null; amountMinor: number; reason: string; idempotencyKey: string; method?: string | null }) {
  const inv = await db.saasInvoice.findUnique({ where: { id: o.invoiceId } }); if (!inv) return { recorded: false };
  const prior = await db.saasPayment.findFirst({ where: { OR: [{ idempotencyKey: o.idempotencyKey }, ...(o.providerPaymentId ? [{ provider: o.provider, providerPaymentId: o.providerPaymentId }] : [])] } });
  if (prior) return { recorded: false }; // already known (a failure after a success must not undo it)
  try {
    const pay = await db.saasPayment.create({ data: { tenantId: inv.tenantId, subscriptionId: inv.subscriptionId, invoiceId: inv.id, amountMinor: Math.max(1, o.amountMinor), currency: inv.currency, method: o.method?.toUpperCase() === "UPI" ? "UPI" : o.method?.toUpperCase() === "CARD" ? "CARD" : "ONLINE", status: "FAILED", provider: o.provider, providerPaymentId: o.providerPaymentId, providerOrderId: o.providerOrderId ?? null, failureReason: o.reason.slice(0, 200), idempotencyKey: o.idempotencyKey, attempt: (await db.saasPayment.count({ where: { invoiceId: inv.id } })) + 1 } });
    await db.subscription.update({ where: { id: inv.subscriptionId }, data: { failedPaymentCount: { increment: 1 }, lastPaymentFailedAt: new Date() } });
    await recordAudit({ action: AUDIT_ACTIONS.SUBSCRIPTION_PAYMENT_FAILED, tenantId: inv.tenantId, entityType: "saas_payment", entityId: pay.id, metadata: { invoiceId: inv.id, amountMinor: o.amountMinor } });
    await notifySubscription(inv.tenantId, "SUBSCRIPTION_PAYMENT_FAILED", `payfail:${pay.id}`, { number: inv.invoiceNumber, amount: money(inv.totalMinor - inv.paidMinor) });
    return { recorded: true };
  } catch (e) { if (uniqueViolation(e)) return { recorded: false }; throw e; }
}

/* ------------------------------------------------------------------------------ refunds ------------------------------------------------------------------------------ */
export async function refundableOf(paymentId: string) {
  const p = await db.saasPayment.findUnique({ where: { id: paymentId } }); if (!p) throw new AppError("NOT_FOUND", { message: "That payment doesn't exist." });
  const open = await db.saasRefund.aggregate({ where: { paymentId, status: { in: ["REQUESTED", "APPROVED"] } }, _sum: { amountMinor: true } });
  return { payment: p, refundable: Math.max(0, (p.status === "SUCCEEDED" || p.status === "PARTIALLY_REFUNDED" ? p.amountMinor : 0) - p.refundedMinor - (open._sum.amountMinor ?? 0)) };
}
export async function requestRefund(o: { paymentId: string; amountMinor: number; reason: string; actor: Actor }) {
  const { payment, refundable } = await refundableOf(o.paymentId);
  if (!Number.isSafeInteger(o.amountMinor) || o.amountMinor <= 0) throw new AppError("VALIDATION_ERROR", { fieldErrors: { amount: "Enter a refund amount above zero." } });
  if (o.amountMinor > refundable) throw new AppError("VALIDATION_ERROR", { fieldErrors: { amount: `You can refund at most ${money(refundable)} of this payment.` } });
  const refund = await db.$transaction(async (tx) => tx.saasRefund.create({ data: { tenantId: payment.tenantId, subscriptionId: payment.subscriptionId, invoiceId: payment.invoiceId, paymentId: payment.id, refundNumber: await nextNumber(tx, "RFD", new Date()), amountMinor: o.amountMinor, currency: payment.currency, reason: o.reason.slice(0, 300), requestedById: o.actor.id ?? "system" } }));
  await recordAudit({ action: AUDIT_ACTIONS.SUBSCRIPTION_REFUND_CHANGED, tenantId: payment.tenantId, actorId: o.actor.id, entityType: "saas_refund", entityId: refund.id, metadata: { status: "REQUESTED", amountMinor: o.amountMinor } });
  return refund;
}
const REFUND_MOVES: Record<string, string[]> = { REQUESTED: ["APPROVED", "REJECTED", "CANCELLED"], APPROVED: ["CANCELLED"] };
export async function decideRefund(refundId: string, decision: "APPROVED" | "REJECTED" | "CANCELLED", actor: Actor) {
  const r = await db.saasRefund.findUnique({ where: { id: refundId } }); if (!r) throw new AppError("NOT_FOUND", { message: "That refund doesn't exist." });
  if (!(REFUND_MOVES[r.status] ?? []).includes(decision)) throw new AppError("CONFLICT", { message: `A ${r.status.toLowerCase()} refund can't be ${decision.toLowerCase()}.` });
  const u = await db.saasRefund.updateMany({ where: { id: refundId, status: r.status }, data: { status: decision, decidedById: actor.id, decidedAt: new Date() } });
  if (u.count === 0) throw new AppError("CONFLICT", { message: "The refund changed while you were working." });
  await recordAudit({ action: AUDIT_ACTIONS.SUBSCRIPTION_REFUND_CHANGED, tenantId: r.tenantId, actorId: actor.id, entityType: "saas_refund", entityId: refundId, metadata: { status: decision, amountMinor: r.amountMinor } });
}
/** APPROVED → PROCESSED. Online payments are refunded through the provider (never faked); offline payments are marked processed with the reference the Super Admin gives. */
export async function processRefund(refundId: string, actor: Actor, manualReference?: string) {
  const r = await db.saasRefund.findUnique({ where: { id: refundId } }); if (!r) throw new AppError("NOT_FOUND", { message: "That refund doesn't exist." });
  if (r.status !== "APPROVED") throw new AppError("CONFLICT", { message: "Only an approved refund can be processed." });
  const pay = await db.saasPayment.findUnique({ where: { id: r.paymentId } }); if (!pay) throw new AppError("NOT_FOUND");
  const claim = `claim:${randomUUID()}`; const got = await db.saasRefund.updateMany({ where: { id: refundId, status: "APPROVED", providerRefundId: null }, data: { providerRefundId: claim } });
  if (got.count === 0) throw new AppError("CONFLICT", { message: "This refund is already being processed." });
  let providerRefundId: string | null = null;
  try {
    if (pay.method === "ONLINE" || pay.method === "CARD" || pay.method === "UPI") {
      const prov = providerByKey(pay.provider); if (!prov || !prov.capabilities.refunds || !prov.configured() || !pay.providerPaymentId) throw new AppError("CONFLICT", { message: "This payment's provider can't refund from here. Refund it in the provider's dashboard, then process the refund with its reference." });
      providerRefundId = (await prov.refundPayment(pay.providerPaymentId, r.amountMinor, r.reason)).providerRefundId;
    } else { if (!manualReference?.trim()) throw new AppError("VALIDATION_ERROR", { fieldErrors: { reference: "Enter the reference of the offline refund." } }); providerRefundId = `manual:${manualReference.trim().slice(0, 80)}`; }
  } catch (e) { await db.saasRefund.updateMany({ where: { id: refundId, providerRefundId: claim }, data: { providerRefundId: null } }); throw e; }
  await finishRefund(r.id, providerRefundId!, actor);
}
async function finishRefund(refundId: string, providerRefundId: string, actor: Actor) {
  const now = new Date(); let tenantId = "", amount = 0, invoiceNumber = "";
  await db.$transaction(async (tx) => {
    const r = (await tx.saasRefund.findUnique({ where: { id: refundId } }))!; tenantId = r.tenantId; amount = r.amountMinor;
    const u = await tx.saasRefund.updateMany({ where: { id: refundId, status: { in: ["APPROVED", "REQUESTED"] } }, data: { status: "PROCESSED", processedAt: now, providerRefundId } });
    if (u.count === 0) return;
    const pay = await tx.saasPayment.update({ where: { id: r.paymentId }, data: { refundedMinor: { increment: r.amountMinor } } });
    await tx.saasPayment.update({ where: { id: pay.id }, data: { status: pay.refundedMinor >= pay.amountMinor ? "REFUNDED" : "PARTIALLY_REFUNDED" } });
    const inv = await tx.saasInvoice.update({ where: { id: r.invoiceId }, data: { refundedMinor: { increment: r.amountMinor } } }); invoiceNumber = inv.invoiceNumber;
    if (inv.status !== "VOID") await tx.saasInvoice.update({ where: { id: inv.id }, data: { status: inv.refundedMinor >= inv.paidMinor ? "REFUNDED" : "PARTIALLY_REFUNDED" } });
  });
  await recordAudit({ action: AUDIT_ACTIONS.SUBSCRIPTION_REFUND_CHANGED, tenantId, actorId: actor.id, entityType: "saas_refund", entityId: refundId, metadata: { status: "PROCESSED", amountMinor: amount } });
  await notifySubscription(tenantId, "SUBSCRIPTION_REFUND", `refund:${refundId}`, { amount: money(amount), number: invoiceNumber });
}
/** A refund made in the provider's own dashboard, reported by a verified webhook. Idempotent on the provider's refund id. */
export async function syncProviderRefund(o: { provider: string; providerPaymentId: string; providerRefundId: string; amountMinor: number }) {
  const pay = await db.saasPayment.findFirst({ where: { provider: o.provider, providerPaymentId: o.providerPaymentId } }); if (!pay) return false;
  if (await db.saasRefund.findFirst({ where: { paymentId: pay.id, providerRefundId: o.providerRefundId } })) return false;
  const claimed = await db.saasRefund.findFirst({ where: { paymentId: pay.id, status: "APPROVED", amountMinor: o.amountMinor, providerRefundId: { startsWith: "claim:" } } });
  if (claimed) { await finishRefund(claimed.id, o.providerRefundId, SYSTEM); return true; }
  const amount = Math.min(o.amountMinor, Math.max(0, pay.amountMinor - pay.refundedMinor)); if (amount <= 0) return false;
  const created = await db.$transaction(async (tx) => tx.saasRefund.create({ data: { tenantId: pay.tenantId, subscriptionId: pay.subscriptionId, invoiceId: pay.invoiceId, paymentId: pay.id, refundNumber: await nextNumber(tx, "RFD", new Date()), amountMinor: amount, currency: pay.currency, reason: "Refunded in the payment provider's dashboard", status: "APPROVED", requestedById: "provider", providerRefundId: o.providerRefundId } }));
  await finishRefund(created.id, o.providerRefundId, SYSTEM); return true;
}

/* ---------------------------------------------------------------- the clinic's billing details ---------------------------------------------------------------- */
export { transition, SYSTEM };
export async function overdueSweep(now: Date) {
  const r = await db.saasInvoice.updateMany({ where: { status: { in: ["ISSUED", "PARTIALLY_PAID"] }, dueAt: { lt: now } }, data: { status: "OVERDUE" } });
  return r.count;
}
