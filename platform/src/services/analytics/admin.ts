import { db } from "@/lib/db";
import { dayKey, monthPrefix } from "@/lib/services/usage";
import { adminBillingOverview } from "@/services/billing/admin";

const DAY = 86_400_000;

function lastMonths(n: number) {
  const out: string[] = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) out.push(dayKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 15))).slice(0, 7));
  return out;
}

/** Platform-wide analytics for the super admin: client growth, revenue, usage and the health of the system. */
export async function getAdminAnalytics(days: number) {
  const now = new Date();
  const since = new Date(now.getTime() - days * DAY);
  const labels = Array.from({ length: days }, (_, i) => dayKey(new Date(now.getTime() - (days - 1 - i) * DAY)));
  const months = lastMonths(12);
  const metrics = ["messages_sent", "contacts_created", "ai_replies", "api_calls", "campaigns_launched"] as const;

  const [orgs, counters, topRows, billing, hooks, apiLogs, metaEvents, failedMsgs, runStatus, backlogHooks, runningExec, sendingCampaigns, totals, onboarding] = await Promise.all([
    db.organization.findMany({ select: { createdAt: true, status: true, subscriptions: { where: { status: "active" }, select: { id: true }, take: 1 } } }),
    db.usageCounter.findMany({ where: { day: { gte: labels[0] } }, select: { metric: true, day: true, value: true } }),
    db.usageCounter.groupBy({ by: ["organizationId"], where: { metric: "messages_sent", day: { startsWith: monthPrefix() } }, _sum: { value: true }, orderBy: { _sum: { value: "desc" } }, take: 8 }),
    adminBillingOverview(),
    db.webhookDelivery.groupBy({ by: ["status"], where: { createdAt: { gte: since } }, _count: { _all: true } }),
    db.apiRequestLog.findMany({ where: { createdAt: { gte: since } }, select: { status: true } }),
    db.webhookEvent.groupBy({ by: ["status"], where: { receivedAt: { gte: since } }, _count: { _all: true } }),
    db.message.count({ where: { direction: "outbound", status: "failed", createdAt: { gte: since }, isDemo: false } }),
    db.automationExecution.groupBy({ by: ["status"], where: { isTest: false, createdAt: { gte: since } }, _count: { _all: true } }),
    db.webhookDelivery.count({ where: { status: "pending", nextAttemptAt: { lte: now } } }),
    db.automationExecution.count({ where: { status: { in: ["queued", "running"] } } }),
    db.campaign.count({ where: { status: "sending" } }),
    Promise.all([db.organization.count(), db.contact.count(), db.message.count(), db.conversation.count()]),
    Promise.all([
      db.organization.count({ where: { whatsappAccounts: { some: { status: { in: ["connected", "demo"] } } } } }),
      db.organization.count({ where: { messages: { some: { direction: "outbound" } } } }),
      db.organization.count({ where: { campaigns: { some: { status: { not: "draft" } } } } }),
      db.organization.count({ where: { automations: { some: { status: "active" } } } }),
    ]),
  ]);

  // Client growth ------------------------------------------------------------------------------
  const byMonth = new Map(months.map((m) => [m, 0]));
  for (const o of orgs) {
    const m = dayKey(o.createdAt).slice(0, 7);
    if (byMonth.has(m)) byMonth.set(m, (byMonth.get(m) ?? 0) + 1);
  }
  const before = orgs.filter((o) => dayKey(o.createdAt).slice(0, 7) < months[0]).length;
  let run = before;
  const growth = months.map((m) => {
    run += byMonth.get(m) ?? 0;
    return { month: m, newClients: byMonth.get(m) ?? 0, totalClients: run };
  });

  // Usage ---------------------------------------------------------------------------------------
  const series: Record<string, number[]> = Object.fromEntries(metrics.map((m) => [m, labels.map(() => 0)]));
  for (const c of counters) {
    const i = labels.indexOf(c.day);
    if (i >= 0 && series[c.metric]) series[c.metric][i] += c.value;
  }
  const topOrgs = await db.organization.findMany({ where: { id: { in: topRows.map((t) => t.organizationId) } }, select: { id: true, name: true } });

  const status = (rows: { status: string; _count: { _all: number } }[], s: string) => rows.find((r) => r.status === s)?._count._all ?? 0;
  const apiTotal = apiLogs.length;
  const api4xx = apiLogs.filter((l) => l.status >= 400 && l.status < 500).length;
  const api5xx = apiLogs.filter((l) => l.status >= 500).length;
  const hookDone = status(hooks, "delivered") + status(hooks, "failed");

  return {
    range: { days, labels },
    clients: {
      total: totals[0],
      active: orgs.filter((o) => o.status === "active").length,
      suspended: orgs.filter((o) => o.status === "suspended").length,
      withPlan: orgs.filter((o) => o.subscriptions.length).length,
      withoutPlan: orgs.filter((o) => !o.subscriptions.length).length,
      growth,
      onboarding: { connectedNumber: onboarding[0], sentMessages: onboarding[1], launchedCampaign: onboarding[2], activeAutomation: onboarding[3] },
    },
    revenue: { ...billing.revenue, mrr: billing.mrr, subscriptions: billing.subscriptions, receivables: billing.receivables, arpa: billing.subscriptions.invoiced ? Math.round(billing.mrr.invoiced / billing.subscriptions.invoiced) : 0 },
    usage: {
      series,
      totals: Object.fromEntries(metrics.map((m) => [m, series[m].reduce((a, b) => a + b, 0)])),
      topClients: topRows.map((t) => ({ id: t.organizationId, name: topOrgs.find((o) => o.id === t.organizationId)?.name ?? "—", messages: t._sum.value ?? 0 })),
    },
    system: {
      platform: { clients: totals[0], contacts: totals[1], messages: totals[2], conversations: totals[3] },
      webhooks: { delivered: status(hooks, "delivered"), failed: status(hooks, "failed"), pending: status(hooks, "pending"), successRate: hookDone ? Math.round((status(hooks, "delivered") / hookDone) * 1000) / 10 : null, dueNow: backlogHooks },
      api: { requests: apiTotal, clientErrors: api4xx, serverErrors: api5xx, rateLimited: apiLogs.filter((l) => l.status === 429).length },
      metaEvents: { processed: status(metaEvents, "processed"), ignored: status(metaEvents, "ignored"), failed: status(metaEvents, "failed") },
      failedMessages: failedMsgs,
      automation: { completed: status(runStatus, "completed"), failed: status(runStatus, "failed"), activeNow: runningExec },
      campaignsSending: sendingCampaigns,
    },
  };
}
