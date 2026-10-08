import "server-only";
import type { TenantRequestContext } from "@/lib/auth/context";
import { minorToInput } from "@/lib/billing/money";
import { AppError } from "@/lib/errors";
import { expiryState, daysRemaining } from "@/lib/pharmacy/stock";
import { addDays, DATE_RE, dayRangeUtc, zonedToUtc } from "@/lib/scheduling/time";
import { tenantTimezone } from "./clinic-shared";
import { AUDIT_ACTIONS, audit, db, guard, loadPharmacySettings, lowThreshold, sellableStock, stockStatus, todayFor, userNames } from "./pharmacy-core";

const medName = (m: { genericName: string; brandName: string | null; strength: string | null }) => [m.brandName ?? m.genericName, m.strength].filter(Boolean).join(" ");

/* ----------------------------------------------------- dashboard ----------------------------------------------------- */
/** Real, database-driven numbers only. Counts of batches (expired / near expiry) only include batches that still hold stock. */
export async function pharmacyDashboard(ctx: TenantRequestContext) {
  guard(ctx, "pharmacy.view"); const tdb = db(ctx); const tz = await tenantTimezone(ctx.tenantId); const today = await todayFor(ctx.tenantId);
  const settings = await loadPharmacySettings(tdb, ctx.tenantId);
  const near = addDays(today, settings.nearExpiryDays); const { start, end } = dayRangeUtc(today, tz); const monthStart = zonedToUtc(`${today.slice(0, 8)}01`, 0, tz);
  const meds = (await tdb.medicine.findMany({ where: { active: true }, select: { id: true, reorderLevel: true, minimumStock: true, genericName: true, brandName: true, strength: true, medicineCode: true, maximumStock: true } })) as { id: string; reorderLevel: number; minimumStock: number; genericName: string; brandName: string | null; strength: string | null; medicineCode: string; maximumStock: number | null }[];
  const stock = await sellableStock(tdb, today);
  const status = meds.map((m) => ({ m, avail: stock.get(m.id) ?? 0, s: stockStatus(stock.get(m.id) ?? 0, m) }));
  const low = status.filter((x) => x.s === "LOW_STOCK"); const out = status.filter((x) => x.s === "OUT_OF_STOCK");
  const [expiredBatches, nearBatches, todayD, monthD, recent, valueRows] = await Promise.all([
    tdb.medicineBatch.count({ where: { expiryDate: { lt: today }, quantityAvailable: { gt: 0 } } }),
    tdb.medicineBatch.count({ where: { expiryDate: { gte: today, lte: near }, quantityAvailable: { gt: 0 }, status: "ACTIVE" } }),
    tdb.dispensing.aggregate({ where: { status: { not: "CANCELLED" }, dispensedAt: { gte: start, lt: end } }, _sum: { totalMinor: true }, _count: { _all: true } }),
    tdb.dispensing.aggregate({ where: { status: { not: "CANCELLED" }, dispensedAt: { gte: monthStart, lt: end } }, _sum: { totalMinor: true }, _count: { _all: true } }),
    tdb.stockTransaction.findMany({ orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 10, include: { medicine: { select: { genericName: true, brandName: true, strength: true } }, batch: { select: { batchNumber: true } } } }),
    tdb.medicineBatch.findMany({ where: { quantityAvailable: { gt: 0 } }, select: { quantityAvailable: true, purchasePriceMinor: true } }),
  ]);
  const names = await userNames(tdb, recent.map((r: { createdById: string }) => r.createdById));
  const expiring = (await tdb.medicineBatch.findMany({ where: { expiryDate: { lte: near }, quantityAvailable: { gt: 0 } }, orderBy: { expiryDate: "asc" }, take: 8, include: { medicine: { select: { genericName: true, brandName: true, strength: true } } } })) as Record<string, any>[];
  return {
    counts: { totalMedicines: meds.length, lowStock: low.length, outOfStock: out.length, nearExpiry: nearBatches as number, expired: expiredBatches as number, todayDispensing: todayD._count._all as number, todaySalesMinor: (todayD._sum.totalMinor ?? 0) as number, monthDispensing: monthD._count._all as number, monthSalesMinor: (monthD._sum.totalMinor ?? 0) as number },
    stockValueMinor: (valueRows as { quantityAvailable: number; purchasePriceMinor: number }[]).reduce((a, b) => a + b.quantityAvailable * b.purchasePriceMinor, 0), valuationMethod: "Quantity on hand × batch purchase price (cost). This is stock value, not profit.",
    lowStock: low.sort((a, b) => a.avail - b.avail).slice(0, 8).map((x) => ({ id: x.m.id, name: medName(x.m), code: x.m.medicineCode, available: x.avail, reorderLevel: lowThreshold(x.m), maximumStock: x.m.maximumStock })),
    expiring: expiring.map((b) => ({ id: b.id as string, medicineId: b.medicineId as string, name: medName(b.medicine), batchNumber: b.batchNumber as string, expiryDate: b.expiryDate as string, quantity: b.quantityAvailable as number, daysRemaining: daysRemaining(b.expiryDate, today), state: expiryState(b.expiryDate, today, settings.nearExpiryDays) })),
    recent: recent.map((r: Record<string, any>) => ({ id: r.id as string, createdAt: r.createdAt.toISOString() as string, type: r.type as string, quantity: r.quantity as number, medicineName: medName(r.medicine), batchNumber: r.batch.batchNumber as string, user: names.get(r.createdById) ?? null })) as { id: string; createdAt: string; type: string; quantity: number; medicineName: string; batchNumber: string; user: string | null }[],
    nearExpiryDays: settings.nearExpiryDays, today,
  };
}

/* ------------------------------------------------------- reports ------------------------------------------------------- */
export const REPORT_KINDS = ["stock_summary", "stock_ledger", "purchases", "dispensing", "expiry", "low_stock", "medicine_sales", "supplier_purchases", "adjustments", "returns"] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];
export interface ReportFilters { from?: string; to?: string; medicineId?: string; category?: string; batchId?: string; supplierId?: string; userId?: string; state?: string }
export interface ReportColumn { key: string; label: string; type: "text" | "int" | "money" | "date" }
export interface ReportResult { kind: ReportKind; title: string; columns: ReportColumn[]; rows: Record<string, string | number | null>[]; summary: { label: string; value: string | number; type?: "money" | "int" | "text" }[]; note: string | null; from: string; to: string; capped: boolean }
const CAP = 5000;
const T: ReportColumn["type"] = "text"; const I: ReportColumn["type"] = "int"; const M: ReportColumn["type"] = "money"; const D: ReportColumn["type"] = "date";

async function span(ctx: TenantRequestContext, f: ReportFilters) {
  const tz = await tenantTimezone(ctx.tenantId); const today = await todayFor(ctx.tenantId);
  const to = f.to && DATE_RE.test(f.to) ? f.to : today; const from = f.from && DATE_RE.test(f.from) ? f.from : addDays(to, -29);
  if (from > to) throw new AppError("VALIDATION_ERROR", { message: "The start date is after the end date.", fieldErrors: { from: "The start date is after the end date." } });
  if (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`) > 366 * 86_400_000) throw new AppError("VALIDATION_ERROR", { message: "Choose a range of one year or less.", fieldErrors: { to: "Choose a range of one year or less." } });
  return { today, from, to, start: zonedToUtc(from, 0, tz), end: zonedToUtc(addDays(to, 1), 0, tz), tz };
}
const dayOf = (d: Date, tz: string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

export async function pharmacyReport(ctx: TenantRequestContext, kind: string, f: ReportFilters = {}): Promise<ReportResult> {
  guard(ctx, "pharmacy.reports");
  if (!(REPORT_KINDS as readonly string[]).includes(kind)) throw new AppError("NOT_FOUND", { message: "Unknown report." });
  const k = kind as ReportKind; const tdb = db(ctx); const r = await span(ctx, f); const settings = await loadPharmacySettings(tdb, ctx.tenantId);
  const base = { kind: k, from: r.from, to: r.to, capped: false, note: null as string | null, summary: [] as ReportResult["summary"] };
  const medFilter = f.medicineId ? { medicineId: f.medicineId } : {};
  switch (k) {
    case "stock_summary": {
      const meds = (await tdb.medicine.findMany({ where: { active: true, ...(f.medicineId ? { id: f.medicineId } : {}), ...(f.category ? { category: f.category } : {}) }, orderBy: { genericName: "asc" }, take: CAP })) as Record<string, any>[];
      const batches = (await tdb.medicineBatch.findMany({ where: { quantityAvailable: { gt: 0 }, medicineId: { in: meds.map((m) => m.id as string) } }, select: { medicineId: true, quantityAvailable: true, purchasePriceMinor: true, expiryDate: true, status: true } })) as { medicineId: string; quantityAvailable: number; purchasePriceMinor: number; expiryDate: string; status: string }[];
      const rows = meds.map((m) => { const bs = batches.filter((b) => b.medicineId === m.id); const onHand = bs.reduce((a, b) => a + b.quantityAvailable, 0); const sell = bs.filter((b) => b.status === "ACTIVE" && b.expiryDate >= r.today).reduce((a, b) => a + b.quantityAvailable, 0); return { code: m.medicineCode, medicine: medName(m as never), category: m.category, onHand, available: sell, status: stockStatus(sell, m as never).replace("_", " ").toLowerCase(), valueMinor: bs.reduce((a, b) => a + b.quantityAvailable * b.purchasePriceMinor, 0) }; });
      return { ...base, title: "Stock summary", columns: [{ key: "code", label: "Code", type: T }, { key: "medicine", label: "Medicine", type: T }, { key: "category", label: "Category", type: T }, { key: "onHand", label: "On hand", type: I }, { key: "available", label: "Available to dispense", type: I }, { key: "status", label: "Status", type: T }, { key: "valueMinor", label: "Stock value (cost)", type: M }], rows, summary: [{ label: "Stock value (cost)", value: rows.reduce((a, x) => a + x.valueMinor, 0), type: "money" }, { label: "Medicines", value: rows.length, type: "int" }], note: "Stock value = quantity on hand × batch purchase price. It is not profit. Available excludes expired, blocked and empty batches.", capped: meds.length === CAP };
    }
    case "stock_ledger": case "adjustments": {
      const types = k === "adjustments" ? ["ADJUSTMENT_IN", "ADJUSTMENT_OUT", "DAMAGE", "EXPIRY"] : null;
      const rows = (await tdb.stockTransaction.findMany({ where: { createdAt: { gte: r.start, lt: r.end }, ...medFilter, ...(f.batchId ? { batchId: f.batchId } : {}), ...(f.userId ? { createdById: f.userId } : {}), ...(types ? { type: { in: types } } : {}) }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: CAP, include: { medicine: { select: { genericName: true, brandName: true, strength: true } }, batch: { select: { batchNumber: true } } } })) as Record<string, any>[];
      const names = await userNames(tdb, rows.map((x) => x.createdById));
      return { ...base, title: k === "adjustments" ? "Stock adjustments" : "Stock ledger", columns: [{ key: "date", label: "Date", type: D }, { key: "medicine", label: "Medicine", type: T }, { key: "batch", label: "Batch", type: T }, { key: "type", label: "Transaction", type: T }, { key: "quantity", label: "Quantity", type: I }, { key: "balance", label: "Balance", type: I }, { key: "reason", label: "Reason", type: T }, { key: "user", label: "User", type: T }], rows: rows.map((x) => ({ date: dayOf(x.createdAt, r.tz), medicine: medName(x.medicine), batch: x.batch.batchNumber, type: x.type, quantity: x.quantity, balance: x.balanceAfter, reason: x.reason, user: names.get(x.createdById) ?? null })), capped: rows.length === CAP };
    }
    case "purchases": case "supplier_purchases": {
      const ps = (await tdb.purchase.findMany({ where: { purchaseDate: { gte: r.from, lte: r.to }, status: { in: ["RECEIVED", "COMPLETED"] }, ...(f.supplierId ? { supplierId: f.supplierId } : {}) }, orderBy: { purchaseDate: "desc" }, take: CAP, include: { supplier: { select: { supplierName: true, supplierCode: true } } } })) as Record<string, any>[];
      if (k === "purchases") return { ...base, title: "Purchases", columns: [{ key: "date", label: "Date", type: D }, { key: "number", label: "Purchase", type: T }, { key: "supplier", label: "Supplier", type: T }, { key: "invoice", label: "Supplier invoice", type: T }, { key: "status", label: "Status", type: T }, { key: "totalMinor", label: "Total", type: M }], rows: ps.map((p) => ({ date: p.purchaseDate, number: p.purchaseNumber, supplier: p.supplier.supplierName, invoice: p.supplierInvoiceNumber, status: p.status, totalMinor: p.totalMinor })), summary: [{ label: "Total purchased", value: ps.reduce((a, p) => a + p.totalMinor, 0), type: "money" }, { label: "Purchases", value: ps.length, type: "int" }], capped: ps.length === CAP };
      const g = new Map<string, { supplier: string; code: string; count: number; totalMinor: number }>();
      for (const p of ps) { const cur = g.get(p.supplierId) ?? { supplier: p.supplier.supplierName, code: p.supplier.supplierCode, count: 0, totalMinor: 0 }; cur.count++; cur.totalMinor += p.totalMinor; g.set(p.supplierId, cur); }
      return { ...base, title: "Supplier purchases", columns: [{ key: "code", label: "Code", type: T }, { key: "supplier", label: "Supplier", type: T }, { key: "count", label: "Purchases", type: I }, { key: "totalMinor", label: "Total purchased", type: M }], rows: [...g.values()].sort((a, b) => b.totalMinor - a.totalMinor), summary: [{ label: "Total purchased", value: ps.reduce((a, p) => a + p.totalMinor, 0), type: "money" }], capped: ps.length === CAP };
    }
    case "dispensing": case "medicine_sales": {
      const items = (await tdb.dispensingItem.findMany({ where: { status: "DISPENSED", ...medFilter, ...(f.batchId ? { batchId: f.batchId } : {}), dispensing: { is: { status: { not: "CANCELLED" }, dispensedAt: { gte: r.start, lt: r.end }, ...(f.userId ? { dispensedById: f.userId } : {}) } } }, orderBy: { id: "desc" }, take: CAP, include: { dispensing: { select: { dispensingNumber: true, dispensedAt: true, patient: { select: { code: true } } } } } })) as Record<string, any>[];
      if (k === "dispensing") return { ...base, title: "Dispensing", columns: [{ key: "date", label: "Date", type: D }, { key: "number", label: "Dispensing", type: T }, { key: "patient", label: "Patient ID", type: T }, { key: "medicine", label: "Medicine", type: T }, { key: "batch", label: "Batch", type: T }, { key: "quantity", label: "Quantity", type: I }, { key: "totalMinor", label: "Total", type: M }], rows: items.map((i) => ({ date: dayOf(i.dispensing.dispensedAt, r.tz), number: i.dispensing.dispensingNumber, patient: i.dispensing.patient.code, medicine: i.medicineNameSnapshot, batch: i.batchNumberSnapshot, quantity: i.dispensedQuantity, totalMinor: i.totalMinor })), summary: [{ label: "Units dispensed", value: items.reduce((a, i) => a + i.dispensedQuantity, 0), type: "int" }, { label: "Billed (incl. tax)", value: items.reduce((a, i) => a + i.totalMinor, 0), type: "money" }], capped: items.length === CAP };
      const g = new Map<string, { medicine: string; quantity: number; totalMinor: number }>();
      for (const i of items) { const cur = g.get(i.medicineId) ?? { medicine: i.medicineNameSnapshot, quantity: 0, totalMinor: 0 }; cur.quantity += i.dispensedQuantity; cur.totalMinor += i.totalMinor; g.set(i.medicineId, cur); }
      return { ...base, title: "Medicine sales", columns: [{ key: "medicine", label: "Medicine", type: T }, { key: "quantity", label: "Units sold", type: I }, { key: "totalMinor", label: "Billed (incl. tax)", type: M }], rows: [...g.values()].sort((a, b) => b.totalMinor - a.totalMinor), summary: [{ label: "Billed (incl. tax)", value: items.reduce((a, i) => a + i.totalMinor, 0), type: "money" }], note: "Billed amounts come from the dispensing snapshot. Payment status lives in Billing.", capped: items.length === CAP };
    }
    case "expiry": {
      const near = addDays(r.today, settings.nearExpiryDays);
      const bs = (await tdb.medicineBatch.findMany({ where: { quantityAvailable: { gt: 0 }, ...(f.state === "expired" ? { expiryDate: { lt: r.today } } : f.state === "near" ? { expiryDate: { gte: r.today, lte: near } } : { expiryDate: { lte: near } }), ...medFilter }, orderBy: { expiryDate: "asc" }, take: CAP, include: { medicine: { select: { genericName: true, brandName: true, strength: true, category: true } } } })) as Record<string, any>[];
      const rows = bs.filter((b) => !f.category || b.medicine.category === f.category).map((b) => ({ medicine: medName(b.medicine), batch: b.batchNumber, expiry: b.expiryDate, days: daysRemaining(b.expiryDate, r.today), quantity: b.quantityAvailable, state: expiryState(b.expiryDate, r.today, settings.nearExpiryDays) === "EXPIRED" ? "Expired" : "Near expiry", valueMinor: b.quantityAvailable * b.purchasePriceMinor }));
      return { ...base, title: "Expiry", columns: [{ key: "medicine", label: "Medicine", type: T }, { key: "batch", label: "Batch", type: T }, { key: "expiry", label: "Expiry", type: D }, { key: "days", label: "Days remaining", type: I }, { key: "quantity", label: "Quantity", type: I }, { key: "state", label: "State", type: T }, { key: "valueMinor", label: "Value (cost)", type: M }], rows, summary: [{ label: "Value at risk (cost)", value: rows.reduce((a, x) => a + x.valueMinor, 0), type: "money" }], note: `Near expiry = within ${settings.nearExpiryDays} days (set in pharmacy settings).`, capped: bs.length === CAP };
    }
    case "low_stock": {
      const meds = (await tdb.medicine.findMany({ where: { active: true, ...(f.category ? { category: f.category } : {}), ...(f.medicineId ? { id: f.medicineId } : {}) }, orderBy: { genericName: "asc" }, take: CAP })) as Record<string, any>[];
      const stock = await sellableStock(tdb, r.today);
      const rows = meds.map((m) => ({ m, a: stock.get(m.id) ?? 0 })).filter((x) => stockStatus(x.a, x.m as never) !== "IN_STOCK").map((x) => ({ code: x.m.medicineCode, medicine: medName(x.m as never), available: x.a, reorder: lowThreshold(x.m as never), maximum: x.m.maximumStock, status: x.a <= 0 ? "Out of stock" : "Low stock", toMaximum: x.m.maximumStock != null ? Math.max(0, x.m.maximumStock - x.a) : null }));
      return { ...base, title: "Low stock", columns: [{ key: "code", label: "Code", type: T }, { key: "medicine", label: "Medicine", type: T }, { key: "available", label: "Available", type: I }, { key: "reorder", label: "Reorder level", type: I }, { key: "maximum", label: "Maximum", type: I }, { key: "status", label: "Status", type: T }, { key: "toMaximum", label: "Units to reach maximum", type: I }], rows, note: "No purchase is created automatically.", capped: meds.length === CAP };
    }
    case "returns": {
      const rs = (await tdb.medicineReturn.findMany({ where: { createdAt: { gte: r.start, lt: r.end }, ...medFilter, ...(f.batchId ? { batchId: f.batchId } : {}), ...(f.supplierId ? { supplierId: f.supplierId } : {}) }, orderBy: { createdAt: "desc" }, take: CAP })) as Record<string, any>[];
      const meds = (await tdb.medicine.findMany({ where: { id: { in: [...new Set(rs.map((x) => x.medicineId as string))] } }, select: { id: true, genericName: true, brandName: true, strength: true } })) as { id: string; genericName: string; brandName: string | null; strength: string | null }[];
      const bt = (await tdb.medicineBatch.findMany({ where: { id: { in: [...new Set(rs.map((x) => x.batchId as string))] } }, select: { id: true, batchNumber: true } })) as { id: string; batchNumber: string }[];
      return { ...base, title: "Returns", columns: [{ key: "date", label: "Date", type: D }, { key: "number", label: "Return", type: T }, { key: "type", label: "Type", type: T }, { key: "medicine", label: "Medicine", type: T }, { key: "batch", label: "Batch", type: T }, { key: "quantity", label: "Quantity", type: I }, { key: "status", label: "Status", type: T }, { key: "reason", label: "Reason", type: T }], rows: rs.map((x) => ({ date: dayOf(x.createdAt, r.tz), number: x.returnNumber, type: x.type, medicine: medName(meds.find((m) => m.id === x.medicineId) ?? { genericName: "—", brandName: null, strength: null }), batch: bt.find((b) => b.id === x.batchId)?.batchNumber ?? "—", quantity: x.quantity, status: x.status, reason: x.reason })), capped: rs.length === CAP };
    }
  }
}

const csvCell = (v: unknown) => { let s = String(v ?? ""); if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export async function exportPharmacyReport(ctx: TenantRequestContext, kind: string, f: ReportFilters = {}) {
  const rep = await pharmacyReport(ctx, kind, f);
  const rows = rep.rows.map((row) => rep.columns.map((c) => (c.type === "money" ? minorToInput(Number(row[c.key] ?? 0)) : row[c.key] ?? "")));
  const csv = [rep.columns.map((c) => c.label), ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
  await audit(ctx, AUDIT_ACTIONS.PHARMACY_EXPORTED, "pharmacy_report", kind, { kind, from: rep.from, to: rep.to });
  return { csv, filename: `pharmacy-${kind}-${rep.from}_${rep.to}.csv` };
}
