import "server-only";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";
import type { TenantRequestContext } from "@/lib/auth/context";
import { COLLECTIBLE, dueOf, isOverdue, minorToInput } from "@/lib/billing/money";
import { AppError } from "@/lib/errors";
import { addDays, todayIn, utcToZoned, zonedToUtc } from "@/lib/scheduling/time";
import { tenantDb } from "@/lib/tenant/db";
import { tenantTimezone, type Client } from "./clinic-shared";
import { loadBillingSettings } from "./billing-master";
import { viewGuard } from "./billing-invoices";

/**
 * Billing dashboard, collections and operational financial reports. These are COUNTS AND SUMS OF REAL ROWS in the clinic's own tables:
 * gross billing, collected, outstanding, refunded and net collection. They are not profit, revenue recognition or accounting.
 * Cancelled/failed payments are never counted; refunds are shown separately.
 */
const db = (ctx: TenantRequestContext) => tenantDb(ctx) as Client;
const MONEY_IN = ["SUCCESS", "PARTIALLY_REFUNDED", "REFUNDED"];
const OPEN: string[] = [...COLLECTIBLE];
const BILLED = ["ISSUED", "PARTIALLY_PAID", "PAID", "REFUNDED", "PARTIALLY_REFUNDED"];
const sum = (rows: { amountMinor?: number }[]) => rows.reduce((a, r) => a + (r.amountMinor ?? 0), 0);
function full(ctx: TenantRequestContext) { viewGuard(ctx); if (!ctx.permissions.has("billing.view")) throw new AppError("FORBIDDEN"); }
function reportGuard(ctx: TenantRequestContext) { full(ctx); if (!ctx.permissions.has("billing.reports")) throw new AppError("FORBIDDEN", { message: "Financial reports are for finance staff and clinic admins." }); }

export async function billingDashboard(ctx: TenantRequestContext) {
  full(ctx);
  const tdb = db(ctx); const tz = await tenantTimezone(ctx.tenantId); const today = todayIn(tz);
  const day0 = zonedToUtc(today, 0, tz); const weekFrom = addDays(today, -6); const monthFrom = `${today.slice(0, 7)}-01`;
  const settings = await loadBillingSettings(tdb, ctx.tenantId);
  const [billedToday, collToday, refundsToday, openInv, partial, invToday, collWeek, collMonth, recentPay, recentRef, overdueCount] = await Promise.all([
    tdb.invoice.findMany({ where: { invoiceDate: today, status: { in: BILLED } }, select: { totalMinor: true } }),
    tdb.payment.findMany({ where: { paymentDate: today, status: { in: MONEY_IN } }, select: { amountMinor: true } }),
    tdb.refund.findMany({ where: { status: "PROCESSED", processedAt: { gte: day0 } }, select: { amountMinor: true } }),
    tdb.invoice.findMany({ where: { status: { in: OPEN }, dueMinor: { gt: 0 } }, select: { dueMinor: true } }),
    tdb.invoice.count({ where: { status: "PARTIALLY_PAID" } }),
    tdb.invoice.count({ where: { invoiceDate: today, status: { not: "CANCELLED" } } }),
    tdb.payment.findMany({ where: { paymentDate: { gte: weekFrom, lte: today }, status: { in: MONEY_IN } }, select: { amountMinor: true } }),
    tdb.payment.findMany({ where: { paymentDate: { gte: monthFrom, lte: today }, status: { in: MONEY_IN } }, select: { amountMinor: true } }),
    tdb.payment.findMany({ orderBy: { createdAt: "desc" }, take: 8, include: { patient: { select: { id: true, name: true } }, invoice: { select: { invoiceNumber: true } } } }),
    tdb.refund.findMany({ where: { status: { in: ["REQUESTED", "APPROVED"] } }, orderBy: { createdAt: "desc" }, take: 5, include: { invoice: { select: { invoiceNumber: true } } } }),
    tdb.invoice.count({ where: { status: { in: OPEN }, dueDate: { lt: today }, dueMinor: { gt: 0 } } }),
  ]);
  return {
    currency: settings.currency, today,
    todaysRevenue: billedToday.reduce((a: number, r: { totalMinor: number }) => a + r.totalMinor, 0), todaysCollections: sum(collToday), pendingMinor: openInv.reduce((a: number, r: { dueMinor: number }) => a + r.dueMinor, 0), partialPayments: partial as number,
    refundsToday: sum(refundsToday), invoicesToday: invToday as number, outstandingInvoices: openInv.length as number, overdueInvoices: overdueCount as number, weekCollected: sum(collWeek), monthCollected: sum(collMonth),
    recent: recentPay.map((p: Record<string, any>) => ({ id: p.id, patientId: p.patient.id, patientName: p.patient.name, invoiceId: p.invoiceId, invoiceNumber: p.invoice.invoiceNumber, amountMinor: p.amountMinor, method: p.method, status: p.status, date: p.paymentDate })) as { id: string; patientId: string; patientName: string; invoiceId: string; invoiceNumber: string; amountMinor: number; method: string; status: string; date: string }[], // eslint-disable-line @typescript-eslint/no-explicit-any
    pendingRefunds: recentRef.map((r: Record<string, any>) => ({ id: r.id, refundNumber: r.refundNumber, invoiceNumber: r.invoice.invoiceNumber, amountMinor: r.amountMinor, status: r.status })) as { id: string; refundNumber: string; invoiceNumber: string; amountMinor: number; status: string }[], // eslint-disable-line @typescript-eslint/no-explicit-any
    can: { newInvoice: ctx.permissions.has("billing.create"), reports: ctx.permissions.has("billing.reports"), configure: ctx.permissions.has("billing.configure") },
  };
}

export interface ReportFilters { from?: string; to?: string; doctorId?: string; serviceId?: string; method?: string }
const dt = /^\d{4}-\d{2}-\d{2}$/;
async function range(ctx: TenantRequestContext, f: ReportFilters) {
  const tz = await tenantTimezone(ctx.tenantId); const today = todayIn(tz);
  const to = f.to && dt.test(f.to) ? f.to : today; const from = f.from && dt.test(f.from) ? f.from : to;
  if (from > to) throw new AppError("VALIDATION_ERROR", { message: "The start date is after the end date.", fieldErrors: { from: "The start date is after the end date." } });
  if (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`) > 366 * 86400000) throw new AppError("VALIDATION_ERROR", { message: "Choose a range of one year or less.", fieldErrors: { to: "Choose a range of one year or less." } });
  return { tz, today, from, to, start: zonedToUtc(from, 0, tz), end: zonedToUtc(addDays(to, 1), 0, tz) };
}

/** Collections by payment method for ONE day (or a range): successful payments only, refunds separately. */
export async function collectionReport(ctx: TenantRequestContext, f: ReportFilters) {
  reportGuard(ctx);
  const tdb = db(ctx); const r = await range(ctx, f); const settings = await loadBillingSettings(tdb, ctx.tenantId);
  const payWhere: Record<string, unknown> = { paymentDate: { gte: r.from, lte: r.to }, status: { in: MONEY_IN }, ...(f.method ? { method: f.method } : {}), ...(f.doctorId || f.serviceId ? { invoice: { is: { ...(f.doctorId ? { doctorUserId: f.doctorId } : {}), ...(f.serviceId ? { items: { some: { serviceId: f.serviceId } } } : {}) } } } : {}) };
  const pays = await tdb.payment.findMany({ where: payWhere, select: { amountMinor: true, method: true, paymentDate: true }, take: 50000 });
  const refunds = await tdb.refund.findMany({ where: { status: "PROCESSED", processedAt: { gte: r.start, lt: r.end }, ...(f.method ? { method: f.method } : {}), ...(f.doctorId ? { invoice: { is: { doctorUserId: f.doctorId } } } : {}) }, select: { amountMinor: true, method: true, processedAt: true }, take: 50000 });
  const byMethod: Record<string, number> = {}; for (const p of pays) byMethod[p.method] = (byMethod[p.method] ?? 0) + p.amountMinor;
  const refMethod: Record<string, number> = {}; for (const x of refunds) refMethod[x.method] = (refMethod[x.method] ?? 0) + x.amountMinor;
  const byDay: Record<string, { collected: number; refunded: number }> = {};
  for (const p of pays) (byDay[p.paymentDate] ??= { collected: 0, refunded: 0 }).collected += p.amountMinor;
  for (const x of refunds) (byDay[utcToZoned(x.processedAt, r.tz).date] ??= { collected: 0, refunded: 0 }).refunded += x.amountMinor;
  const totalCollected = sum(pays); const totalRefunded = sum(refunds);
  return { currency: settings.currency, from: r.from, to: r.to, methods: ["CASH", "UPI", "CARD", "BANK_TRANSFER", "ONLINE", "CHEQUE", "OTHER"].map((m) => ({ method: m, collectedMinor: byMethod[m] ?? 0, refundedMinor: refMethod[m] ?? 0 })), totalCollected, totalRefunded, netMinor: totalCollected - totalRefunded, days: Object.entries(byDay).sort(([a], [b]) => (a < b ? -1 : 1)).map(([date, v]) => ({ date, collectedMinor: v.collected, refundedMinor: v.refunded, netMinor: v.collected - v.refunded })) };
}

export async function financialReport(ctx: TenantRequestContext, f: ReportFilters) {
  reportGuard(ctx);
  const tdb = db(ctx); const r = await range(ctx, f); const settings = await loadBillingSettings(tdb, ctx.tenantId);
  const invWhere: Record<string, unknown> = { invoiceDate: { gte: r.from, lte: r.to }, status: { in: BILLED }, ...(f.doctorId ? { doctorUserId: f.doctorId } : {}), ...(f.serviceId ? { items: { some: { serviceId: f.serviceId } } } : {}), ...(f.method ? { payments: { some: { method: f.method } } } : {}) };
  const invoices = await tdb.invoice.findMany({ where: invWhere, select: { id: true, invoiceNumber: true, invoiceDate: true, dueDate: true, status: true, totalMinor: true, collectedMinor: true, refundedMinor: true, patient: { select: { id: true, name: true, code: true } } }, orderBy: { invoiceDate: "asc" }, take: 20000 });
  const gross = invoices.reduce((a: number, i: { totalMinor: number }) => a + i.totalMinor, 0);
  const collected = invoices.reduce((a: number, i: { collectedMinor: number }) => a + i.collectedMinor, 0); const refunded = invoices.reduce((a: number, i: { refundedMinor: number }) => a + i.refundedMinor, 0);
  const outstanding = invoices.filter((i: { status: string }) => OPEN.includes(i.status)).reduce((a: number, i: { totalMinor: number; collectedMinor: number }) => a + dueOf(i), 0);
  const outstandingList = invoices.filter((i: { status: string; totalMinor: number; collectedMinor: number }) => OPEN.includes(i.status) && dueOf(i) > 0).slice(0, 200).map((i: Record<string, any>) => ({ id: i.id, invoiceNumber: i.invoiceNumber, patientName: i.patient.name, patientCode: i.patient.code, invoiceDate: i.invoiceDate, dueDate: i.dueDate, totalMinor: i.totalMinor, dueMinor: dueOf(i as never), overdue: isOverdue(i as never, r.today) })); // eslint-disable-line @typescript-eslint/no-explicit-any
  const items = await tdb.invoiceItem.findMany({ where: { invoice: { is: invWhere }, ...(f.serviceId ? { serviceId: f.serviceId } : {}) }, select: { serviceCodeSnapshot: true, descriptionSnapshot: true, quantity: true, lineTotalMinor: true, serviceTypeSnapshot: true }, take: 50000 });
  const svc = new Map<string, { code: string | null; name: string; type: string | null; qty: number; totalMinor: number }>();
  for (const it of items) { const k = `${it.serviceCodeSnapshot ?? ""}|${it.descriptionSnapshot}`; const cur = svc.get(k) ?? { code: it.serviceCodeSnapshot, name: it.descriptionSnapshot, type: it.serviceTypeSnapshot, qty: 0, totalMinor: 0 }; cur.qty += it.quantity; cur.totalMinor += it.lineTotalMinor; svc.set(k, cur); }
  const refunds = await tdb.refund.findMany({ where: { createdAt: { gte: r.start, lt: r.end }, ...(f.method ? { method: f.method } : {}), ...(f.doctorId ? { invoice: { is: { doctorUserId: f.doctorId } } } : {}) }, select: { refundNumber: true, amountMinor: true, status: true, reason: true, method: true, createdAt: true, invoice: { select: { invoiceNumber: true } } }, orderBy: { createdAt: "asc" }, take: 2000 });
  const coll = await collectionReport(ctx, f);
  return {
    currency: settings.currency, from: r.from, to: r.to, summary: { grossBilledMinor: gross, collectedMinor: coll.totalCollected, outstandingMinor: outstanding, refundedMinor: coll.totalRefunded, netCollectionMinor: coll.netMinor, invoiceCount: invoices.length, invoiceCollectedMinor: collected, invoiceRefundedMinor: refunded },
    methods: coll.methods, days: coll.days, outstanding: outstandingList as { id: string; invoiceNumber: string; patientName: string; patientCode: string; invoiceDate: string; dueDate: string | null; totalMinor: number; dueMinor: number; overdue: boolean }[],
    services: [...svc.values()].sort((a, b) => b.totalMinor - a.totalMinor).slice(0, 200),
    refunds: refunds.map((x: Record<string, any>) => ({ refundNumber: x.refundNumber, invoiceNumber: x.invoice.invoiceNumber, amountMinor: x.amountMinor, status: x.status, reason: x.reason, method: x.method, date: x.createdAt.toISOString().slice(0, 10) })) as { refundNumber: string; invoiceNumber: string; amountMinor: number; status: string; reason: string; method: string; date: string }[], // eslint-disable-line @typescript-eslint/no-explicit-any
  };
}

const csvCell = (v: unknown) => { let s = String(v ?? ""); if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const toCsv = (head: string[], rows: unknown[][]) => [head, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
/** CSV for finance users only: financial columns, no clinical fields. */
export async function exportReport(ctx: TenantRequestContext, kind: string, f: ReportFilters) {
  reportGuard(ctx); if (!ctx.permissions.has("billing.export")) throw new AppError("FORBIDDEN", { message: "You can't export financial data." });
  const rep = await financialReport(ctx, f); let csv: string;
  const m = (x: number) => minorToInput(x);
  switch (kind) {
    case "collection": csv = toCsv(["Date", "Collected", "Refunded", "Net"], rep.days.map((d) => [d.date, m(d.collectedMinor), m(d.refundedMinor), m(d.netMinor)])); break;
    case "methods": csv = toCsv(["Method", "Collected", "Refunded"], rep.methods.map((d) => [d.method, m(d.collectedMinor), m(d.refundedMinor)])); break;
    case "outstanding": csv = toCsv(["Invoice", "Patient ID", "Invoice date", "Due date", "Total", "Due", "Overdue"], rep.outstanding.map((o) => [o.invoiceNumber, o.patientCode, o.invoiceDate, o.dueDate ?? "", m(o.totalMinor), m(o.dueMinor), o.overdue ? "yes" : "no"])); break;
    case "refunds": csv = toCsv(["Refund", "Invoice", "Date", "Method", "Status", "Amount"], rep.refunds.map((x) => [x.refundNumber, x.invoiceNumber, x.date, x.method, x.status, m(x.amountMinor)])); break;
    case "services": csv = toCsv(["Code", "Service", "Type", "Quantity", "Total"], rep.services.map((s) => [s.code ?? "", s.name, s.type ?? "", s.qty, m(s.totalMinor)])); break;
    default: throw new AppError("VALIDATION_ERROR", { message: "Unknown report." });
  }
  await recordAudit({ action: AUDIT_ACTIONS.BILLING_EXPORTED, tenantId: ctx.tenantId, actorId: ctx.user.id, entityType: "billing_report", entityId: kind, metadata: { kind, from: rep.from, to: rep.to } });
  return { csv, filename: `${kind}-${rep.from}_${rep.to}.csv`, currency: rep.currency };
}
