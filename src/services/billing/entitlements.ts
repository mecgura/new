import { db } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { FEATURES, isUnlimited, limitLabel, limitsOf, parseFeatures, wouldExceed, type FeatureKey, type PlanLimits } from "@/lib/plans";
import { currentPlan, monthTotal } from "@/lib/services/usage";
import { getBillingSettings } from "@/services/billing/settings";
import type { UsageMetric } from "@/lib/catalog";

/**
 * What a workspace may do — always read from its plan in the database, never from constants.
 * A workspace that never had a plan (legacy/admin-managed) is unrestricted. One whose subscription was
 * cancelled, or whose invoice is unpaid beyond the grace period, is "blocked" from sending.
 */
export type BillingState = "none" | "ok" | "past_due" | "blocked";
export type Entitlements = {
  hasPlan: boolean;
  planId: string | null;
  planName: string | null;
  limits: PlanLimits | null; // null = no plan = no limits
  features: Set<FeatureKey> | null; // null = all
  state: BillingState;
  blockedReason: string;
};

const DAY = 86_400_000;

export async function billingState(organizationId: string): Promise<{ state: BillingState; reason: string }> {
  const sub = await currentPlan(organizationId);
  if (!sub) {
    const canceled = await db.subscription.findFirst({ where: { organizationId, status: "ended", endReason: "canceled" }, orderBy: { endedAt: "desc" } });
    const replacedLater = canceled ? await db.subscription.count({ where: { organizationId, startedAt: { gt: canceled.startedAt } } }) : 0;
    if (canceled && !replacedLater) return { state: "blocked", reason: "Your subscription was cancelled. Choose a plan in Billing to start sending again." };
    return { state: "none", reason: "" };
  }
  if (sub.billingMode !== "invoiced") return { state: "ok", reason: "" };
  const overdue = await db.invoice.findFirst({ where: { organizationId, status: "open", dueAt: { lt: new Date() } }, orderBy: { dueAt: "asc" } });
  if (!overdue) return { state: "ok", reason: "" };
  const { graceDays } = await getBillingSettings();
  if (Date.now() > overdue.dueAt.getTime() + graceDays * DAY) {
    return { state: "blocked", reason: `Invoice ${overdue.number} is overdue. Pay it in Billing to restore sending.` };
  }
  return { state: "past_due", reason: `Invoice ${overdue.number} is overdue.` };
}

export async function getEntitlements(organizationId: string): Promise<Entitlements> {
  const [sub, bs] = await Promise.all([currentPlan(organizationId), billingState(organizationId)]);
  if (!sub) return { hasPlan: false, planId: null, planName: null, limits: null, features: null, state: bs.state, blockedReason: bs.reason };
  return { hasPlan: true, planId: sub.planId, planName: sub.plan.name, limits: limitsOf(sub.plan), features: new Set(parseFeatures(sub.plan.features)), state: bs.state, blockedReason: bs.reason };
}

/** Refuses outbound activity while the workspace is cancelled or seriously overdue. */
export async function assertBillingActive(organizationId: string) {
  const { state, reason } = await billingState(organizationId);
  if (state === "blocked") throw new ApiError("CONFLICT", reason);
}

export async function hasFeature(organizationId: string, feature: FeatureKey): Promise<boolean> {
  const e = await getEntitlements(organizationId);
  return !e.features || e.features.has(feature);
}

export async function assertFeature(organizationId: string, feature: FeatureKey) {
  const e = await getEntitlements(organizationId);
  if (e.features && !e.features.has(feature)) {
    throw new ApiError("FORBIDDEN", `${FEATURES[feature]} isn't included in your ${e.planName} plan. Upgrade in Billing to use it.`);
  }
}

type MonthlyKind = "messages" | "contacts" | "campaigns" | "aiReplies" | "apiRequests";
const METRIC: Record<MonthlyKind, UsageMetric> = { messages: "messages_sent", contacts: "contacts_created", campaigns: "campaigns_launched", aiReplies: "ai_replies", apiRequests: "api_calls" };

/** Throws when `adding` more would pass this month's allowance on the workspace's plan. */
export async function assertMonthlyQuota(organizationId: string, kind: MonthlyKind, adding = 1, what = "") {
  const e = await getEntitlements(organizationId);
  if (!e.limits) return;
  const limit = e.limits[kind];
  if (!isUnlimited(limit) && wouldExceed(await monthTotal(organizationId, METRIC[kind]), limit, adding)) {
    throw new ApiError("CONFLICT", `Your ${e.planName} plan allows ${limitLabel(limit)} ${what || kind} per month, and this month's allowance is used up. Upgrade in Billing.`);
  }
}

/** Non-throwing variant for background work (AI replies, API requests). */
export async function monthlyQuotaLeft(organizationId: string, kind: MonthlyKind): Promise<boolean> {
  try {
    await assertMonthlyQuota(organizationId, kind);
    return true;
  } catch {
    return false;
  }
}

export async function assertAutomationSlot(organizationId: string) {
  const e = await getEntitlements(organizationId);
  if (!e.limits) return;
  const active = await db.automation.count({ where: { organizationId, status: "active" } });
  if (wouldExceed(active, e.limits.automations)) {
    throw new ApiError("CONFLICT", `Your ${e.planName} plan allows ${limitLabel(e.limits.automations)} active automation(s). Deactivate one or upgrade in Billing.`);
  }
}
