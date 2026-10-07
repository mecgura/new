import "server-only";
import type { TenantRequestContext } from "@/lib/auth/context";
import { AppError } from "@/lib/errors";
import { computePurchase, expiryState, LEDGER_TYPES } from "@/lib/pharmacy/stock";
import { DATE_RE } from "@/lib/scheduling/time";
import { parseOrThrow } from "@/lib/validation";
import { adjustmentSchema, batchBlockSchema, cancelSchema, countLinesSchema, countStartSchema, openingStockSchema, purchaseReturnSchema, purchaseSchema, stockEventSchema } from "@/lib/validation/pharmacy";
import { isUniqueViolation, nextCounter, type Client } from "./clinic-shared";
import { AUDIT_ACTIONS, PAGE, applyStock, audit, batchView, type BatchView, db, guard, iso, loadPharmacySettings, lowThreshold, nextNumber, pad, todayFor, userNames } from "./pharmacy-core";
import { containsCI } from "./shared";

/* ----------------------------------------------------- purchases ----------------------------------------------------- */
async function resolveItems(tdb: Client, v: ReturnType<typeof purchaseSchema.parse>) {
  const supplier = await tdb.supplier.findFirst({ where: { id: v.supplierId }, select: { id: true, active: true } });
  if (!supplier || !supplier.active) throw new AppError("VALIDATION_ERROR", { message: "Choose an active supplier.", fieldErrors: { supplierId: "Choose an active supplier." } });
  const ids = [...new Set(v.items.map((i) => i.medicineId))];
  const meds = (await tdb.medicine.findMany({ where: { id: { in: ids } }, select: { id: true, active: true } })) as { id: string; active: boolean }[];
  v.items.forEach((i, n) => { const m = meds.find((x) => x.id === i.medicineId); if (!m || !m.active) throw new AppError("VALIDATION_ERROR", { message: "One of the medicines is not available.", fieldErrors: { [`items.${n}.medicineId`]: "This medicine is not available." } }); });
  let calc: ReturnType<typeof computePurchase>;
  try { calc = computePurchase(v.items.map((i) => ({ quantity: i.quantity, unitPurchasePriceMinor: i.unitPurchasePriceMinor, taxRateBp: i.taxRateBp, discountMinor: i.discountMinor }))); }
  catch (e) { if (e instanceof RangeError) throw new AppError("VALIDATION_ERROR", { message: e.message }); throw e; }
  return calc;
}
const itemRows = (v: ReturnType<typeof purchaseSchema.parse>, calc: ReturnType<typeof computePurchase>, tenantId: string, purchaseId: string) => v.items.map((i, n) => ({ tenantId, purchaseId, position: n, medicineId: i.medicineId, batchNumber: i.batchNumber, expiryDate: i.expiryDate, manufacturingDate: i.manufacturingDate ?? null, quantity: i.quantity, freeQuantity: i.freeQuantity, unitPurchasePriceMinor: i.unitPurchasePriceMinor, sellingPriceMinor: i.sellingPriceMinor, taxRateBp: i.taxRateBp, discountMinor: calc.lines[n].discountMinor, taxMinor: calc.lines[n].taxMinor, lineTotalMinor: calc.lines[n].lineTotalMinor }));
const dupInvoice = (e: unknown) => { if (isUniqueViolation(e)) throw new AppError("CONFLICT", { message: "This supplier invoice number was already entered for that supplier.", fieldErrors: { supplierInvoiceNumber: "Already entered for this supplier." } }); throw e; };

export async function createPurchase(ctx: TenantRequestContext, raw: unknown) {
  guard(ctx, "pharmacy.purchase");
  const v = parseOrThrow(purchaseSchema, raw); const tdb = db(ctx);
  const calc = await resolveItems(tdb, v); const today = await todayFor(ctx.tenantId); const yr = today.slice(0, 4);
  let out: { id: string; purchaseNumber: string };
  try {
    out = await tdb.$transaction(async (tx: Client) => {
      const n = await nextCounter(tx, ctx.tenantId, `pur:${yr}`);
      const p = await tx.purchase.create({ data: { tenantId: ctx.tenantId, supplierId: v.supplierId, purchaseNumber: `PUR-${yr}-${pad(n)}`, supplierInvoiceNumber: v.supplierInvoiceNumber ?? null, purchaseDate: v.purchaseDate ?? today, subtotalMinor: calc.subtotalMinor, discountMinor: calc.discountMinor, taxMinor: calc.taxMinor, totalMinor: calc.totalMinor, notes: v.notes ?? null, createdById: ctx.user.id }, select: { id: true, purchaseNumber: true } });
      await tx.purchaseItem.createMany({ data: itemRows(v, calc, ctx.tenantId, p.id) });
      return p;
    });
  } catch (e) { return dupInvoice(e); }
  await audit(ctx, AUDIT_ACTIONS.PURCHASE_CREATED, "purchase", out.id, { number: out.purchaseNumber, items: v.items.length, totalMinor: calc.totalMinor });
  return out;
}
export async function updatePurchase(ctx: TenantRequestContext, id: string, raw: unknown) {
  guard(ctx, "pharmacy.purchase");
  const v = parseOrThrow(purchaseSchema, raw); const tdb = db(ctx);
  const cur = await tdb.purchase.findFirst({ where: { id } });
  if (!cur) throw new AppError("NOT_FOUND", { message: "Purchase not found." });
  if (cur.status !== "DRAFT") throw new AppError("CONFLICT", { message: "Only a draft purchase can be edited." });
  const calc = await resolveItems(tdb, v);
  try {
    await tdb.$transaction(async (tx: Client) => {
      const r = await tx.purchase.updateMany({ where: { id, tenantId: ctx.tenantId, status: "DRAFT" }, data: { supplierId: v.supplierId, supplierInvoiceNumber: v.supplierInvoiceNumber ?? null, purchaseDate: v.purchaseDate ?? cur.purchaseDate, subtotalMinor: calc.subtotalMinor, discountMinor: calc.discountMinor, taxMinor: calc.taxMinor, totalMinor: calc.totalMinor, notes: v.notes ?? null } });
      if (r.count !== 1) throw new AppError("CONFLICT", { message: "This purchase was just received or changed. Refresh and try again." });
      await tx.purchaseItem.deleteMany({ where: { tenantId: ctx.tenantId, purchaseId: id } });
      await tx.purchaseItem.createMany({ data: itemRows(v, calc, ctx.tenantId, id) });
    });
  } catch (e) { return dupInvoice(e); }
  await audit(ctx, AUDIT_ACTIONS.PURCHASE_EDITED, "purchase", id, { number: cur.purchaseNumber, totalMinor: calc.totalMinor });
  return { id };
}
export async function cancelPurchase(ctx: TenantRequestContext, id: string, raw: unknown) {
  guard(ctx, "pharmacy.purchase");
  const v = parseOrThrow(cancelSchema, raw); const tdb = db(ctx);
  const cur = await tdb.purchase.findFirst({ where: { id } });
  if (!cur) throw new AppError("NOT_FOUND", { message: "Purchase not found." });
  const r = await tdb.purchase.updateMany({ where: { id, status: "DRAFT" }, data: { status: "CANCELLED", cancelledAt: new Date(), cancelledById: ctx.user.id, cancelReason: v.reason } });
  if (r.count !== 1) throw new AppError("CONFLICT", { message: "Only a draft purchase can be cancelled. Stock already received is returned to the supplier with a purchase return." });
  await audit(ctx, AUDIT_ACTIONS.PURCHASE_CANCELLED, "purchase", id, { number: cur.purchaseNumber });
  return { status: "CANCELLED" };
}
/** DRAFT → RECEIVED: creates/extends batches and writes one PURCHASE ledger row per line (paid + free units), atomically. */
export async function receivePurchase(ctx: TenantRequestContext, id: string) {
  guard(ctx, "pharmacy.receive", "pharmacy.purchase");
  const tdb = db(ctx); const today = await todayFor(ctx.tenantId);
  const cur = await tdb.purchase.findFirst({ where: { id }, include: { items: { orderBy: { position: "asc" } } } });
  if (!cur) throw new AppError("NOT_FOUND", { message: "Purchase not found." });
  if (cur.status !== "DRAFT") throw new AppError("CONFLICT", { message: "This purchase was already received or cancelled." });
  if (!cur.items.length) throw new AppError("VALIDATION_ERROR", { message: "The purchase has no items." });
  for (const it of cur.items) if (it.expiryDate < today) throw new AppError("VALIDATION_ERROR", { message: `Batch ${it.batchNumber} is already expired and can't be received.` });
  const created: string[] = [];
  await tdb.$transaction(async (tx: Client) => {
    const r = await tx.purchase.updateMany({ where: { id, tenantId: ctx.tenantId, status: "DRAFT" }, data: { status: "RECEIVED", receivedAt: new Date(), receivedById: ctx.user.id } });
    if (r.count !== 1) throw new AppError("CONFLICT", { message: "This purchase was just received by someone else." });
    for (const it of cur.items as Record<string, any>[]) {
      let batch = await tx.medicineBatch.findFirst({ where: { tenantId: ctx.tenantId, medicineId: it.medicineId, batchNumber: it.batchNumber }, select: { id: true, expiryDate: true } });
      if (batch && batch.expiryDate !== it.expiryDate) throw new AppError("CONFLICT", { message: `Batch ${it.batchNumber} already exists with a different expiry date (${batch.expiryDate}). Check the batch number.` });
      if (!batch) { batch = await tx.medicineBatch.create({ data: { tenantId: ctx.tenantId, medicineId: it.medicineId, batchNumber: it.batchNumber, expiryDate: it.expiryDate, manufacturingDate: it.manufacturingDate, purchasePriceMinor: it.unitPurchasePriceMinor, sellingPriceMinor: it.sellingPriceMinor }, select: { id: true, expiryDate: true } }); created.push(batch.id); }
      await applyStock(tx, ctx, { batchId: batch.id, type: "PURCHASE", delta: it.quantity + it.freeQuantity, referenceType: "PURCHASE", referenceId: id, bump: { quantityReceived: it.quantity + it.freeQuantity } });
      await tx.purchaseItem.update({ where: { id: it.id }, data: { batchId: batch.id } });
    }
  });
  await audit(ctx, AUDIT_ACTIONS.PURCHASE_RECEIVED, "purchase", id, { number: cur.purchaseNumber, lines: cur.items.length });
  for (const b of created) await audit(ctx, AUDIT_ACTIONS.BATCH_CREATED, "medicine_batch", b, { source: "purchase" });
  return { status: "RECEIVED" };
}
export async function completePurchase(ctx: TenantRequestContext, id: string) {
  guard(ctx, "pharmacy.purchase");
  const tdb = db(ctx);
  const cur = await tdb.purchase.findFirst({ where: { id }, select: { purchaseNumber: true } });
  if (!cur) throw new AppError("NOT_FOUND", { message: "Purchase not found." });
  const r = await tdb.purchase.updateMany({ where: { id, status: "RECEIVED" }, data: { status: "COMPLETED", completedAt: new Date(), completedById: ctx.user.id } });
  if (r.count !== 1) throw new AppError("CONFLICT", { message: "Only a received purchase can be completed." });
  await audit(ctx, AUDIT_ACTIONS.PURCHASE_COMPLETED, "purchase", id, { number: cur.purchaseNumber });
  return { status: "COMPLETED" };
}
export async function listPurchases(ctx: TenantRequestContext, q: { status?: string; supplierId?: string; medicineId?: string; q?: string; from?: string; to?: string; page?: number } = {}) {
  guard(ctx, "pharmacy.purchase", "pharmacy.receive", "pharmacy.reports"); const tdb = db(ctx); const page = Math.max(1, Math.floor(q.page ?? 1));
  const text = (q.q ?? "").trim().slice(0, 40);
  const where: Record<string, unknown> = { ...(q.status ? { status: q.status } : {}), ...(q.supplierId ? { supplierId: q.supplierId } : {}), ...(q.medicineId ? { items: { some: { medicineId: q.medicineId } } } : {}), ...(q.from && DATE_RE.test(q.from) ? { purchaseDate: { gte: q.from, ...(q.to && DATE_RE.test(q.to) ? { lte: q.to } : {}) } } : q.to && DATE_RE.test(q.to) ? { purchaseDate: { lte: q.to } } : {}), ...(text ? { OR: [{ purchaseNumber: containsCI(text) }, { supplierInvoiceNumber: containsCI(text) }, { supplier: { is: { supplierName: containsCI(text) } } }] } : {}) };
  const [total, rows] = await Promise.all([tdb.purchase.count({ where }), tdb.purchase.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * PAGE, take: PAGE, include: { supplier: { select: { supplierName: true, supplierCode: true } } } })]);
  return { rows: rows.map((p: Record<string, any>) => ({ id: p.id, purchaseNumber: p.purchaseNumber, supplierInvoiceNumber: p.supplierInvoiceNumber, supplierName: p.supplier.supplierName, supplierCode: p.supplier.supplierCode, purchaseDate: p.purchaseDate, totalMinor: p.totalMinor, status: p.status })) as { id: string; purchaseNumber: string; supplierInvoiceNumber: string | null; supplierName: string; supplierCode: string; purchaseDate: string; totalMinor: number; status: string }[], total: total as number, page, pageSize: PAGE };
}
export async function getPurchase(ctx: TenantRequestContext, id: string) {
  guard(ctx, "pharmacy.purchase", "pharmacy.receive", "pharmacy.reports"); const tdb = db(ctx);
  const p = await tdb.purchase.findFirst({ where: { id }, include: { supplier: true, items: { orderBy: { position: "asc" }, include: { medicine: { select: { medicineCode: true, genericName: true, brandName: true, strength: true, unit: true } } } } } });
  if (!p) throw new AppError("NOT_FOUND", { message: "Purchase not found." });
  const names = await userNames(tdb, [p.createdById, p.receivedById, p.completedById]);
  return {
    id: p.id as string, purchaseNumber: p.purchaseNumber as string, supplierInvoiceNumber: p.supplierInvoiceNumber as string | null, purchaseDate: p.purchaseDate as string, status: p.status as string, notes: p.notes as string | null,
    subtotalMinor: p.subtotalMinor as number, discountMinor: p.discountMinor as number, taxMinor: p.taxMinor as number, totalMinor: p.totalMinor as number, cancelReason: p.cancelReason as string | null,
    createdBy: names.get(p.createdById) ?? null, receivedBy: p.receivedById ? names.get(p.receivedById) ?? null : null, receivedAt: iso(p.receivedAt), completedAt: iso(p.completedAt), createdAt: iso(p.createdAt),
    supplier: { id: p.supplier.id as string, supplierCode: p.supplier.supplierCode as string, supplierName: p.supplier.supplierName as string, address: p.supplier.address as string | null, phone: p.supplier.phone as string | null, taxId: p.supplier.taxId as string | null },
    items: p.items.map((i: Record<string, any>) => ({ id: i.id, medicineId: i.medicineId, medicineCode: i.medicine.medicineCode, medicineName: [i.medicine.brandName ?? i.medicine.genericName, i.medicine.strength].filter(Boolean).join(" "), unit: i.medicine.unit, batchNumber: i.batchNumber, expiryDate: i.expiryDate, manufacturingDate: i.manufacturingDate, quantity: i.quantity, freeQuantity: i.freeQuantity, unitPurchasePriceMinor: i.unitPurchasePriceMinor, sellingPriceMinor: i.sellingPriceMinor, taxRateBp: i.taxRateBp, discountMinor: i.discountMinor, taxMinor: i.taxMinor, lineTotalMinor: i.lineTotalMinor, batchId: i.batchId })) as { id: string; medicineId: string; medicineCode: string; medicineName: string; unit: string; batchNumber: string; expiryDate: string; manufacturingDate: string | null; quantity: number; freeQuantity: number; unitPurchasePriceMinor: number; sellingPriceMinor: number; taxRateBp: number; discountMinor: number; taxMinor: number; lineTotalMinor: number; batchId: string | null }[],
  };
}
export type PurchaseDetail = Awaited<ReturnType<typeof getPurchase>>;

/* ------------------------------------------------- opening stock & events ------------------------------------------------- */
export async function addOpeningStock(ctx: TenantRequestContext, raw: unknown) {
  guard(ctx, "pharmacy.configure");
  const v = parseOrThrow(openingStockSchema, raw); const tdb = db(ctx);
  const med = await tdb.medicine.findFirst({ where: { id: v.medicineId }, select: { id: true } });
  if (!med) throw new AppError("NOT_FOUND", { message: "Medicine not found." });
  if (v.manufacturingDate && v.manufacturingDate > v.expiryDate) throw new AppError("VALIDATION_ERROR", { message: "Manufacturing date must be before the expiry date.", fieldErrors: { manufacturingDate: "Must be before the expiry date." } });
  let batchId = "";
  try {
    await tdb.$transaction(async (tx: Client) => {
      const b = await tx.medicineBatch.create({ data: { tenantId: ctx.tenantId, medicineId: v.medicineId, batchNumber: v.batchNumber, expiryDate: v.expiryDate, manufacturingDate: v.manufacturingDate ?? null, purchasePriceMinor: v.purchasePriceMinor, sellingPriceMinor: v.sellingPriceMinor }, select: { id: true } });
      batchId = b.id;
      await applyStock(tx, ctx, { batchId: b.id, type: "OPENING", delta: v.quantity, referenceType: "OPENING", referenceId: b.id, notes: v.notes, bump: { quantityReceived: v.quantity } });
    });
  } catch (e) { if (isUniqueViolation(e)) throw new AppError("CONFLICT", { message: "This batch already exists for the medicine. Use a purchase or a stock adjustment to change its stock.", fieldErrors: { batchNumber: "Batch already exists." } }); throw e; }
  await audit(ctx, AUDIT_ACTIONS.STOCK_OPENING, "medicine_batch", batchId, { quantity: v.quantity });
  await audit(ctx, AUDIT_ACTIONS.BATCH_CREATED, "medicine_batch", batchId, { source: "opening" });
  return { batchId };
}
async function batchFor(tdb: Client, id: string) {
  const b = await tdb.medicineBatch.findFirst({ where: { id } });
  if (!b) throw new AppError("NOT_FOUND", { message: "That batch doesn't exist." });
  return b as Record<string, any>;
}
/** Manual correction. Both directions need a reason and a note; the ledger shows who and why. */
export async function adjustStock(ctx: TenantRequestContext, raw: unknown) {
  guard(ctx, "pharmacy.adjust");
  const v = parseOrThrow(adjustmentSchema, raw); const tdb = db(ctx); await batchFor(tdb, v.batchId);
  const res = await tdb.$transaction((tx: Client) => applyStock(tx, ctx, { batchId: v.batchId, type: v.direction === "IN" ? "ADJUSTMENT_IN" : "ADJUSTMENT_OUT", delta: v.direction === "IN" ? v.quantity : -v.quantity, referenceType: "ADJUSTMENT", reason: v.reason, notes: v.notes }));
  await audit(ctx, AUDIT_ACTIONS.STOCK_ADJUSTED, "medicine_batch", v.batchId, { direction: v.direction, quantity: v.quantity, reason: v.reason, balanceAfter: res.balanceAfter });
  return { balanceAfter: res.balanceAfter };
}
export async function recordDamage(ctx: TenantRequestContext, raw: unknown) {
  guard(ctx, "pharmacy.adjust");
  const v = parseOrThrow(stockEventSchema, raw); const tdb = db(ctx); await batchFor(tdb, v.batchId);
  const res = await tdb.$transaction((tx: Client) => applyStock(tx, ctx, { batchId: v.batchId, type: "DAMAGE", delta: -v.quantity, referenceType: "DAMAGE", reason: v.reason, notes: v.notes, bump: { damagedQuantity: v.quantity } }));
  await audit(ctx, AUDIT_ACTIONS.STOCK_DAMAGED, "medicine_batch", v.batchId, { quantity: v.quantity, reason: v.reason });
  return { balanceAfter: res.balanceAfter };
}
/** Moves an EXPIRED batch's remaining stock out (kept in history, never deleted). Valid batches can't be written off as expired. */
export async function writeOffExpired(ctx: TenantRequestContext, raw: unknown) {
  guard(ctx, "pharmacy.adjust");
  const v = parseOrThrow(stockEventSchema.partial({ quantity: true, reason: true }).extend({ batchId: stockEventSchema.shape.batchId }), raw); const tdb = db(ctx);
  const b = await batchFor(tdb, v.batchId); const today = await todayFor(ctx.tenantId);
  if (b.expiryDate >= today) throw new AppError("CONFLICT", { message: "This batch has not expired yet. Use damage or an adjustment instead." });
  const q = v.quantity ?? b.quantityAvailable;
  if (q <= 0) throw new AppError("VALIDATION_ERROR", { message: "There is no stock left in this batch." });
  const res = await tdb.$transaction((tx: Client) => applyStock(tx, ctx, { batchId: v.batchId, type: "EXPIRY", delta: -q, referenceType: "EXPIRY", reason: v.reason ?? "Expired stock disposed", notes: v.notes, bump: { expiredQuantity: q } }));
  await audit(ctx, AUDIT_ACTIONS.STOCK_EXPIRED, "medicine_batch", v.batchId, { quantity: q });
  return { balanceAfter: res.balanceAfter };
}
export async function setBatchBlocked(ctx: TenantRequestContext, batchId: string, raw: unknown) {
  guard(ctx, "pharmacy.adjust");
  const v = parseOrThrow(batchBlockSchema, raw); const tdb = db(ctx); await batchFor(tdb, batchId);
  await tdb.medicineBatch.updateMany({ where: { id: batchId }, data: { status: v.block ? "BLOCKED" : "ACTIVE", blockedReason: v.block ? v.reason ?? null : null } });
  await audit(ctx, v.block ? AUDIT_ACTIONS.BATCH_BLOCKED : AUDIT_ACTIONS.BATCH_UNBLOCKED, "medicine_batch", batchId, { reason: v.reason ?? null });
  return { status: v.block ? "BLOCKED" : "ACTIVE" };
}

/** Purchase return: stock goes back to the supplier immediately (ledger PURCHASE_RETURN) and a record is kept. */
export async function returnToSupplier(ctx: TenantRequestContext, raw: unknown) {
  guard(ctx, "pharmacy.purchase");
  const v = parseOrThrow(purchaseReturnSchema, raw); const tdb = db(ctx);
  const [b, s] = await Promise.all([batchFor(tdb, v.batchId), tdb.supplier.findFirst({ where: { id: v.supplierId }, select: { id: true } })]);
  if (!s) throw new AppError("NOT_FOUND", { message: "Supplier not found." });
  const out = await tdb.$transaction(async (tx: Client) => {
    const n = await nextCounter(tx, ctx.tenantId, `ret:${(await todayFor(ctx.tenantId)).slice(0, 4)}`);
    const row = await tx.medicineReturn.create({ data: { tenantId: ctx.tenantId, returnNumber: `RET-${(await todayFor(ctx.tenantId)).slice(0, 4)}-${pad(n)}`, type: "PURCHASE_RETURN", status: "RECEIVED", medicineId: b.medicineId, batchId: v.batchId, quantity: v.quantity, reason: v.reason, supplierId: v.supplierId, reference: v.reference ?? null, notes: v.notes ?? null, requestedById: ctx.user.id, approvedById: ctx.user.id, receivedById: ctx.user.id }, select: { id: true, returnNumber: true } });
    await applyStock(tx, ctx, { batchId: v.batchId, type: "PURCHASE_RETURN", delta: -v.quantity, referenceType: "RETURN", referenceId: row.id, reason: v.reason, notes: v.reference ?? undefined });
    return row;
  });
  await audit(ctx, AUDIT_ACTIONS.PURCHASE_RETURNED, "medicine_return", out.id, { number: out.returnNumber, quantity: v.quantity });
  return { id: out.id as string, returnNumber: out.returnNumber as string };
}

/* ------------------------------------------------------ physical count ------------------------------------------------------ */
export async function startCount(ctx: TenantRequestContext, raw: unknown) {
  guard(ctx, "pharmacy.adjust");
  const v = parseOrThrow(countStartSchema, raw); const tdb = db(ctx);
  const batches = (await tdb.medicineBatch.findMany({ where: { ...(v.medicineId ? { medicineId: v.medicineId } : {}), quantityAvailable: { gt: 0 } }, select: { id: true, medicineId: true, quantityAvailable: true }, take: 500 })) as { id: string; medicineId: string; quantityAvailable: number }[];
  if (!batches.length) throw new AppError("VALIDATION_ERROR", { message: "There is no stock to count." });
  const yr = (await todayFor(ctx.tenantId)).slice(0, 4);
  const out = await tdb.$transaction(async (tx: Client) => {
    const n = await nextNumber(tx, ctx.tenantId, `cnt:${yr}`);
    const c = await tx.stockCount.create({ data: { tenantId: ctx.tenantId, countNumber: `CNT-${yr}-${n}`, notes: v.notes ?? null, createdById: ctx.user.id }, select: { id: true, countNumber: true } });
    await tx.stockCountLine.createMany({ data: batches.map((b) => ({ tenantId: ctx.tenantId, countId: c.id, batchId: b.id, medicineId: b.medicineId, systemQuantity: b.quantityAvailable })) });
    return c;
  });
  return { id: out.id as string, countNumber: out.countNumber as string, lines: batches.length };
}
export async function getCount(ctx: TenantRequestContext, id: string) {
  guard(ctx, "pharmacy.adjust"); const tdb = db(ctx);
  const c = await tdb.stockCount.findFirst({ where: { id }, include: { lines: true } });
  if (!c) throw new AppError("NOT_FOUND", { message: "Count not found." });
  const bIds = c.lines.map((l: { batchId: string }) => l.batchId); const mIds = [...new Set(c.lines.map((l: { medicineId: string }) => l.medicineId))] as string[];
  const [batches, meds] = await Promise.all([tdb.medicineBatch.findMany({ where: { id: { in: bIds } }, select: { id: true, batchNumber: true, expiryDate: true, quantityAvailable: true } }), tdb.medicine.findMany({ where: { id: { in: mIds } }, select: { id: true, genericName: true, brandName: true, strength: true } })]);
  const lines = c.lines.map((l: Record<string, any>) => { const b = batches.find((x: { id: string }) => x.id === l.batchId); const m = meds.find((x: { id: string }) => x.id === l.medicineId); return { batchId: l.batchId as string, medicineName: m ? [m.brandName ?? m.genericName, m.strength].filter(Boolean).join(" ") : "—", batchNumber: (b?.batchNumber ?? "—") as string, expiryDate: (b?.expiryDate ?? "") as string, systemQuantity: l.systemQuantity as number, currentQuantity: (b?.quantityAvailable ?? 0) as number, physicalQuantity: l.physicalQuantity as number | null, difference: l.difference as number | null, reason: l.reason as string | null }; }).sort((a: { medicineName: string }, b: { medicineName: string }) => a.medicineName.localeCompare(b.medicineName));
  return { id: c.id as string, countNumber: c.countNumber as string, status: c.status as string, notes: c.notes as string | null, createdAt: iso(c.createdAt), appliedAt: iso(c.appliedAt), lines };
}
export async function listCounts(ctx: TenantRequestContext) {
  guard(ctx, "pharmacy.adjust");
  const rows = await db(ctx).stockCount.findMany({ orderBy: { createdAt: "desc" }, take: 30, select: { id: true, countNumber: true, status: true, createdAt: true, _count: { select: { lines: true } } } });
  return { rows: rows.map((r: Record<string, any>) => ({ id: r.id as string, countNumber: r.countNumber as string, status: r.status as string, createdAt: iso(r.createdAt), lines: r._count.lines as number })) };
}
export async function saveCountLines(ctx: TenantRequestContext, id: string, raw: unknown) {
  guard(ctx, "pharmacy.adjust");
  const v = parseOrThrow(countLinesSchema, raw); const tdb = db(ctx);
  const c = await tdb.stockCount.findFirst({ where: { id }, select: { status: true } });
  if (!c) throw new AppError("NOT_FOUND", { message: "Count not found." });
  if (c.status !== "OPEN") throw new AppError("CONFLICT", { message: "This count is already closed." });
  await tdb.$transaction(async (tx: Client) => { for (const l of v.lines) await tx.stockCountLine.updateMany({ where: { countId: id, batchId: l.batchId, tenantId: ctx.tenantId }, data: { physicalQuantity: l.physicalQuantity ?? null, reason: l.reason ?? null } }); });
  return { saved: v.lines.length };
}
/** Applies the differences as ADJUSTMENT rows (never an overwrite). A line whose stock moved since the count started is refused. */
export async function applyCount(ctx: TenantRequestContext, id: string) {
  guard(ctx, "pharmacy.adjust"); const tdb = db(ctx);
  const c = await tdb.stockCount.findFirst({ where: { id }, include: { lines: true } });
  if (!c) throw new AppError("NOT_FOUND", { message: "Count not found." });
  if (c.status !== "OPEN") throw new AppError("CONFLICT", { message: "This count is already closed." });
  const counted = c.lines.filter((l: { physicalQuantity: number | null }) => l.physicalQuantity != null);
  if (!counted.length) throw new AppError("VALIDATION_ERROR", { message: "Enter at least one physical quantity." });
  for (const l of counted as { systemQuantity: number; physicalQuantity: number; reason: string | null; batchId: string }[]) if (l.physicalQuantity !== l.systemQuantity && !l.reason) throw new AppError("VALIDATION_ERROR", { message: "Give a reason for every line that differs from the system quantity." });
  let adjusted = 0;
  await tdb.$transaction(async (tx: Client) => {
    const r = await tx.stockCount.updateMany({ where: { id, tenantId: ctx.tenantId, status: "OPEN" }, data: { status: "APPLIED", appliedAt: new Date(), appliedById: ctx.user.id } });
    if (r.count !== 1) throw new AppError("CONFLICT", { message: "This count was just applied by someone else." });
    for (const l of counted as { id: string; systemQuantity: number; physicalQuantity: number; reason: string | null; batchId: string }[]) {
      const diff = l.physicalQuantity - l.systemQuantity;
      await tx.stockCountLine.update({ where: { id: l.id }, data: { difference: diff } });
      if (diff === 0) continue;
      const cur = await tx.medicineBatch.findFirst({ where: { id: l.batchId, tenantId: ctx.tenantId }, select: { quantityAvailable: true } });
      if (!cur || cur.quantityAvailable !== l.systemQuantity) throw new AppError("CONFLICT", { message: "Stock changed after this count started (a sale or purchase happened). Start a new count." });
      await applyStock(tx, ctx, { batchId: l.batchId, type: diff > 0 ? "ADJUSTMENT_IN" : "ADJUSTMENT_OUT", delta: diff, referenceType: "COUNT", referenceId: id, reason: "PHYSICAL_COUNT_CORRECTION", notes: l.reason ?? undefined });
      adjusted++;
    }
  });
  await audit(ctx, AUDIT_ACTIONS.STOCK_COUNTED, "stock_count", id, { number: c.countNumber, lines: counted.length, adjusted });
  return { adjusted };
}
export async function cancelCount(ctx: TenantRequestContext, id: string) {
  guard(ctx, "pharmacy.adjust");
  const r = await db(ctx).stockCount.updateMany({ where: { id, status: "OPEN" }, data: { status: "CANCELLED" } });
  if (r.count !== 1) throw new AppError("CONFLICT", { message: "Only an open count can be cancelled." });
  return { status: "CANCELLED" };
}

/* ------------------------------------------------------ batches & ledger ------------------------------------------------------ */
export type BatchRow = BatchView & { medicineCode: string; medicineName: string; unit: string; expiry: string };
export async function listBatches(ctx: TenantRequestContext, q: { q?: string; medicineId?: string; state?: string; page?: number } = {}) {
  guard(ctx, "pharmacy.view"); const tdb = db(ctx); const today = await todayFor(ctx.tenantId); const settings = await loadPharmacySettings(tdb, ctx.tenantId); const page = Math.max(1, Math.floor(q.page ?? 1));
  const near = new Date(Date.parse(`${today}T00:00:00Z`) + settings.nearExpiryDays * 86_400_000).toISOString().slice(0, 10);
  const text = (q.q ?? "").trim().slice(0, 60);
  const where: Record<string, unknown> = { ...(q.medicineId ? { medicineId: q.medicineId } : {}), ...(text ? { OR: [{ batchNumber: containsCI(text) }, { medicine: { is: { genericName: containsCI(text) } } }, { medicine: { is: { brandName: containsCI(text) } } }, { medicine: { is: { medicineCode: containsCI(text) } } }] } : {}) };
  switch (q.state) {
    case "expired": Object.assign(where, { expiryDate: { lt: today }, quantityAvailable: { gt: 0 } }); break;
    case "near": Object.assign(where, { expiryDate: { gte: today, lte: near }, quantityAvailable: { gt: 0 }, status: "ACTIVE" }); break;
    case "blocked": Object.assign(where, { status: "BLOCKED" }); break;
    case "available": Object.assign(where, { expiryDate: { gte: today }, quantityAvailable: { gt: 0 }, status: "ACTIVE" }); break;
    case "depleted": Object.assign(where, { quantityAvailable: 0 }); break;
    default: if (!text && !q.medicineId) Object.assign(where, { quantityAvailable: { gt: 0 } });
  }
  const [total, rows] = await Promise.all([tdb.medicineBatch.count({ where }), tdb.medicineBatch.findMany({ where, orderBy: [{ expiryDate: "asc" }, { batchNumber: "asc" }], skip: (page - 1) * PAGE, take: PAGE, include: { medicine: { select: { medicineCode: true, genericName: true, brandName: true, strength: true, reorderLevel: true, minimumStock: true, unit: true } } } })]);
  return { rows: rows.map((b: Record<string, any>) => ({ ...batchView(b, today, lowThreshold(b.medicine)), medicineCode: b.medicine.medicineCode as string, medicineName: [b.medicine.brandName ?? b.medicine.genericName, b.medicine.strength].filter(Boolean).join(" "), unit: b.medicine.unit as string, expiry: expiryState(b.expiryDate, today, settings.nearExpiryDays) })) as BatchRow[], total: total as number, page, pageSize: PAGE, nearExpiryDays: settings.nearExpiryDays };
}
export async function getBatch(ctx: TenantRequestContext, id: string) {
  guard(ctx, "pharmacy.view"); const tdb = db(ctx);
  const b = await tdb.medicineBatch.findFirst({ where: { id }, include: { medicine: true } });
  if (!b) throw new AppError("NOT_FOUND", { message: "Batch not found." });
  const today = await todayFor(ctx.tenantId);
  const tx = (await tdb.stockTransaction.findMany({ where: { batchId: id }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 500 })) as Record<string, any>[];
  const names = await userNames(tdb, tx.map((t) => t.createdById));
  const ledgerSum = tx.reduce((a, t) => a + t.quantity, 0);
  return { batch: batchView(b, today, lowThreshold(b.medicine)), medicine: { id: b.medicine.id as string, medicineCode: b.medicine.medicineCode as string, name: [b.medicine.brandName ?? b.medicine.genericName, b.medicine.strength].filter(Boolean).join(" "), unit: b.medicine.unit as string }, ledgerConsistent: ledgerSum === b.quantityAvailable, transactions: tx.map(ledgerRow(names)) as LedgerEntry[] };
}
const ledgerRow = (names: Map<string, string>) => (t: Record<string, any>) => ({ id: t.id as string, createdAt: iso(t.createdAt) as string, type: t.type as string, quantity: t.quantity as number, balanceAfter: t.balanceAfter as number, referenceType: t.referenceType as string | null, referenceId: t.referenceId as string | null, reason: t.reason as string | null, notes: t.notes as string | null, user: names.get(t.createdById) ?? null });
export interface LedgerEntry { id: string; createdAt: string; type: string; quantity: number; balanceAfter: number; referenceType: string | null; referenceId: string | null; reason: string | null; notes: string | null; user: string | null }
export type LedgerRow = LedgerEntry & { medicineName: string; batchNumber: string };
export interface LedgerFilters { from?: string; to?: string; medicineId?: string; batchId?: string; type?: string; userId?: string; page?: number }
export async function listLedger(ctx: TenantRequestContext, q: LedgerFilters = {}) {
  guard(ctx, "pharmacy.view", "pharmacy.reports"); const tdb = db(ctx); const page = Math.max(1, Math.floor(q.page ?? 1));
  const range: Record<string, Date> = {};
  if (q.from && DATE_RE.test(q.from)) range.gte = new Date(`${q.from}T00:00:00Z`);
  if (q.to && DATE_RE.test(q.to)) range.lt = new Date(Date.parse(`${q.to}T00:00:00Z`) + 86_400_000);
  const where: Record<string, unknown> = { ...(q.medicineId ? { medicineId: q.medicineId } : {}), ...(q.batchId ? { batchId: q.batchId } : {}), ...(q.type && (LEDGER_TYPES as readonly string[]).includes(q.type) ? { type: q.type } : {}), ...(q.userId ? { createdById: q.userId } : {}), ...(Object.keys(range).length ? { createdAt: range } : {}) };
  const [total, rows] = await Promise.all([tdb.stockTransaction.count({ where }), tdb.stockTransaction.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (page - 1) * PAGE, take: PAGE, include: { medicine: { select: { genericName: true, brandName: true, strength: true } }, batch: { select: { batchNumber: true } } } })]);
  const names = await userNames(tdb, rows.map((r: { createdById: string }) => r.createdById));
  return { rows: rows.map((t: Record<string, any>) => ({ ...ledgerRow(names)(t), medicineName: [t.medicine.brandName ?? t.medicine.genericName, t.medicine.strength].filter(Boolean).join(" "), batchNumber: t.batch.batchNumber as string })) as LedgerRow[], total: total as number, page, pageSize: PAGE };
}
/** Integrity check: every batch's quantity must equal the sum of its ledger rows. Returns the batches that don't (should be none). */
export async function reconcileStock(ctx: TenantRequestContext) {
  guard(ctx, "pharmacy.reports", "pharmacy.adjust"); const tdb = db(ctx);
  const sums = (await tdb.stockTransaction.groupBy({ by: ["batchId"], _sum: { quantity: true } })) as { batchId: string; _sum: { quantity: number | null } }[];
  const batches = (await tdb.medicineBatch.findMany({ select: { id: true, batchNumber: true, quantityAvailable: true } })) as { id: string; batchNumber: string; quantityAvailable: number }[];
  const map = new Map(sums.map((s) => [s.batchId, s._sum.quantity ?? 0]));
  const mismatches = batches.filter((b) => (map.get(b.id) ?? 0) !== b.quantityAvailable).map((b) => ({ batchId: b.id, batchNumber: b.batchNumber, quantityAvailable: b.quantityAvailable, ledgerSum: map.get(b.id) ?? 0 }));
  return { checked: batches.length, mismatches };
}
