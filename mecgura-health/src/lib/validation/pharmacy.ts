import { z } from "zod";
import { MAX_MINOR } from "@/lib/billing/money";
import { ADJUST_REASONS, MAX_STOCK_QTY, RETURN_CONDITIONS } from "@/lib/pharmacy/stock";
import { DATE_RE, isValidDate } from "@/lib/scheduling/time";
import { requiredText } from "./fields";

const txt = (label: string, max: number) => z.string().trim().max(max, `${label} must be ${max} characters or fewer.`).nullish().transform((v) => (v ? v : undefined));
const id = z.string().trim().min(1).max(60);
const optId = id.nullish().or(z.literal("").transform(() => undefined)).transform((v) => v ?? undefined);
const date = (label: string) => z.string().regex(DATE_RE, `${label} must be a date.`).refine(isValidDate, `${label} is not a real date.`);
const num = (v: unknown) => (typeof v === "string" && v.trim() !== "" ? Number(v) : v);
const minor = (label: string) => z.preprocess(num, z.number({ error: `${label} must be a number.` }).int(`${label} must be a whole number of paise.`).min(0, `${label} can't be negative.`).max(MAX_MINOR, `${label} is too large.`));
const qty = (label: string, min = 1) => z.preprocess(num, z.number({ error: `${label} must be a number.` }).int(`${label} must be a whole number.`).min(min, min > 0 ? `${label} must be at least ${min}.` : `${label} can't be negative.`).max(MAX_STOCK_QTY, `${label} is too large.`));
const optQty = (label: string) => z.preprocess((v) => (v === "" || v === null ? undefined : num(v)), qty(label, 0).optional());
const bp = (label: string) => minor(label).refine((v) => v <= 10000, `${label} can't exceed 100%.`);

export const medicineSchema = z.object({
  genericName: requiredText("Generic name", { max: 120, min: 2 }), brandName: txt("Brand name", 120), strength: txt("Strength", 60), dosageForm: txt("Dosage form", 40), route: txt("Route", 40),
  manufacturer: txt("Manufacturer", 120), category: txt("Category", 60), unit: z.string().trim().min(1, "Enter a unit.").max(20).default("unit"), packSize: optQty("Pack size"), barcode: txt("Barcode", 64),
  reorderLevel: qty("Reorder level", 0).default(0), minimumStock: qty("Minimum stock", 0).default(0), maximumStock: optQty("Maximum stock"),
  purchasePriceMinor: minor("Purchase price").default(0), sellingPriceMinor: minor("Selling price").default(0), taxRateBp: bp("Tax rate").default(0),
  prescriptionRequired: z.boolean().default(true), active: z.boolean().default(true), notes: txt("Notes", 500), priceChangeReason: txt("Reason", 200),
}).superRefine((v, c) => { if (v.maximumStock != null && v.maximumStock < v.reorderLevel) c.addIssue({ code: "custom", path: ["maximumStock"], message: "Maximum stock can't be below the reorder level." }); });

export const supplierSchema = z.object({
  supplierName: requiredText("Supplier name", { max: 120, min: 2 }), contactPerson: txt("Contact person", 80), phone: txt("Phone", 30), email: z.string().trim().max(120).email("Enter a valid email.").nullish().or(z.literal("")).transform((v) => v || undefined),
  address: txt("Address", 300), taxId: txt("Tax ID", 40), paymentTerms: txt("Payment terms", 120), active: z.boolean().default(true), notes: txt("Notes", 300),
});

export const purchaseItemSchema = z.object({
  medicineId: id, batchNumber: requiredText("Batch number", { max: 40, min: 1 }), expiryDate: date("Expiry date"), manufacturingDate: date("Manufacturing date").nullish().or(z.literal("").transform(() => undefined)).transform((v) => v ?? undefined),
  quantity: qty("Quantity"), freeQuantity: qty("Free quantity", 0).default(0), unitPurchasePriceMinor: minor("Purchase price"), sellingPriceMinor: minor("Selling price"), taxRateBp: bp("Tax rate").default(0), discountMinor: minor("Discount").default(0),
}).superRefine((v, c) => { if (v.manufacturingDate && v.manufacturingDate > v.expiryDate) c.addIssue({ code: "custom", path: ["manufacturingDate"], message: "Manufacturing date must be before the expiry date." }); });
export const purchaseSchema = z.object({
  supplierId: id, supplierInvoiceNumber: txt("Supplier invoice number", 40), purchaseDate: date("Purchase date").optional().or(z.literal("").transform(() => undefined)), notes: txt("Notes", 300),
  items: z.array(purchaseItemSchema).min(1, "Add at least one item.").max(100, "At most 100 items."),
}).superRefine((v, c) => {
  const seen = new Set<string>();
  v.items.forEach((i, n) => { const k = `${i.medicineId}|${i.batchNumber.toLowerCase()}`; if (seen.has(k)) c.addIssue({ code: "custom", path: ["items", n, "batchNumber"], message: "This batch is already on the purchase." }); seen.add(k); });
});
export const cancelSchema = z.object({ reason: requiredText("Reason", { max: 300, min: 2 }) });

export const openingStockSchema = z.object({
  medicineId: id, batchNumber: requiredText("Batch number", { max: 40, min: 1 }), expiryDate: date("Expiry date"), manufacturingDate: date("Manufacturing date").nullish().or(z.literal("").transform(() => undefined)).transform((v) => v ?? undefined),
  quantity: qty("Quantity"), purchasePriceMinor: minor("Purchase price"), sellingPriceMinor: minor("Selling price"), notes: txt("Notes", 300),
});
export const adjustmentSchema = z.object({
  batchId: id, direction: z.enum(["IN", "OUT"], { error: "Choose in or out." }), quantity: qty("Quantity"), reason: z.enum(ADJUST_REASONS, { error: "Choose a reason." }), notes: requiredText("Notes", { max: 300, min: 2 }),
});
export const stockEventSchema = z.object({ batchId: id, quantity: qty("Quantity"), reason: requiredText("Reason", { max: 200, min: 2 }), notes: txt("Notes", 300) });
export const batchBlockSchema = z.object({ block: z.boolean(), reason: txt("Reason", 200) }).superRefine((v, c) => { if (v.block && !v.reason) c.addIssue({ code: "custom", path: ["reason"], message: "Give a reason for blocking this batch." }); });

export const countStartSchema = z.object({ medicineId: optId, notes: txt("Notes", 300) });
export const countLinesSchema = z.object({ lines: z.array(z.object({ batchId: id, physicalQuantity: optQty("Physical quantity"), reason: txt("Reason", 200) })).min(1).max(500) });

const alloc = z.object({ batchId: id, quantity: qty("Quantity"), overrideReason: txt("Reason", 200) });
export const dispenseItemSchema = z.object({ prescriptionItemId: id, medicineId: id, quantity: qty("Quantity"), allocations: z.array(alloc).max(10).optional(), notes: txt("Notes", 200) });
export const dispenseSchema = z.object({ idempotencyKey: z.string().trim().min(8, "Missing request key.").max(80), items: z.array(dispenseItemSchema).min(1, "Choose at least one medicine to dispense.").max(40), notes: txt("Notes", 300) });
export const dispenseCancelSchema = cancelSchema;

export const returnRequestSchema = z.object({
  type: z.enum(["PATIENT_RETURN", "OTHER"], { error: "Choose a return type." }), dispensingItemId: optId, batchId: optId, quantity: qty("Quantity"), reason: requiredText("Reason", { max: 200, min: 2 }), notes: txt("Notes", 300),
}).superRefine((v, c) => {
  if (v.type === "PATIENT_RETURN" && !v.dispensingItemId) c.addIssue({ code: "custom", path: ["dispensingItemId"], message: "Choose the dispensed medicine being returned." });
  if (v.type === "OTHER" && !v.batchId) c.addIssue({ code: "custom", path: ["batchId"], message: "Choose the batch." });
});
export const purchaseReturnSchema = z.object({ supplierId: id, batchId: id, quantity: qty("Quantity"), reason: requiredText("Reason", { max: 200, min: 2 }), reference: txt("Reference", 80), notes: txt("Notes", 300) });
export const returnActionSchema = z.object({ action: z.enum(["approve", "reject", "receive", "restock", "dispose"], { error: "Unknown action." }), condition: z.enum(RETURN_CONDITIONS).optional(), reason: txt("Reason", 200) });

export const pharmacySettingsSchema = z.object({
  nearExpiryDays: z.preprocess(num, z.number().int().min(1, "At least 1 day.").max(365, "At most 365 days.")), allowOverDispense: z.boolean(), allowPatientReturns: z.boolean(),
  returnWindowDays: z.preprocess(num, z.number().int().min(0).max(365)), billFooter: txt("Bill footer", 300),
});
export const configItemSchema = z.object({ kind: z.enum(["DOSAGE_FORM", "CATEGORY", "UNIT"], { error: "Unknown list." }), name: requiredText("Name", { max: 60, min: 1 }), active: z.boolean().default(true) });
