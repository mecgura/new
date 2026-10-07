import { db } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { ACTIVE_NUMBER_STATUSES, type UsageMetric } from "@/lib/catalog";
import { limitLabel, wouldExceed } from "@/lib/plans";

const istDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" });

/** Calendar day key in IST (YYYY-MM-DD) — usage periods follow Indian business days. */
export function dayKey(date: Date = new Date()): string {
  return istDay.format(date);
}

export function monthPrefix(date: Date = new Date()): string {
  return dayKey(date).slice(0, 7);
}

/**
 * Metering entry point for later modules (messaging, CRM, AI). Atomic upsert so
 * concurrent senders never lose counts.
 */
export async function incrementUsage(organizationId: string, metric: UsageMetric, by = 1, at: Date = new Date()) {
  const day = dayKey(at);
  await db.usageCounter.upsert({
    where: { organizationId_metric_day: { organizationId, metric, day } },
    update: { value: { increment: by } },
    create: { organizationId, metric, day, value: by },
  });
}

export async function monthTotal(organizationId: string, metric: UsageMetric, at: Date = new Date()): Promise<number> {
  const r = await db.usageCounter.aggregate({
    where: { organizationId, metric, day: { startsWith: monthPrefix(at) } },
    _sum: { value: true },
  });
  return r._sum.value ?? 0;
}

export async function currentPlan(organizationId: string) {
  const sub = await db.subscription.findFirst({
    where: { organizationId, status: "active" },
    include: { plan: true },
    orderBy: { startedAt: "desc" },
  });
  return sub;
}

export type UsageLine = { key: string; label: string; used: number; limit: number | null };

/** Usage vs plan limits for one client. `limit: null` = no plan assigned. */
export async function getUsageSummary(organizationId: string): Promise<UsageLine[]> {
  const [sub, seats, numbers, messages, contacts] = await Promise.all([
    currentPlan(organizationId),
    db.organizationMember.count({ where: { organizationId } }),
    db.whatsAppAccount.count({ where: { organizationId, status: { in: ACTIVE_NUMBER_STATUSES } } }),
    monthTotal(organizationId, "messages_sent"),
    monthTotal(organizationId, "contacts_created"),
  ]);
  const p = sub?.plan;
  return [
    { key: "users", label: "Team seats", used: seats, limit: p ? p.maxUsers : null },
    { key: "whatsapp_numbers", label: "WhatsApp numbers", used: numbers, limit: p ? p.maxWhatsAppNumbers : null },
    { key: "messages", label: "Messages this month", used: messages, limit: p ? p.maxMonthlyMessages : null },
    { key: "contacts", label: "New contacts this month", used: contacts, limit: p ? p.maxContacts : null },
  ];
}

/** Enforces plan limits on countable resources before they are created. */
export async function assertWithinLimit(organizationId: string, resource: "users" | "whatsapp_numbers") {
  const sub = await currentPlan(organizationId);
  if (!sub) return; // no plan assigned yet → no limit to enforce
  if (resource === "users") {
    const used = await db.organizationMember.count({ where: { organizationId } });
    if (wouldExceed(used, sub.plan.maxUsers)) {
      throw new ApiError("CONFLICT", `The ${sub.plan.name} plan allows ${limitLabel(sub.plan.maxUsers)} team seats. Upgrade the plan to add more people.`);
    }
  } else {
    const used = await db.whatsAppAccount.count({ where: { organizationId, status: { in: ACTIVE_NUMBER_STATUSES } } });
    if (wouldExceed(used, sub.plan.maxWhatsAppNumbers)) {
      throw new ApiError("CONFLICT", `The ${sub.plan.name} plan allows ${limitLabel(sub.plan.maxWhatsAppNumbers)} WhatsApp number(s). Upgrade the plan to add more.`);
    }
  }
}
