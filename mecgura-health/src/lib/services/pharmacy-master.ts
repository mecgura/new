import "server-only";
import type { TenantRequestContext } from "@/lib/auth/context";
import { AppError } from "@/lib/errors";
import { rateLimit } from "@/lib/security/rate-limit";
import { parseOrThrow } from "@/lib/validation";
import { configItemSchema, medicineSchema, pharmacySettingsSchema, supplierSchema } from "@/lib/validation/pharmacy";
import { isUniqueViolation, nextCounter, type Client } from "./clinic-shared";
import { AUDIT_ACTIONS, PAGE, audit, batchView, db, guard, iso, loadPharmacySettings, lowThreshold, pad, sellableStock, stockStatus, todayFor, type BatchView, type PharmacySettingsView } from "./pharmacy-core";
import { containsCI } from "./shared";

/* ---------------------------------------------- settings & lists ---------------------------------------------- */
export async function getPharmacySettings(ctx: TenantRequestContext): Promise<PharmacySettingsView> {
  guard(ctx, "pharmacy.view");
  return loadPharmacySettings(db(ctx), ctx.tenantId);
}
export async function savePharmacySettings(ctx: TenantRequestContext, raw: unknown) {
  guard(ctx, "pharmacy.configure");
  const v = parseOrThrow(pharmacySettingsSchema, raw);
  const tdb = db(ctx); const cur = await loadPharmacySettings(tdb, ctx.tenantId);
  const data = { nearExpiryDays: v.nearExpiryDays, allowOverDispense: v.allowOverDispense, allowPatientReturns: v.allowPatientReturns, returnWindowDays: v.returnWindowDays, billFooter: v.billFooter ?? null };
  await tdb.pharmacySettings.upsert({ where: { tenantId: ctx.tenantId }, update: data, create: { tenantId: ctx.tenantId, ...data } });
  const changed = (Object.keys(data) as (keyof typeof data)[]).filter((k) => (cur as never as Record<string, unknown>)[k] !== (data as Record<string, unknown>)[k]);
  await audit(ctx, AUDIT_ACTIONS.PHARMACY_CONFIG_CHANGED, "pharmacy_settings", ctx.tenantId, { fields: changed });
  return loadPharmacySettings(tdb, ctx.tenantId);
}

const DEFAULTS: Record<string, string[]> = {
  DOSAGE_FORM: ["Tablet", "Capsule", "Syrup", "Injection", "Cream", "Ointment", "Drops", "Powder", "Suspension", "Inhaler", "Other"],
  CATEGORY: ["Antibiotic", "Analgesic", "Antacid", "Vitamin", "Cardiac", "Diabetic", "Dermatology", "Respiratory", "Other"],
  UNIT: ["Tablet", "Capsule", "ml", "Vial", "Strip", "Tube", "Bottle", "Unit"],
};
/** The clinic's editable lists. Starter values are created once, then belong to the clinic (rename, add, deactivate). */
export async function listConfig(ctx: TenantRequestContext) {
  guard(ctx, "pharmacy.view", "pharmacy.configure");
  const tdb = db(ctx);
  const have = (await tdb.pharmacyConfigItem.groupBy({ by: ["kind"], _count: { _all: true } })) as { kind: string }[];
  for (const [kind, names] of Object.entries(DEFAULTS)) {
    if (have.some((h) => h.kind === kind)) continue;
    for (const name of names) { try { await tdb.pharmacyConfigItem.create({ data: { tenantId: ctx.tenantId, kind, name } }); } catch (e) { if (!isUniqueViolation(e)) throw e; } }
  }
  const rows = (await tdb.pharmacyConfigItem.findMany({ orderBy: [{ kind: "asc" }, { name: "asc" }] })) as { id: string; kind: string; name: string; active: boolean }[];
  return { dosageForms: rows.filter((r) => r.kind === "DOSAGE_FORM"), categories: rows.filter((r) => r.kind === "CATEGORY"), units: rows.filter((r) => r.kind === "UNIT") };
}
export async function saveConfigItem(ctx: TenantRequestContext, id: string | null, raw: unknown) {
  guard(ctx, "pharmacy.configure");
  const v = parseOrThrow(configItemSchema, raw); const tdb = db(ctx);
  try {
    if (id) {
      const cur = await tdb.pharmacyConfigItem.findFirst({ where: { id } });
      if (!cur) throw new AppError("NOT_FOUND", { message: "Item not found." });
      await tdb.pharmacyConfigItem.update({ where: { id }, data: { name: v.name, active: v.active } });
    } else id = (await tdb.pharmacyConfigItem.create({ data: { tenantId: ctx.tenantId, kind: v.kind, name: v.name, active: v.active } })).id;
  } catch (e) { if (isUniqueViolation(e)) throw new AppError("CONFLICT", { message: "That name is already in the list.", fieldErrors: { name: "That name is already in the list." } }); throw e; }
  await audit(ctx, AUDIT_ACTIONS.PHARMACY_CONFIG_CHANGED, "pharmacy_config", id!, { kind: v.kind, active: v.active });
  return { id: id! };
}

/* ------------------------------------------------- medicines ------------------------------------------------- */
export interface MedicineRow {
  id: string; medicineCode: string; genericName: string; brandName: string | null; displayName: string; strength: string | null; dosageForm: string | null; manufacturer: string | null; category: string | null; unit: string;
  reorderLevel: number; minimumStock: number; maximumStock: number | null; purchasePriceMinor: number; sellingPriceMinor: number; taxRateBp: number; prescriptionRequired: boolean; active: boolean;
  availableQuantity: number; stockStatus: string; barcode: string | null;
}
const rowOf = (m: Record<string, any>, avail: number): MedicineRow => ({
  id: m.id, medicineCode: m.medicineCode, genericName: m.genericName, brandName: m.brandName, displayName: [m.brandName ?? m.genericName, m.strength].filter(Boolean).join(" "), strength: m.strength, dosageForm: m.dosageForm, manufacturer: m.manufacturer, category: m.category, unit: m.unit,
  reorderLevel: m.reorderLevel, minimumStock: m.minimumStock, maximumStock: m.maximumStock, purchasePriceMinor: m.purchasePriceMinor, sellingPriceMinor: m.sellingPriceMinor, taxRateBp: m.taxRateBp, prescriptionRequired: m.prescriptionRequired, active: m.active,
  availableQuantity: avail, stockStatus: stockStatus(avail, m as never), barcode: m.barcode,
});
const searchWhere = (q: string) => (q ? { OR: [{ medicineCode: containsCI(q) }, { genericName: containsCI(q) }, { brandName: containsCI(q) }, { strength: containsCI(q) }, { manufacturer: containsCI(q) }, { barcode: containsCI(q) }] } : {});

/** Server-side search + pagination. Stock status filters (low / out) are evaluated against real batch stock. */
export async function listMedicines(ctx: TenantRequestContext, q: { q?: string; category?: string; status?: string; page?: number } = {}) {
  guard(ctx, "pharmacy.view"); const tdb = db(ctx);
  const text = (q.q ?? "").trim().slice(0, 60); const page = Math.max(1, Math.floor(q.page ?? 1)); const today = await todayFor(ctx.tenantId);
  const base: Record<string, unknown> = { ...searchWhere(text), ...(q.category ? { category: q.category } : {}) };
  if (q.status === "inactive") base.active = false; else base.active = true;
  if (q.status === "low" || q.status === "out") {
    const all = (await tdb.medicine.findMany({ where: base, select: { id: true, reorderLevel: true, minimumStock: true } })) as { id: string; reorderLevel: number; minimumStock: number }[];
    const stock = await sellableStock(tdb, today);
    const ids = all.filter((m) => { const s = stockStatus(stock.get(m.id) ?? 0, m); return q.status === "out" ? s === "OUT_OF_STOCK" : s === "LOW_STOCK"; }).map((m) => m.id);
    base.id = { in: ids };
  }
  const [total, rows] = await Promise.all([tdb.medicine.count({ where: base }), tdb.medicine.findMany({ where: base, orderBy: [{ genericName: "asc" }, { medicineCode: "asc" }], skip: (page - 1) * PAGE, take: PAGE })]);
  const stock = await sellableStock(tdb, today, rows.map((r: { id: string }) => r.id));
  return { rows: rows.map((m: Record<string, unknown>) => rowOf(m, stock.get(m.id as string) ?? 0)) as MedicineRow[], total: total as number, page, pageSize: PAGE };
}
/** Debounced picker search (small result set). Used by purchase, dispensing and opening-stock forms. */
export async function pickMedicines(ctx: TenantRequestContext, q: string) {
  guard(ctx, "pharmacy.view", "pharmacy.dispense", "pharmacy.receive", "pharmacy.purchase");
  const lim = await rateLimit(`pharmpick:${ctx.user.id}`, { limit: 240, windowMs: 60_000 });
  if (!lim.allowed) throw new AppError("RATE_LIMITED");
  const text = q.trim().slice(0, 60); const tdb = db(ctx);
  if (text.length < 2) return { rows: [] as MedicineRow[] };
  const rows = await tdb.medicine.findMany({ where: { active: true, ...searchWhere(text) }, orderBy: [{ genericName: "asc" }], take: 15 });
  const stock = await sellableStock(tdb, await todayFor(ctx.tenantId), rows.map((r: { id: string }) => r.id));
  return { rows: rows.map((m: Record<string, unknown>) => rowOf(m, stock.get(m.id as string) ?? 0)) as MedicineRow[] };
}
/** For doctors: only whether a medicine is available — never quantities, prices or suppliers. */
export async function medicineAvailability(ctx: TenantRequestContext, q: string) {
  guard(ctx, "pharmacy.availability", "pharmacy.view");
  const text = q.trim().slice(0, 60); const tdb = db(ctx);
  if (text.length < 2) return { rows: [] as { name: string; strength: string | null; available: boolean }[] };
  const rows = await tdb.medicine.findMany({ where: { active: true, OR: [{ genericName: containsCI(text) }, { brandName: containsCI(text) }] }, orderBy: { genericName: "asc" }, take: 15 });
  const stock = await sellableStock(tdb, await todayFor(ctx.tenantId), rows.map((r: { id: string }) => r.id));
  return { rows: rows.map((m: { id: string; genericName: string; brandName: string | null; strength: string | null }) => ({ name: m.brandName ?? m.genericName, strength: m.strength, available: (stock.get(m.id) ?? 0) > 0 })) };
}

export async function getMedicine(ctx: TenantRequestContext, id: string) {
  guard(ctx, "pharmacy.view"); const tdb = db(ctx);
  const m = await tdb.medicine.findFirst({ where: { id } });
  if (!m) throw new AppError("NOT_FOUND", { message: "Medicine not found." });
  const today = await todayFor(ctx.tenantId); const settings = await loadPharmacySettings(tdb, ctx.tenantId);
  const batches = await tdb.medicineBatch.findMany({ where: { medicineId: id }, orderBy: [{ expiryDate: "asc" }, { batchNumber: "asc" }] });
  const views: BatchView[] = batches.map((b: Record<string, unknown>) => batchView(b, today, lowThreshold(m)));
  const available = views.filter((b) => b.displayStatus === "ACTIVE" || b.displayStatus === "LOW_STOCK").reduce((a, b) => a + b.quantityAvailable, 0);
  const totalOnHand = views.reduce((a, b) => a + b.quantityAvailable, 0);
  const valueMinor = views.reduce((a, b) => a + b.quantityAvailable * b.purchasePriceMinor, 0);
  return { medicine: { ...rowOf(m, available), route: m.route, packSize: m.packSize, notes: m.notes, createdAt: iso(m.createdAt) }, batches: views, totals: { available, totalOnHand, reserved: views.reduce((a, b) => a + b.reservedQuantity, 0), valueMinor, valuationMethod: "Quantity on hand × batch purchase price (cost). This is stock value, not profit." }, nearExpiryDays: settings.nearExpiryDays };
}

async function createWithCode(tx: Client, ctx: TenantRequestContext, data: Record<string, unknown>) {
  const n = await nextCounter(tx, ctx.tenantId, "med");
  return tx.medicine.create({ data: { ...data, tenantId: ctx.tenantId, medicineCode: `MED-${pad(n)}`, createdById: ctx.user.id }, select: { id: true, medicineCode: true } });
}
export async function createMedicine(ctx: TenantRequestContext, raw: unknown) {
  guard(ctx, "pharmacy.medicines");
  const { priceChangeReason: _r, ...v } = parseOrThrow(medicineSchema, raw); void _r;
  const tdb = db(ctx);
  const out = await tdb.$transaction((tx: Client) => createWithCode(tx, ctx, { ...v, brandName: v.brandName ?? null, strength: v.strength ?? null, dosageForm: v.dosageForm ?? null, route: v.route ?? null, manufacturer: v.manufacturer ?? null, category: v.category ?? null, packSize: v.packSize ?? null, barcode: v.barcode ?? null, maximumStock: v.maximumStock ?? null, notes: v.notes ?? null }));
  await audit(ctx, AUDIT_ACTIONS.MEDICINE_CREATED, "medicine", out.id, { code: out.medicineCode });
  return { id: out.id as string, medicineCode: out.medicineCode as string };
}
/** The medicine code never changes. Price and threshold changes are audited with old/new values and a reason; old bills are snapshots and stay as they were. */
export async function updateMedicine(ctx: TenantRequestContext, id: string, raw: unknown, opts: { applyToBatches?: boolean } = {}) {
  guard(ctx, "pharmacy.medicines");
  const v = parseOrThrow(medicineSchema, raw); const tdb = db(ctx);
  const cur = await tdb.medicine.findFirst({ where: { id } });
  if (!cur) throw new AppError("NOT_FOUND", { message: "Medicine not found." });
  const priceChanged = cur.purchasePriceMinor !== v.purchasePriceMinor || cur.sellingPriceMinor !== v.sellingPriceMinor || cur.taxRateBp !== v.taxRateBp;
  if (priceChanged && !v.priceChangeReason) throw new AppError("VALIDATION_ERROR", { message: "Give a reason for the price change.", fieldErrors: { priceChangeReason: "Give a reason for the price change." } });
  const { priceChangeReason, ...d } = v;
  await tdb.$transaction(async (tx: Client) => {
    await tx.medicine.update({ where: { id }, data: { ...d, brandName: d.brandName ?? null, strength: d.strength ?? null, dosageForm: d.dosageForm ?? null, route: d.route ?? null, manufacturer: d.manufacturer ?? null, category: d.category ?? null, packSize: d.packSize ?? null, barcode: d.barcode ?? null, maximumStock: d.maximumStock ?? null, notes: d.notes ?? null } });
    if (opts.applyToBatches && cur.sellingPriceMinor !== d.sellingPriceMinor) await tx.medicineBatch.updateMany({ where: { medicineId: id, tenantId: ctx.tenantId }, data: { sellingPriceMinor: d.sellingPriceMinor } });
  });
  await audit(ctx, AUDIT_ACTIONS.MEDICINE_EDITED, "medicine", id, { code: cur.medicineCode });
  if (priceChanged) await audit(ctx, AUDIT_ACTIONS.MEDICINE_PRICE_CHANGED, "medicine", id, { oldPurchaseMinor: cur.purchasePriceMinor, newPurchaseMinor: d.purchasePriceMinor, oldSellingMinor: cur.sellingPriceMinor, newSellingMinor: d.sellingPriceMinor, oldTaxBp: cur.taxRateBp, newTaxBp: d.taxRateBp, reason: priceChangeReason ?? null, appliedToBatches: !!opts.applyToBatches });
  if (cur.reorderLevel !== d.reorderLevel || cur.minimumStock !== d.minimumStock || cur.maximumStock !== (d.maximumStock ?? null)) await audit(ctx, AUDIT_ACTIONS.MEDICINE_THRESHOLD_CHANGED, "medicine", id, { oldReorder: cur.reorderLevel, newReorder: d.reorderLevel, oldMinimum: cur.minimumStock, newMinimum: d.minimumStock, oldMaximum: cur.maximumStock, newMaximum: d.maximumStock ?? null });
  return { id };
}

/* ------------------------------------------------- suppliers ------------------------------------------------- */
export async function listSuppliers(ctx: TenantRequestContext, q: { q?: string; all?: boolean; page?: number } = {}) {
  guard(ctx, "pharmacy.view", "pharmacy.purchase", "pharmacy.suppliers"); const tdb = db(ctx);
  const text = (q.q ?? "").trim().slice(0, 60); const page = Math.max(1, Math.floor(q.page ?? 1));
  const where: Record<string, unknown> = { ...(q.all ? {} : { active: true }), ...(text ? { OR: [{ supplierName: containsCI(text) }, { supplierCode: containsCI(text) }, { phone: containsCI(text) }] } : {}) };
  const [total, rows] = await Promise.all([tdb.supplier.count({ where }), tdb.supplier.findMany({ where, orderBy: { supplierName: "asc" }, skip: (page - 1) * PAGE, take: PAGE })]);
  return { rows: rows as { id: string; supplierCode: string; supplierName: string; contactPerson: string | null; phone: string | null; email: string | null; address: string | null; taxId: string | null; paymentTerms: string | null; active: boolean; notes: string | null }[], total: total as number, page, pageSize: PAGE };
}
export async function saveSupplier(ctx: TenantRequestContext, id: string | null, raw: unknown) {
  guard(ctx, "pharmacy.suppliers");
  const v = parseOrThrow(supplierSchema, raw); const tdb = db(ctx);
  const data = { supplierName: v.supplierName, contactPerson: v.contactPerson ?? null, phone: v.phone ?? null, email: v.email ?? null, address: v.address ?? null, taxId: v.taxId ?? null, paymentTerms: v.paymentTerms ?? null, active: v.active, notes: v.notes ?? null };
  if (id) {
    const cur = await tdb.supplier.findFirst({ where: { id } });
    if (!cur) throw new AppError("NOT_FOUND", { message: "Supplier not found." });
    await tdb.supplier.update({ where: { id }, data });
    await audit(ctx, AUDIT_ACTIONS.SUPPLIER_EDITED, "supplier", id, { code: cur.supplierCode });
    return { id, supplierCode: cur.supplierCode as string };
  }
  const out = await tdb.$transaction(async (tx: Client) => { const n = await nextCounter(tx, ctx.tenantId, "sup"); return tx.supplier.create({ data: { ...data, tenantId: ctx.tenantId, supplierCode: `SUP-${pad(n)}` }, select: { id: true, supplierCode: true } }); });
  await audit(ctx, AUDIT_ACTIONS.SUPPLIER_CREATED, "supplier", out.id, { code: out.supplierCode });
  return { id: out.id as string, supplierCode: out.supplierCode as string };
}
/** Purchase history for one supplier (not supplier accounting). */
export async function getSupplier(ctx: TenantRequestContext, id: string) {
  guard(ctx, "pharmacy.view", "pharmacy.purchase", "pharmacy.suppliers"); const tdb = db(ctx);
  const s = await tdb.supplier.findFirst({ where: { id } });
  if (!s) throw new AppError("NOT_FOUND", { message: "Supplier not found." });
  const purchases = (await tdb.purchase.findMany({ where: { supplierId: id }, orderBy: { createdAt: "desc" }, take: 50, select: { id: true, purchaseNumber: true, supplierInvoiceNumber: true, purchaseDate: true, totalMinor: true, status: true } })) as { id: string; purchaseNumber: string; supplierInvoiceNumber: string | null; purchaseDate: string; totalMinor: number; status: string }[];
  const agg = await tdb.purchase.aggregate({ where: { supplierId: id, status: { in: ["RECEIVED", "COMPLETED"] } }, _sum: { totalMinor: true }, _count: { _all: true } });
  const items = (await tdb.purchaseItem.findMany({ where: { purchase: { is: { supplierId: id, status: { in: ["RECEIVED", "COMPLETED"] } } } }, select: { medicine: { select: { genericName: true, brandName: true, strength: true } } }, take: 400 })) as { medicine: { genericName: string; brandName: string | null; strength: string | null } }[];
  const medicines = [...new Set(items.map((i) => [i.medicine.brandName ?? i.medicine.genericName, i.medicine.strength].filter(Boolean).join(" ")))].sort();
  return { supplier: s as Record<string, unknown> & { id: string; supplierCode: string; supplierName: string }, purchases, totalPurchasedMinor: (agg._sum.totalMinor ?? 0) as number, purchaseCount: agg._count._all as number, medicines };
}
