import { db } from "@/lib/db";
import { dayKey } from "@/lib/services/usage";

/**
 * Revenue analytics for MECGURA (Super Admin). Builds on the billing overview with the SaaS numbers an owner
 * watches: MRR trend and ARR, where MRR moved (new / expansion / contraction / churn), logo and revenue churn,
 * renewal rate, revenue by client and by plan, the wallet ledger, and a reconciliation of payments vs invoices.
 * Amounts are in paise. MRR counts active subscriptions of active clients (complimentary ones included, as contracted).
 */

const DAY = 86_400_000;
const IST = 5.5 * 3_600_000;
/** IST month boundaries for the last n months, oldest first: [start, end) of each. */
export function monthWindows(n: number, now = new Date()) {
  const ist = new Date(now.getTime() + IST);
  return Array.from({ length: n }, (_, i) => {
    const y = ist.getUTCFullYear();
    const m = ist.getUTCMonth() - (n - 1 - i);
    const start = new Date(Date.UTC(y, m, 1) - IST);
    const end = new Date(Date.UTC(y, m + 1, 1) - IST);
    return { month: dayKey(new Date(start.getTime() + DAY)).slice(0, 7), start, end };
  });
}

type Sub = { organizationId: string; priceMonthly: number; startedAt: Date; endedAt: Date | null; endReason: string; planId: string; orgActive: boolean };

/** Each client's MRR at a moment (sum of their subscriptions running then). */
export function mrrByOrg(subs: Sub[], at: Date) {
  const m = new Map<string, number>();
  for (const s of subs) if (s.orgActive && s.startedAt <= at && (!s.endedAt || s.endedAt > at)) m.set(s.organizationId, (m.get(s.organizationId) ?? 0) + s.priceMonthly);
  return m;
}

/** MRR movement between two moments, by client. */
export function movement(before: Map<string, number>, after: Map<string, number>) {
  let added = 0, expansion = 0, contraction = 0, churned = 0, newClients = 0, lostClients = 0;
  for (const [org, a] of after) {
    const b = before.get(org) ?? 0;
    if (!b && a) { added += a; newClients++; }
    else if (a > b) expansion += a - b;
    else if (a < b) contraction += b - a;
  }
  for (const [org, b] of before) if (b && !after.get(org)) { churned += b; lostClients++; }
  return { added, expansion, contraction, churned, newClients, lostClients };
}

export async function revenueAnalytics(now = new Date()) {
  const windows = monthWindows(12, now);
  const since = windows[0].start;
  const since30 = new Date(now.getTime() - 30 * DAY);
  const yearAgo = new Date(now.getTime() - 365 * DAY);
  const [rawSubs, plans, orgs, paidInvoices, renewals, wallet, payments, invoicesPaid] = await Promise.all([
    db.subscription.findMany({ where: { OR: [{ endedAt: null }, { endedAt: { gte: since } }] }, select: { organizationId: true, priceMonthly: true, startedAt: true, endedAt: true, endReason: true, planId: true, organization: { select: { status: true } } } }),
    db.plan.findMany({ select: { id: true, name: true } }),
    db.organization.findMany({ select: { id: true, name: true, status: true } }),
    db.invoice.findMany({ where: { status: "paid", paidAt: { gte: yearAgo } }, select: { organizationId: true, total: true, kind: true } }),
    db.invoice.findMany({ where: { kind: "renewal", issuedAt: { gte: new Date(now.getTime() - 90 * DAY), lt: new Date(now.getTime() - 7 * DAY) } }, select: { status: true } }),
    db.walletEntry.groupBy({ by: ["reason", "direction"], where: { createdAt: { gte: since30 } }, _sum: { amount: true }, _count: { _all: true } }),
    db.payment.findMany({ where: { status: "succeeded", createdAt: { gte: since30 } }, select: { id: true, amount: true, invoiceId: true, gateway: true, createdAt: true, invoice: { select: { number: true, status: true, total: true, organization: { select: { name: true } } } } } }),
    db.invoice.findMany({ where: { status: "paid", paidAt: { gte: since30 }, paidVia: { notIn: ["", "manual"] } }, select: { id: true, number: true, total: true, paidVia: true, organization: { select: { name: true } }, payments: { where: { status: "succeeded" }, select: { amount: true } } } }),
  ]);
  const subs: Sub[] = rawSubs.map((s) => ({ ...s, orgActive: s.organization.status === "active" }));
  const orgName = new Map(orgs.map((o) => [o.id, o.name]));

  // MRR trend + movements, month by month.
  const trend = windows.map((w) => {
    const startMap = mrrByOrg(subs, new Date(w.start.getTime() - 1));
    const endAt = w.end > now ? now : new Date(w.end.getTime() - 1);
    const endMap = mrrByOrg(subs, endAt);
    const mrrStart = [...startMap.values()].reduce((a, b) => a + b, 0);
    const mrr = [...endMap.values()].reduce((a, b) => a + b, 0);
    const mv = movement(startMap, endMap);
    const clientsStart = [...startMap.values()].filter(Boolean).length;
    return {
      month: w.month,
      mrr,
      clients: [...endMap.values()].filter(Boolean).length,
      ...mv,
      logoChurnPct: clientsStart ? Math.round((mv.lostClients / clientsStart) * 1000) / 10 : null,
      revenueChurnPct: mrrStart ? Math.round(((mv.churned + mv.contraction) / mrrStart) * 1000) / 10 : null,
      netRetentionPct: mrrStart ? Math.round(((mrrStart - mv.churned - mv.contraction + mv.expansion) / mrrStart) * 1000) / 10 : null,
    };
  });
  const current = mrrByOrg(subs, now);
  const mrr = [...current.values()].reduce((a, b) => a + b, 0);
  const last3 = trend.slice(-3);
  const avg = (xs: (number | null)[]) => {
    const v = xs.filter((x): x is number => x !== null);
    return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null;
  };

  // Revenue by client (paid invoices, last 12 months) with their current MRR.
  const byClient = new Map<string, { paid: number; invoices: number }>();
  for (const i of paidInvoices) {
    const r = byClient.get(i.organizationId) ?? { paid: 0, invoices: 0 };
    r.paid += i.total;
    r.invoices++;
    byClient.set(i.organizationId, r);
  }
  const clientIds = new Set([...byClient.keys(), ...current.keys()]);
  const clients = [...clientIds]
    .map((id) => ({ id, name: orgName.get(id) ?? "—", mrr: current.get(id) ?? 0, paid12m: byClient.get(id)?.paid ?? 0, invoices12m: byClient.get(id)?.invoices ?? 0 }))
    .sort((a, b) => b.paid12m - a.paid12m || b.mrr - a.mrr);

  // Current MRR by plan.
  const byPlan = plans
    .map((p) => {
      const rows = subs.filter((s) => s.planId === p.id && s.orgActive && s.startedAt <= now && (!s.endedAt || s.endedAt > now));
      return { id: p.id, name: p.name, clients: new Set(rows.map((r) => r.organizationId)).size, mrr: rows.reduce((a, r) => a + r.priceMonthly, 0) };
    })
    .filter((p) => p.clients)
    .sort((a, b) => b.mrr - a.mrr);

  const renewalDone = renewals.filter((r) => r.status === "paid").length;
  const renewalClosed = renewals.filter((r) => r.status === "paid" || r.status === "void").length;
  const w = (reason: string, direction: string) => wallet.find((x) => x.reason === reason && x.direction === direction);

  // Reconciliation: money received for an invoice that isn't marked paid, or a gateway-paid invoice with no payment.
  const mismatches = [
    ...payments.filter((p) => p.invoice.status !== "paid").map((p) => ({ kind: "Payment received, invoice not paid", invoice: p.invoice.number, client: p.invoice.organization.name, amount: p.amount, at: p.createdAt })),
    ...payments.filter((p) => p.invoice.status === "paid" && p.amount !== p.invoice.total).map((p) => ({ kind: "Paid amount differs from invoice", invoice: p.invoice.number, client: p.invoice.organization.name, amount: p.amount - p.invoice.total, at: p.createdAt })),
    ...invoicesPaid.filter((i) => !i.payments.length).map((i) => ({ kind: "Invoice paid online, no payment recorded", invoice: i.number, client: i.organization.name, amount: i.total, at: now })),
  ];

  return {
    mrr,
    arr: mrr * 12,
    activeClients: [...current.values()].filter(Boolean).length,
    arpa: current.size ? Math.round(mrr / [...current.values()].filter(Boolean).length) : 0,
    avgLogoChurn3m: avg(last3.map((t) => t.logoChurnPct)),
    avgRevenueChurn3m: avg(last3.map((t) => t.revenueChurnPct)),
    netRetention3m: avg(last3.map((t) => t.netRetentionPct)),
    renewalRatePct: renewalClosed ? Math.round((renewalDone / renewalClosed) * 100) : null,
    renewalsOpen: renewals.length - renewalClosed,
    trend,
    byPlan,
    clients,
    wallet30: {
      topups: w("topup", "credit")?._sum.amount ?? 0,
      topupCount: w("topup", "credit")?._count._all ?? 0,
      usage: w("usage", "debit")?._sum.amount ?? 0,
      refunds: (w("refund", "credit")?._sum.amount ?? 0) + (w("refund", "debit")?._sum.amount ?? 0),
      refundCount: (w("refund", "credit")?._count._all ?? 0) + (w("refund", "debit")?._count._all ?? 0),
      corrections: (w("correction", "credit")?._sum.amount ?? 0) - (w("correction", "debit")?._sum.amount ?? 0),
    },
    reconciliation: { checked: payments.length + invoicesPaid.length, mismatches },
  };
}

/** CSV of revenue by client (for the accountant). */
export async function revenueCsv(now = new Date()) {
  const r = await revenueAnalytics(now);
  const rupees = (p: number) => (p / 100).toFixed(2);
  const esc = (v: string) => (/[",\n]/.test(v) || /^[=+\-@]/.test(v) ? `"${v.replace(/^([=+\-@])/, "'$1").replace(/"/g, '""')}"` : v);
  const lines = ["Client,Current MRR (INR),Paid last 12 months (INR),Invoices last 12 months", ...r.clients.map((c) => [esc(c.name), rupees(c.mrr), rupees(c.paid12m), String(c.invoices12m)].join(","))];
  return lines.join("\n") + "\n";
}
