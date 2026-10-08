import "server-only";
import { db } from "@/lib/db";
import type { RequestContext } from "@/lib/auth/context";
import { AppError } from "@/lib/errors";
import { STATUS_LABEL, STATUSES, type SubStatus } from "@/lib/subscriptions/state";
import { providerStatusSummary } from "@/lib/subscriptions/providers/registry";
import { usageSnapshot } from "./entitlements";
import { decideRefund, outstandingOf, processRefund, refundableOf, requestRefund, voidInvoice } from "./sub-billing";
import { guard, requireReason, stepUp } from "./platform-core";
import { containsCI, pageParams } from "./shared";

export const SUB_STATUSES = STATUSES;
const actor = (ctx: RequestContext) => ({ id: ctx.user.id, source: "SUPER_ADMIN" as const });
const LIVE = ["TRIAL", "ACTIVE", "PAST_DUE", "GRACE", "PAUSED", "SUSPENDED", "PENDING_PAYMENT"];

export interface SubFilter { q?: string; status?: string; planId?: string; source?: string; page?: number }
export async function listSubscriptions(ctx: RequestContext, f: SubFilter) {
  guard(ctx); const { skip, take, page } = pageParams(f.page, 20);
  const where = { managed: true, ...(f.status && (STATUSES as readonly string[]).includes(f.status) ? { status: f.status } : {}), ...(f.planId ? { planId: f.planId } : {}), ...(f.source ? { source: f.source } : {}), ...(f.q ? { tenant: { OR: [{ name: containsCI(f.q) }, { slug: containsCI(f.q) }] } } : {}) };
  const [total, rows, plans, legacy] = await Promise.all([db.subscription.count({ where }), db.subscription.findMany({ where, orderBy: { updatedAt: "desc" }, skip, take, include: { plan: { select: { name: true } }, tenant: { select: { id: true, name: true, slug: true } } } }), db.plan.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }), db.subscription.count({ where: { managed: false } })]);
  const owed = await db.saasInvoice.groupBy({ by: ["tenantId"], where: { tenantId: { in: rows.map((r) => r.tenantId) }, status: { in: ["ISSUED", "OVERDUE", "PARTIALLY_PAID"] } }, _sum: { totalMinor: true, paidMinor: true } });
  const owe = new Map(owed.map((o) => [o.tenantId, (o._sum.totalMinor ?? 0) - (o._sum.paidMinor ?? 0)]));
  return { total, page, pageSize: take, legacyUnmanaged: legacy, plans, statuses: STATUSES.map((s) => ({ key: s, label: STATUS_LABEL[s as SubStatus] })), rows: rows.map((r) => ({ id: r.id, tenantId: r.tenantId, clinic: r.tenant.name, slug: r.tenant.slug, plan: (parseName(r.snapshot) ?? r.plan.name), status: r.status, statusLabel: STATUS_LABEL[r.status as SubStatus] ?? r.status, interval: r.billingInterval, priceMinor: r.priceMinor, trialEnd: r.trialEnd, periodEnd: r.currentPeriodEnd, cancelAtPeriodEnd: r.cancelAtPeriodEnd, source: r.source, outstandingMinor: owe.get(r.tenantId) ?? 0 })) };
}
const parseName = (s: string) => { try { return (JSON.parse(s) as { name?: string }).name ?? null; } catch { return null; } };

export async function subscriptionDetail(ctx: RequestContext, tenantId: string) {
  guard(ctx);
  const tenant = await db.tenant.findFirst({ where: { id: tenantId, deletedAt: null }, select: { id: true, name: true, slug: true } }); if (!tenant) throw new AppError("NOT_FOUND", { message: "That clinic doesn't exist." });
  const sub = await db.subscription.findUnique({ where: { tenantId }, include: { plan: true } });
  const [invoices, payments, refunds, events, profile, usage] = await Promise.all([
    db.saasInvoice.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" }, take: 50 }), db.saasPayment.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" }, take: 50 }),
    db.saasRefund.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" }, take: 50 }), db.subscriptionEvent.findMany({ where: { tenantId, type: { not: "NOTIFIED" } }, orderBy: { createdAt: "desc" }, take: 30 }),
    db.subscriptionBillingProfile.findUnique({ where: { tenantId } }), usageSnapshot(tenantId),
  ]);
  const refundable = new Map<string, number>(); for (const p of payments.filter((x) => x.status === "SUCCEEDED" || x.status === "PARTIALLY_REFUNDED")) refundable.set(p.id, (await refundableOf(p.id)).refundable);
  return {
    tenant, managed: !!sub?.managed, legacyPlan: sub && !sub.managed ? sub.plan.name : null,
    subscription: sub?.managed ? { id: sub.id, status: sub.status, statusLabel: STATUS_LABEL[sub.status as SubStatus] ?? sub.status, planId: sub.planId, planName: parseName(sub.snapshot) ?? sub.plan.name, planVersion: sub.planVersion, interval: sub.billingInterval, priceMinor: sub.priceMinor, source: sub.source, trialStart: sub.trialStart, trialEnd: sub.trialEnd, periodStart: sub.currentPeriodStart, periodEnd: sub.currentPeriodEnd, cancelAtPeriodEnd: sub.cancelAtPeriodEnd, cancellationReason: sub.cancellationReason, graceEnd: sub.gracePeriodEnd, suspendedAt: sub.suspendedAt, failedPaymentCount: sub.failedPaymentCount, scheduledChange: sub.scheduledChange } : null,
    profile, usage: usage.rows,
    invoices: invoices.map((i) => ({ ...i, outstandingMinor: i.status === "VOID" ? 0 : outstandingOf(i) })), payments: payments.map((p) => ({ ...p, refundableMinor: refundable.get(p.id) ?? 0 })), refunds, events,
  };
}

export async function allInvoices(ctx: RequestContext, f: { status?: string; q?: string; page?: number }) {
  guard(ctx); const { skip, take, page } = pageParams(f.page, 25);
  const where = { ...(f.status ? { status: f.status } : {}), ...(f.q ? { OR: [{ invoiceNumber: containsCI(f.q) }] } : {}) };
  const [total, rows] = await Promise.all([db.saasInvoice.count({ where }), db.saasInvoice.findMany({ where, orderBy: { createdAt: "desc" }, skip, take })]);
  const names = new Map((await db.tenant.findMany({ where: { id: { in: rows.map((r) => r.tenantId) } }, select: { id: true, name: true } })).map((t) => [t.id, t.name]));
  return { total, page, pageSize: take, rows: rows.map((r) => ({ id: r.id, tenantId: r.tenantId, clinic: names.get(r.tenantId) ?? "—", number: r.invoiceNumber, kind: r.kind, status: r.status, totalMinor: r.totalMinor, paidMinor: r.paidMinor, refundedMinor: r.refundedMinor, dueAt: r.dueAt, issuedAt: r.issuedAt })) };
}
export async function webhookLog(ctx: RequestContext, page = 1) {
  guard(ctx); const { skip, take } = pageParams(page, 25); const [total, rows] = await Promise.all([db.subscriptionWebhookEvent.count(), db.subscriptionWebhookEvent.findMany({ orderBy: { receivedAt: "desc" }, skip, take, select: { id: true, provider: true, eventType: true, status: true, error: true, receivedAt: true, processedAt: true } })]);
  return { total, page, pageSize: take, rows };
}
export const providerStatus = (ctx: RequestContext) => { guard(ctx); return providerStatusSummary(); };

/* ------------------------------------------- Super Admin money actions: every one needs the admin's own password and a reason ------------------------------------------- */
export async function adminRequestRefund(ctx: RequestContext, paymentId: string, i: { amountMinor?: number; amountRupees?: string; reason?: string; password?: string }) {
  await stepUp(ctx, i.password, "subscription_refund_request"); const reason = requireReason(i.reason, 5);
  return requestRefund({ paymentId, amountMinor: i.amountRupees !== undefined ? Math.round(parseFloat(i.amountRupees) * 100) : Number(i.amountMinor), reason, actor: actor(ctx) });
}
export async function adminDecideRefund(ctx: RequestContext, refundId: string, i: { decision?: string; password?: string; reference?: string }) {
  await stepUp(ctx, i.password, "subscription_refund_decision");
  if (i.decision === "PROCESS") return processRefund(refundId, actor(ctx), i.reference);
  if (i.decision === "APPROVED" || i.decision === "REJECTED" || i.decision === "CANCELLED") return decideRefund(refundId, i.decision, actor(ctx));
  throw new AppError("VALIDATION_ERROR", { message: "Choose approve, reject, cancel or process." });
}
export async function adminVoidInvoice(ctx: RequestContext, invoiceId: string, i: { reason?: string; password?: string }) {
  await stepUp(ctx, i.password, "subscription_void_invoice"); const reason = requireReason(i.reason, 5); return voidInvoice(invoiceId, actor(ctx), reason);
}
export { LIVE };
