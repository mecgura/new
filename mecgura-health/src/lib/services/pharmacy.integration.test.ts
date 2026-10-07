import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { addDays, todayIn } from "@/lib/scheduling/time";
import { allocateFefo, batchDisplayStatus, computePurchase, daysRemaining, expiryState, fefoOrder, itemKeys, ledgerBalance, medicineMatchesItem, prescribedUnits } from "@/lib/pharmacy/stock";
import { renderPharmacyDoc } from "@/lib/pharmacy/pharmacy-html";
import { asTenant, ctxFor, makeUser, seedSystemData, uniq } from "@/test/helpers";
import type { RoleKey } from "@/lib/permissions";
import { registerVisit } from "./opd";
import { registerPatient } from "./patient-crm";
import { saveSchedule } from "./schedule";
import { consultationAction, getConsultation, patchConsultation, startConsultation } from "./consultation";
import { savePrescriptionDraft } from "./prescription";
import { getInvoice } from "./billing-invoices";
import { recordPayment } from "./billing-payments";
import { patientBilling } from "./billing-docs";
import { patientTimeline as getPatientTimeline } from "./patient-crm";
import { getMedicine, createMedicine, getPharmacySettings, getSupplier, listConfig, listMedicines, listSuppliers, medicineAvailability, pickMedicines, saveConfigItem, savePharmacySettings, saveSupplier, updateMedicine } from "./pharmacy-master";
import { addOpeningStock, adjustStock, applyCount, cancelCount, cancelPurchase, completePurchase, createPurchase, getBatch, getCount, getPurchase, listBatches, listLedger, listPurchases, reconcileStock, receivePurchase, recordDamage, returnToSupplier, saveCountLines, setBatchBlocked, startCount, updatePurchase, writeOffExpired } from "./pharmacy-inventory";
import { cancelDispensing, dispense, getDispensing, getPrescriptionForDispensing, listDispensings, listReturns, patientPharmacy, prescriptionQueue, requestReturn, returnAction } from "./pharmacy-dispensing";
import { exportPharmacyReport, pharmacyDashboard, pharmacyReport, REPORT_KINDS } from "./pharmacy-reports";
import { pharmacyDocument, recordPharmacyDocAccess } from "./pharmacy-docs";

const TZ = "Asia/Kolkata";
const code = (p: Promise<unknown>) => p.then(() => "ok", (e) => (e instanceof AppError ? e.code : `ERR:${e}`));
type Ctx = ReturnType<typeof asTenant>;
interface T { id: string; admin: Ctx; manager: Ctx; staff: Ctx; doctor: Ctx; recep: Ctx; accountant: Ctx; nurse: Ctx; lab: Ctx; superAdmin: Ctx; doctorId: string; managerId: string; staffId: string; supplier: string }
const today = () => todayIn(TZ);
let keyN = 0; const key = () => `idem-${Date.now().toString(36)}-${++keyN}-pharm`;

async function mkTenant(label: string): Promise<T> {
  const t = await db.tenant.create({ data: { name: `Pharm Clinic ${label}`, slug: uniq(`ph-${label}`).slice(0, 30), status: "ACTIVE", address: "1 Test Road", city: "Testville", contactPhone: "+911234500000" } });
  const mk = async (role: RoleKey) => { const { user } = await makeUser(role, t.id); const b = ctxFor(user, role, t.id); return { user, ctx: asTenant({ ...b, tenant: { ...b.tenant!, name: `Pharm Clinic ${label}`, timezone: TZ, address: "1 Test Road", city: "Testville", contactPhone: "+911234500000", logoUrl: null, brand: { primary: "#0e7c86", secondary: "#000000", accent: "#000000" } } as never }) }; };
  const [a, m, s, d, r, ac, n, l] = [await mk("CLINIC_ADMIN"), await mk("PHARMACY_MANAGER"), await mk("PHARMACY_STAFF"), await mk("DOCTOR"), await mk("RECEPTIONIST"), await mk("ACCOUNTANT"), await mk("NURSE"), await mk("LAB_STAFF")];
  const sa = await makeUser("SUPER_ADMIN", null);
  await saveSchedule(a.ctx, d.user.id, { slotMinutes: 15, bufferMinutes: 0, onlineBooking: false, advanceDays: 30, minNoticeMinutes: 0, windows: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, start: "09:00", end: "17:00" })) });
  await db.doctorProfile.upsert({ where: { userId: d.user.id }, update: { qualification: "MBBS (test)", specialization: "General practice (test)", registrationNumber: "TEST-REG-1" }, create: { tenantId: t.id, userId: d.user.id, qualification: "MBBS (test)", specialization: "General practice (test)", registrationNumber: "TEST-REG-1" } });
  const sup = await saveSupplier(m.ctx, null, { supplierName: "Test Supplier (synthetic)", phone: "9000000001" });
  return { id: t.id, admin: a.ctx, manager: m.ctx, staff: s.ctx, doctor: d.ctx, recep: r.ctx, accountant: ac.ctx, nurse: n.ctx, lab: l.ctx, superAdmin: asTenant({ ...ctxFor(sa.user, "SUPER_ADMIN", t.id), viewingAs: true }), doctorId: d.user.id, managerId: m.user.id, staffId: s.user.id, supplier: sup.id };
}
let phoneN = 0;
const FAR = () => addDays(today(), 400);
async function mkMed(t: T, over: Record<string, unknown> = {}) {
  const n = ++keyN;
  return createMedicine(t.manager, { genericName: `Testgeneric${n}`, brandName: `Testbrand${n}`, strength: "500 mg", dosageForm: "Tablet", manufacturer: "Synthetic Pharma", category: "Analgesic", unit: "tablet", reorderLevel: 10, minimumStock: 5, maximumStock: 200, purchasePriceMinor: 100, sellingPriceMinor: 200, taxRateBp: 500, ...over }) as Promise<{ id: string; medicineCode: string }>;
}
/** stock in through the real purchase → receive workflow */
async function stockIn(t: T, medicineId: string, batchNumber: string, qty: number, expiryDate = FAR(), extra: Record<string, unknown> = {}) {
  const p = await createPurchase(t.manager, { supplierId: t.supplier, items: [{ medicineId, batchNumber, expiryDate, quantity: qty, unitPurchasePriceMinor: 100, sellingPriceMinor: 200, taxRateBp: 500, ...extra }] });
  await receivePurchase(t.manager, p.id);
  const b = await db.medicineBatch.findFirstOrThrow({ where: { tenantId: t.id, medicineId, batchNumber } });
  return { purchaseId: p.id, batchId: b.id };
}
/** an expired batch can't be received through a purchase (correct), so history is seeded with opening stock + a back-dated expiry */
async function expiredBatch(t: T, medicineId: string, batchNumber: string, qty: number) {
  const { batchId } = await addOpeningStock(t.admin, { medicineId, batchNumber, expiryDate: addDays(today(), -5), quantity: qty, purchasePriceMinor: 100, sellingPriceMinor: 200 });
  return batchId;
}
const rxItem = (name: string, quantity: number | null, over: Record<string, unknown> = {}) => ({ name, strength: "500 mg", dose: "1 tablet", frequency: "Twice daily", morning: true, night: true, foodTiming: "AFTER_FOOD", durationDays: 5, quantity, instructions: "Take with water", ...over });
/** a real finalized prescription (Phase 5 workflow) */
async function finalizedRx(t: T, items: Record<string, unknown>[]) {
  await db.opdVisit.updateMany({ where: { tenantId: t.id, doctorUserId: t.doctorId, status: { in: ["CALLED", "IN_CONSULTATION"] } }, data: { status: "COMPLETED" } });
  const p = await registerPatient(t.recep, { name: "Pharm Patient", phone: `95${String(50000000 + ++phoneN * 13).slice(0, 8)}`, allowDuplicate: true, dateOfBirth: "1985-05-05", gender: "FEMALE" });
  const v = await registerVisit(t.recep, { patient: { patientId: p.id, viaProfile: true }, doctorUserId: t.doctorId });
  const c = await startConsultation(t.doctor, v.id);
  const cur = await getConsultation(t.doctor, c.id);
  await patchConsultation(t.doctor, c.id, { rev: cur.rev, chiefComplaints: [{ text: "Cough", duration: "5 days" }], clinicalNotes: "Private clinical note" });
  await savePrescriptionDraft(t.doctor, c.id, { items });
  await consultationAction(t.doctor, c.id, { action: "review" });
  await consultationAction(t.doctor, c.id, { action: "finalize", confirm: true });
  const rx = await db.prescription.findFirstOrThrow({ where: { consultationId: c.id }, include: { items: { orderBy: { position: "asc" } } } });
  return { patientId: p.id as string, consultationId: c.id as string, prescriptionId: rx.id as string, itemIds: rx.items.map((i: { id: string }) => i.id) as string[] };
}
const line = (itemId: string, medicineId: string, quantity: number, extra: Record<string, unknown> = {}) => ({ prescriptionItemId: itemId, medicineId, quantity, ...extra });
const disp = (who: Ctx, rxId: string, items: Record<string, unknown>[], extra: Record<string, unknown> = {}) => dispense(who, rxId, { idempotencyKey: key(), items, ...extra });
const qty = async (batchId: string) => (await db.medicineBatch.findUniqueOrThrow({ where: { id: batchId } })).quantityAvailable;

let A: T, B: T;
beforeAll(async () => { await seedSystemData(); A = await mkTenant("a"); B = await mkTenant("b"); });

describe("pure stock rules", () => {
  it("expiry classification uses a configurable near-expiry window", () => {
    expect(expiryState("2026-01-10", "2026-01-11", 30)).toBe("EXPIRED");
    expect(expiryState("2026-01-11", "2026-01-11", 30)).toBe("NEAR_EXPIRY"); // valid through the expiry date
    expect(expiryState("2026-02-10", "2026-01-11", 30)).toBe("NEAR_EXPIRY"); expect(expiryState("2026-02-11", "2026-01-11", 30)).toBe("VALID");
    expect(expiryState("2026-04-11", "2026-01-11", 60)).toBe("VALID"); expect(expiryState("2026-02-20", "2026-01-11", 60)).toBe("NEAR_EXPIRY");
    expect(daysRemaining("2026-11-15", "2026-10-21")).toBe(25);
  });
  it("batch display status", () => {
    const b = (o: Record<string, unknown>) => ({ id: "x", status: "ACTIVE", expiryDate: "2030-01-01", quantityAvailable: 50, ...o });
    expect(batchDisplayStatus(b({}), "2026-01-01", 10)).toBe("ACTIVE"); expect(batchDisplayStatus(b({ quantityAvailable: 5 }), "2026-01-01", 10)).toBe("LOW_STOCK");
    expect(batchDisplayStatus(b({ quantityAvailable: 0 }), "2026-01-01", 10)).toBe("DEPLETED"); expect(batchDisplayStatus(b({ expiryDate: "2025-01-01" }), "2026-01-01", 10)).toBe("EXPIRED");
    expect(batchDisplayStatus(b({ status: "BLOCKED" }), "2026-01-01", 10)).toBe("BLOCKED");
  });
  it("FEFO: earliest expiry first, never expired / blocked / empty", () => {
    const bs = [{ id: "b", status: "ACTIVE", expiryDate: "2027-05-01", quantityAvailable: 50, batchNumber: "B" }, { id: "a", status: "ACTIVE", expiryDate: "2026-11-01", quantityAvailable: 20, batchNumber: "A" }, { id: "x", status: "ACTIVE", expiryDate: "2026-01-01", quantityAvailable: 99, batchNumber: "X" }, { id: "k", status: "BLOCKED", expiryDate: "2026-10-01", quantityAvailable: 99, batchNumber: "K" }, { id: "e", status: "ACTIVE", expiryDate: "2026-12-01", quantityAvailable: 0, batchNumber: "E" }];
    expect(fefoOrder(bs, "2026-06-01").map((b) => b.id)).toEqual(["a", "b"]);
    expect(allocateFefo(bs, 30, "2026-06-01")).toEqual({ allocations: [{ batchId: "a", quantity: 20 }, { batchId: "b", quantity: 10 }], short: 0 });
    expect(allocateFefo(bs, 100, "2026-06-01").short).toBe(30); expect(allocateFefo(bs, 5, "2026-06-01").allocations).toEqual([{ batchId: "a", quantity: 5 }]);
  });
  it("purchase totals are integer minor units, tax on the discounted amount, free stock costs nothing", () => {
    const r = computePurchase([{ quantity: 10, unitPurchasePriceMinor: 1999, taxRateBp: 1200, discountMinor: 999 }, { quantity: 3, unitPurchasePriceMinor: 333, taxRateBp: 0, discountMinor: 0 }]);
    expect(r.subtotalMinor).toBe(19990 + 999); expect(r.discountMinor).toBe(999); expect(r.taxMinor).toBe(Math.round((19990 - 999) * 0.12)); expect(r.totalMinor).toBe(r.subtotalMinor - r.discountMinor + r.taxMinor);
    expect(() => computePurchase([{ quantity: 999999, unitPurchasePriceMinor: 2_000_000_000, taxRateBp: 0, discountMinor: 0 }])).toThrow();
  });
  it("matching is exact (generic or brand) and never fuzzy; keys survive duplicates", () => {
    const m = { genericName: "Paracetamol", brandName: "Crocin", strength: "500 mg" };
    expect(medicineMatchesItem(m, { name: "paracetamol", genericName: null, brandName: null, strength: "500mg" })).toBe(true);
    expect(medicineMatchesItem(m, { name: "Crocin", genericName: null, brandName: null, strength: null })).toBe(true);
    expect(medicineMatchesItem(m, { name: "Paracetamol", genericName: null, brandName: null, strength: "650 mg" })).toBe(false);
    expect(medicineMatchesItem(m, { name: "Paracet", genericName: null, brandName: null, strength: null })).toBe(false);
    expect(medicineMatchesItem(m, { name: "Ibuprofen", genericName: null, brandName: null, strength: "500 mg" })).toBe(false);
    expect(itemKeys([{ name: "A", strength: "1" }, { name: "a ", strength: "1" }, { name: "B", strength: null }])).toEqual(["a|1#0", "a|1#1", "b|#0"]);
    expect(prescribedUnits(10.2)).toBe(11); expect(prescribedUnits(null)).toBe(0); expect(ledgerBalance([{ quantity: 5 }, { quantity: -2 }])).toBe(3);
  });
});

describe("medicine master (1, 2)", () => {
  it("creates medicines with tenant-scoped immutable codes and validates input", async () => {
    const a = await mkMed(A); const a2 = await mkMed(A);
    expect(a.medicineCode).toMatch(/^MED-\d{6}$/); expect(Number(a2.medicineCode.slice(4))).toBe(Number(a.medicineCode.slice(4)) + 1);
    const row = await db.medicine.findUniqueOrThrow({ where: { id: a.id } });
    expect(row).toMatchObject({ tenantId: A.id, prescriptionRequired: true, active: true });
    await updateMedicine(A.manager, a.id, { genericName: "Renamed generic", unit: "tablet", reorderLevel: 10, minimumStock: 5, maximumStock: 200, purchasePriceMinor: 100, sellingPriceMinor: 200, taxRateBp: 500 });
    expect((await db.medicine.findUniqueOrThrow({ where: { id: a.id } })).medicineCode).toBe(a.medicineCode);
    for (const bad of [{ genericName: "" }, { genericName: "Ok name", sellingPriceMinor: -1 }, { genericName: "Ok name", taxRateBp: 10001 }, { genericName: "Ok name", reorderLevel: 50, maximumStock: 10 }, { genericName: "Ok name", sellingPriceMinor: 1.5 }]) expect(await code(createMedicine(A.manager, bad))).toBe("VALIDATION_ERROR");
    const b = await mkMed(B); expect(b.medicineCode).toMatch(/^MED-\d{6}$/);
    expect(await db.auditLog.count({ where: { tenantId: A.id, entityId: a.id, action: "pharmacy.medicine_created" } })).toBe(1);
  });
  it("searches server-side by code, generic, brand, strength, manufacturer and barcode, with pagination", async () => {
    const m = await mkMed(A, { genericName: "Zyxoprazole", brandName: "Zyxo-Brand", strength: "77 mg", manufacturer: "Quillix Labs", barcode: "8901234567890" });
    for (const q of [m.medicineCode, "zyxoprazole", "zyxo-brand", "77 mg", "quillix", "8901234567890"]) { const r = await listMedicines(A.manager, { q }); expect(r.rows.some((x) => x.id === m.id), q).toBe(true); }
    expect((await listMedicines(B.manager, { q: "zyxoprazole" })).total).toBe(0);
    for (let i = 0; i < 22; i++) await mkMed(A, { genericName: `Pagetest ${i}` });
    const p1 = await listMedicines(A.manager, { q: "Pagetest", page: 1 }); const p2 = await listMedicines(A.manager, { q: "Pagetest", page: 2 });
    expect(p1.rows).toHaveLength(20); expect(p2.rows).toHaveLength(2); expect(p1.total).toBe(22);
    expect((await pickMedicines(A.manager, "zyxo")).rows.map((x) => x.id)).toContain(m.id); expect((await pickMedicines(A.manager, "z")).rows).toEqual([]);
  });
  it("configurable lists (dosage forms, categories, units) belong to the clinic", async () => {
    const c = await listConfig(A.admin); expect(c.dosageForms.map((x) => x.name)).toContain("Tablet"); expect(c.categories.length).toBeGreaterThan(0);
    await saveConfigItem(A.admin, null, { kind: "DOSAGE_FORM", name: "Lozenge" }); expect((await listConfig(A.admin)).dosageForms.map((x) => x.name)).toContain("Lozenge");
    expect((await listConfig(B.admin)).dosageForms.map((x) => x.name)).not.toContain("Lozenge");
    expect(await code(saveConfigItem(A.admin, null, { kind: "DOSAGE_FORM", name: "Lozenge" }))).toBe("CONFLICT");
    expect(await code(saveConfigItem(A.manager, null, { kind: "CATEGORY", name: "Nope" }))).toBe("FORBIDDEN");
  });
  it("price changes are audited with old/new values and a reason; thresholds too; old bills keep their snapshot", async () => {
    const m = await mkMed(A, { sellingPriceMinor: 200 });
    const full = (o: Record<string, unknown>) => ({ genericName: "Price test", unit: "tablet", reorderLevel: 10, minimumStock: 5, maximumStock: 200, purchasePriceMinor: 100, sellingPriceMinor: 200, taxRateBp: 500, ...o });
    expect(await code(updateMedicine(A.manager, m.id, full({ sellingPriceMinor: 300 })))).toBe("VALIDATION_ERROR"); // reason needed
    await updateMedicine(A.manager, m.id, full({ sellingPriceMinor: 300, priceChangeReason: "Supplier increased MRP", reorderLevel: 20 }));
    const log = await db.auditLog.findFirstOrThrow({ where: { tenantId: A.id, entityId: m.id, action: "pharmacy.price_changed" } });
    expect(JSON.parse(String(log.metadata))).toMatchObject({ oldSellingMinor: 200, newSellingMinor: 300, reason: "Supplier increased MRP" });
    expect(await db.auditLog.count({ where: { tenantId: A.id, entityId: m.id, action: "pharmacy.threshold_changed" } })).toBe(1);
    expect(await code(updateMedicine(A.staff, m.id, full({})))).toBe("FORBIDDEN");
  });
});

describe("suppliers (3)", () => {
  it("creates tenant-scoped supplier codes and shows purchase history without accounting", async () => {
    const s = await saveSupplier(A.manager, null, { supplierName: "Second Supplier (synthetic)" });
    expect(s.supplierCode).toMatch(/^SUP-\d{6}$/);
    const m = await mkMed(A); await stockIn(A, m.id, uniq("SB"), 10);
    const h = await getSupplier(A.manager, A.supplier); expect(h.purchaseCount).toBeGreaterThan(0); expect(h.totalPurchasedMinor).toBeGreaterThan(0); expect(h.purchases[0].purchaseNumber).toMatch(/^PUR-/);
    expect((await listSuppliers(B.manager, { q: "Second Supplier" })).total).toBe(0);
    expect(await code(saveSupplier(A.staff, null, { supplierName: "Not allowed" }))).toBe("FORBIDDEN"); expect(await code(saveSupplier(A.manager, null, { supplierName: "x" }))).toBe("VALIDATION_ERROR");
    expect(await code(getSupplier(B.manager, A.supplier))).toBe("NOT_FOUND");
  });
});

describe("purchases, batches and the ledger (4–7, 9)", () => {
  it("creates, edits, receives and completes a purchase; every received unit is in the ledger", async () => {
    const m = await mkMed(A);
    const p = await createPurchase(A.manager, { supplierId: A.supplier, supplierInvoiceNumber: uniq("SI"), items: [{ medicineId: m.id, batchNumber: "LOT-1", expiryDate: FAR(), quantity: 100, freeQuantity: 10, unitPurchasePriceMinor: 150, sellingPriceMinor: 250, taxRateBp: 500, discountMinor: 500 }] });
    expect(p.purchaseNumber).toMatch(/^PUR-\d{4}-\d{6}$/);
    const d = await getPurchase(A.manager, p.id); expect(d).toMatchObject({ status: "DRAFT", subtotalMinor: 15000, discountMinor: 500, taxMinor: 725, totalMinor: 15225 });
    await updatePurchase(A.manager, p.id, { supplierId: A.supplier, items: [{ medicineId: m.id, batchNumber: "LOT-1", expiryDate: FAR(), quantity: 100, freeQuantity: 10, unitPurchasePriceMinor: 150, sellingPriceMinor: 250, taxRateBp: 500 }] });
    expect((await getPurchase(A.manager, p.id)).totalMinor).toBe(15750);
    expect(await db.medicineBatch.count({ where: { tenantId: A.id, medicineId: m.id } })).toBe(0); // draft adds no stock
    await receivePurchase(A.manager, p.id);
    const b = await db.medicineBatch.findFirstOrThrow({ where: { tenantId: A.id, medicineId: m.id } });
    expect(b).toMatchObject({ batchNumber: "LOT-1", quantityReceived: 110, quantityAvailable: 110, purchasePriceMinor: 150, sellingPriceMinor: 250 });
    const led = await db.stockTransaction.findMany({ where: { batchId: b.id } }); expect(led).toHaveLength(1); expect(led[0]).toMatchObject({ type: "PURCHASE", quantity: 110, balanceAfter: 110, referenceType: "PURCHASE", referenceId: p.id });
    expect(await code(receivePurchase(A.manager, p.id))).toBe("CONFLICT"); expect(await db.stockTransaction.count({ where: { batchId: b.id } })).toBe(1);
    expect(await code(updatePurchase(A.manager, p.id, { supplierId: A.supplier, items: [] }))).toBe("VALIDATION_ERROR");
    expect(await code(cancelPurchase(A.manager, p.id, { reason: "oops" }))).toBe("CONFLICT");
    await completePurchase(A.manager, p.id); expect((await getPurchase(A.manager, p.id)).status).toBe("COMPLETED");
    expect(await code(completePurchase(A.manager, p.id))).toBe("CONFLICT");
    expect((await getPurchase(A.manager, p.id)).purchaseNumber).toBe(p.purchaseNumber);
    expect(await db.auditLog.count({ where: { tenantId: A.id, entityId: p.id, action: { in: ["pharmacy.purchase_created", "pharmacy.purchase_received", "pharmacy.purchase_completed"] } } })).toBe(3);
  });
  it("validates purchases: duplicate supplier invoice, duplicate batch lines, expired batch, mismatching expiry, drafts can be cancelled", async () => {
    const m = await mkMed(A); const si = uniq("DUP");
    const base = { medicineId: m.id, batchNumber: "VAL-1", expiryDate: FAR(), quantity: 5, unitPurchasePriceMinor: 100, sellingPriceMinor: 200 };
    await createPurchase(A.manager, { supplierId: A.supplier, supplierInvoiceNumber: si, items: [base] });
    expect(await code(createPurchase(A.manager, { supplierId: A.supplier, supplierInvoiceNumber: si, items: [base] }))).toBe("CONFLICT");
    expect(await code(createPurchase(A.manager, { supplierId: A.supplier, items: [base, base] }))).toBe("VALIDATION_ERROR");
    expect(await code(createPurchase(A.manager, { supplierId: A.supplier, items: [{ ...base, quantity: 0 }] }))).toBe("VALIDATION_ERROR");
    expect(await code(createPurchase(A.manager, { supplierId: A.supplier, items: [{ ...base, expiryDate: "2030-02-31" }] }))).toBe("VALIDATION_ERROR");
    expect(await code(createPurchase(A.manager, { supplierId: B.supplier, items: [base] }))).toBe("VALIDATION_ERROR");
    const exp = await createPurchase(A.manager, { supplierId: A.supplier, items: [{ ...base, batchNumber: "OLD-1", expiryDate: addDays(today(), -1) }] });
    expect(await code(receivePurchase(A.manager, exp.id))).toBe("VALIDATION_ERROR"); expect(await db.medicineBatch.count({ where: { tenantId: A.id, medicineId: m.id } })).toBe(0);
    await stockIn(A, m.id, "SAME-1", 10);
    const clash = await createPurchase(A.manager, { supplierId: A.supplier, items: [{ ...base, batchNumber: "SAME-1", expiryDate: addDays(FAR(), 30) }] });
    expect(await code(receivePurchase(A.manager, clash.id))).toBe("CONFLICT");
    const again = await createPurchase(A.manager, { supplierId: A.supplier, items: [{ ...base, batchNumber: "SAME-1", expiryDate: FAR(), quantity: 7 }] });
    await receivePurchase(A.manager, again.id); expect((await db.medicineBatch.findFirstOrThrow({ where: { tenantId: A.id, medicineId: m.id, batchNumber: "SAME-1" } })).quantityAvailable).toBe(17); // same batch extended, not duplicated
    await cancelPurchase(A.manager, exp.id, { reason: "Wrong entry" }); expect((await getPurchase(A.manager, exp.id)).status).toBe("CANCELLED"); expect(await code(receivePurchase(A.manager, exp.id))).toBe("CONFLICT");
    expect((await listPurchases(A.manager, { status: "CANCELLED" })).rows.some((r) => r.id === exp.id)).toBe(true);
  });
  it("opening stock is admin-only, creates an OPENING ledger row and can't overwrite an existing batch", async () => {
    const m = await mkMed(A);
    expect(await code(addOpeningStock(A.manager, { medicineId: m.id, batchNumber: "OP-1", expiryDate: FAR(), quantity: 5, purchasePriceMinor: 100, sellingPriceMinor: 200 }))).toBe("FORBIDDEN");
    const { batchId } = await addOpeningStock(A.admin, { medicineId: m.id, batchNumber: "OP-1", expiryDate: FAR(), quantity: 40, purchasePriceMinor: 100, sellingPriceMinor: 200 });
    expect(await db.stockTransaction.findMany({ where: { batchId } })).toMatchObject([{ type: "OPENING", quantity: 40, balanceAfter: 40 }]);
    expect(await code(addOpeningStock(A.admin, { medicineId: m.id, batchNumber: "OP-1", expiryDate: FAR(), quantity: 5, purchasePriceMinor: 100, sellingPriceMinor: 200 }))).toBe("CONFLICT");
    expect(await code(addOpeningStock(A.admin, { medicineId: m.id, batchNumber: "OP-2", expiryDate: FAR(), quantity: 0, purchasePriceMinor: 100, sellingPriceMinor: 200 }))).toBe("VALIDATION_ERROR");
  });
  it("adjustments need permission, reason and notes, never go below zero, and every change has a ledger row", async () => {
    const m = await mkMed(A); const { batchId } = await stockIn(A, m.id, "ADJ-1", 50);
    expect(await code(adjustStock(A.staff, { batchId, direction: "OUT", quantity: 1, reason: "DATA_CORRECTION", notes: "no" }))).toBe("FORBIDDEN");
    expect(await code(adjustStock(A.manager, { batchId, direction: "OUT", quantity: 1, reason: "OTHER" }))).toBe("VALIDATION_ERROR");
    expect(await code(adjustStock(A.manager, { batchId, direction: "OUT", quantity: 51, reason: "DATA_CORRECTION", notes: "too many" }))).toBe("CONFLICT");
    expect((await adjustStock(A.manager, { batchId, direction: "OUT", quantity: 3, reason: "PHYSICAL_COUNT_CORRECTION", notes: "count was short" })).balanceAfter).toBe(47);
    expect((await adjustStock(A.manager, { batchId, direction: "IN", quantity: 2, reason: "DATA_CORRECTION", notes: "found two" })).balanceAfter).toBe(49);
    expect(await qty(batchId)).toBe(49);
    const led = await db.stockTransaction.findMany({ where: { batchId }, orderBy: { createdAt: "asc" } }); expect(led.map((l: { type: string }) => l.type)).toEqual(["PURCHASE", "ADJUSTMENT_OUT", "ADJUSTMENT_IN"]);
    expect(await db.auditLog.count({ where: { tenantId: A.id, entityId: batchId, action: "pharmacy.stock_adjusted" } })).toBe(2);
    const detail = await getBatch(A.manager, batchId); expect(detail.ledgerConsistent).toBe(true); expect(detail.transactions).toHaveLength(3); expect(detail.transactions.map((t) => t.balanceAfter)).toEqual([50, 47, 49]);
  });
  it("physical count shows system vs physical, needs reasons, applies adjustments and refuses stale lines", async () => {
    const m = await mkMed(A); const { batchId } = await stockIn(A, m.id, "CNT-1", 100);
    const c = await startCount(A.manager, { medicineId: m.id }); const det = await getCount(A.manager, c.id);
    expect(det.lines).toEqual([expect.objectContaining({ batchId, systemQuantity: 100, physicalQuantity: null })]);
    await saveCountLines(A.manager, c.id, { lines: [{ batchId, physicalQuantity: 97 }] });
    expect(await code(applyCount(A.manager, c.id))).toBe("VALIDATION_ERROR"); // difference without reason
    await saveCountLines(A.manager, c.id, { lines: [{ batchId, physicalQuantity: 97, reason: "3 strips damaged in storage" }] });
    expect(await qty(batchId)).toBe(100); // saving a count never touches stock
    expect((await applyCount(A.manager, c.id)).adjusted).toBe(1); expect(await qty(batchId)).toBe(97);
    expect(await db.stockTransaction.findFirstOrThrow({ where: { batchId, type: "ADJUSTMENT_OUT" } })).toMatchObject({ quantity: -3, referenceType: "COUNT", reason: "PHYSICAL_COUNT_CORRECTION" });
    expect((await getCount(A.manager, c.id)).lines[0]).toMatchObject({ difference: -3 }); expect(await code(applyCount(A.manager, c.id))).toBe("CONFLICT");
    const c2 = await startCount(A.manager, { medicineId: m.id }); await saveCountLines(A.manager, c2.id, { lines: [{ batchId, physicalQuantity: 90, reason: "recount" }] });
    await adjustStock(A.manager, { batchId, direction: "OUT", quantity: 1, reason: "OTHER", notes: "moved while counting" });
    expect(await code(applyCount(A.manager, c2.id))).toBe("CONFLICT"); expect(await qty(batchId)).toBe(96);
    await cancelCount(A.manager, c2.id); expect(await code(startCount(A.staff, {}))).toBe("FORBIDDEN");
  });
  it("damage and expiry write-offs move stock out through the ledger; valid batches can't be written off as expired; blocking works", async () => {
    const m = await mkMed(A); const { batchId } = await stockIn(A, m.id, "DMG-1", 30);
    expect(await code(recordDamage(A.staff, { batchId, quantity: 2, reason: "dropped" }))).toBe("FORBIDDEN");
    await recordDamage(A.manager, { batchId, quantity: 4, reason: "Broken in transit" });
    expect(await db.medicineBatch.findUniqueOrThrow({ where: { id: batchId } })).toMatchObject({ quantityAvailable: 26, damagedQuantity: 4 });
    expect(await db.stockTransaction.findFirstOrThrow({ where: { batchId, type: "DAMAGE" } })).toMatchObject({ quantity: -4, reason: "Broken in transit" });
    expect(await code(recordDamage(A.manager, { batchId, quantity: 99, reason: "x1" }))).toBe("CONFLICT");
    expect(await code(writeOffExpired(A.manager, { batchId }))).toBe("CONFLICT");
    const eb = await expiredBatch(A, m.id, "EXP-OLD", 12);
    await writeOffExpired(A.manager, { batchId: eb });
    expect(await db.medicineBatch.findUniqueOrThrow({ where: { id: eb } })).toMatchObject({ quantityAvailable: 0, expiredQuantity: 12 }); // stays in history, not deleted
    expect(await db.stockTransaction.findFirstOrThrow({ where: { batchId: eb, type: "EXPIRY" } })).toMatchObject({ quantity: -12 });
    expect(await code(setBatchBlocked(A.manager, batchId, { block: true }))).toBe("VALIDATION_ERROR");
    await setBatchBlocked(A.manager, batchId, { block: true, reason: "Recall notice" });
    expect((await getMedicine(A.manager, m.id)).totals.available).toBe(0); // blocked stock isn't available
    await setBatchBlocked(A.manager, batchId, { block: false }); expect((await getMedicine(A.manager, m.id)).totals.available).toBe(26);
  });
  it("purchase return takes stock back to the supplier with a ledger row", async () => {
    const m = await mkMed(A); const { batchId } = await stockIn(A, m.id, "PR-1", 20);
    expect(await code(returnToSupplier(A.staff, { supplierId: A.supplier, batchId, quantity: 5, reason: "Wrong item" }))).toBe("FORBIDDEN");
    expect(await code(returnToSupplier(A.manager, { supplierId: A.supplier, batchId, quantity: 25, reason: "Too many" }))).toBe("CONFLICT");
    const r = await returnToSupplier(A.manager, { supplierId: A.supplier, batchId, quantity: 5, reason: "Wrong item", reference: "CN-77" });
    expect(r.returnNumber).toMatch(/^RET-\d{4}-\d{6}$/); expect(await qty(batchId)).toBe(15);
    expect(await db.stockTransaction.findFirstOrThrow({ where: { batchId, type: "PURCHASE_RETURN" } })).toMatchObject({ quantity: -5, referenceType: "RETURN", referenceId: r.id });
    expect(await db.auditLog.count({ where: { tenantId: A.id, entityId: r.id, action: "pharmacy.purchase_returned" } })).toBe(1);
  });
});

describe("stock levels, low stock, out of stock, expiry alerts (7, 8)", () => {
  it("low / out-of-stock come from real sellable batches, not expired or blocked ones", async () => {
    const low = await mkMed(A, { genericName: "Lowstockmed", reorderLevel: 10, minimumStock: 0 }); const out = await mkMed(A, { genericName: "Outstockmed", reorderLevel: 10 }); const ok = await mkMed(A, { genericName: "Okstockmed", reorderLevel: 10 });
    await stockIn(A, low.id, "L1", 8); await stockIn(A, ok.id, "O1", 80); await expiredBatch(A, out.id, "X1", 500);
    const ids = async (status: string) => (await listMedicines(A.manager, { status, q: "stockmed" })).rows.map((r) => r.id);
    expect(await ids("low")).toContain(low.id); expect(await ids("low")).not.toContain(ok.id);
    expect(await ids("out")).toContain(out.id); expect(await ids("out")).not.toContain(low.id);
    expect((await getMedicine(A.manager, out.id)).medicine).toMatchObject({ availableQuantity: 0, stockStatus: "OUT_OF_STOCK" }); expect((await getMedicine(A.manager, out.id)).totals.totalOnHand).toBe(500);
    const r = await pharmacyReport(A.manager, "low_stock"); expect(r.rows.map((x) => x.medicine)).toEqual(expect.arrayContaining([expect.stringContaining("Testbrand")]));
  });
  it("near-expiry threshold is configurable per clinic and drives the dashboard and expiry lists", async () => {
    const m = await mkMed(A); await stockIn(A, m.id, "NEAR-1", 10, addDays(today(), 45)); await expiredBatch(A, m.id, "GONE-1", 3);
    await savePharmacySettings(A.admin, { nearExpiryDays: 30, allowOverDispense: false, allowPatientReturns: false, returnWindowDays: 7 });
    expect((await listBatches(A.manager, { state: "near", q: "NEAR-1" })).rows).toHaveLength(0);
    await savePharmacySettings(A.admin, { nearExpiryDays: 60, allowOverDispense: false, allowPatientReturns: false, returnWindowDays: 7 });
    const near = await listBatches(A.manager, { state: "near", q: "NEAR-1" }); expect(near.rows).toHaveLength(1); expect(near.rows[0]).toMatchObject({ expiry: "NEAR_EXPIRY", daysRemaining: 45 });
    expect((await listBatches(A.manager, { state: "expired", q: "GONE-1" })).rows[0]).toMatchObject({ displayStatus: "EXPIRED", daysRemaining: -5 });
    const dash = await pharmacyDashboard(A.manager); expect(dash.nearExpiryDays).toBe(60); expect(dash.counts.nearExpiry).toBeGreaterThan(0); expect(dash.counts.expired).toBeGreaterThan(0);
    expect(await code(savePharmacySettings(A.manager, { nearExpiryDays: 10, allowOverDispense: false, allowPatientReturns: false, returnWindowDays: 7 }))).toBe("FORBIDDEN");
    expect(await code(savePharmacySettings(A.admin, { nearExpiryDays: 0, allowOverDispense: false, allowPatientReturns: false, returnWindowDays: 7 }))).toBe("VALIDATION_ERROR");
    await savePharmacySettings(A.admin, { nearExpiryDays: 90, allowOverDispense: false, allowPatientReturns: false, returnWindowDays: 7 });
  });
});

describe("prescription integration and dispensing (10–17, 19)", () => {
  it("only a finalized prescription can be dispensed; the prescription itself is never changed", async () => {
    const m = await mkMed(A, { genericName: "Rxmatch", brandName: null }); await stockIn(A, m.id, "RX-1", 100);
    const rx = await finalizedRx(A, [rxItem("Rxmatch", 10)]);
    const before = await db.prescription.findUniqueOrThrow({ where: { id: rx.prescriptionId }, include: { items: true } });
    const view = await getPrescriptionForDispensing(A.staff, rx.prescriptionId);
    expect(view.lines[0]).toMatchObject({ name: "Rxmatch", prescribedUnits: 10, dispensedUnits: 0, remainingUnits: 10 }); expect(view.lines[0].medicines.map((x) => x.id)).toEqual([m.id]); expect(view.lines[0].medicines[0].batches[0].batchNumber).toBe("RX-1");
    expect(view.patient?.name).toBe("Pharm Patient"); expect(JSON.stringify(view)).not.toContain("Private clinical note");
    const r = await disp(A.staff, rx.prescriptionId, [line(rx.itemIds[0], m.id, 10)]); expect(r.dispensingNumber).toMatch(/^DSP-\d{4}-\d{6}$/);
    const after = await db.prescription.findUniqueOrThrow({ where: { id: rx.prescriptionId }, include: { items: true } });
    expect(JSON.stringify(after)).toBe(JSON.stringify(before)); // same status, version, items, quantities
    // a prescription being amended (DRAFT again) can't be dispensed
    const m2 = await mkMed(A, { genericName: "Amendme", brandName: null }); await stockIn(A, m2.id, "AM-1", 20);
    const rx2 = await finalizedRx(A, [rxItem("Amendme", 5)]);
    await db.prescription.update({ where: { id: rx2.prescriptionId }, data: { status: "DRAFT" } });
    expect(await code(disp(A.staff, rx2.prescriptionId, [line(rx2.itemIds[0], m2.id, 5)]))).toBe("CONFLICT");
    expect(await code(getPrescriptionForDispensing(A.staff, "nope"))).toBe("NOT_FOUND");
  });
  it("dispenses, deducts stock through the ledger, snapshots prices and creates one issued pharmacy invoice", async () => {
    const m = await mkMed(A, { genericName: "Billable", brandName: null, sellingPriceMinor: 500, taxRateBp: 500 }); const { batchId } = await stockIn(A, m.id, "BL-1", 50, FAR(), { sellingPriceMinor: 500 });
    const rx = await finalizedRx(A, [rxItem("Billable", 10)]);
    const k = key(); const r = await dispense(A.staff, rx.prescriptionId, { idempotencyKey: k, items: [line(rx.itemIds[0], m.id, 10)] });
    expect(await qty(batchId)).toBe(40);
    expect(await db.stockTransaction.findFirstOrThrow({ where: { batchId, type: "DISPENSE" } })).toMatchObject({ quantity: -10, balanceAfter: 40, referenceType: "DISPENSING", referenceId: r.id, createdById: A.staffId });
    expect((await db.medicineBatch.findUniqueOrThrow({ where: { id: batchId } })).dispensedQuantity).toBe(10);
    const d = await getDispensing(A.staff, r.id);
    expect(d).toMatchObject({ status: "DISPENSED", totalMinor: 5250, patientId: rx.patientId }); // 10 × ₹5.00 + 5% tax
    expect(d.items[0]).toMatchObject({ medicineName: expect.stringContaining("Billable"), batchNumber: "BL-1", dispensedQuantity: 10, unitPriceMinor: 500, taxRateBp: 500, taxMinor: 250, totalMinor: 5250 });
    const inv = await db.invoice.findUniqueOrThrow({ where: { id: r.invoiceId! }, include: { items: true } });
    expect(inv).toMatchObject({ tenantId: A.id, patientId: rx.patientId, consultationId: rx.consultationId, status: "ISSUED", totalMinor: 5250, dueMinor: 5250, sourceKey: `dispense:${r.id}`, createdById: A.staffId });
    expect(inv.items).toHaveLength(1); expect(inv.items[0]).toMatchObject({ sourceType: "MEDICINE", serviceTypeSnapshot: "MEDICINE", quantity: 10, unitPriceMinor: 500, taxMinor: 250 });
    expect(inv.items[0].descriptionSnapshot).toContain("batch BL-1");
    // historical price must not move when the master changes
    await updateMedicine(A.manager, m.id, { genericName: "Billable", unit: "tablet", reorderLevel: 10, minimumStock: 5, purchasePriceMinor: 100, sellingPriceMinor: 900, taxRateBp: 1800, priceChangeReason: "Price revision" }, { applyToBatches: true });
    expect((await getDispensing(A.staff, r.id)).items[0]).toMatchObject({ unitPriceMinor: 500, totalMinor: 5250 }); expect((await db.invoice.findUniqueOrThrow({ where: { id: r.invoiceId! } })).totalMinor).toBe(5250);
    // idempotent: replaying the same request creates nothing
    const again = await dispense(A.staff, rx.prescriptionId, { idempotencyKey: k, items: [line(rx.itemIds[0], m.id, 10)] }); expect(again).toMatchObject({ id: r.id, duplicate: true });
    expect(await db.dispensing.count({ where: { prescriptionId: rx.prescriptionId } })).toBe(1); expect(await db.invoice.count({ where: { tenantId: A.id, sourceKey: `dispense:${r.id}` } })).toBe(1); expect(await qty(batchId)).toBe(40);
    expect(await db.stockTransaction.count({ where: { batchId, type: "DISPENSE" } })).toBe(1);
    expect(await db.auditLog.count({ where: { tenantId: A.id, entityId: r.id, action: "pharmacy.dispensing_created" } })).toBe(1);
  });
  it("partial dispensing leaves the prescription quantity alone and tracks what remains", async () => {
    const m = await mkMed(A, { genericName: "Partial", brandName: null }); const { batchId } = await stockIn(A, m.id, "PA-1", 20);
    const rx = await finalizedRx(A, [rxItem("Partial", 30)]);
    expect(await code(disp(A.staff, rx.prescriptionId, [line(rx.itemIds[0], m.id, 30)]))).toBe("CONFLICT"); // only 20 in stock
    const r1 = await disp(A.staff, rx.prescriptionId, [line(rx.itemIds[0], m.id, 20)]);
    expect((await getDispensing(A.staff, r1.id)).status).toBe("PARTIALLY_DISPENSED");
    const v = await getPrescriptionForDispensing(A.staff, rx.prescriptionId); expect(v.lines[0]).toMatchObject({ prescribedUnits: 30, dispensedUnits: 20, remainingUnits: 10 }); expect(v.overallStatus).toBe("PARTIALLY_DISPENSED");
    expect((await db.prescriptionItem.findUniqueOrThrow({ where: { id: rx.itemIds[0] } })).quantity).toBe(30);
    expect((await prescriptionQueue(A.staff, { status: "PARTIALLY_DISPENSED" })).rows.some((r) => r.id === rx.prescriptionId)).toBe(true);
    expect(await qty(batchId)).toBe(0);
    expect(await code(disp(A.staff, rx.prescriptionId, [line(rx.itemIds[0], m.id, 1)]))).toBe("CONFLICT"); // out of stock
    await stockIn(A, m.id, "PA-2", 50);
    expect(await code(disp(A.staff, rx.prescriptionId, [line(rx.itemIds[0], m.id, 11)]))).toBe("VALIDATION_ERROR"); // only 10 remain on the prescription
    const r2 = await disp(A.staff, rx.prescriptionId, [line(rx.itemIds[0], m.id, 10)]); expect((await getDispensing(A.staff, r2.id)).status).toBe("DISPENSED");
    expect((await getPrescriptionForDispensing(A.staff, rx.prescriptionId)).overallStatus).toBe("DISPENSED");
    expect((await prescriptionQueue(A.staff, { status: "DISPENSED" })).rows.some((r) => r.id === rx.prescriptionId)).toBe(true); expect((await prescriptionQueue(A.staff, { status: "PENDING" })).rows.some((r) => r.id === rx.prescriptionId)).toBe(false);
  });
  it("over-dispensing is refused unless the clinic explicitly allows it", async () => {
    const m = await mkMed(A, { genericName: "Overdose", brandName: null }); await stockIn(A, m.id, "OD-1", 100);
    const rx = await finalizedRx(A, [rxItem("Overdose", 5)]);
    expect(await code(disp(A.staff, rx.prescriptionId, [line(rx.itemIds[0], m.id, 6)]))).toBe("VALIDATION_ERROR");
    await savePharmacySettings(A.admin, { nearExpiryDays: 90, allowOverDispense: true, allowPatientReturns: false, returnWindowDays: 7 });
    expect(await code(disp(A.staff, rx.prescriptionId, [line(rx.itemIds[0], m.id, 6)]))).toBe("ok");
    await savePharmacySettings(A.admin, { nearExpiryDays: 90, allowOverDispense: false, allowPatientReturns: false, returnWindowDays: 7 });
    const noQty = await finalizedRx(A, [rxItem("Overdose", null)]);
    expect(await code(disp(A.staff, noQty.prescriptionId, [line(noQty.itemIds[0], m.id, 3)]))).toBe("VALIDATION_ERROR"); // doctor gave no quantity: a note is required
    expect(await code(disp(A.staff, noQty.prescriptionId, [line(noQty.itemIds[0], m.id, 3, { notes: "Doctor confirmed 3 by phone" })]))).toBe("ok");
  });
  it("FEFO suggests the earliest-expiry batch, spills into the next, and a manual choice needs a reason", async () => {
    const m = await mkMed(A, { genericName: "Fefomed", brandName: null });
    const a = await stockIn(A, m.id, "FE-A", 20, addDays(today(), 120)); const b = await stockIn(A, m.id, "FE-B", 50, addDays(today(), 300));
    const rx = await finalizedRx(A, [rxItem("Fefomed", 40)]);
    const view = await getPrescriptionForDispensing(A.staff, rx.prescriptionId); expect(view.lines[0].medicines[0].batches.map((x) => x.batchNumber)).toEqual(["FE-A", "FE-B"]); // FEFO order
    const r = await disp(A.staff, rx.prescriptionId, [line(rx.itemIds[0], m.id, 25)]); // 20 from A then 5 from B
    expect((await getDispensing(A.staff, r.id)).items.map((i) => [i.batchNumber, i.dispensedQuantity])).toEqual([["FE-A", 20], ["FE-B", 5]]);
    expect(await qty(a.batchId)).toBe(0); expect(await qty(b.batchId)).toBe(45);
    const m2 = await mkMed(A, { genericName: "Fefotwo", brandName: null }); const c1 = await stockIn(A, m2.id, "FT-A", 20, addDays(today(), 100)); const c2 = await stockIn(A, m2.id, "FT-B", 20, addDays(today(), 200));
    const rx2 = await finalizedRx(A, [rxItem("Fefotwo", 10)]);
    expect(await code(disp(A.staff, rx2.prescriptionId, [line(rx2.itemIds[0], m2.id, 10, { allocations: [{ batchId: c2.batchId, quantity: 10 }] })]))).toBe("VALIDATION_ERROR");
    const ok = await disp(A.staff, rx2.prescriptionId, [line(rx2.itemIds[0], m2.id, 10, { allocations: [{ batchId: c2.batchId, quantity: 10, overrideReason: "Patient asked for the longer-dated pack" }] })]);
    expect((await getDispensing(A.staff, ok.id)).items[0]).toMatchObject({ batchNumber: "FT-B", batchOverrideReason: "Patient asked for the longer-dated pack" }); expect(await qty(c1.batchId)).toBe(20); expect(await qty(c2.batchId)).toBe(10);
  });
  it("never dispenses expired, blocked or insufficient stock, never a different medicine, never a bad quantity", async () => {
    const m = await mkMed(A, { genericName: "Guarded", brandName: null }); const good = await stockIn(A, m.id, "GD-1", 5); const old = await expiredBatch(A, m.id, "GD-OLD", 100);
    const rx = await finalizedRx(A, [rxItem("Guarded", 50)]);
    expect(await code(disp(A.staff, rx.prescriptionId, [line(rx.itemIds[0], m.id, 6)]))).toBe("CONFLICT"); // 100 expired units don't count
    expect(await code(disp(A.staff, rx.prescriptionId, [line(rx.itemIds[0], m.id, 5, { allocations: [{ batchId: old, quantity: 5, overrideReason: "x1" }] })]))).toBe("CONFLICT");
    await setBatchBlocked(A.manager, good.batchId, { block: true, reason: "Quality hold" });
    expect(await code(disp(A.staff, rx.prescriptionId, [line(rx.itemIds[0], m.id, 1)]))).toBe("CONFLICT");
    expect((await getPrescriptionForDispensing(A.staff, rx.prescriptionId)).lines[0].medicines[0].available).toBe(0);
    await setBatchBlocked(A.manager, good.batchId, { block: false });
    for (const q of [0, -3, 1.5, 1_000_001]) expect(await code(disp(A.staff, rx.prescriptionId, [line(rx.itemIds[0], m.id, q)]))).toBe("VALIDATION_ERROR");
    const other = await mkMed(A, { genericName: "Different medicine", brandName: null }); await stockIn(A, other.id, "DF-1", 10);
    expect(await code(disp(A.staff, rx.prescriptionId, [line(rx.itemIds[0], other.id, 1)]))).toBe("VALIDATION_ERROR"); // no substitution
    expect(await code(disp(A.staff, rx.prescriptionId, [line("not-an-item", m.id, 1)]))).toBe("VALIDATION_ERROR");
    expect(await code(disp(A.staff, rx.prescriptionId, []))).toBe("VALIDATION_ERROR");
    const unpriced = await mkMed(A, { genericName: "Freebie", brandName: null, sellingPriceMinor: 0 }); await stockIn(A, unpriced.id, "FB-1", 5, FAR(), { sellingPriceMinor: 0 });
    const rx3 = await finalizedRx(A, [rxItem("Freebie", 2)]); expect(await code(disp(A.staff, rx3.prescriptionId, [line(rx3.itemIds[0], unpriced.id, 2)]))).toBe("VALIDATION_ERROR");
    expect(await qty(good.batchId)).toBe(5); expect(await db.dispensing.count({ where: { prescriptionId: rx.prescriptionId } })).toBe(0); // nothing half-done
    expect(await db.stockTransaction.count({ where: { batchId: good.batchId, type: "DISPENSE" } })).toBe(0);
  });
  it("out-of-stock prescriptions stay valid and show the medicine as unavailable", async () => {
    const m = await mkMed(A, { genericName: "Soldout", brandName: null });
    const rx = await finalizedRx(A, [rxItem("Soldout", 10), rxItem("Nostockanywhere", 4)]);
    const v = await getPrescriptionForDispensing(A.staff, rx.prescriptionId);
    expect(v.lines[0].medicines[0]).toMatchObject({ id: m.id, available: 0 }); expect(v.lines[1].medicines).toEqual([]); expect(v.status).toBe("FINALIZED");
    expect((await prescriptionQueue(A.staff, { status: "PENDING" })).rows.some((r) => r.id === rx.prescriptionId)).toBe(true);
  });
  it("concurrency: two staff can't dispense the same stock — no negative stock, no double bill, no duplicate ledger rows", async () => {
    const m = await mkMed(A, { genericName: "Raced", brandName: null }); const { batchId } = await stockIn(A, m.id, "RC-1", 10);
    const [r1, r2] = [await finalizedRx(A, [rxItem("Raced", 8)]), await finalizedRx(A, [rxItem("Raced", 8)])];
    const res = await Promise.allSettled([disp(A.staff, r1.prescriptionId, [line(r1.itemIds[0], m.id, 8)]), disp(A.manager, r2.prescriptionId, [line(r2.itemIds[0], m.id, 8)])]);
    expect(res.filter((r) => r.status === "fulfilled")).toHaveLength(1); expect(res.filter((r) => r.status === "rejected")).toHaveLength(1);
    expect(await qty(batchId)).toBe(2); expect(await db.stockTransaction.count({ where: { batchId, type: "DISPENSE" } })).toBe(1);
    expect(await db.dispensing.count({ where: { tenantId: A.id, id: { in: (await db.dispensingItem.findMany({ where: { batchId }, select: { dispensingId: true } })).map((d: { dispensingId: string }) => d.dispensingId) } } })).toBe(1);
    expect((await reconcileStock(A.manager)).mismatches).toEqual([]);
  });
  it("concurrency: the same prescription can't be over-dispensed or double-submitted", async () => {
    const m = await mkMed(A, { genericName: "Twice", brandName: null }); const { batchId } = await stockIn(A, m.id, "TW-1", 100);
    const rx = await finalizedRx(A, [rxItem("Twice", 10)]);
    const res = await Promise.allSettled([disp(A.staff, rx.prescriptionId, [line(rx.itemIds[0], m.id, 10)]), disp(A.manager, rx.prescriptionId, [line(rx.itemIds[0], m.id, 10)])]);
    expect(res.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await qty(batchId)).toBe(90); expect(await db.dispensing.count({ where: { prescriptionId: rx.prescriptionId } })).toBe(1);
    const rx2 = await finalizedRx(A, [rxItem("Twice", 10)]); const k = key();
    const same = await Promise.allSettled([dispense(A.staff, rx2.prescriptionId, { idempotencyKey: k, items: [line(rx2.itemIds[0], m.id, 10)] }), dispense(A.staff, rx2.prescriptionId, { idempotencyKey: k, items: [line(rx2.itemIds[0], m.id, 10)] })]);
    expect(same.every((r) => r.status === "fulfilled")).toBe(true); expect(await db.dispensing.count({ where: { prescriptionId: rx2.prescriptionId } })).toBe(1); expect(await qty(batchId)).toBe(80);
    expect(await db.invoice.count({ where: { tenantId: A.id, sourceKey: { startsWith: "dispense:" }, items: { some: { sourceId: { in: (await db.dispensingItem.findMany({ where: { dispensing: { prescriptionId: rx2.prescriptionId } }, select: { id: true } })).map((x: { id: string }) => x.id) } } } } })).toBe(1);
    expect((await reconcileStock(A.manager)).mismatches).toEqual([]);
  });
});

describe("billing integration (20, 30)", () => {
  it("the pharmacy bill is a normal Phase 8 invoice: visible in Patient billing, payable by the accountant, and protected once paid", async () => {
    const m = await mkMed(A, { genericName: "Paidmed", brandName: null, sellingPriceMinor: 1000, taxRateBp: 0 }); const { batchId } = await stockIn(A, m.id, "PD-1", 30, FAR(), { sellingPriceMinor: 1000 });
    const rx = await finalizedRx(A, [rxItem("Paidmed", 5)]);
    const r = await disp(A.staff, rx.prescriptionId, [line(rx.itemIds[0], m.id, 5)]);
    const pb = await patientBilling(A.accountant, rx.patientId); expect(pb.invoices.some((i: { id: string }) => i.id === r.invoiceId)).toBe(true);
    const inv = await getInvoice(A.accountant, r.invoiceId!); expect(inv).toMatchObject({ status: "ISSUED", totalMinor: 5000 });
    expect(await code(recordPayment(A.staff, r.invoiceId!, { amountMinor: 5000, method: "CASH", idempotencyKey: key() }))).toBe("FORBIDDEN"); // pharmacy staff collect through Billing roles
    await recordPayment(A.accountant, r.invoiceId!, { amountMinor: 5000, method: "CASH", idempotencyKey: key() });
    expect((await getInvoice(A.accountant, r.invoiceId!)).status).toBe("PAID");
    expect(await code(cancelDispensing(A.manager, r.id, { reason: "Wrong patient" }))).toBe("CONFLICT"); // money was collected: refund in Billing first
    expect(await qty(batchId)).toBe(25);
    expect(await code(cancelDispensing(A.staff, r.id, { reason: "Wrong patient" }))).toBe("FORBIDDEN");
  });
  it("cancelling an unpaid dispensing reverses the stock through REVERSAL rows and cancels the bill", async () => {
    const m = await mkMed(A, { genericName: "Reversible", brandName: null }); const { batchId } = await stockIn(A, m.id, "RV-1", 30);
    const rx = await finalizedRx(A, [rxItem("Reversible", 12)]); const r = await disp(A.staff, rx.prescriptionId, [line(rx.itemIds[0], m.id, 12)]);
    expect(await qty(batchId)).toBe(18);
    await cancelDispensing(A.manager, r.id, { reason: "Entered for wrong patient" });
    expect(await qty(batchId)).toBe(30); expect(await db.stockTransaction.findFirstOrThrow({ where: { batchId, type: "REVERSAL" } })).toMatchObject({ quantity: 12, referenceId: r.id });
    expect((await db.invoice.findUniqueOrThrow({ where: { id: r.invoiceId! } })).status).toBe("CANCELLED"); expect((await getDispensing(A.manager, r.id)).status).toBe("CANCELLED");
    expect(await code(cancelDispensing(A.manager, r.id, { reason: "again" }))).toBe("CONFLICT"); expect(await qty(batchId)).toBe(30);
    expect((await getPrescriptionForDispensing(A.staff, rx.prescriptionId)).lines[0].dispensedUnits).toBe(0); // can be dispensed again
    expect((await reconcileStock(A.manager)).mismatches).toEqual([]);
  });
});

describe("medicine returns (21)", () => {
  async function dispensed(label: string, n = 10) {
    const m = await mkMed(A, { genericName: label, brandName: null }); const { batchId } = await stockIn(A, m.id, `${label}-1`, 40);
    const rx = await finalizedRx(A, [rxItem(label, n)]); const r = await disp(A.staff, rx.prescriptionId, [line(rx.itemIds[0], m.id, n)]);
    const item = await db.dispensingItem.findFirstOrThrow({ where: { dispensingId: r.id } });
    return { m, batchId, itemId: item.id as string, patientId: rx.patientId };
  }
  it("is refused unless clinic policy accepts returns, and respects the return window and quantity", async () => {
    const d = await dispensed("Retpolicy");
    expect(await code(requestReturn(A.staff, { type: "PATIENT_RETURN", dispensingItemId: d.itemId, quantity: 2, reason: "Not needed" }))).toBe("CONFLICT");
    await savePharmacySettings(A.admin, { nearExpiryDays: 90, allowOverDispense: false, allowPatientReturns: true, returnWindowDays: 7 });
    expect(await code(requestReturn(A.doctor, { type: "PATIENT_RETURN", dispensingItemId: d.itemId, quantity: 2, reason: "x1" }))).toBe("FORBIDDEN");
    expect(await code(requestReturn(A.staff, { type: "PATIENT_RETURN", dispensingItemId: d.itemId, quantity: 11, reason: "Too many" }))).toBe("VALIDATION_ERROR");
    expect(await code(requestReturn(A.staff, { type: "PATIENT_RETURN", dispensingItemId: d.itemId, quantity: 2 }))).toBe("VALIDATION_ERROR");
    await db.dispensing.updateMany({ where: { id: (await db.dispensingItem.findUniqueOrThrow({ where: { id: d.itemId } })).dispensingId }, data: { dispensedAt: new Date(Date.now() - 30 * 86_400_000) } });
    expect(await code(requestReturn(A.staff, { type: "PATIENT_RETURN", dispensingItemId: d.itemId, quantity: 2, reason: "Late" }))).toBe("CONFLICT");
    await savePharmacySettings(A.admin, { nearExpiryDays: 90, allowOverDispense: false, allowPatientReturns: false, returnWindowDays: 7 });
  });
  it("walks REQUESTED → APPROVED → RECEIVED → RESTOCKED, and returned stock is never sellable before the explicit restock", async () => {
    await savePharmacySettings(A.admin, { nearExpiryDays: 90, allowOverDispense: false, allowPatientReturns: true, returnWindowDays: 30 });
    const d = await dispensed("Retflow"); const before = await qty(d.batchId);
    const r = await requestReturn(A.staff, { type: "PATIENT_RETURN", dispensingItemId: d.itemId, quantity: 4, reason: "Prescription changed" }); expect(r.returnNumber).toMatch(/^RET-\d{4}-\d{6}$/);
    expect(await code(requestReturn(A.staff, { type: "PATIENT_RETURN", dispensingItemId: d.itemId, quantity: 7, reason: "More" }))).toBe("VALIDATION_ERROR"); // 4 reserved, only 6 left
    expect(await code(returnAction(A.staff, r.id, { action: "approve" }))).toBe("FORBIDDEN");
    expect(await code(returnAction(A.manager, r.id, { action: "receive", condition: "SEALED" }))).toBe("CONFLICT"); // not approved yet
    await returnAction(A.manager, r.id, { action: "approve" });
    expect(await code(returnAction(A.manager, r.id, { action: "receive" }))).toBe("VALIDATION_ERROR"); // condition is mandatory
    await returnAction(A.manager, r.id, { action: "receive", condition: "SEALED" });
    expect(await qty(d.batchId)).toBe(before); // received ≠ restocked
    await returnAction(A.manager, r.id, { action: "restock" });
    expect(await qty(d.batchId)).toBe(before + 4); expect(await db.stockTransaction.findFirstOrThrow({ where: { batchId: d.batchId, type: "SALE_RETURN" } })).toMatchObject({ quantity: 4, referenceId: r.id }); expect((await db.medicineBatch.findUniqueOrThrow({ where: { id: d.batchId } })).returnedQuantity).toBe(4);
    expect(await code(returnAction(A.manager, r.id, { action: "restock" }))).toBe("CONFLICT");
    expect((await listReturns(A.manager, { status: "RESTOCKED" })).rows.some((x) => x.id === r.id)).toBe(true);
    // opened packs can't be restocked, they are disposed
    const r2 = await requestReturn(A.staff, { type: "PATIENT_RETURN", dispensingItemId: d.itemId, quantity: 2, reason: "Opened and unused" });
    await returnAction(A.manager, r2.id, { action: "approve" }); await returnAction(A.manager, r2.id, { action: "receive", condition: "OPENED" });
    expect(await code(returnAction(A.manager, r2.id, { action: "restock" }))).toBe("CONFLICT"); await returnAction(A.manager, r2.id, { action: "dispose" });
    expect(await qty(d.batchId)).toBe(before + 4); expect((await db.medicineReturn.findUniqueOrThrow({ where: { id: r2.id } })).status).toBe("DISPOSED");
    // rejection releases the reserved quantity
    const r3 = await requestReturn(A.staff, { type: "PATIENT_RETURN", dispensingItemId: d.itemId, quantity: 4, reason: "Changed my mind" });
    expect(await code(returnAction(A.manager, r3.id, { action: "reject" }))).toBe("VALIDATION_ERROR"); await returnAction(A.manager, r3.id, { action: "reject", reason: "Outside policy" });
    expect(await code(requestReturn(A.staff, { type: "PATIENT_RETURN", dispensingItemId: d.itemId, quantity: 4, reason: "Retry" }))).toBe("ok");
    expect(await db.auditLog.count({ where: { tenantId: A.id, entityId: r.id, action: { in: ["pharmacy.return_requested", "pharmacy.return_approved", "pharmacy.return_received", "pharmacy.return_resolved"] } } })).toBe(4);
    expect(await code(cancelDispensing(A.manager, (await db.dispensingItem.findUniqueOrThrow({ where: { id: d.itemId } })).dispensingId, { reason: "late" }))).toBe("CONFLICT"); // has returns
    expect((await reconcileStock(A.manager)).mismatches).toEqual([]);
    await savePharmacySettings(A.admin, { nearExpiryDays: 90, allowOverDispense: false, allowPatientReturns: false, returnWindowDays: 7 });
  });
});

describe("tenant isolation (26)", () => {
  it("clinic B can't see or touch clinic A's pharmacy data, even with valid ids", async () => {
    const m = await mkMed(A, { genericName: "Isolated", brandName: null }); const { batchId, purchaseId } = await stockIn(A, m.id, "ISO-1", 30);
    const rx = await finalizedRx(A, [rxItem("Isolated", 5)]); const d = await disp(A.staff, rx.prescriptionId, [line(rx.itemIds[0], m.id, 5)]);
    const cnt = await startCount(A.manager, { medicineId: m.id });
    for (const [name, p] of [["medicine", getMedicine(B.manager, m.id)], ["batch", getBatch(B.manager, batchId)], ["purchase", getPurchase(B.manager, purchaseId)], ["dispensing", getDispensing(B.manager, d.id)], ["count", getCount(B.manager, cnt.id)], ["rx", getPrescriptionForDispensing(B.staff, rx.prescriptionId)]] as const) expect(await code(p), name).toBe("NOT_FOUND");
    const b = await mkMed(B, { genericName: "Isolated", brandName: null }); await stockIn(B, b.id, "ISO-1", 10); // same batch number in another clinic is fine
    expect(await code(adjustStock(B.manager, { batchId, direction: "OUT", quantity: 1, reason: "OTHER", notes: "cross tenant" }))).toBe("NOT_FOUND");
    expect(await code(recordDamage(B.manager, { batchId, quantity: 1, reason: "cross" }))).toBe("NOT_FOUND"); expect(await code(setBatchBlocked(B.manager, batchId, { block: true, reason: "x1" }))).toBe("NOT_FOUND");
    expect(await code(receivePurchase(B.manager, purchaseId))).toBe("NOT_FOUND"); expect(await code(cancelDispensing(B.manager, d.id, { reason: "cross tenant" }))).toBe("NOT_FOUND");
    expect(await code(disp(B.staff, rx.prescriptionId, [line(rx.itemIds[0], b.id, 1)]))).toBe("NOT_FOUND");
    expect(await code(disp(A.staff, rx.prescriptionId, [line(rx.itemIds[0], b.id, 1)]))).toBe("NOT_FOUND"); // B's medicine can't be used by A
    expect(await code(createPurchase(B.manager, { supplierId: B.supplier, items: [{ medicineId: m.id, batchNumber: "X", expiryDate: FAR(), quantity: 1, unitPurchasePriceMinor: 1, sellingPriceMinor: 1 }] }))).toBe("VALIDATION_ERROR");
    expect((await listBatches(B.manager, { q: "ISO-1" })).rows.every((r) => r.medicineId === b.id)).toBe(true);
    expect((await listLedger(B.manager, {})).rows.every((r) => r.batchNumber !== undefined)).toBe(true); expect((await listDispensings(B.staff, {})).rows.some((r) => r.id === d.id)).toBe(false);
    expect((await prescriptionQueue(B.staff, {})).rows.some((r) => r.id === rx.prescriptionId)).toBe(false);
    expect(await code(startCount(B.manager, { medicineId: m.id }))).toBe("VALIDATION_ERROR"); // A's medicine id has no stock in B
    expect(await code(patientPharmacy(B.staff, rx.patientId))).toBe("NOT_FOUND");
    expect(await qty(batchId)).toBe(25);
    for (const kind of ["bill", "slip"]) expect(await code(pharmacyDocument(B.staff, kind, d.id)), kind).toBe("NOT_FOUND");
    expect(await code(pharmacyDocument(B.manager, "purchase", purchaseId))).toBe("NOT_FOUND");
  });
});

describe("roles and permissions (27)", () => {
  it("applies the documented role matrix", async () => {
    const m = await mkMed(A); const { batchId } = await stockIn(A, m.id, "RB-1", 20);
    const allow = (who: Ctx, fn: () => Promise<unknown>) => code(fn());
    // pharmacy staff: view, dispense, return request — nothing structural
    expect(await allow(A.staff, () => listMedicines(A.staff, {}))).toBe("ok"); expect(await allow(A.staff, () => listBatches(A.staff, {}))).toBe("ok"); expect(await allow(A.staff, () => pharmacyDashboard(A.staff))).toBe("ok");
    for (const [name, fn] of [["createMedicine", () => createMedicine(A.staff, { genericName: "Nope" })], ["purchase", () => createPurchase(A.staff, { supplierId: A.supplier, items: [] })], ["adjust", () => adjustStock(A.staff, { batchId, direction: "IN", quantity: 1, reason: "OTHER", notes: "no" })], ["settings", () => savePharmacySettings(A.staff, { nearExpiryDays: 10, allowOverDispense: true, allowPatientReturns: true, returnWindowDays: 1 })], ["report", () => pharmacyReport(A.staff, "stock_summary")], ["opening", () => addOpeningStock(A.staff, { medicineId: m.id, batchNumber: "z", expiryDate: FAR(), quantity: 1, purchasePriceMinor: 1, sellingPriceMinor: 1 })]] as const) expect(await code(fn()), name).toBe("FORBIDDEN");
    expect(await code(receivePurchase(A.staff, "x"))).toBe("FORBIDDEN");
    // staff can be GRANTED receive explicitly
    const { user } = await makeUser("PHARMACY_STAFF", A.id, ["pharmacy.receive"]); const granted = asTenant({ ...ctxFor(user, "PHARMACY_STAFF", A.id, { grants: ["pharmacy.receive"] }), tenant: A.staff.tenant });
    const p = await createPurchase(A.manager, { supplierId: A.supplier, items: [{ medicineId: m.id, batchNumber: "RB-2", expiryDate: FAR(), quantity: 3, unitPurchasePriceMinor: 100, sellingPriceMinor: 200 }] });
    expect(await code(receivePurchase(granted, p.id))).toBe("ok");
    // manager: purchases, suppliers, adjustments, returns, reports — but not settings or opening stock
    expect(await code(pharmacyReport(A.manager, "stock_summary"))).toBe("ok"); expect(await code(savePharmacySettings(A.manager, { nearExpiryDays: 10, allowOverDispense: false, allowPatientReturns: false, returnWindowDays: 1 }))).toBe("FORBIDDEN");
    // doctor: availability only
    expect(await code(medicineAvailability(A.doctor, "test"))).toBe("ok");
    for (const [name, fn] of [["list", () => listMedicines(A.doctor, {})], ["batches", () => listBatches(A.doctor, {})], ["dispense", () => prescriptionQueue(A.doctor, {})], ["adjust", () => adjustStock(A.doctor, { batchId, direction: "OUT", quantity: 1, reason: "OTHER", notes: "doctor" })], ["purchase", () => createPurchase(A.doctor, { supplierId: A.supplier, items: [] })], ["ledger", () => listLedger(A.doctor, {})], ["dashboard", () => pharmacyDashboard(A.doctor)]] as const) expect(await code(fn()), `doctor ${name}`).toBe("FORBIDDEN");
    const av = await medicineAvailability(A.doctor, m.id ? "testbrand" : ""); expect(av.rows.length).toBeGreaterThan(0); expect(Object.keys(av.rows[0]).sort()).toEqual(["available", "name", "strength"]);
    // everyone else, plus the platform admin
    for (const [role, who] of [["reception", A.recep], ["nurse", A.nurse], ["lab", A.lab], ["accountant", A.accountant], ["superAdmin", A.superAdmin]] as const) { expect(await code(listMedicines(who, {})), role).toBe("FORBIDDEN"); expect(await code(prescriptionQueue(who, {})), `${role} queue`).toBe("FORBIDDEN"); expect(await code(pharmacyDashboard(who)), `${role} dash`).toBe("FORBIDDEN"); }
    expect(await code(listConfig(A.admin))).toBe("ok"); expect(await code(getPharmacySettings(A.admin))).toBe("ok");
  });
});

describe("documents (28)", () => {
  it("renders private, clinic-branded, escaped documents and audits access", async () => {
    const evil = `<img src=x onerror=alert(1)> & "q"`;
    const m = await mkMed(A, { genericName: "Docmed", brandName: null, sellingPriceMinor: 300, taxRateBp: 0 }); const { batchId, purchaseId } = await stockIn(A, m.id, "DOC-1", 40, FAR(), { sellingPriceMinor: 300 });
    const rx = await finalizedRx(A, [rxItem("Docmed", 6, { instructions: evil })]); const r = await disp(A.staff, rx.prescriptionId, [line(rx.itemIds[0], m.id, 6)]);
    const docs = [await pharmacyDocument(A.manager, "purchase", purchaseId), await pharmacyDocument(A.staff, "bill", r.id), await pharmacyDocument(A.staff, "slip", r.id), await pharmacyDocument(A.manager, "stock", "current"), await pharmacyDocument(A.manager, "expiry", "current")];
    for (const d of docs) { const { body, style } = renderPharmacyDoc(d); expect(body).toContain("Pharm Clinic a"); expect(body + style).not.toMatch(/mecgura/i); expect(body).not.toContain("<img src=x"); expect(body).toContain("#0e7c86".slice(0, 0)); }
    expect(renderPharmacyDoc(docs[2]).body).toContain("&lt;img src=x onerror=alert(1)&gt;"); expect(renderPharmacyDoc(docs[1]).body).toContain("₹3.00"); expect(JSON.stringify(docs[2])).not.toContain("Private clinical note"); expect(JSON.stringify(docs[1])).not.toContain("Private clinical note");
    await recordPharmacyDocAccess(A.staff, "bill", r.id, "VIEWED"); await recordPharmacyDocAccess(A.staff, "bill", r.id, "PRINTED"); await recordPharmacyDocAccess(A.staff, "slip", r.id, "DOWNLOADED");
    expect(await db.auditLog.count({ where: { tenantId: A.id, entityId: r.id, action: { in: ["pharmacy.doc_viewed", "pharmacy.doc_printed", "pharmacy.doc_downloaded"] } } })).toBe(3);
    const ret = await returnToSupplier(A.manager, { supplierId: A.supplier, batchId, quantity: 2, reason: "Damaged on arrival" }); const rd = await pharmacyDocument(A.manager, "return", ret.id);
    expect(renderPharmacyDoc(rd).body).toContain(ret.returnNumber);
    const draft = await createPurchase(A.manager, { supplierId: A.supplier, items: [{ medicineId: m.id, batchNumber: "DOC-D", expiryDate: FAR(), quantity: 1, unitPurchasePriceMinor: 1, sellingPriceMinor: 1 }] });
    expect(await code(pharmacyDocument(A.manager, "purchase", draft.id))).toBe("CONFLICT"); expect(await code(pharmacyDocument(A.manager, "nonsense", "x"))).toBe("NOT_FOUND");
    for (const [who, kind, id] of [[A.doctor, "bill", r.id], [A.recep, "slip", r.id], [A.accountant, "stock", "current"], [A.staff, "stock", "current"], [A.staff, "purchase", purchaseId], [A.nurse, "return", ret.id]] as const) expect(await code(pharmacyDocument(who, kind, id)), `${kind}`).toBe("FORBIDDEN");
    await cancelDispensing(A.manager, r.id, { reason: "Test reversal" }); expect(await code(pharmacyDocument(A.staff, "bill", r.id))).toBe("CONFLICT");
  });
});

describe("Patient 360 and timeline (29)", () => {
  it("shows pharmacy history to dispensers and clinicians, not to reception", async () => {
    const m = await mkMed(A, { genericName: "Historymed", brandName: null }); await stockIn(A, m.id, "HI-1", 20);
    const rx = await finalizedRx(A, [rxItem("Historymed", 4)]); const r = await disp(A.staff, rx.prescriptionId, [line(rx.itemIds[0], m.id, 4)]);
    const h = await patientPharmacy(A.staff, rx.patientId); expect(h.rows[0]).toMatchObject({ id: r.id, status: "DISPENSED", prescriptionNumber: expect.stringMatching(/^RX-/), invoiceNumber: expect.stringMatching(/^INV-/) }); expect(h.rows[0].items[0]).toMatchObject({ quantity: 4 });
    expect((await patientPharmacy(A.doctor, rx.patientId)).rows).toHaveLength(1); expect(await code(patientPharmacy(A.recep, rx.patientId))).toBe("FORBIDDEN"); expect(await code(patientPharmacy(A.accountant, rx.patientId))).toBe("FORBIDDEN");
    const tl = await getPatientTimeline(A.doctor, rx.patientId, { filter: "pharmacy", page: 1 }); expect(tl.available).toBe(true); expect(tl.events.some((e) => e.category === "pharmacy")).toBe(true);
    expect((await getPatientTimeline(A.recep, rx.patientId, { filter: "all", page: 1 })).events.some((e) => e.category === "pharmacy")).toBe(false);
    expect((await listDispensings(A.staff, { patientId: rx.patientId })).total).toBe(1);
  });
});

describe("reports, exports and dashboard (24)", () => {
  it("runs every report, labels stock value as cost, and exports safe CSV", async () => {
    for (const k of REPORT_KINDS) { const r = await pharmacyReport(A.manager, k, {}); expect(r.columns.length, k).toBeGreaterThan(0); expect(Array.isArray(r.rows)).toBe(true); }
    const stock = await pharmacyReport(A.manager, "stock_summary"); expect(stock.note).toMatch(/not profit/i); expect(stock.summary[0].label).toMatch(/cost/i);
    expect((await pharmacyReport(A.manager, "dispensing")).rows.length).toBeGreaterThan(0); expect((await pharmacyReport(A.manager, "medicine_sales")).rows.length).toBeGreaterThan(0);
    expect((await pharmacyReport(A.manager, "stock_ledger", { state: "x" })).rows.length).toBeGreaterThan(0);
    expect(await code(pharmacyReport(A.manager, "nope"))).toBe("NOT_FOUND"); expect(await code(pharmacyReport(A.manager, "stock_summary", { from: "2026-02-01", to: "2026-01-01" }))).toBe("VALIDATION_ERROR");
    expect(await code(pharmacyReport(A.manager, "stock_ledger", { from: "2020-01-01", to: "2026-01-01" }))).toBe("VALIDATION_ERROR");
    const evil = await mkMed(A, { genericName: "=HYPERLINK(\"x\")", brandName: null }); await stockIn(A, evil.id, "CSV-1", 3);
    const csv = await exportPharmacyReport(A.manager, "stock_summary"); expect(csv.csv).toContain("'=HYPERLINK"); expect(csv.filename).toMatch(/^pharmacy-stock_summary-/); expect(csv.csv.split("\r\n")[0]).toContain("Stock value (cost)");
    expect(await db.auditLog.count({ where: { tenantId: A.id, action: "pharmacy.exported" } })).toBeGreaterThan(0); expect(await code(exportPharmacyReport(A.staff, "stock_summary"))).toBe("FORBIDDEN");
    expect((await pharmacyReport(B.manager, "stock_summary")).rows.some((r) => String(r.medicine).includes("HYPERLINK"))).toBe(false);
  });
  it("dashboard numbers are real database counts", async () => {
    const before = await pharmacyDashboard(A.manager);
    const m = await mkMed(A, { genericName: "Dashmed", brandName: null, sellingPriceMinor: 1000, taxRateBp: 0 }); await stockIn(A, m.id, "DB-1", 20, FAR(), { sellingPriceMinor: 1000 });
    const rx = await finalizedRx(A, [rxItem("Dashmed", 3)]); await disp(A.staff, rx.prescriptionId, [line(rx.itemIds[0], m.id, 3)]);
    const after = await pharmacyDashboard(A.manager);
    expect(after.counts.totalMedicines).toBe(before.counts.totalMedicines + 1); expect(after.counts.todayDispensing).toBe(before.counts.todayDispensing + 1); expect(after.counts.todaySalesMinor).toBe(before.counts.todaySalesMinor + 3000); expect(after.recent[0]).toMatchObject({ type: "DISPENSE", quantity: -3 });
    expect(after.valuationMethod).toMatch(/not profit/i); const dashB = await pharmacyDashboard(B.manager); expect(dashB.counts.todaySalesMinor).toBe(0);
  });
});

describe("ledger integrity (7, 23)", () => {
  it("every batch equals the sum of its immutable ledger rows after all of the above, in every clinic", async () => {
    for (const t of [A, B]) { const r = await reconcileStock(t.manager); expect(r.checked).toBeGreaterThan(0); expect(r.mismatches).toEqual([]); }
    const rows = await db.stockTransaction.findMany({ where: { tenantId: A.id }, orderBy: { createdAt: "asc" } });
    expect(rows.every((r: { quantity: number }) => r.quantity !== 0)).toBe(true);
    const ledger = await listLedger(A.manager, { type: "DISPENSE" }); expect(ledger.rows.every((r) => r.type === "DISPENSE" && r.quantity < 0)).toBe(true);
    expect((await listLedger(A.manager, { from: today(), to: today() })).total).toBeGreaterThan(0);
  });
});
