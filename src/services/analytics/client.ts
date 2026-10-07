import { db } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { dayKey } from "@/lib/services/usage";

const DAY = 86_400_000;
const MESSAGE_CAP = 60_000;

const startOfDayIst = (key: string) => new Date(`${key}T00:00:00+05:30`);
const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : null);
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};
const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);

export type AnalyticsFilter = { days: number; numberId?: string };

/**
 * One workspace's analytics for the last `days` days (IST calendar days, today included). Every query is
 * scoped to the organisation; an optional number filter must belong to it.
 */
export async function getClientAnalytics(organizationId: string, f: AnalyticsFilter) {
  if (f.numberId) {
    const ok = await db.whatsAppAccount.count({ where: { id: f.numberId, organizationId } });
    if (!ok) throw new ApiError("NOT_FOUND", "WhatsApp number not found.");
  }
  const labels = Array.from({ length: f.days }, (_, i) => dayKey(new Date(Date.now() - (f.days - 1 - i) * DAY)));
  const since = startOfDayIst(labels[0]);
  const convScope = f.numberId ? { whatsappAccountId: f.numberId } : {};
  const msgScope = { organizationId, createdAt: { gte: since }, direction: { in: ["inbound", "outbound"] }, ...(f.numberId ? { conversation: { whatsappAccountId: f.numberId } } : {}) };

  const [messages, convsCreated, convsOpenNow, convsUnassigned, convsClosedInRange, contacts, leadDist, campaigns, executions, members, aiRows] = await Promise.all([
    db.message.findMany({ where: msgScope, select: { conversationId: true, direction: true, status: true, createdAt: true, senderUserId: true, payload: true }, orderBy: [{ conversationId: "asc" }, { createdAt: "asc" }], take: MESSAGE_CAP }),
    db.conversation.findMany({ where: { organizationId, createdAt: { gte: since }, ...convScope }, select: { createdAt: true } }),
    db.conversation.count({ where: { organizationId, status: "open", ...convScope } }),
    db.conversation.count({ where: { organizationId, status: "open", assignedToUserId: null, ...convScope } }),
    db.conversation.count({ where: { organizationId, status: "closed", updatedAt: { gte: since }, ...convScope } }),
    db.contact.findMany({ where: { organizationId, createdAt: { gte: since }, ...(f.numberId ? { conversations: { some: { whatsappAccountId: f.numberId } } } : {}) }, select: { createdAt: true, lifecycle: true, leadStatus: true, source: true } }),
    db.contact.groupBy({ by: ["leadStatus"], where: { organizationId, lifecycle: "lead", ...(f.numberId ? { conversations: { some: { whatsappAccountId: f.numberId } } } : {}) }, _count: { _all: true } }),
    db.campaign.findMany({ where: { organizationId, status: { not: "draft" }, createdAt: { gte: since }, ...(f.numberId ? { whatsappAccountId: f.numberId } : {}) }, select: { id: true, name: true, status: true, totalRecipients: true } }),
    db.automationExecution.findMany({ where: { organizationId, isTest: false, createdAt: { gte: since }, ...(f.numberId ? { automation: { whatsappAccountId: f.numberId } } : {}) }, select: { status: true, automationId: true, automation: { select: { name: true } } } }),
    db.organizationMember.findMany({ where: { organizationId }, select: { userId: true, role: true, user: { select: { name: true, email: true } } } }),
    db.aiInteraction.groupBy({ by: ["kind", "mode"], where: { organizationId, isTest: false, createdAt: { gte: since } }, _count: { _all: true } }),
  ]);

  // ---- Messages + delivery/read -------------------------------------------------------------
  const daily = new Map(labels.map((d) => [d, { date: d, inbound: 0, outbound: 0 }]));
  const delivery = { pending: 0, sent: 0, delivered: 0, read: 0, failed: 0 };
  for (const m of messages) {
    const row = daily.get(dayKey(m.createdAt));
    if (!row) continue;
    if (m.direction === "inbound") row.inbound++;
    else {
      row.outbound++;
      if (m.status in delivery) delivery[m.status as keyof typeof delivery]++;
    }
  }
  const inboundTotal = messages.filter((m) => m.direction === "inbound").length;
  const outboundTotal = messages.length - inboundTotal;
  const accepted = delivery.sent + delivery.delivered + delivery.read;

  // ---- Response times (customer message → first reply), overall and per teammate -------------
  type Pending = { at: number };
  const pendingByConv = new Map<string, Pending>();
  const firstResponses: number[] = [];
  const byAgent = new Map<string, { replies: number; times: number[] }>();
  let ai = { replies: 0 };
  const convsWithInbound = new Set<string>();
  const convsAnswered = new Set<string>();
  for (const m of messages) {
    if (m.direction === "inbound") {
      convsWithInbound.add(m.conversationId);
      if (!pendingByConv.has(m.conversationId)) pendingByConv.set(m.conversationId, { at: m.createdAt.getTime() });
      continue;
    }
    // outbound
    let origin = "";
    try {
      origin = (JSON.parse(m.payload) as { origin?: string }).origin ?? "";
    } catch {
      /* ignore */
    }
    if (origin === "ai" || origin === "ai_demo") ai = { replies: ai.replies + 1 };
    const waiting = pendingByConv.get(m.conversationId);
    if (m.senderUserId) {
      const a = byAgent.get(m.senderUserId) ?? { replies: 0, times: [] };
      a.replies++;
      if (waiting) a.times.push(m.createdAt.getTime() - waiting.at);
      byAgent.set(m.senderUserId, a);
    }
    if (waiting) {
      if (m.senderUserId || origin === "ai" || origin === "ai_demo" || origin === "api") firstResponses.push(m.createdAt.getTime() - waiting.at);
      convsAnswered.add(m.conversationId);
      pendingByConv.delete(m.conversationId);
    }
  }
  const fiveMin = 5 * 60_000;

  // ---- Leads ----------------------------------------------------------------------------------
  const leadsDaily = new Map(labels.map((d) => [d, 0]));
  for (const c of contacts) if (c.lifecycle === "lead") leadsDaily.set(dayKey(c.createdAt), (leadsDaily.get(dayKey(c.createdAt)) ?? 0) + 1);
  const newLeads = contacts.filter((c) => c.lifecycle === "lead").length;
  const converted = contacts.filter((c) => c.leadStatus === "won" || c.lifecycle === "customer").length;
  const bySource: Record<string, number> = {};
  for (const c of contacts) bySource[c.source] = (bySource[c.source] ?? 0) + 1;
  const stageOrder = ["new", "contacted", "qualified", "proposal", "won", "lost"];

  // ---- Campaigns ------------------------------------------------------------------------------
  const campaignIds = campaigns.map((c) => c.id);
  const recipients = campaignIds.length ? await db.campaignRecipient.groupBy({ by: ["campaignId", "status"], where: { campaignId: { in: campaignIds } }, _count: { _all: true } }) : [];
  const replied = campaignIds.length ? await db.campaignRecipient.groupBy({ by: ["campaignId"], where: { campaignId: { in: campaignIds }, repliedAt: { not: null } }, _count: { _all: true } }) : [];
  const campaignRows = campaigns.map((c) => {
    const st = Object.fromEntries(recipients.filter((r) => r.campaignId === c.id).map((r) => [r.status, r._count._all])) as Record<string, number>;
    const sent = (st.sent ?? 0) + (st.delivered ?? 0) + (st.read ?? 0);
    const deliveredN = (st.delivered ?? 0) + (st.read ?? 0);
    return { id: c.id, name: c.name, status: c.status, recipients: c.totalRecipients, sent, delivered: deliveredN, read: st.read ?? 0, failed: st.failed ?? 0, replied: replied.find((r) => r.campaignId === c.id)?._count._all ?? 0, deliveryRate: pct(deliveredN, sent), readRate: pct(st.read ?? 0, sent) };
  });

  // ---- Automation -----------------------------------------------------------------------------
  const runStatus: Record<string, number> = {};
  const perAutomation = new Map<string, { name: string; runs: number; failed: number }>();
  for (const e of executions) {
    runStatus[e.status] = (runStatus[e.status] ?? 0) + 1;
    const a = perAutomation.get(e.automationId) ?? { name: e.automation.name, runs: 0, failed: 0 };
    a.runs++;
    if (e.status === "failed") a.failed++;
    perAutomation.set(e.automationId, a);
  }
  const finished = (runStatus.completed ?? 0) + (runStatus.failed ?? 0);

  // ---- AI agent -------------------------------------------------------------------------------
  const aiCount = (kind: string, mode?: string) => aiRows.filter((r) => r.kind === kind && (!mode || r.mode === mode)).reduce((n, r) => n + r._count._all, 0);

  return {
    range: { days: f.days, from: labels[0], to: labels.at(-1)!, numberId: f.numberId ?? null },
    truncated: messages.length >= MESSAGE_CAP,
    messages: {
      inbound: inboundTotal,
      outbound: outboundTotal,
      daily: [...daily.values()],
    },
    delivery: { ...delivery, accepted, deliveryRate: pct(delivery.delivered + delivery.read, accepted), readRate: pct(delivery.read, accepted), failureRate: pct(delivery.failed, accepted + delivery.failed) },
    conversations: {
      started: convsCreated.length,
      openNow: convsOpenNow,
      unassignedOpen: convsUnassigned,
      closed: convsClosedInRange,
      active: convsWithInbound.size,
      dailyStarted: labels.map((d) => ({ date: d, count: convsCreated.filter((c) => dayKey(c.createdAt) === d).length })),
    },
    response: {
      conversationsWithCustomerMessage: convsWithInbound.size,
      answered: convsAnswered.size,
      responseRate: pct(convsAnswered.size, convsWithInbound.size),
      medianFirstResponseSec: firstResponses.length ? Math.round((median(firstResponses) ?? 0) / 1000) : null,
      averageFirstResponseSec: firstResponses.length ? Math.round((avg(firstResponses) ?? 0) / 1000) : null,
      within5MinRate: pct(firstResponses.filter((t) => t <= fiveMin).length, firstResponses.length),
    },
    leads: {
      created: newLeads,
      converted,
      conversionRate: pct(converted, contacts.length),
      newContacts: contacts.length,
      daily: labels.map((d) => ({ date: d, count: leadsDaily.get(d) ?? 0 })),
      bySource,
      pipeline: stageOrder.map((s) => ({ stage: s, count: leadDist.find((l) => l.leadStatus === s)?._count._all ?? 0 })),
    },
    campaigns: {
      count: campaigns.length,
      sent: campaignRows.reduce((n, c) => n + c.sent, 0),
      delivered: campaignRows.reduce((n, c) => n + c.delivered, 0),
      read: campaignRows.reduce((n, c) => n + c.read, 0),
      failed: campaignRows.reduce((n, c) => n + c.failed, 0),
      replied: campaignRows.reduce((n, c) => n + c.replied, 0),
      items: campaignRows.sort((a, b) => b.sent - a.sent).slice(0, 10),
    },
    automation: {
      runs: executions.length,
      byStatus: runStatus,
      successRate: pct(runStatus.completed ?? 0, finished),
      top: [...perAutomation.values()].sort((a, b) => b.runs - a.runs).slice(0, 8),
    },
    agents: {
      team: members
        .filter((m) => m.role !== "CLIENT_OWNER" || byAgent.has(m.userId))
        .map((m) => {
          const a = byAgent.get(m.userId) ?? { replies: 0, times: [] };
          return { userId: m.userId, name: m.user.name ?? m.user.email, role: m.role, replies: a.replies, answeredThreads: a.times.length, medianResponseSec: a.times.length ? Math.round((median(a.times) ?? 0) / 1000) : null, within5MinRate: pct(a.times.filter((t) => t <= fiveMin).length, a.times.length) };
        })
        .sort((a, b) => b.replies - a.replies),
      ai: { replies: ai.replies, liveReplies: aiCount("reply", "live"), demoReplies: aiCount("reply", "demo"), handoffs: aiCount("handoff"), skipped: aiCount("skipped"), errors: aiCount("error") },
    },
  };
}
