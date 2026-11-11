import "server-only";
import type { TenantRequestContext } from "@/lib/auth/context";
import { COLLECTIBLE, SERVICE_TYPES, dueOf } from "@/lib/billing/money";
import { compareValues, rate, type Comparison } from "@/lib/analytics/range";
import { dailySeries, divRound, tally, titleCase } from "@/lib/analytics/stats";
import { daysBetween } from "@/lib/pharmacy/stock";
import { addDays } from "@/lib/scheduling/time";
import { BILLED, MONEY_IN, ROW_CAP, currencyOf, doctorNames, doctorWhere, drill, insufficientHistory, runDomain, type Env } from "./analytics-core";
import { loadPharmacySettings, lowThreshold, sellableStock, stockStatus } from "./pharmacy-core";

/**
 * Billing, pharmacy and communication analytics.
 * MONEY: integer minor units only, no float maths. "Billed" comes from invoice SNAPSHOTS (so later price changes never rewrite history),
 * "collected" from successful payments, "refunded" from processed refunds. Invoice, payment and refund are NEVER added together,
 * so nothing is double counted. This is operational reporting, not accounting, profit or tax filing.
 */
const cmp = (cur: number, prev: number | null, hist: boolean): Comparison | null => (prev === null ? null : compareValues(cur, prev, { insufficientHistory: hist }));
const OPEN: string[] = [...COLLECTIBLE];
const sumOf = <T,>(rows: T[], f: (r: T) => number) => rows.reduce((a, r) => a + f(r), 0);

async function billingTotals(env: Env, from: string, to: string, start: Date, end: Date) {
  const d = doctorWhere(env);
  const pd = env.doctorId ? { invoice: { is: { doctorUserId: env.doctorId } } } : {};
  const [inv, pays, refs] = await Promise.all([
    env.tdb.invoice.findMany({ where: { invoiceDate: { gte: from, lte: to }, status: { in: [...BILLED, "CANCELLED"] }, ...d }, select: { id: true, status: true, subtotalMinor: true, discountMinor: true, taxMinor: true, totalMinor: true, collectedMinor: true, dueDate: true, discountReason: true, discountById: true, doctorUserId: true, invoiceDate: true }, take: ROW_CAP }),
    env.tdb.payment.findMany({ where: { paymentDate: { gte: from, lte: to }, status: { in: MONEY_IN }, ...pd }, select: { amountMinor: true, method: true, paymentDate: true }, take: ROW_CAP }),
    env.tdb.refund.findMany({ where: { processedAt: { gte: start, lt: end }, status: "PROCESSED", ...(env.doctorId ? { invoice: { is: { doctorUserId: env.doctorId } } } : {}) }, select: { amountMinor: true, method: true, reason: true }, take: ROW_CAP }),
  ]);
  const billed = inv.filter((i: { status: string }) => BILLED.includes(i.status)); const cancelled = inv.filter((i: { status: string }) => i.status === "CANCELLED");
  const net = sumOf(billed, (i: { totalMinor: number }) => i.totalMinor);
  return {
    inv, billed, cancelled, pays, refs,
    gross: sumOf(billed, (i: { subtotalMinor: number }) => i.subtotalMinor), discounts: sumOf(billed, (i: { discountMinor: number }) => i.discountMinor), taxes: sumOf(billed, (i: { taxMinor: number }) => i.taxMinor), net,
    collected: sumOf(pays, (p: { amountMinor: number }) => p.amountMinor), refunded: sumOf(refs, (p: { amountMinor: number }) => p.amountMinor),
  };
}

export function billingAnalytics(ctx: TenantRequestContext, raw: unknown, silent = false) {
  return runDomain(ctx, raw, "billing", ["analytics.financial"], async (env) => {
    const r = env.range; const tdb = env.tdb; const currency = await currencyOf(env); const d = doctorWhere(env);
    const t = await billingTotals(env, r.from, r.to, r.start, r.end);
    const open = t.billed.filter((i: { status: string }) => OPEN.includes(i.status));
    const outstanding = sumOf(open, (i: { totalMinor: number; collectedMinor: number }) => dueOf(i));
    const allOpen: { totalMinor: number; collectedMinor: number; dueDate: string | null; invoiceDate: string }[] = await tdb.invoice.findMany({ where: { status: { in: OPEN }, ...d }, select: { totalMinor: true, collectedMinor: true, dueDate: true, invoiceDate: true }, take: ROW_CAP });
    const openRows = allOpen.filter((i) => dueOf(i) > 0);
    const aging = [["Not yet due", -99999, 0], ["1–30 days", 1, 30], ["31–60 days", 31, 60], ["61–90 days", 61, 90], ["Over 90 days", 91, 99999]].map(([label, lo, hi]) => {
      const rows = openRows.filter((i) => { const late = daysBetween(i.dueDate ?? i.invoiceDate, env.today); return late >= (lo as number) && late <= (hi as number) && (lo === -99999 ? late <= 0 : true); });
      return { label: label as string, count: rows.length, amountMinor: sumOf(rows, (i) => dueOf(i)) };
    });
    const itemWhere = { invoice: { is: { invoiceDate: { gte: r.from, lte: r.to }, status: { in: BILLED }, ...d } } };
    const [byType, topSvc] = await Promise.all([
      tdb.invoiceItem.groupBy({ by: ["serviceTypeSnapshot"], where: itemWhere, _sum: { lineTotalMinor: true, quantity: true }, _count: { _all: true } }),
      tdb.invoiceItem.groupBy({ by: ["descriptionSnapshot"], where: itemWhere, _sum: { lineTotalMinor: true, quantity: true }, orderBy: { _sum: { lineTotalMinor: "desc" } }, take: 10 }),
    ]);
    const serviceRevenue = (byType as { serviceTypeSnapshot: string | null; _sum: { lineTotalMinor: number | null; quantity: number | null } }[]).map((x) => ({ key: x.serviceTypeSnapshot ?? "OTHER", label: titleCase(x.serviceTypeSnapshot ?? "OTHER"), amountMinor: x._sum.lineTotalMinor ?? 0, quantity: x._sum.quantity ?? 0 })).sort((a, b) => b.amountMinor - a.amountMinor);
    const seeDiscounts = ctx.permissions.has("billing.discount") || ctx.permissions.has("billing.reports");
    const disc = t.billed.filter((i: { discountMinor: number }) => i.discountMinor > 0);
    let discounts: unknown = { available: false, note: "Discount analytics are limited to finance staff and clinic admins." };
    if (seeDiscounts) {
      const names = await doctorNames(env, disc.map((i: { discountById: string | null }) => i.discountById));
      const byUser = new Map<string, { count: number; amountMinor: number }>(); for (const i of disc as { discountById: string | null; discountMinor: number }[]) { const k = i.discountById ?? "-"; const c = byUser.get(k) ?? { count: 0, amountMinor: 0 }; c.count++; c.amountMinor += i.discountMinor; byUser.set(k, c); }
      discounts = { available: true, invoices: disc.length, totalMinor: t.discounts, averageMinor: divRound(t.discounts, disc.length), pctOfGross: rate(t.discounts, t.gross), reasons: tally(disc, (i: { discountReason: string | null }) => i.discountReason?.trim().toLowerCase().slice(0, 60), { missing: "No reason recorded", top: 8 }), byUser: [...byUser.entries()].map(([id, v]) => ({ userId: id, name: names.get(id) ?? "Unknown", ...v })).sort((a, b) => b.amountMinor - a.amountMinor).slice(0, 10) };
    }
    const refundReq: { status: string; reason: string | null; amountMinor: number }[] = await tdb.refund.findMany({ where: { createdAt: { gte: r.start, lt: r.end }, ...(env.doctorId ? { invoice: { is: { doctorUserId: env.doctorId } } } : {}) }, select: { status: true, reason: true, amountMinor: true }, take: ROW_CAP });
    const billedDay = new Map<string, number>(); for (const i of t.billed as { invoiceDate: string; totalMinor: number }[]) billedDay.set(i.invoiceDate, (billedDay.get(i.invoiceDate) ?? 0) + i.totalMinor);
    const collDay = new Map<string, number>(); for (const p of t.pays as { paymentDate: string; amountMinor: number }[]) collDay.set(p.paymentDate, (collDay.get(p.paymentDate) ?? 0) + p.amountMinor);
    const byMethod = new Map<string, number>(); for (const p of t.pays as { method: string; amountMinor: number }[]) byMethod.set(p.method, (byMethod.get(p.method) ?? 0) + p.amountMinor);
    let doctors: unknown[] = [];
    if (!env.doctorId) {
      const g = await tdb.invoice.groupBy({ by: ["doctorUserId"], where: { invoiceDate: { gte: r.from, lte: r.to }, status: { in: BILLED } }, _sum: { totalMinor: true }, _count: { _all: true } });
      const names = await doctorNames(env, g.map((x: { doctorUserId: string | null }) => x.doctorUserId));
      doctors = g.map((x: { doctorUserId: string | null; _sum: { totalMinor: number | null }; _count: { _all: number } }) => ({ doctorId: x.doctorUserId, name: x.doctorUserId ? (names.get(x.doctorUserId) ?? "Doctor") : "Not assigned to a doctor", billedMinor: x._sum.totalMinor ?? 0, invoices: x._count._all })).sort((a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name));
    }
    let prev: { net: number; collected: number } | null = null;
    if (r.previous) { const p = await billingTotals(env, r.previous.from, r.previous.to, r.previous.start, r.previous.end); prev = { net: p.net, collected: p.collected }; }
    const hist = await insufficientHistory(env);
    const itemsTotal = sumOf(serviceRevenue, (x) => x.amountMinor);
    return {
      currency,
      definitions: {
        grossBilled: "Sum of invoice subtotals (before discount and tax) for issued, paid and refunded invoices dated in the period.", discounts: "Sum of invoice discounts.", taxes: "Sum of invoice taxes.", netBilled: "Sum of invoice totals — what patients were billed.",
        collected: "Successful payments received in the period (by payment date).", refunded: "Refunds processed in the period.", outstanding: "Unpaid balance on invoices billed in the period that can still be collected.",
        note: "Operational figures from clinic records. Not profit, revenue recognition or accounting.",
      },
      totals: { grossBilledMinor: t.gross, discountsMinor: t.discounts, taxesMinor: t.taxes, netBilledMinor: t.net, collectedMinor: t.collected, refundedMinor: t.refunded, netCollectedMinor: t.collected - t.refunded, outstandingMinor: outstanding, invoices: t.billed.length, cancelledInvoices: t.cancelled.length, cancelledValueMinor: sumOf(t.cancelled, (i: { totalMinor: number }) => i.totalMinor), partiallyPaid: t.billed.filter((i: { status: string }) => i.status === "PARTIALLY_PAID").length, paid: t.billed.filter((i: { status: string }) => i.status === "PAID").length, averageInvoiceMinor: divRound(t.net, t.billed.length) },
      comparison: prev && { netBilled: cmp(t.net, prev.net, hist), collected: cmp(t.collected, prev.collected, hist) },
      outstandingNow: { totalMinor: sumOf(openRows, (i) => dueOf(i)), invoices: openRows.length, overdueInvoices: openRows.filter((i) => !!i.dueDate && i.dueDate < env.today).length, aging, definition: "All open balances right now (not limited to the period); overdue = past the invoice due date." },
      paymentMethods: [...byMethod.entries()].map(([key, amountMinor]) => ({ key, label: titleCase(key), amountMinor })).sort((a, b) => b.amountMinor - a.amountMinor),
      serviceRevenue, serviceRevenueReconciles: itemsTotal === t.net, topServices: (topSvc as { descriptionSnapshot: string; _sum: { lineTotalMinor: number | null; quantity: number | null } }[]).map((x) => ({ key: x.descriptionSnapshot, label: x.descriptionSnapshot, amountMinor: x._sum.lineTotalMinor ?? 0, quantity: x._sum.quantity ?? 0 })),
      discounts,
      refunds: { requested: refundReq.length, statuses: tally(refundReq, (x) => x.status, { labels: Object.fromEntries(refundReq.map((x) => [x.status, titleCase(x.status)])) }), processedMinor: t.refunded, processedCount: t.refs.length, ratePct: rate(t.refunded, t.collected), rateDefinition: "Refunds processed ÷ payments collected in the period.", reasons: tally(t.refs, (x: { reason: string | null }) => x.reason?.trim().toLowerCase().slice(0, 60), { missing: "No reason recorded", top: 8 }) },
      doctors, serviceTypes: SERVICE_TYPES,
      billedTrend: dailySeries(r.from, r.to, billedDay), collectedTrend: dailySeries(r.from, r.to, collDay),
      drill: { invoices: drill(env, "billing"), payments: drill(env, "payments"), refunds: drill(env, "refunds"), services: drill(env, "services") },
    };
  }, { audit: !silent });
}

/* ------------------------------------------------------------------ pharmacy ------------------------------------------------------------------ */
export function pharmacyAnalytics(ctx: TenantRequestContext, raw: unknown) {
  return runDomain(ctx, raw, "pharmacy", ["analytics.pharmacy"], async (env) => {
    const r = env.range; const tdb = env.tdb; const currency = await currencyOf(env);
    const settings = await loadPharmacySettings(tdb, ctx.tenantId); const near = addDays(env.today, settings.nearExpiryDays);
    const meds: { id: string; reorderLevel: number; minimumStock: number; genericName: string; brandName: string | null; strength: string | null }[] = await tdb.medicine.findMany({ where: { active: true }, select: { id: true, reorderLevel: true, minimumStock: true, genericName: true, brandName: true, strength: true }, take: ROW_CAP });
    const stock = await sellableStock(tdb, env.today);
    const status = meds.map((m) => ({ m, s: stockStatus(stock.get(m.id) ?? 0, m), avail: stock.get(m.id) ?? 0 }));
    const batches: { quantityAvailable: number; purchasePriceMinor: number; expiryDate: string; status: string }[] = await tdb.medicineBatch.findMany({ where: { quantityAvailable: { gt: 0 } }, select: { quantityAvailable: true, purchasePriceMinor: true, expiryDate: true, status: true }, take: ROW_CAP });
    const priced = batches.filter((b) => b.purchasePriceMinor > 0);
    const startStr = r.from; const endStr = r.to;
    const [disp, purchases, tx, dispItems] = await Promise.all([
      tdb.dispensing.groupBy({ by: ["status"], where: { dispensedAt: { gte: r.start, lt: r.end } }, _sum: { totalMinor: true }, _count: { _all: true } }),
      tdb.purchase.aggregate({ where: { purchaseDate: { gte: startStr, lte: endStr }, status: { in: ["RECEIVED", "COMPLETED"] } }, _sum: { totalMinor: true }, _count: { _all: true } }),
      tdb.stockTransaction.groupBy({ by: ["type"], where: { createdAt: { gte: r.start, lt: r.end }, type: { in: ["ADJUSTMENT_IN", "ADJUSTMENT_OUT", "DAMAGE", "EXPIRY", "PURCHASE_RETURN", "SALE_RETURN"] } }, _sum: { quantity: true }, _count: { _all: true } }),
      tdb.dispensingItem.groupBy({ by: ["medicineId"], where: { dispensing: { is: { dispensedAt: { gte: r.start, lt: r.end }, status: { not: "CANCELLED" } } } }, _sum: { dispensedQuantity: true, returnedQuantity: true }, orderBy: { _sum: { dispensedQuantity: "desc" } }, take: 10 }),
    ]);
    const dn = (s: string) => disp.find((x: { status: string }) => x.status === s);
    const live = (disp as { status: string; _sum: { totalMinor: number | null }; _count: { _all: number } }[]).filter((x) => x.status !== "CANCELLED");
    const medIds = dispItems.map((x: { medicineId: string }) => x.medicineId);
    const medRows: { id: string; genericName: string; brandName: string | null; strength: string | null }[] = medIds.length ? await tdb.medicine.findMany({ where: { id: { in: medIds } }, select: { id: true, genericName: true, brandName: true, strength: true } }) : [];
    const label = (m?: { genericName: string; brandName: string | null; strength: string | null }) => m ? [m.brandName || m.genericName, m.strength].filter(Boolean).join(" ") : "Medicine";
    const t = (k: string) => tx.find((x: { type: string }) => x.type === k);
    const expired = batches.filter((b) => b.expiryDate < env.today).length; const nearBatches = batches.filter((b) => b.expiryDate >= env.today && b.expiryDate <= near && b.status === "ACTIVE").length;
    return {
      currency,
      stock: { activeMedicines: meds.length, inStock: status.filter((x) => x.s === "IN_STOCK").length, lowStock: status.filter((x) => x.s === "LOW_STOCK").length, outOfStock: status.filter((x) => x.s === "OUT_OF_STOCK").length, expiredBatchesWithStock: expired, nearExpiryBatches: nearBatches, nearExpiryDays: settings.nearExpiryDays, definition: "Snapshot as of now (not limited to the period). Low stock = at or below the larger of the reorder level and minimum stock.",
        valuation: priced.length ? { configured: true, valueMinor: sumOf(batches, (b) => b.quantityAvailable * b.purchasePriceMinor), method: "Quantity on hand × batch purchase price (cost). Stock value, not profit." } : { configured: false, valueMinor: null, method: "Stock valuation not configured" } },
      dispensing: { count: sumOf(live, (x) => x._count._all), valueMinor: sumOf(live, (x) => x._sum.totalMinor ?? 0), cancelled: dn("CANCELLED")?._count._all ?? 0 },
      purchases: { count: purchases._count._all as number, valueMinor: (purchases._sum.totalMinor ?? 0) as number, definition: "Purchases received or completed with a purchase date in the period." },
      movements: { adjustmentsIn: { entries: t("ADJUSTMENT_IN")?._count._all ?? 0, units: t("ADJUSTMENT_IN")?._sum.quantity ?? 0 }, adjustmentsOut: { entries: t("ADJUSTMENT_OUT")?._count._all ?? 0, units: Math.abs(t("ADJUSTMENT_OUT")?._sum.quantity ?? 0) }, damaged: { entries: t("DAMAGE")?._count._all ?? 0, units: Math.abs(t("DAMAGE")?._sum.quantity ?? 0) }, expiredWrittenOff: { entries: t("EXPIRY")?._count._all ?? 0, units: Math.abs(t("EXPIRY")?._sum.quantity ?? 0) }, returnsToSupplier: { entries: t("PURCHASE_RETURN")?._count._all ?? 0, units: Math.abs(t("PURCHASE_RETURN")?._sum.quantity ?? 0) } },
      topDispensed: dispItems.map((x: { medicineId: string; _sum: { dispensedQuantity: number | null; returnedQuantity: number | null } }) => ({ key: x.medicineId, label: label(medRows.find((m) => m.id === x.medicineId)), count: (x._sum.dispensedQuantity ?? 0) - (x._sum.returnedQuantity ?? 0) })),
      lowStockList: status.filter((x) => x.s !== "IN_STOCK").sort((a, b) => a.avail - b.avail).slice(0, 15).map((x) => ({ id: x.m.id, name: label(x.m), available: x.avail, reorderLevel: lowThreshold(x.m), status: x.s })),
      drill: { stock: drill(env, "pharmacy-stock"), expiry: drill(env, "pharmacy-expiry"), dispensing: drill(env, "pharmacy-dispensing") },
    };
  }, { audit: false });
}

/* --------------------------------------------------------------- communication --------------------------------------------------------------- */
const SUPPORT: Record<string, { delivered: boolean; read: boolean }> = { WHATSAPP: { delivered: true, read: true }, SMS: { delivered: true, read: false }, EMAIL: { delivered: true, read: false }, IN_APP: { delivered: false, read: true } };
export function communicationAnalytics(ctx: TenantRequestContext, raw: unknown) {
  return runDomain(ctx, raw, "communication", ["analytics.communication"], async (env) => {
    const r = env.range; const tdb = env.tdb;
    const msgs: { channel: string; status: string; eventType: string; sentAt: Date | null; deliveredAt: Date | null; readAt: Date | null; failedAt: Date | null; failureCode: string | null }[] =
      await tdb.communicationMessage.findMany({ where: { createdAt: { gte: r.start, lt: r.end }, ...(env.q.channel ? { channel: env.q.channel } : {}) }, select: { channel: true, status: true, eventType: true, sentAt: true, deliveredAt: true, readAt: true, failedAt: true, failureCode: true }, take: ROW_CAP });
    const inApp = env.q.channel && env.q.channel !== "IN_APP" ? [] : await tdb.notification.findMany({ where: { createdAt: { gte: r.start, lt: r.end } }, select: { readAt: true }, take: ROW_CAP });
    const stat = (m: (typeof msgs)[number]) => ({ sent: !!m.sentAt || ["SENT", "DELIVERED", "READ"].includes(m.status), delivered: !!m.deliveredAt || ["DELIVERED", "READ"].includes(m.status), read: !!m.readAt || m.status === "READ", failed: m.status === "FAILED" || !!m.failedAt });
    const channels = ["WHATSAPP", "SMS", "EMAIL", "IN_APP"].filter((c) => !env.q.channel || env.q.channel === c).map((c) => {
      const sup = SUPPORT[c];
      if (c === "IN_APP") return { channel: c, label: "In-app", total: inApp.length, sent: inApp.length, delivered: null, read: (inApp as { readAt: Date | null }[]).filter((x) => !!x.readAt).length, failed: null, deliveryRatePct: null, readRatePct: rate((inApp as { readAt: Date | null }[]).filter((x) => !!x.readAt).length, inApp.length), notes: "Delivery and failure do not apply to in-app notifications." };
      const rows = msgs.filter((m) => m.channel === c).map(stat); const sent = rows.filter((x) => x.sent).length; const delivered = rows.filter((x) => x.delivered).length; const read = rows.filter((x) => x.read).length;
      return { channel: c, label: titleCase(c), total: rows.length, sent, delivered: sup.delivered ? delivered : null, read: sup.read ? read : null, failed: rows.filter((x) => x.failed).length, deliveryRatePct: sup.delivered ? rate(delivered, sent) : null, readRatePct: sup.read ? rate(read, sent) : null, notes: sup.read ? null : "Read receipts are not available for this channel." };
    });
    const all = msgs.map(stat); const failed = all.filter((x) => x.failed).length;
    let prev: number | null = null; if (r.previous) prev = await tdb.communicationMessage.count({ where: { createdAt: { gte: r.previous.start, lt: r.previous.end }, ...(env.q.channel ? { channel: env.q.channel } : {}) } });
    const hist = await insufficientHistory(env);
    return {
      privacy: "Counts and delivery states only. Message contents and recipient details are never part of analytics.",
      totals: { messages: msgs.length, sent: all.filter((x) => x.sent).length, delivered: all.filter((x) => x.delivered).length, failed, pending: msgs.filter((m) => ["QUEUED", "PROCESSING", "RETRYING"].includes(m.status)).length, failureRatePct: rate(failed, msgs.length), comparison: cmp(msgs.length, prev, hist) },
      channels, eventTypes: tally(msgs, (m) => m.eventType, { top: 12, labels: Object.fromEntries(msgs.map((m) => [m.eventType, titleCase(m.eventType.replace(/\./g, " "))])) }),
      failureCodes: tally(msgs.filter((m) => m.status === "FAILED"), (m) => m.failureCode, { missing: "No code recorded", top: 8 }),
      drill: { messages: drill(env, "communications") },
    };
  }, { audit: false });
}
