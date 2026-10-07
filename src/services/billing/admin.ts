import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { mrrAt } from "@/lib/services/clients";
import { dayKey } from "@/lib/services/usage";
import { invoiceDto } from "@/services/billing/billing";

const DAY = 86_400_000;
const monthKey = (d: Date) => dayKey(d).slice(0, 7);

/** Months (YYYY-MM, IST) from oldest to newest. */
function lastMonths(n: number) {
  const out: string[] = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) out.push(monthKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 15))));
  return out;
}

/** Real money only: revenue = PAID invoices (what was actually collected), not what was promised. */
export async function adminBillingOverview() {
  const now = new Date();
  const since30 = new Date(now.getTime() - 30 * DAY);
  const months = lastMonths(12);
  const [paid, subs, plans, open, failed, recent, mrr, newSubs, endedSubs] = await Promise.all([
    db.invoice.findMany({ where: { status: "paid", paidAt: { gte: new Date(`${months[0]}-01T00:00:00Z`) } }, select: { total: true, taxAmount: true, paidAt: true } }),
    db.subscription.findMany({ where: { status: "active" }, select: { planId: true, billingMode: true, cancelAtPeriodEnd: true, priceMonthly: true, organization: { select: { status: true } } } }),
    db.plan.findMany({ orderBy: [{ sortOrder: "asc" }, { priceMonthly: "asc" }], select: { id: true, name: true, isActive: true } }),
    db.invoice.findMany({ where: { status: "open" }, select: { total: true, dueAt: true, organizationId: true } }),
    db.payment.findMany({ where: { status: "failed", createdAt: { gte: since30 } }, orderBy: { createdAt: "desc" }, take: 50, include: { invoice: { select: { number: true, total: true } }, organization: { select: { id: true, name: true } } } }),
    db.invoice.findMany({ orderBy: { issuedAt: "desc" }, take: 8, include: { organization: { select: { id: true, name: true } } } }),
    mrrAt(now),
    db.subscription.count({ where: { startedAt: { gte: since30 }, status: "active" } }),
    db.subscription.count({ where: { endedAt: { gte: since30 }, endReason: "canceled" } }),
  ]);
  const byMonth = new Map(months.map((m) => [m, { month: m, revenue: 0, tax: 0, invoices: 0 }]));
  for (const i of paid) {
    const row = byMonth.get(monthKey(i.paidAt!));
    if (row) {
      row.revenue += i.total;
      row.tax += i.taxAmount;
      row.invoices++;
    }
  }
  const thisMonth = byMonth.get(months.at(-1)!)!;
  const lastMonth = byMonth.get(months.at(-2)!)!;
  const overdue = open.filter((i) => i.dueAt < now);
  const active = subs.filter((s) => s.organization.status === "active");
  return {
    revenue: { thisMonth: thisMonth.revenue, lastMonth: lastMonth.revenue, last12Months: [...byMonth.values()].reduce((n, r) => n + r.revenue, 0), taxCollected: thisMonth.tax, byMonth: [...byMonth.values()] },
    mrr: { contracted: mrr, invoiced: active.filter((s) => s.billingMode === "invoiced").reduce((n, s) => n + s.priceMonthly, 0), complimentary: active.filter((s) => s.billingMode !== "invoiced").reduce((n, s) => n + s.priceMonthly, 0) },
    subscriptions: {
      active: active.length,
      invoiced: active.filter((s) => s.billingMode === "invoiced").length,
      complimentary: active.filter((s) => s.billingMode !== "invoiced").length,
      cancelling: active.filter((s) => s.cancelAtPeriodEnd).length,
      pastDue: new Set(overdue.map((i) => i.organizationId)).size,
      new30d: newSubs,
      canceled30d: endedSubs,
    },
    activePlans: plans.map((p) => {
      const mine = active.filter((s) => s.planId === p.id);
      return { id: p.id, name: p.name, isActive: p.isActive, subscriptions: mine.length, mrr: mine.reduce((n, s) => n + s.priceMonthly, 0) };
    }),
    receivables: { open: open.reduce((n, i) => n + i.total, 0), openCount: open.length, overdue: overdue.reduce((n, i) => n + i.total, 0), overdueCount: overdue.length },
    failedPayments: { count30d: failed.length, items: failed.map((p) => ({ id: p.id, createdAt: p.createdAt, gateway: p.gateway, amount: p.amount, reason: p.failureReason || p.failureCode || "Declined", invoice: p.invoice.number, client: p.organization })) },
    recentInvoices: recent.map((i) => ({ ...invoiceDto(i), client: i.organization })),
  };
}

export async function adminListInvoices(f: { status?: string; q?: string; organizationId?: string; page: number; pageSize: number }) {
  const where: Prisma.InvoiceWhereInput = {
    ...(f.organizationId ? { organizationId: f.organizationId } : {}),
    ...(f.status === "overdue" ? { status: "open", dueAt: { lt: new Date() } } : f.status ? { status: f.status } : {}),
    ...(f.q ? { OR: [{ number: { contains: f.q } }, { organization: { name: { contains: f.q } } }] } : {}),
  };
  const [rows, total] = await Promise.all([
    db.invoice.findMany({ where, orderBy: { issuedAt: "desc" }, skip: (f.page - 1) * f.pageSize, take: f.pageSize, include: { organization: { select: { id: true, name: true } }, payments: { orderBy: { createdAt: "desc" }, take: 3, select: { status: true, gateway: true, failureReason: true, createdAt: true } } } }),
    db.invoice.count({ where }),
  ]);
  return { invoices: rows.map((i) => ({ ...invoiceDto(i), client: i.organization })), total };
}

export async function adminListPayments(f: { status?: string; page: number; pageSize: number }) {
  const where: Prisma.PaymentWhereInput = f.status ? { status: f.status } : {};
  const [rows, total] = await Promise.all([
    db.payment.findMany({ where, orderBy: { createdAt: "desc" }, skip: (f.page - 1) * f.pageSize, take: f.pageSize, include: { invoice: { select: { number: true } }, organization: { select: { id: true, name: true } } } }),
    db.payment.count({ where }),
  ]);
  return { payments: rows.map((p) => ({ id: p.id, gateway: p.gateway, status: p.status, amount: p.amount, currency: p.currency, reason: p.failureReason || p.failureCode, invoice: p.invoice.number, client: p.organization, createdAt: p.createdAt, completedAt: p.completedAt })), total };
}
