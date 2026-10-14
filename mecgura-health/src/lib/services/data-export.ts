import "server-only";
import bcrypt from "bcryptjs";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";
import type { TenantRequestContext } from "@/lib/auth/context";
import type { Column, ReportMeta, Row } from "@/lib/analytics/export";
import { db as rootDb } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { tableToFile, type ExportFormat } from "@/lib/export/table";
import { rateLimit } from "@/lib/security/rate-limit";
import { tenantDb } from "@/lib/tenant/db";
import type { Client } from "./clinic-shared";
import { onExport } from "./sec-events";
import { hasMfa, verifySecondFactor } from "./sec-mfa";

/**
 * Whole-list exports (patients, medicines, stock, suppliers, lab tests). Always: tenant scoped, permission checked, rate limited, audited, built per
 * request (never stored or linked). The patients list is personal data, so it additionally needs the user to confirm their password (and 2FA code).
 */
export const EXPORT_KINDS = ["patients", "medicines", "stock", "suppliers", "lab-tests"] as const;
export type ExportKind = (typeof EXPORT_KINDS)[number];
export const isExportKind = (k: string): k is ExportKind => (EXPORT_KINDS as readonly string[]).includes(k);
const CAP = 50_000;
type Rec = Record<string, unknown>;
const db = (ctx: TenantRequestContext) => tenantDb(ctx) as Client;
const rupees = (minor: unknown) => (typeof minor === "number" ? (minor / 100).toFixed(2) : "");
const yn = (b: unknown) => (b ? "Yes" : "No");

const ALLOWED: Record<ExportKind, (c: TenantRequestContext) => boolean> = {
  patients: (c) => c.permissions.has("patients.export"),
  medicines: (c) => c.permissions.has("pharmacy.view") || c.permissions.has("pharmacy.medicines"),
  stock: (c) => c.permissions.has("pharmacy.view"),
  suppliers: (c) => c.permissions.has("pharmacy.view") || c.permissions.has("pharmacy.suppliers"),
  "lab-tests": (c) => c.permissions.has("lab.configure"),
};
export const canExport = (ctx: TenantRequestContext, kind: ExportKind) => ctx.user.role !== "SUPER_ADMIN" && ALLOWED[kind](ctx);
export const needsConfirmation = (kind: ExportKind) => kind === "patients";

async function confirmIdentity(ctx: TenantRequestContext, password?: string, code?: string) {
  const lim = await rateLimit(`export-confirm:${ctx.user.id}`, { limit: 5, windowMs: 10 * 60_000 });
  if (!lim.allowed) throw new AppError("RATE_LIMITED", { message: "Too many attempts. Try again in a few minutes." });
  const u = await rootDb.user.findFirst({ where: { id: ctx.user.id, deletedAt: null }, select: { passwordHash: true } });
  if (!password || !u?.passwordHash || !(await bcrypt.compare(password, u.passwordHash))) throw new AppError("FORBIDDEN", { message: "Your password wasn't accepted, so nothing was exported." });
  if (await hasMfa(ctx.user.id)) { const r = await verifySecondFactor(ctx.user.id, code); if (!r.ok) throw new AppError("FORBIDDEN", { message: "The authentication code wasn't accepted, so nothing was exported." }); }
}

type Dataset = { name: string; cols: Column[]; rows: Row[]; truncated: boolean };
async function load(ctx: TenantRequestContext, kind: ExportKind): Promise<Dataset> {
  const tdb = db(ctx);
  if (kind === "patients") {
    const rows = await tdb.patient.findMany({ orderBy: { createdAt: "asc" }, take: CAP + 1 }) as Rec[];
    return { name: "Patients", truncated: rows.length > CAP, cols: [
      { key: "code", label: "Patient ID" }, { key: "name", label: "Full name" }, { key: "phone", label: "Mobile" }, { key: "alternatePhone", label: "Alternate phone" }, { key: "email", label: "Email" },
      { key: "gender", label: "Gender" }, { key: "dateOfBirth", label: "Date of birth" }, { key: "ageYears", label: "Age", type: "number" }, { key: "addressLine", label: "Address" }, { key: "city", label: "City" },
      { key: "state", label: "State" }, { key: "pincode", label: "Pincode" }, { key: "bloodGroup", label: "Blood group" }, { key: "occupation", label: "Occupation" }, { key: "status", label: "Status" }, { key: "registered", label: "Registered on" },
    ], rows: rows.slice(0, CAP).map((p) => ({ ...p, dateOfBirth: p.dateOfBirth instanceof Date ? p.dateOfBirth.toISOString().slice(0, 10) : p.dateOfBirth, registered: p.createdAt instanceof Date ? p.createdAt.toISOString().slice(0, 10) : "" })) as Row[] };
  }
  if (kind === "medicines") {
    const [meds, batches] = await Promise.all([tdb.medicine.findMany({ orderBy: { genericName: "asc" }, take: CAP + 1 }) as Promise<Rec[]>, tdb.medicineBatch.groupBy({ by: ["medicineId"], _sum: { quantityAvailable: true } }) as Promise<{ medicineId: string; _sum: { quantityAvailable: number | null } }[]>]);
    const stock = new Map(batches.map((b) => [b.medicineId, b._sum.quantityAvailable ?? 0]));
    return { name: "Medicines", truncated: meds.length > CAP, cols: [
      { key: "medicineCode", label: "Code" }, { key: "genericName", label: "Generic name" }, { key: "brandName", label: "Brand name" }, { key: "strength", label: "Strength" }, { key: "dosageForm", label: "Form" },
      { key: "manufacturer", label: "Manufacturer" }, { key: "category", label: "Category" }, { key: "unit", label: "Unit" }, { key: "packSize", label: "Pack size", type: "number" }, { key: "barcode", label: "Barcode" },
      { key: "purchase", label: "Purchase price (₹)", type: "number" }, { key: "selling", label: "Selling price / MRP (₹)", type: "number" }, { key: "gst", label: "GST %", type: "number" },
      { key: "reorderLevel", label: "Reorder level", type: "number" }, { key: "inStock", label: "In stock", type: "number" }, { key: "rx", label: "Prescription needed" }, { key: "active", label: "Active" },
    ], rows: meds.slice(0, CAP).map((m) => ({ ...m, purchase: rupees(m.purchasePriceMinor), selling: rupees(m.sellingPriceMinor), gst: String((Number(m.taxRateBp) || 0) / 100), inStock: stock.get(String(m.id)) ?? 0, rx: yn(m.prescriptionRequired), active: yn(m.active) })) };
  }
  if (kind === "stock") {
    const batches = await tdb.medicineBatch.findMany({ include: { medicine: { select: { medicineCode: true, genericName: true, brandName: true, strength: true } } }, orderBy: { expiryDate: "asc" }, take: CAP + 1 }) as Rec[];
    return { name: "Stock by batch", truncated: batches.length > CAP, cols: [
      { key: "code", label: "Code" }, { key: "medicine", label: "Medicine" }, { key: "batchNumber", label: "Batch" }, { key: "expiryDate", label: "Expiry" }, { key: "quantityAvailable", label: "Available", type: "number" },
      { key: "purchase", label: "Purchase price (₹)", type: "number" }, { key: "selling", label: "Selling price (₹)", type: "number" }, { key: "status", label: "Status" },
    ], rows: batches.slice(0, CAP).map((b) => { const med = (b.medicine ?? {}) as Record<string, string | null>; return { ...b, code: med.medicineCode, medicine: [med.brandName ?? med.genericName, med.strength].filter(Boolean).join(" "), purchase: rupees(b.purchasePriceMinor), selling: rupees(b.sellingPriceMinor) }; }) };
  }
  if (kind === "suppliers") {
    const rows = await tdb.supplier.findMany({ orderBy: { supplierName: "asc" }, take: CAP + 1 }) as Rec[];
    return { name: "Suppliers", truncated: rows.length > CAP, cols: [
      { key: "supplierCode", label: "Code" }, { key: "supplierName", label: "Supplier name" }, { key: "contactPerson", label: "Contact person" }, { key: "phone", label: "Phone" }, { key: "email", label: "Email" },
      { key: "address", label: "Address" }, { key: "taxId", label: "GSTIN" }, { key: "paymentTerms", label: "Payment terms" }, { key: "active", label: "Active" },
    ], rows: rows.slice(0, CAP).map((s) => ({ ...s, active: yn(s.active) })) };
  }
  const rows = await tdb.investigation.findMany({ orderBy: { testName: "asc" }, take: CAP + 1 }) as Rec[];
  return { name: "Lab tests", truncated: rows.length > CAP, cols: [
    { key: "testCode", label: "Test code" }, { key: "testName", label: "Test name" }, { key: "shortName", label: "Short name" }, { key: "category", label: "Category" }, { key: "sampleType", label: "Sample type" },
    { key: "department", label: "Department" }, { key: "turnaroundHours", label: "Turnaround (hours)", type: "number" }, { key: "active", label: "Active" },
  ], rows: rows.slice(0, CAP).map((t) => ({ ...t, active: yn(t.active) })) };
}

export async function exportList(ctx: TenantRequestContext, kindKey: string, formatRaw: string, confirm: { password?: string; code?: string } = {}) {
  if (!isExportKind(kindKey)) throw new AppError("NOT_FOUND", { message: "Unknown export." });
  const kind = kindKey; const format: ExportFormat = formatRaw === "csv" ? "csv" : "xlsx";
  if (!canExport(ctx, kind)) throw new AppError("FORBIDDEN");
  if (needsConfirmation(kind)) await confirmIdentity(ctx, confirm.password, confirm.code); // wrong passwords are limited separately and don't use up the export allowance
  const lim = await rateLimit(`export:${kind === "patients" ? "patients" : "list"}:${ctx.user.id}`, { limit: kind === "patients" ? 4 : 30, windowMs: 60 * 60_000 });
  if (!lim.allowed) throw new AppError("RATE_LIMITED", { message: "Too many exports. Try again later." });
  const data = await load(ctx, kind);
  const meta: ReportMeta = { name: data.name, description: `${data.name} list`, dataSource: ctx.tenant.name, range: "All records", timezone: ctx.tenant.timezone, generatedAt: new Date().toISOString(), generatedBy: ctx.user.name, filters: "None", ...(data.truncated ? { truncated: true } : {}) } as ReportMeta;
  await recordAudit({ action: AUDIT_ACTIONS.DATA_EXPORTED, tenantId: ctx.tenantId, actorId: ctx.user.id, entityType: "export", metadata: { kind, format, rows: data.rows.length } });
  if (kind === "patients") await onExport({ actorId: ctx.user.id, tenantId: ctx.tenantId, kind: "patients-list" });
  return { ...tableToFile(meta, data.cols, data.rows, format, `${ctx.tenant.slug}-${kind}`), rows: data.rows.length, truncated: data.truncated };
}
