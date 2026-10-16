import "server-only";
import { db } from "@/lib/db";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";
import type { RequestContext, TenantRequestContext } from "@/lib/auth/context";
import { AppError } from "@/lib/errors";
import { BILLING_INTERVALS, priceFor, snapshotOfPlan, parseJson, type PlanLimits } from "@/lib/subscriptions/catalog";
import { addDaysUtc, addInterval, daysBetweenCeil, prorateUpgrade } from "@/lib/subscriptions/period";
import { computeInvoice } from "@/lib/subscriptions/tax";
import { accessFor, STATUS_LABEL, type SubStatus } from "@/lib/subscriptions/state";
import { onlineProvider } from "@/lib/subscriptions/providers/registry";
import { entitlementOf, invalidateEntitlements, usageSnapshot, violationsFor } from "./entitlements";
import { getPolicy, getTax, getVendor } from "./sub-config";
import { dateText, issueInvoice, outstandingOf, voidInvoice } from "./sub-billing";
import { isCommercial } from "./sub-plans";
import { notifySubscription } from "./sub-notify";
import { logEvent, transition, SYSTEM, type Actor } from "./sub-state";
import { requireReason, stepUp } from "./platform-core";

export const CANCEL_REASONS = { TOO_EXPENSIVE: "Too expensive", MISSING_FEATURES: "Missing features", SWITCHING: "Switching to another system", CLOSING: "Closing the clinic", NOT_USING: "Not using it enough", OTHER: "Other" } as const;
const interval = (v: unknown) => { if (!(BILLING_INTERVALS as readonly string[]).includes(v as string)) throw new AppError("VALIDATION_ERROR", { fieldErrors: { interval: "Choose monthly or yearly billing." } }); return v as "MONTHLY" | "YEARLY"; };
const actorOf = (ctx: RequestContext): Actor => ({ id: ctx.user.id, source: ctx.user.role === "SUPER_ADMIN" ? "SUPER_ADMIN" : "USER" });
const loadSub = async (tenantId: string) => db.subscription.findUnique({ where: { tenantId }, include: { plan: true } });

async function resetFields(plan: Awaited<ReturnType<typeof db.plan.findUniqueOrThrow>>, intv: string, source: string, now: Date) {
  return { managed: true, planId: plan.id, billingInterval: intv, currency: plan.currency, priceMinor: priceFor(plan, intv), planVersion: plan.version, snapshot: JSON.stringify(snapshotOfPlan(plan)), trialStart: null, trialEnd: null, currentPeriodStart: null, currentPeriodEnd: null, nextBillingDate: null, cancelAtPeriodEnd: false, cancelledAt: null, cancellationReason: null, cancellationNotes: null, gracePeriodStart: null, gracePeriodEnd: null, pausedAt: null, suspendedAt: null, autoRenew: true, scheduledChange: null, failedPaymentCount: 0, dunningStage: 0, lastPaymentFailedAt: null, source, provider: null, startsAt: now, endsAt: null };
}

/* ----------------------------------------------------------------------- starting a subscription ----------------------------------------------------------------------- */
interface Begin { tenantId: string; planId: string; interval: string; mode: "TRIAL" | "PAID" | "FREE"; actor: Actor; source: "ONLINE" | "MANUAL" | "SYSTEM"; publicOnly: boolean; overrideTrialUsed?: boolean; trialDays?: number; now?: Date }
export async function beginSubscription(o: Begin) {
  const now = o.now ?? new Date(); const plan = await db.plan.findUnique({ where: { id: o.planId } });
  if (!plan || plan.status !== "ACTIVE" || !isCommercial(plan) || (o.publicOnly && !plan.isPublic)) throw new AppError("VALIDATION_ERROR", { fieldErrors: { planId: "That plan isn't available." } });
  const intv = interval(o.interval); const price = priceFor(plan, intv); const policy = await getPolicy();
  const existing = await db.subscription.findUnique({ where: { tenantId: o.tenantId } });
  if (existing?.managed && !["CANCELLED", "EXPIRED"].includes(existing.status)) throw new AppError("CONFLICT", { message: "This clinic already has a subscription. Change its plan instead." });
  const free = price === 0 && plan.setupFeeMinor === 0;
  if (o.mode === "TRIAL") {
    if (plan.trialDays <= 0 && !o.trialDays) throw new AppError("VALIDATION_ERROR", { message: "This plan doesn't include a free trial." });
    if (!o.overrideTrialUsed && (existing?.trialUsed || existing?.trialStart)) throw new AppError("CONFLICT", { message: "This clinic has already used its free trial." });
  }
  const base = await resetFields(plan, intv, o.source, now);
  const target: SubStatus = o.mode === "TRIAL" ? "TRIAL" : free || o.mode === "FREE" ? "ACTIVE" : "PENDING_PAYMENT";
  const days = Math.min(o.trialDays ?? plan.trialDays, policy.trial.maxDays);
  const patch = target === "TRIAL" ? { trialStart: now, trialEnd: addDaysUtc(now, days), trialUsed: true } : target === "ACTIVE" ? { currentPeriodStart: now, currentPeriodEnd: addInterval(now, intv), nextBillingDate: addInterval(now, intv), endsAt: addInterval(now, intv), trialUsed: existing?.trialUsed ?? false } : { trialUsed: existing?.trialUsed ?? false };
  const sub = await db.$transaction(async (tx) => {
    if (!existing) { const c = await tx.subscription.create({ data: { tenantId: o.tenantId, status: target, ...base, ...patch } }); await logEvent(tx, { tenantId: o.tenantId, subscriptionId: c.id, type: "STARTED", to: target, toPlanId: plan.id, actor: o.actor, note: o.mode }); return c; }
    if (!existing.managed) { // a pre-Phase-15 row is adopted: it had no billing, so nothing is lost
      const c = await tx.subscription.update({ where: { id: existing.id }, data: { status: target, ...base, ...patch } });
      await logEvent(tx, { tenantId: o.tenantId, subscriptionId: c.id, type: "STARTED", from: existing.status, to: target, fromPlanId: existing.planId, toPlanId: plan.id, actor: o.actor, note: `${o.mode} (adopted legacy subscription)` }); return c;
    }
    await transition(tx, existing, "PENDING_PAYMENT", { ...base, trialUsed: existing.trialUsed }, o.actor, "new subscription after " + existing.status.toLowerCase());
    if (target === "PENDING_PAYMENT") return (await tx.subscription.findUnique({ where: { id: existing.id } }))!;
    const cur = (await tx.subscription.findUnique({ where: { id: existing.id } }))!; await transition(tx, cur, target, patch, o.actor, o.mode); return (await tx.subscription.findUnique({ where: { id: existing.id } }))!;
  });
  invalidateEntitlements(o.tenantId);
  await recordAudit({ action: AUDIT_ACTIONS.SUBSCRIPTION_STARTED, tenantId: o.tenantId, actorId: o.actor.id, entityType: "subscription", entityId: sub.id, metadata: { planId: plan.id, planVersion: plan.version, interval: intv, status: target, mode: o.mode } });
  if (target === "TRIAL") await notifySubscription(o.tenantId, "SUBSCRIPTION_TRIAL_STARTED", `trial:${sub.id}:${sub.trialStart?.getTime()}`, { plan: plan.name, date: dateText(sub.trialEnd!) });
  let invoiceId: string | null = null;
  if (target === "PENDING_PAYMENT") invoiceId = (await issueNewInvoice(sub.id, o.tenantId, plan.id, intv, o.actor, now)).id;
  return { subscriptionId: sub.id, status: target, invoiceId };
}

/** The first-payment invoice (also used when a trial converts). Re-choosing a plan supersedes the earlier unpaid invoice; double-clicks reuse it. */
export async function issueNewInvoice(subscriptionId: string, tenantId: string, planId: string, intv: string, actor: Actor, now = new Date()) {
  const plan = await db.plan.findUniqueOrThrow({ where: { id: planId } });
  const open = await db.saasInvoice.findMany({ where: { subscriptionId, kind: "NEW", status: { in: ["ISSUED", "OVERDUE"] }, paidMinor: 0 } });
  for (const inv of open) {
    const c = parseJson<{ planId?: string; billingInterval?: string }>(inv.changeJson, {});
    if (c.planId === planId && c.billingInterval === intv) return inv;
    await voidInvoice(inv.id, SYSTEM, "superseded by a new plan choice");
  }
  const price = priceFor(plan, intv); const prevPaid = await db.saasInvoice.count({ where: { subscriptionId, paidMinor: { gt: 0 } } });
  const seq = (await db.saasInvoice.count({ where: { subscriptionId, kind: "NEW" } })) + 1;
  const items = [{ description: `${plan.name} — ${intv === "YEARLY" ? "annual" : "monthly"} subscription`, unitMinor: price }, ...(plan.setupFeeMinor > 0 && prevPaid === 0 ? [{ description: "One-time setup fee", unitMinor: plan.setupFeeMinor }] : [])];
  const r = await issueInvoice({ tenantId, subscriptionId, kind: "NEW", periodStart: now, periodEnd: addInterval(now, intv), items, dedupeKey: `NEW:${subscriptionId}:${seq}`, change: { planId, billingInterval: intv, planVersion: plan.version }, planName: plan.name, createdById: actor.id, now });
  return r.invoice;
}

/** Clinic admin: pick a plan. Starts a trial, or issues the first invoice, or converts a running trial to paid. Nothing is charged here — payment is a separate, explicit step. */
export async function choosePlan(ctx: TenantRequestContext, input: { planId?: string; interval?: string; trial?: boolean }) {
  const tenantId = ctx.tenantId; const intv = interval(input.interval); const planId = String(input.planId ?? ""); const sub = await db.subscription.findUnique({ where: { tenantId } });
  if (sub?.managed && sub.status === "TRIAL" && !input.trial) {
    const plan = await db.plan.findUnique({ where: { id: planId } }); if (!plan || plan.status !== "ACTIVE" || !plan.isPublic || !isCommercial(plan)) throw new AppError("VALIDATION_ERROR", { fieldErrors: { planId: "That plan isn't available." } });
    if (priceFor(plan, intv) === 0 && plan.setupFeeMinor === 0) throw new AppError("VALIDATION_ERROR", { message: "That plan is free — switch to it from the trial instead." });
    const inv = await issueNewInvoice(sub.id, tenantId, planId, intv, actorOf(ctx)); return { subscriptionId: sub.id, status: sub.status, invoiceId: inv.id };
  }
  if (sub?.managed && sub.status === "PENDING_PAYMENT" && !input.trial) { const inv = await issueNewInvoice(sub.id, tenantId, planId, intv, actorOf(ctx)); return { subscriptionId: sub.id, status: sub.status, invoiceId: inv.id }; }
  return beginSubscription({ tenantId, planId, interval: intv, mode: input.trial ? "TRIAL" : "PAID", actor: actorOf(ctx), source: "ONLINE", publicOnly: true });
}

/* ------------------------------------------------------------------------------ plan change ------------------------------------------------------------------------------ */
export interface ChangePreview {
  kind: "UPGRADE" | "DOWNGRADE" | "INTERVAL" | "TRIAL_SWITCH" | "NONE"; allowed: boolean; blockedReason: string | null; effectiveAt: Date | null; immediate: boolean;
  fromPlan: string; toPlan: string; fromPriceMinor: number; toPriceMinor: number; interval: string;
  proration: { totalDays: number; remainingDays: number; creditMinor: number; chargeMinor: number; netMinor: number } | null;
  invoice: { subtotalMinor: number; taxMinor: number; totalMinor: number } | null; violations: { key: string; label: string; used: number; limit: number | null }[];
  featuresLost: string[]; featuresGained: string[];
}
export async function previewChange(ctx: TenantRequestContext, input: { planId?: string; interval?: string }, now = new Date()): Promise<ChangePreview> {
  const sub = await loadSub(ctx.tenantId); if (!sub?.managed) throw new AppError("CONFLICT", { message: "Choose a plan first." });
  const plan = await db.plan.findUnique({ where: { id: String(input.planId ?? "") } });
  if (!plan || !isCommercial(plan) || (plan.id !== sub.planId && (plan.status !== "ACTIVE" || !plan.isPublic))) throw new AppError("VALIDATION_ERROR", { fieldErrors: { planId: "That plan isn't available." } });
  const intv = interval(input.interval); const snap = snapshotOfPlan(plan); const cur = parseJson<{ features?: Record<string, boolean>; limits?: PlanLimits }>(sub.snapshot, {});
  const price = priceFor(plan, intv); const base: ChangePreview = { kind: "NONE", allowed: false, blockedReason: null, effectiveAt: null, immediate: false, fromPlan: sub.plan.name, toPlan: plan.name, fromPriceMinor: sub.priceMinor, toPriceMinor: price, interval: intv, proration: null, invoice: null, violations: [], featuresLost: [], featuresGained: [] };
  const lost = Object.keys(cur.features ?? {}).filter((k) => cur.features?.[k] && !snap.features[k]); const gained = Object.keys(snap.features).filter((k) => snap.features[k] && !cur.features?.[k]);
  base.featuresLost = lost; base.featuresGained = gained;
  if (!["TRIAL", "ACTIVE"].includes(sub.status)) return { ...base, blockedReason: sub.status === "PENDING_PAYMENT" ? "Pay your first invoice or choose a plan to start." : "Settle the open invoice before changing plan." };
  if (sub.cancelAtPeriodEnd) return { ...base, blockedReason: "Resume the subscription first — it is set to end." };
  if (plan.id === sub.planId && intv === sub.billingInterval) return { ...base, blockedReason: "That is already your plan." };
  const violations = violationsFor(snap.limits, (await usageSnapshot(ctx.tenantId, now)).rows).map(({ key, label, used, limit }) => ({ key, label, used, limit }));
  if (sub.status === "TRIAL") return { ...base, kind: "TRIAL_SWITCH", allowed: violations.length === 0, immediate: true, effectiveAt: now, violations, blockedReason: violations.length ? "Your current usage doesn't fit that plan." : null };
  const periodStart = sub.currentPeriodStart ?? sub.startsAt; const periodEnd = sub.currentPeriodEnd ?? addInterval(periodStart, sub.billingInterval);
  if (plan.id === sub.planId) return { ...base, kind: "INTERVAL", allowed: true, immediate: false, effectiveAt: periodEnd, violations };
  const upgrade = plan.monthlyPriceMinor > sub.plan.monthlyPriceMinor && priceFor(plan, sub.billingInterval) > sub.priceMinor;
  if (upgrade) {
    if (intv !== sub.billingInterval) return { ...base, kind: "UPGRADE", blockedReason: "Upgrade on your current billing cycle; you can switch monthly/yearly at renewal." };
    const pr = prorateUpgrade({ oldPriceMinor: sub.priceMinor, newPriceMinor: price, periodStart, periodEnd, now }); const m = computeInvoice([pr.netMinor], 0, await getTax(), null);
    return { ...base, kind: "UPGRADE", allowed: true, immediate: true, effectiveAt: now, proration: pr, invoice: { subtotalMinor: m.subtotalMinor, taxMinor: m.taxMinor, totalMinor: m.totalMinor } };
  }
  return { ...base, kind: "DOWNGRADE", allowed: violations.length === 0, effectiveAt: periodEnd, violations, blockedReason: violations.length ? "Your current usage is above the new plan's limits. Reduce it first — nothing is deleted for you." : null };
}

export async function changePlan(ctx: TenantRequestContext, input: { planId?: string; interval?: string }, now = new Date()) {
  const sub = (await loadSub(ctx.tenantId))!; const pv = await previewChange(ctx, input, now); const intv = interval(input.interval);
  if (!pv.allowed) throw new AppError("CONFLICT", { message: pv.blockedReason ?? "That change isn't possible right now." });
  const actor = actorOf(ctx); const plan = await db.plan.findUniqueOrThrow({ where: { id: String(input.planId) } });
  if (pv.kind === "TRIAL_SWITCH") {
    await db.$transaction(async (tx) => { await tx.subscription.update({ where: { id: sub.id }, data: { planId: plan.id, billingInterval: intv, priceMinor: priceFor(plan, intv), planVersion: plan.version, snapshot: JSON.stringify(snapshotOfPlan(plan)), currency: plan.currency } }); await logEvent(tx, { tenantId: ctx.tenantId, subscriptionId: sub.id, type: "PLAN_CHANGED", fromPlanId: sub.planId, toPlanId: plan.id, actor, note: "during trial" }); });
    invalidateEntitlements(ctx.tenantId); await recordAudit({ action: AUDIT_ACTIONS.SUBSCRIPTION_PLAN_CHANGED, tenantId: ctx.tenantId, actorId: ctx.user.id, entityType: "subscription", entityId: sub.id, metadata: { kind: "TRIAL_SWITCH", from: sub.planId, to: plan.id } });
    return { kind: pv.kind, invoiceId: null as string | null };
  }
  if (pv.kind === "UPGRADE") {
    const pr = pv.proration!; const periodEnd = sub.currentPeriodEnd!;
    if (pr.netMinor === 0) { // nothing left to charge: switch now
      await db.$transaction(async (tx) => { const { planChangePatch } = await import("./sub-billing"); const sw = await planChangePatch(tx, { planId: plan.id, billingInterval: intv }); await tx.subscription.update({ where: { id: sub.id }, data: sw!.patch }); await logEvent(tx, { tenantId: ctx.tenantId, subscriptionId: sub.id, type: "PLAN_UPGRADED", fromPlanId: sub.planId, toPlanId: plan.id, actor, note: "no balance due" }); });
      invalidateEntitlements(ctx.tenantId); return { kind: pv.kind, invoiceId: null };
    }
    const open = await db.saasInvoice.findMany({ where: { subscriptionId: sub.id, kind: "UPGRADE", status: { in: ["ISSUED", "OVERDUE"] }, paidMinor: 0 } });
    for (const inv of open) { if (parseJson<{ planId?: string }>(inv.changeJson, {}).planId === plan.id && inv.periodEnd.getTime() === periodEnd.getTime()) return { kind: pv.kind, invoiceId: inv.id }; await voidInvoice(inv.id, SYSTEM, "superseded by a new upgrade"); }
    const seq = (await db.saasInvoice.count({ where: { subscriptionId: sub.id, kind: "UPGRADE" } })) + 1;
    const r = await issueInvoice({ tenantId: ctx.tenantId, subscriptionId: sub.id, kind: "UPGRADE", periodStart: now, periodEnd, items: [{ description: `Upgrade to ${plan.name}: ${pr.remainingDays} of ${pr.totalDays} days remaining (new price less unused credit)`, unitMinor: pr.netMinor }], dedupeKey: `UPGRADE:${sub.id}:${seq}`, change: { planId: plan.id, billingInterval: intv, planVersion: plan.version }, planName: plan.name, createdById: ctx.user.id, now, dueDays: 3 });
    return { kind: pv.kind, invoiceId: r.invoice.id };
  }
  // DOWNGRADE or INTERVAL: scheduled for the end of the paid period. Nothing changes today; nothing is refunded.
  await db.subscription.update({ where: { id: sub.id }, data: { scheduledChange: JSON.stringify({ planId: plan.id, billingInterval: intv, effectiveAt: pv.effectiveAt }) } });
  await db.$transaction(async (tx) => logEvent(tx, { tenantId: ctx.tenantId, subscriptionId: sub.id, type: "CHANGE_SCHEDULED", fromPlanId: sub.planId, toPlanId: plan.id, actor, note: `${pv.kind} on ${dateText(pv.effectiveAt!)}` }));
  await recordAudit({ action: AUDIT_ACTIONS.SUBSCRIPTION_PLAN_CHANGED, tenantId: ctx.tenantId, actorId: ctx.user.id, entityType: "subscription", entityId: sub.id, metadata: { kind: pv.kind, from: sub.planId, to: plan.id, effectiveAt: pv.effectiveAt } });
  await notifySubscription(ctx.tenantId, "SUBSCRIPTION_PLAN_DOWNGRADED", `sched:${sub.id}:${plan.id}:${pv.effectiveAt?.getTime()}`, { plan: plan.name, date: dateText(pv.effectiveAt!) });
  invalidateEntitlements(ctx.tenantId); return { kind: pv.kind, invoiceId: null };
}
export async function clearScheduledChange(ctx: TenantRequestContext) {
  const sub = await loadSub(ctx.tenantId); if (!sub?.managed || !sub.scheduledChange) throw new AppError("NOT_FOUND", { message: "There is no scheduled change." });
  await db.subscription.update({ where: { id: sub.id }, data: { scheduledChange: null } });
  await db.$transaction(async (tx) => logEvent(tx, { tenantId: ctx.tenantId, subscriptionId: sub.id, type: "CHANGE_CANCELLED", actor: actorOf(ctx) }));
}

/* ---------------------------------------------------------------------------- cancel / resume ---------------------------------------------------------------------------- */
export async function cancelSubscription(ctx: TenantRequestContext, input: { reason?: string; notes?: string }) {
  const sub = await loadSub(ctx.tenantId); if (!sub?.managed) throw new AppError("CONFLICT", { message: "There is no subscription to cancel." });
  if (!(input.reason && input.reason in CANCEL_REASONS)) throw new AppError("VALIDATION_ERROR", { fieldErrors: { reason: "Tell us why you're cancelling." } });
  const notes = (input.notes ?? "").trim().slice(0, 500); const actor = actorOf(ctx); const reason = input.reason;
  if (["CANCELLED", "EXPIRED"].includes(sub.status)) throw new AppError("CONFLICT", { message: "This subscription has already ended." });
  if (sub.cancelAtPeriodEnd) throw new AppError("CONFLICT", { message: "Cancellation is already scheduled." });
  const endsNow = sub.status === "TRIAL" || sub.status === "PENDING_PAYMENT";
  await db.$transaction(async (tx) => {
    if (endsNow) await transition(tx, sub, "CANCELLED", { cancelledAt: new Date(), cancellationReason: reason, cancellationNotes: notes || null, endsAt: new Date(), nextBillingDate: null }, actor, "cancelled by clinic");
    else { await tx.subscription.update({ where: { id: sub.id }, data: { cancelAtPeriodEnd: true, cancelledAt: new Date(), cancellationReason: reason, cancellationNotes: notes || null, scheduledChange: null } }); await logEvent(tx, { tenantId: ctx.tenantId, subscriptionId: sub.id, type: "CANCEL_SCHEDULED", actor, note: reason }); }
  });
  if (endsNow) for (const i of await db.saasInvoice.findMany({ where: { subscriptionId: sub.id, status: { in: ["ISSUED", "OVERDUE"] }, paidMinor: 0 } })) await voidInvoice(i.id, SYSTEM, "subscription cancelled");
  invalidateEntitlements(ctx.tenantId);
  await recordAudit({ action: AUDIT_ACTIONS.SUBSCRIPTION_CANCELLED, tenantId: ctx.tenantId, actorId: ctx.user.id, entityType: "subscription", entityId: sub.id, metadata: { reason, immediate: endsNow } });
  await notifySubscription(ctx.tenantId, "SUBSCRIPTION_CANCELLED", `cancel:${sub.id}:${Date.now()}`, { plan: sub.plan.name, date: endsNow ? dateText(new Date()) : dateText(sub.currentPeriodEnd ?? new Date()) });
  return { immediate: endsNow, accessUntil: endsNow ? null : sub.currentPeriodEnd };
}
export async function resumeSubscription(ctx: TenantRequestContext) {
  const sub = await loadSub(ctx.tenantId); if (!sub?.managed || !sub.cancelAtPeriodEnd || sub.status !== "ACTIVE") throw new AppError("CONFLICT", { message: "There is no scheduled cancellation to undo. If the subscription has ended, choose a plan to start again." });
  await db.$transaction(async (tx) => { await tx.subscription.update({ where: { id: sub.id }, data: { cancelAtPeriodEnd: false, cancelledAt: null, cancellationReason: null, cancellationNotes: null } }); await logEvent(tx, { tenantId: ctx.tenantId, subscriptionId: sub.id, type: "RESUMED", actor: actorOf(ctx) }); });
  invalidateEntitlements(ctx.tenantId); await recordAudit({ action: AUDIT_ACTIONS.SUBSCRIPTION_RESUMED, tenantId: ctx.tenantId, actorId: ctx.user.id, entityType: "subscription", entityId: sub.id });
}

/* -------------------------------------------------------------------------- Super Admin actions -------------------------------------------------------------------------- */
const needLive = async (tenantId: string) => { const s = await loadSub(tenantId); if (!s?.managed) throw new AppError("CONFLICT", { message: "This clinic has no managed subscription." }); return s; };
export async function adminAssign(ctx: RequestContext, tenantId: string, input: { planId?: string; interval?: string; mode?: string; trialDays?: number; reason?: string; password?: string }) {
  await stepUp(ctx, input.password, "subscription_assign"); const reason = requireReason(input.reason);
  if (!(await db.tenant.findFirst({ where: { id: tenantId, deletedAt: null }, select: { id: true } }))) throw new AppError("NOT_FOUND", { message: "That clinic doesn't exist." });
  const mode = input.mode === "TRIAL" ? "TRIAL" : input.mode === "FREE" ? "FREE" : input.mode === "ACTIVE" ? "FREE" : "PAID";
  const r = await beginSubscription({ tenantId, planId: String(input.planId ?? ""), interval: String(input.interval ?? "MONTHLY"), mode, actor: actorOf(ctx), source: "MANUAL", publicOnly: false, overrideTrialUsed: true, trialDays: input.trialDays });
  await db.subscription.update({ where: { tenantId }, data: { source: mode === "PAID" ? "ONLINE" : "MANUAL" } });
  await recordAudit({ action: AUDIT_ACTIONS.SUBSCRIPTION_STARTED, tenantId, actorId: ctx.user.id, entityType: "subscription", entityId: r.subscriptionId, metadata: { assignedBySuperAdmin: true, mode, reasonLength: reason.length } });
  return r;
}
export async function adminExtendTrial(ctx: RequestContext, tenantId: string, input: { days?: number; reason?: string; password?: string }) {
  await stepUp(ctx, input.password, "subscription_extend_trial"); const reason = requireReason(input.reason); const policy = await getPolicy(); const sub = await needLive(tenantId);
  if (sub.status !== "TRIAL" || !sub.trialStart || !sub.trialEnd) throw new AppError("CONFLICT", { message: "Only a running trial can be extended. For an ended trial, assign a new trial." });
  if (!policy.trial.allowExtension) throw new AppError("CONFLICT", { message: "Trial extensions are switched off in billing settings." });
  const days = Number(input.days); if (!Number.isInteger(days) || days < 1 || days > policy.trial.maxExtensionDays) throw new AppError("VALIDATION_ERROR", { fieldErrors: { days: `Extend by 1 to ${policy.trial.maxExtensionDays} days.` } });
  const end = addDaysUtc(sub.trialEnd, days); if (daysBetweenCeil(sub.trialStart, end) > policy.trial.maxDays + policy.trial.maxExtensionDays) throw new AppError("CONFLICT", { message: "That would exceed the longest trial allowed." });
  await db.$transaction(async (tx) => { await tx.subscription.update({ where: { id: sub.id }, data: { trialEnd: end, endsAt: end } }); await logEvent(tx, { tenantId, subscriptionId: sub.id, type: "TRIAL_EXTENDED", actor: actorOf(ctx), note: `+${days} days` }); });
  invalidateEntitlements(tenantId); await recordAudit({ action: AUDIT_ACTIONS.SUBSCRIPTION_TRIAL_EXTENDED, tenantId, actorId: ctx.user.id, entityType: "subscription", entityId: sub.id, metadata: { days, reasonLength: reason.length } });
  return { trialEnd: end };
}
type AdminAct = "suspend" | "reactivate" | "pause" | "unpause" | "cancel" | "expire";
export async function adminAct(ctx: RequestContext, tenantId: string, act: AdminAct, input: { reason?: string; password?: string; extendDays?: number }, now = new Date()) {
  await stepUp(ctx, input.password, `subscription_${act}`); const reason = requireReason(input.reason); const sub = await needLive(tenantId); const actor = actorOf(ctx);
  await db.$transaction(async (tx) => {
    switch (act) {
      case "suspend": await transition(tx, sub, "SUSPENDED", { suspendedAt: now }, actor, reason); break;
      case "pause": await transition(tx, sub, "PAUSED", { pausedAt: now }, actor, reason); break;
      case "unpause": { const gap = sub.pausedAt ? now.getTime() - sub.pausedAt.getTime() : 0; const end = sub.currentPeriodEnd ? new Date(sub.currentPeriodEnd.getTime() + gap) : null; await transition(tx, sub, "ACTIVE", { pausedAt: null, currentPeriodEnd: end, nextBillingDate: end, endsAt: end }, actor, `${reason} (period extended by the pause)`); break; }
      case "reactivate": {
        if (sub.status !== "SUSPENDED") throw new AppError("CONFLICT", { message: "Only a suspended subscription can be reactivated this way." });
        const lapsed = !sub.currentPeriodEnd || sub.currentPeriodEnd <= now; const days = Number(input.extendDays);
        if (lapsed && !(Number.isInteger(days) && days >= 1 && days <= 90)) throw new AppError("VALIDATION_ERROR", { fieldErrors: { extendDays: "The paid period has ended — give 1 to 90 courtesy days." } });
        const end = lapsed ? addDaysUtc(now, days) : sub.currentPeriodEnd!;
        await transition(tx, sub, "ACTIVE", { suspendedAt: null, gracePeriodStart: null, gracePeriodEnd: null, failedPaymentCount: 0, dunningStage: 0, currentPeriodEnd: end, nextBillingDate: end, endsAt: end, currentPeriodStart: lapsed ? now : sub.currentPeriodStart }, actor, reason); break;
      }
      case "cancel": await transition(tx, sub, "CANCELLED", { cancelledAt: now, cancellationReason: "OTHER", cancellationNotes: reason.slice(0, 500), endsAt: now, nextBillingDate: null }, actor, reason); break;
      case "expire": await transition(tx, sub, "EXPIRED", { endsAt: now, nextBillingDate: null }, actor, reason); break;
    }
  });
  if (act === "cancel") for (const i of await db.saasInvoice.findMany({ where: { subscriptionId: sub.id, status: { in: ["ISSUED", "OVERDUE"] }, paidMinor: 0 } })) await voidInvoice(i.id, SYSTEM, "subscription cancelled");
  invalidateEntitlements(tenantId);
  await recordAudit({ action: act === "cancel" ? AUDIT_ACTIONS.SUBSCRIPTION_CANCELLED : act === "reactivate" ? AUDIT_ACTIONS.SUBSCRIPTION_RESUMED : AUDIT_ACTIONS.SUBSCRIPTION_STATUS_CHANGED, tenantId, actorId: ctx.user.id, entityType: "subscription", entityId: sub.id, metadata: { act, from: sub.status, reasonLength: reason.length } });
  if (act === "suspend") await notifySubscription(tenantId, "SUBSCRIPTION_SUSPENDED", `susp:${sub.id}:${now.getTime()}`, { number: "your open invoice" });
  if (act === "reactivate") await notifySubscription(tenantId, "SUBSCRIPTION_REACTIVATED", `react:${sub.id}:${now.getTime()}`, { plan: sub.plan.name });
}
/** A Super Admin changes the plan of a managed subscription immediately, with no charge (courtesy / contract change). Entitlements follow the new snapshot. */
export async function adminChangePlan(ctx: RequestContext, tenantId: string, input: { planId?: string; interval?: string; reason?: string; password?: string }) {
  await stepUp(ctx, input.password, "subscription_change_plan"); const reason = requireReason(input.reason); const sub = await needLive(tenantId);
  const plan = await db.plan.findUnique({ where: { id: String(input.planId ?? "") } }); if (!plan || plan.status !== "ACTIVE" || !isCommercial(plan)) throw new AppError("VALIDATION_ERROR", { fieldErrors: { planId: "That plan isn't available." } });
  if (["CANCELLED", "EXPIRED"].includes(sub.status)) throw new AppError("CONFLICT", { message: "The subscription has ended. Assign a new subscription instead." });
  const intv = input.interval ? interval(input.interval) : sub.billingInterval;
  const v = violationsFor(snapshotOfPlan(plan).limits, (await usageSnapshot(tenantId)).rows); if (v.length) throw new AppError("CONFLICT", { message: `Current usage doesn't fit that plan: ${v.map((x) => `${x.label} ${x.used}/${x.limit}`).join(", ")}.` });
  await db.$transaction(async (tx) => { await tx.subscription.update({ where: { id: sub.id }, data: { planId: plan.id, billingInterval: intv, priceMinor: priceFor(plan, intv), planVersion: plan.version, snapshot: JSON.stringify(snapshotOfPlan(plan)), currency: plan.currency, scheduledChange: null } }); await logEvent(tx, { tenantId, subscriptionId: sub.id, type: "PLAN_CHANGED", fromPlanId: sub.planId, toPlanId: plan.id, actor: actorOf(ctx), note: reason }); });
  invalidateEntitlements(tenantId); await recordAudit({ action: AUDIT_ACTIONS.SUBSCRIPTION_PLAN_CHANGED, tenantId, actorId: ctx.user.id, entityType: "subscription", entityId: sub.id, metadata: { by: "SUPER_ADMIN", from: sub.planId, to: plan.id } });
}

/* ------------------------------------------------------------------------------- overview ------------------------------------------------------------------------------- */
export async function clinicOverview(ctx: TenantRequestContext, now = new Date()) {
  const tenantId = ctx.tenantId; const [sub, policy, vendor] = await Promise.all([loadSub(tenantId), getPolicy(), getVendor()]);
  const [profile, invoices, payments, events] = await Promise.all([
    db.subscriptionBillingProfile.findUnique({ where: { tenantId } }),
    db.saasInvoice.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" }, take: 25 }),
    db.saasPayment.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" }, take: 25 }),
    sub ? db.subscriptionEvent.findMany({ where: { tenantId, type: { not: "NOTIFIED" } }, orderBy: { createdAt: "desc" }, take: 12 }) : Promise.resolve([]),
  ]);
  const usage = await usageSnapshot(tenantId, now); const ent = await entitlementOf(tenantId, now);
  const scheduled = sub?.scheduledChange ? parseJson<{ planId: string; billingInterval: string; effectiveAt: string }>(sub.scheduledChange, null as never) : null;
  const scheduledPlan = scheduled ? await db.plan.findUnique({ where: { id: scheduled.planId }, select: { name: true } }) : null;
  const prov = onlineProvider(); const open = invoices.filter((i) => ["ISSUED", "OVERDUE", "PARTIALLY_PAID"].includes(i.status));
  return {
    managed: !!sub?.managed, legacyPlanName: sub && !sub.managed ? sub.plan.name : null,
    subscription: sub?.managed ? {
      id: sub.id, status: sub.status, statusLabel: STATUS_LABEL[sub.status as SubStatus] ?? sub.status, planId: sub.planId, planName: ent.planName ?? sub.plan.name, interval: sub.billingInterval, priceMinor: sub.priceMinor, currency: sub.currency, planVersion: sub.planVersion,
      trialStart: sub.trialStart, trialEnd: sub.trialEnd, trialDaysLeft: sub.status === "TRIAL" && sub.trialEnd ? daysBetweenCeil(now, sub.trialEnd) : null,
      currentPeriodStart: sub.currentPeriodStart, currentPeriodEnd: sub.currentPeriodEnd, nextBillingDate: sub.nextBillingDate, cancelAtPeriodEnd: sub.cancelAtPeriodEnd, cancellationReason: sub.cancellationReason,
      gracePeriodEnd: sub.gracePeriodEnd, suspendedAt: sub.suspendedAt, autoRenew: sub.autoRenew, source: sub.source, access: accessFor(sub.status, policy),
      scheduledChange: scheduled ? { planName: scheduledPlan?.name ?? "—", interval: scheduled.billingInterval, effectiveAt: scheduled.effectiveAt } : null,
      features: ent.features, planLimits: ent.limits,
    } : null,
    usage: usage.rows, usageWindowStart: usage.windowStart, profile,
    invoices: invoices.map((i) => ({ id: i.id, number: i.invoiceNumber, kind: i.kind, status: i.status, totalMinor: i.totalMinor, paidMinor: i.paidMinor, refundedMinor: i.refundedMinor, outstandingMinor: i.status === "VOID" ? 0 : outstandingOf(i), issuedAt: i.issuedAt, dueAt: i.dueAt, paidAt: i.paidAt, periodStart: i.periodStart, periodEnd: i.periodEnd, planName: i.planName })),
    payments: payments.map((p) => ({ id: p.id, invoiceId: p.invoiceId, amountMinor: p.amountMinor, status: p.status, method: p.method, receiptNumber: p.receiptNumber, paidAt: p.paidAt, createdAt: p.createdAt, refundedMinor: p.refundedMinor, failureReason: p.failureReason })),
    openInvoice: open.length ? open[0].id : null, events: events.map((e) => ({ id: e.id, type: e.type, from: e.fromStatus, to: e.toStatus, at: e.createdAt, source: e.source })),
    onlinePayments: { available: !!prov, provider: prov?.displayName ?? null, hint: prov ? null : "Online payment isn't switched on yet. Contact support to pay by bank transfer or UPI." },
    support: { email: vendor.supportEmail, phone: vendor.supportPhone, hours: vendor.supportHours }, policy: { graceDays: policy.graceDays },
    canManage: ctx.permissions.has("subscription.manage"), cancelReasons: CANCEL_REASONS,
  };
}
