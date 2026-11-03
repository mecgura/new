import { db } from "@/lib/db";
import { SOURCE_LABELS, type Source } from "@/services/marketing/leads";

const DAY = 86_400_000;
const istDate = (d: Date) => new Date(d.getTime() + 5.5 * 3_600_000).toISOString().slice(0, 10);

/** Marketing overview for the last `days` days: traffic, where it came from, the funnel and money won. */
export async function marketingOverview(days = 30, now = new Date()) {
  const since = new Date(now.getTime() - days * DAY);
  const [events, leads, wonAll] = await Promise.all([
    db.marketingEvent.findMany({ where: { createdAt: { gte: since } }, select: { kind: true, name: true, source: true, ref: true, visitor: true, createdAt: true } }),
    db.marketingLead.findMany({ where: { createdAt: { gte: since } }, select: { source: true, medium: true, ref: true, stage: true, valuePaise: true, createdAt: true } }),
    db.marketingLead.findMany({ where: { stage: "won", updatedAt: { gte: since } }, select: { valuePaise: true } }),
  ]);
  const visits = events.filter((e) => e.kind === "visit");
  const clicks = events.filter((e) => e.kind === "click");

  // Daily series (India dates), oldest first.
  const dates = Array.from({ length: days }, (_, i) => istDate(new Date(now.getTime() - (days - 1 - i) * DAY)));
  const per = (rows: { createdAt: Date }[]) => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(istDate(r.createdAt), (m.get(istDate(r.createdAt)) ?? 0) + 1);
    return dates.map((d) => m.get(d) ?? 0);
  };

  const count = <T,>(rows: T[], key: (r: T) => string) => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(key(r), (m.get(key(r)) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };

  const uniqueVisitors = new Set(visits.map((v) => v.visitor).filter(Boolean)).size || visits.length;
  const ctaClicks = clicks.filter((c) => /demo|whatsapp|claim|call/.test(c.name)).length;

  // Leads by source with how many were won: which channel actually brings customers.
  const bySource = count(leads, (l) => l.source).map(([source, n]) => {
    const won = leads.filter((l) => l.source === source && l.stage === "won").length;
    return { source, label: SOURCE_LABELS[source as Source] ?? source, leads: n, won, rate: n ? Math.round((won / n) * 100) : 0 };
  });

  // Client referral codes (?ref=) that brought visits and leads.
  const refs = count(visits.filter((v) => v.ref), (v) => v.ref).map(([ref, n]) => ({ ref, visits: n, leads: leads.filter((l) => l.ref === ref).length }));

  const stages = { new: 0, contacted: 0, demo: 0, proposal: 0, won: 0, lost: 0 } as Record<string, number>;
  for (const l of leads) stages[l.stage] = (stages[l.stage] ?? 0) + 1;
  const openPipelinePaise = (await db.marketingLead.aggregate({ where: { stage: { in: ["demo", "proposal"] } }, _sum: { valuePaise: true } }))._sum.valuePaise ?? 0;
  const followUpsDue = await db.marketingLead.count({ where: { stage: { notIn: ["won", "lost"] }, OR: [{ nextFollowUpAt: { lte: now } }, { lastContactAt: null }] } });

  return {
    days,
    dates,
    totals: {
      visits: visits.length,
      visitors: uniqueVisitors,
      clicks: ctaClicks,
      leads: leads.length,
      won: leads.filter((l) => l.stage === "won").length,
      wonValuePaise: wonAll.reduce((s, l) => s + l.valuePaise, 0),
      openPipelinePaise,
      followUpsDue,
    },
    series: { visits: per(visits), leads: per(leads) },
    funnel: [
      { label: "Visitors", value: uniqueVisitors },
      { label: "Clicked WhatsApp / demo", value: ctaClicks },
      { label: "Leads", value: leads.length },
      { label: "Demo or later", value: leads.filter((l) => ["demo", "proposal", "won"].includes(l.stage)).length },
      { label: "Won", value: leads.filter((l) => l.stage === "won").length },
    ],
    trafficSources: count(visits, (v) => v.source).slice(0, 8).map(([source, n]) => ({ source, visits: n })),
    topClicks: count(clicks, (c) => c.name).slice(0, 8).map(([name, n]) => ({ name, clicks: n })),
    leadSources: bySource,
    referrals: refs.slice(0, 10),
    stages,
  };
}

/**
 * Real numbers from the platform for "proof" posts: messages MECGURA sent for clients, how many were read and how many
 * new contacts came in. Totals across all live (non-demo) workspaces only; no client is named.
 */
export async function proofStats(days = 30, now = new Date()) {
  const since = new Date(now.getTime() - days * DAY);
  const base = { isDemo: false, direction: "outbound", createdAt: { gte: since } } as const;
  const [sent, delivered, read, contacts, clients, campaigns] = await Promise.all([
    db.message.count({ where: { ...base, status: { in: ["sent", "delivered", "read"] } } }),
    db.message.count({ where: { ...base, status: { in: ["delivered", "read"] } } }),
    db.message.count({ where: { ...base, status: "read" } }),
    db.contact.count({ where: { createdAt: { gte: since } } }),
    db.organization.count({ where: { status: "active" } }),
    db.campaign.count({ where: { status: "completed", completedAt: { gte: since } } }),
  ]);
  return {
    days,
    messagesSent: sent,
    deliveredRate: sent ? Math.round((delivered / sent) * 100) : 0,
    readRate: sent ? Math.round((read / sent) * 100) : 0,
    newContacts: contacts,
    activeClients: clients,
    campaignsCompleted: campaigns,
  };
}
