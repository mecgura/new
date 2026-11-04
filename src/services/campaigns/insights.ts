import { db } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { compare, explainError } from "@/lib/campaign-insights";
import { getMetaRates, metaRateFor } from "@/services/meta-rates";
import { feeFor, type FeeCategory } from "@/services/wallet-pricing";

/**
 * Campaign intelligence on top of the live counters: A/B results with a significance test, cost and ROI with
 * attribution (deals opened, deals won and purchases by recipients after the message), failure diagnostics in plain
 * language, and recommendations (best hour to send, which version to keep). Estimates are labelled as estimates.
 */

const DAY = 86_400_000;
const LEAD_WINDOW = 7 * DAY;
const SALE_WINDOW = 30 * DAY;
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : 0);
const istHour = (d: Date) => new Date(d.getTime() + 5.5 * 3_600_000).getUTCHours();

type Rec = { variant: string; contactId: string | null; status: string; sentAt: Date | null; deliveredAt: Date | null; readAt: Date | null; repliedAt: Date | null; optedOutAt: Date | null; error: string };

function tally(rows: Rec[]) {
  return {
    recipients: rows.length,
    sent: rows.filter((r) => r.sentAt).length,
    delivered: rows.filter((r) => r.deliveredAt).length,
    read: rows.filter((r) => r.readAt).length,
    replies: rows.filter((r) => r.repliedAt).length,
    optOuts: rows.filter((r) => r.optedOutAt).length,
    failed: rows.filter((r) => r.status === "failed").length,
  };
}

/** Deals opened / won and purchases by these contacts after they got the message. */
async function attribution(organizationId: string, rows: Rec[]) {
  const sentAt = new Map(rows.filter((r) => r.contactId && r.sentAt).map((r) => [r.contactId!, r.sentAt!]));
  const ids = [...sentAt.keys()];
  if (!ids.length) return { leads: 0, wonDeals: 0, wonRupees: 0, purchases: 0, purchaseRupees: 0, byContact: new Map<string, { lead: boolean; revenue: number }>() };
  const first = new Date(Math.min(...[...sentAt.values()].map((d) => d.getTime())));
  const [deals, purchases] = await Promise.all([
    db.deal.findMany({ where: { organizationId, contactId: { in: ids }, createdAt: { gte: first } }, select: { contactId: true, createdAt: true, status: true, closedAt: true, valuePaise: true } }),
    db.purchase.findMany({ where: { organizationId, contactId: { in: ids }, createdAt: { gte: first } }, select: { contactId: true, createdAt: true, amountPaise: true } }),
  ]);
  const byContact = new Map<string, { lead: boolean; revenue: number }>();
  const touch = (id: string) => byContact.get(id) ?? byContact.set(id, { lead: false, revenue: 0 }).get(id)!;
  let leads = 0, wonDeals = 0, wonPaise = 0, purchaseCount = 0, purchasePaise = 0;
  for (const d of deals) {
    const s = sentAt.get(d.contactId)!;
    const t = d.createdAt.getTime() - s.getTime();
    if (t >= 0 && t <= LEAD_WINDOW && !touch(d.contactId).lead) {
      touch(d.contactId).lead = true;
      leads++;
    }
    if (d.status === "won" && d.closedAt && d.closedAt.getTime() - s.getTime() >= 0 && d.closedAt.getTime() - s.getTime() <= SALE_WINDOW) {
      wonDeals++;
      wonPaise += d.valuePaise;
      touch(d.contactId).revenue += d.valuePaise;
    }
  }
  for (const p of purchases) {
    const t = p.createdAt.getTime() - sentAt.get(p.contactId)!.getTime();
    if (t >= 0 && t <= SALE_WINDOW) {
      purchaseCount++;
      purchasePaise += p.amountPaise;
      touch(p.contactId).revenue += p.amountPaise;
    }
  }
  return { leads, wonDeals, wonRupees: wonPaise / 100, purchases: purchaseCount, purchaseRupees: purchasePaise / 100, byContact };
}

/** Per-message cost in paise: Meta's rate + MECGURA's fee for the category (0 on demo numbers). */
export async function unitCost(organizationId: string, category: string, isDemo: boolean) {
  if (isDemo) return { meta: 0, fee: 0 };
  const cat = (["marketing", "utility", "authentication"].includes(category.toLowerCase()) ? category.toLowerCase() : "marketing") as FeeCategory;
  const [rates, fee] = await Promise.all([getMetaRates(), feeFor(organizationId, cat)]);
  return { meta: metaRateFor(rates, cat), fee };
}

export async function campaignInsights(organizationId: string, campaignId: string) {
  const c = await db.campaign.findFirst({ where: { id: campaignId, organizationId }, include: { template: { select: { name: true, category: true } }, abTemplate: { select: { name: true } } } });
  if (!c) throw new ApiError("NOT_FOUND", "Campaign not found.");
  const rows: Rec[] = await db.campaignRecipient.findMany({ where: { campaignId }, select: { variant: true, contactId: true, status: true, sentAt: true, deliveredAt: true, readAt: true, repliedAt: true, optedOutAt: true, error: true } });
  const all = tally(rows);
  const attr = await attribution(organizationId, rows);
  const unit = await unitCost(organizationId, c.template?.category ?? "marketing", c.isDemo);
  // Meta charges per delivered message; MECGURA's fee per sent message.
  const costPaise = Math.round(all.delivered * unit.meta + all.sent * unit.fee);
  const revenue = attr.wonRupees + attr.purchaseRupees;
  const cost = costPaise / 100;
  const roi = {
    estimatedCostRupees: Math.round(cost * 100) / 100,
    metaPerMessagePaise: unit.meta,
    feePerMessagePaise: unit.fee,
    replies: all.replies,
    leads: attr.leads,
    wonDeals: attr.wonDeals,
    purchases: attr.purchases,
    revenueRupees: revenue,
    costPerReply: all.replies ? Math.round((cost / all.replies) * 100) / 100 : null,
    costPerLead: attr.leads ? Math.round((cost / attr.leads) * 100) / 100 : null,
    roiPct: cost > 0 && revenue ? Math.round(((revenue - cost) / cost) * 1000) / 10 : null,
    windowNote: "Leads: deals opened within 7 days of the message. Revenue: deals won and purchases within 30 days.",
  };

  // A/B
  let ab = null;
  if (c.abTemplateId || rows.some((r) => r.variant === "B")) {
    const A = rows.filter((r) => r.variant !== "B");
    const B = rows.filter((r) => r.variant === "B");
    const tA = tally(A), tB = tally(B);
    const leadsOf = (rs: Rec[]) => rs.filter((r) => r.contactId && attr.byContact.get(r.contactId)?.lead).length;
    ab = {
      a: { template: c.template?.name ?? "A", ...tA, leads: leadsOf(A) },
      b: { template: c.abTemplate?.name ?? "B", ...tB, leads: leadsOf(B) },
      replyRate: compare("reply rate", tA.replies, tA.delivered, tB.replies, tB.delivered),
      readRate: compare("read rate", tA.read, tA.delivered, tB.read, tB.delivered),
      optOutRate: compare("opt-out rate", tA.optOuts, tA.delivered, tB.optOuts, tB.delivered),
    };
  }

  // Failure diagnostics: group by meaning, with the raw errors underneath.
  const groups = new Map<string, { title: string; fix: string; count: number; examples: string[] }>();
  for (const r of rows.filter((x) => (x.status === "failed" || x.status === "skipped") && x.error)) {
    const h = explainError(r.error);
    const g = groups.get(h.title) ?? { ...h, count: 0, examples: [] };
    g.count++;
    if (g.examples.length < 3 && !g.examples.includes(r.error)) g.examples.push(r.error.slice(0, 200));
    groups.set(h.title, g);
  }
  const failures = [...groups.values()].sort((a, b) => b.count - a.count);

  // Recommendations
  const recommendations: string[] = [];
  const best = await bestHour(organizationId);
  if (best) recommendations.push(`Your customers read most at ${best.label} (${best.readRate}% read rate over the last 90 days). Schedule the next campaign around then.`);
  if (ab?.replyRate.winner) recommendations.push(`Keep version ${ab.replyRate.winner} (“${ab.replyRate.winner === "A" ? ab.a.template : ab.b.template}”) for the next campaign: it got more replies.`);
  if (all.delivered >= 50 && pct(all.optOuts, all.delivered) >= 2) recommendations.push("Opt-outs are above 2%. Send to people who bought or replied recently, and make the offer more specific.");
  if (all.delivered >= 50 && pct(all.replies, all.delivered) < 2) recommendations.push("Few replies. Add a clear question or quick-reply buttons (“Yes, send details”) to the template.");
  if (failures[0]?.title.startsWith("Meta limited marketing")) recommendations.push("Meta capped marketing messages for many people. Space campaigns out and target fewer, warmer contacts.");
  if (!roi.leads && all.replies >= 5) recommendations.push("People replied but no deals were opened. Turn replies into deals in Deals so ROI can be measured.");

  return { rates: { delivered: pct(all.delivered, all.sent), read: pct(all.read, all.delivered), replies: pct(all.replies, all.delivered), optOuts: pct(all.optOuts, all.delivered) }, totals: all, roi, ab, failures, recommendations };
}

/** The IST hour whose campaign messages were read most (needs at least 30 delivered in that hour). */
export async function bestHour(organizationId: string, now = new Date()) {
  const rows = await db.campaignRecipient.findMany({ where: { organizationId, deliveredAt: { not: null }, sentAt: { gte: new Date(now.getTime() - 90 * DAY) } }, select: { sentAt: true, readAt: true }, take: 20_000 });
  const by = new Map<number, { n: number; read: number }>();
  for (const r of rows) {
    const h = istHour(r.sentAt!);
    const v = by.get(h) ?? { n: 0, read: 0 };
    v.n++;
    if (r.readAt) v.read++;
    by.set(h, v);
  }
  const ranked = [...by.entries()].filter(([, v]) => v.n >= 30).map(([h, v]) => ({ hour: h, readRate: pct(v.read, v.n) })).sort((a, b) => b.readRate - a.readRate);
  if (!ranked.length) return null;
  const h = ranked[0].hour;
  const fmt = (x: number) => `${x % 12 || 12}${x % 24 < 12 ? "am" : "pm"}`;
  const label = `${fmt(h)}–${fmt(h + 1)}`;
  return { hour: h, label, readRate: ranked[0].readRate };
}

/** Recent campaigns side by side, plus each template's results across campaigns. */
export async function campaignPerformance(organizationId: string) {
  const campaigns = await db.campaign.findMany({ where: { organizationId, status: { in: ["completed", "sending", "paused"] } }, orderBy: { startedAt: "desc" }, take: 30, select: { id: true, name: true, startedAt: true, isDemo: true, abTemplateId: true, template: { select: { id: true, name: true, category: true } } } });
  const out = [];
  const byTemplate = new Map<string, { name: string; sent: number; delivered: number; read: number; replies: number; optOuts: number; campaigns: number }>();
  for (const c of campaigns) {
    const ins = await campaignInsights(organizationId, c.id);
    out.push({ id: c.id, name: c.name, startedAt: c.startedAt, template: c.template?.name ?? "—", abTest: Boolean(c.abTemplateId), ...ins.totals, rates: ins.rates, costRupees: ins.roi.estimatedCostRupees, leads: ins.roi.leads, revenueRupees: ins.roi.revenueRupees, roiPct: ins.roi.roiPct });
    if (c.template && !c.abTemplateId) {
      const t = byTemplate.get(c.template.id) ?? { name: c.template.name, sent: 0, delivered: 0, read: 0, replies: 0, optOuts: 0, campaigns: 0 };
      t.sent += ins.totals.sent;
      t.delivered += ins.totals.delivered;
      t.read += ins.totals.read;
      t.replies += ins.totals.replies;
      t.optOuts += ins.totals.optOuts;
      t.campaigns++;
      byTemplate.set(c.template.id, t);
    }
  }
  const templates = [...byTemplate.entries()].map(([id, t]) => ({ id, ...t, readRate: pct(t.read, t.delivered), replyRate: pct(t.replies, t.delivered), optOutRate: pct(t.optOuts, t.delivered) })).sort((a, b) => b.replyRate - a.replyRate);
  return { campaigns: out, templates, bestHour: await bestHour(organizationId) };
}
