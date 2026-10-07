import { db } from "@/lib/db";
import { ACTIVE_NUMBER_STATUSES } from "@/lib/catalog";
import { isUnlimited, limitsOf, type PlanLimits } from "@/lib/plans";
import { currentPlan, dayKey, monthPrefix, monthTotal } from "@/lib/services/usage";

export type UsageLine = {
  key: string;
  label: string;
  group: "messaging" | "crm" | "automation" | "platform";
  used: number;
  /** null = no plan (no limit). -1 = unlimited. */
  limit: number | null;
  unit: string;
  note?: string;
};

const monthStart = (d = new Date()) => new Date(`${monthPrefix(d)}-01T00:00:00+05:30`);

/**
 * Everything the workspace has used, next to what its plan allows. Counters are billable usage (live
 * numbers only); DB counts cover things that have no allowance (received messages, automation runs).
 */
export async function getUsage(organizationId: string) {
  const sub = await currentPlan(organizationId);
  const L: PlanLimits | null = sub ? limitsOf(sub.plan) : null;
  const since = monthStart();
  const [sent, received, demoSent, newContacts, totalContacts, launched, totalCampaigns, runs, runsFailed, activeAutomations, ai, api, numbers, members] = await Promise.all([
    monthTotal(organizationId, "messages_sent"),
    db.message.count({ where: { organizationId, direction: "inbound", isDemo: false, createdAt: { gte: since } } }),
    db.message.count({ where: { organizationId, direction: "outbound", isDemo: true, createdAt: { gte: since } } }),
    monthTotal(organizationId, "contacts_created"),
    db.contact.count({ where: { organizationId } }),
    monthTotal(organizationId, "campaigns_launched"),
    db.campaign.count({ where: { organizationId } }),
    db.automationExecution.count({ where: { organizationId, isTest: false, createdAt: { gte: since } } }),
    db.automationExecution.count({ where: { organizationId, isTest: false, status: "failed", createdAt: { gte: since } } }),
    db.automation.count({ where: { organizationId, status: "active" } }),
    monthTotal(organizationId, "ai_replies"),
    monthTotal(organizationId, "api_calls"),
    db.whatsAppAccount.count({ where: { organizationId, status: { in: ACTIVE_NUMBER_STATUSES } } }),
    db.organizationMember.count({ where: { organizationId } }),
  ]);
  const lines: UsageLine[] = [
    { key: "messages", label: "Messages sent", group: "messaging", used: sent, limit: L?.messages ?? null, unit: "this month", note: demoSent ? `${demoSent} demo message(s) aren't counted` : undefined },
    { key: "messages_received", label: "Messages received", group: "messaging", used: received, limit: null, unit: "this month", note: "No allowance — customers can always write to you" },
    { key: "numbers", label: "WhatsApp numbers", group: "messaging", used: numbers, limit: L?.whatsappNumbers ?? null, unit: "connected" },
    { key: "contacts", label: "New contacts", group: "crm", used: newContacts, limit: L?.contacts ?? null, unit: "this month", note: `${totalContacts} contacts in total` },
    { key: "members", label: "Team members", group: "crm", used: members, limit: L?.users ?? null, unit: "seats" },
    { key: "campaigns", label: "Campaigns launched", group: "automation", used: launched, limit: L?.campaigns ?? null, unit: "this month", note: `${totalCampaigns} campaigns in total` },
    { key: "automation_runs", label: "Automation runs", group: "automation", used: runs, limit: null, unit: "this month", note: runsFailed ? `${runsFailed} failed` : undefined },
    { key: "automations", label: "Active automations", group: "automation", used: activeAutomations, limit: L?.automations ?? null, unit: "active" },
    { key: "ai_replies", label: "AI replies", group: "platform", used: ai, limit: L?.aiReplies ?? null, unit: "this month", note: "Live AI only — demo replies aren't counted" },
    { key: "api_requests", label: "API requests", group: "platform", used: api, limit: L?.apiRequests ?? null, unit: "this month" },
  ];
  return { period: monthPrefix(), plan: sub ? { id: sub.plan.id, name: sub.plan.name } : null, lines };
}

/** Daily history of the metered counters for the last `days` days (IST), for the Usage charts. */
export async function getUsageHistory(organizationId: string, days: number) {
  const from = dayKey(new Date(Date.now() - (days - 1) * 86_400_000));
  const rows = await db.usageCounter.findMany({ where: { organizationId, day: { gte: from } }, select: { metric: true, day: true, value: true } });
  const series: Record<string, Record<string, number>> = {};
  for (const r of rows) (series[r.metric] ??= {})[r.day] = r.value;
  const labels = Array.from({ length: days }, (_, i) => dayKey(new Date(Date.now() - (days - 1 - i) * 86_400_000)));
  return { days: labels, metrics: Object.fromEntries(Object.entries(series).map(([m, byDay]) => [m, labels.map((d) => byDay[d] ?? 0)])) };
}

export const usagePercent = (l: UsageLine) => (l.limit === null || isUnlimited(l.limit) || l.limit === 0 ? null : Math.min(100, Math.round((l.used / l.limit) * 100)));
