import type { TenantRequestContext } from "@/lib/auth/context";
import { patientRegisterSchema } from "@/lib/validation/patients";
import { investigationSchema } from "@/lib/validation/lab";
import { medicineSchema as pharmacyMedicineSchema, supplierSchema } from "@/lib/validation/pharmacy";
import type { z } from "zod";
import { normHeader } from "./table";

/**
 * What can be imported from a spreadsheet. Each kind lists its columns (with the aliases people actually use in their own sheets),
 * turns a row of text into the exact input the normal create form/API takes, and says who may import. Rows are then created through
 * the SAME service functions the screens use, so validation, tenant isolation, plan limits, counters and audit are identical.
 */
export type ImportKindKey = "patients" | "medicines" | "suppliers" | "lab-tests";
export interface ImportField { key: string; label: string; required?: boolean; example: string; aliases?: string[]; note?: string }
export interface ImportKind {
  key: ImportKindKey; label: string; description: string;
  fields: ImportField[];
  schema: z.ZodType;
  allowed: (ctx: TenantRequestContext) => boolean;
  build: (v: Record<string, string>) => Record<string, unknown>;
  /** One line that identifies a record for duplicate detection, or null. */
  dupeKey?: (input: Record<string, unknown>) => string | null;
}

const clean = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== "" && v !== undefined && v !== null));
const yes = (s: string, dflt: boolean) => { const v = s.trim().toLowerCase(); if (!v) return dflt; if (["y", "yes", "true", "1", "required", "haan", "ha"].includes(v)) return true; if (["n", "no", "false", "0", "otc", "nahi", "na"].includes(v)) return false; return dflt; };
/** "₹ 1,250.50" -> 125050 paise; text that isn't a number is passed through so validation reports it. */
const rupeesToMinor = (s: string): unknown => { if (!s.trim()) return undefined; const n = Number(s.replace(/[₹,\s]|rs\.?|inr/gi, "")); return Number.isFinite(n) ? Math.round(n * 100) : s; };
const percentToBp = (s: string): unknown => { if (!s.trim()) return undefined; const n = Number(s.replace(/[%\s]/g, "")); return Number.isFinite(n) ? Math.round(n * 100) : s; };
const intOrRaw = (s: string): unknown => { if (!s.trim()) return undefined; const n = Number(s.replace(/,/g, "")); return Number.isFinite(n) ? n : s; };
/** 17/05/1990, 17-5-1990, 17.05.1990 and 1990-05-17 all become 1990-05-17. */
export const toIsoDate = (s: string) => { const t = s.trim(); const m = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/.exec(t); return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : t; };
const gender = (s: string) => { const v = s.trim().toLowerCase(); if (!v) return undefined; if (["m", "male", "man", "purush"].includes(v)) return "MALE"; if (["f", "female", "woman", "mahila"].includes(v)) return "FEMALE"; if (["o", "other", "others"].includes(v)) return "OTHER"; if (/^(prefer|undisclosed|not)/.test(v)) return "UNDISCLOSED"; return v.toUpperCase(); };
const blood = (s: string) => s.trim().toUpperCase().replace(/\s+/g, "").replace("POSITIVE", "+").replace("NEGATIVE", "-");

export const IMPORT_KINDS: Record<ImportKindKey, ImportKind> = {
  patients: {
    key: "patients", label: "Patients", description: "Register many patients at once. Existing patients (same phone, or same name and date of birth) are skipped, never overwritten.",
    schema: patientRegisterSchema,
    allowed: (c) => c.permissions.has("patients.create") && c.permissions.has("patients.export") && c.user.role !== "SUPER_ADMIN",
    fields: [
      { key: "name", label: "Full name", required: true, example: "Gurpreet Singh", aliases: ["name", "patientname", "fullname"] },
      { key: "phone", label: "Mobile", required: true, example: "9876543210", aliases: ["phone", "mobile", "mobileno", "mobilenumber", "contact", "phoneno"] },
      { key: "gender", label: "Gender", example: "Male", note: "Male, Female, Other", aliases: ["sex"] },
      { key: "dateOfBirth", label: "Date of birth", example: "17/05/1990", note: "DD/MM/YYYY or YYYY-MM-DD", aliases: ["dob", "birthdate"] },
      { key: "ageYears", label: "Age", example: "34", note: "only if no date of birth", aliases: ["age", "ageyears"] },
      { key: "alternatePhone", label: "Alternate phone", example: "", aliases: ["altphone", "phone2", "secondaryphone"] },
      { key: "email", label: "Email", example: "", aliases: ["emailid", "emailaddress"] },
      { key: "addressLine", label: "Address", example: "12 Model Town", aliases: ["address", "addressline"] },
      { key: "city", label: "City", example: "Ludhiana", aliases: ["town", "village"] },
      { key: "state", label: "State", example: "Punjab" },
      { key: "pincode", label: "Pincode", example: "141002", aliases: ["pin", "zip", "postalcode"] },
      { key: "bloodGroup", label: "Blood group", example: "B+", aliases: ["bloodgrp", "blood"] },
      { key: "occupation", label: "Occupation", example: "" },
      { key: "emergencyContactName", label: "Emergency contact name", example: "", aliases: ["emergencyname"] },
      { key: "emergencyContactPhone", label: "Emergency contact phone", example: "", aliases: ["emergencyphone"] },
    ],
    build: (v) => clean({ name: v.name, phone: v.phone, gender: gender(v.gender ?? ""), dateOfBirth: v.dateOfBirth ? toIsoDate(v.dateOfBirth) : "", ageYears: v.ageYears || undefined, alternatePhone: v.alternatePhone, email: v.email, addressLine: v.addressLine, city: v.city, state: v.state, pincode: v.pincode, bloodGroup: v.bloodGroup ? blood(v.bloodGroup) : "", occupation: v.occupation, emergencyContactName: v.emergencyContactName, emergencyContactPhone: v.emergencyContactPhone }),
  },
  medicines: {
    key: "medicines", label: "Medicines", description: "Add the clinic's medicine master list with prices. Medicines already in the list (same generic name, brand and strength) are skipped. Stock is added separately through purchases.",
    schema: pharmacyMedicineSchema,
    allowed: (c) => c.permissions.has("pharmacy.medicines") && c.user.role !== "SUPER_ADMIN",
    fields: [
      { key: "genericName", label: "Generic name", required: true, example: "Paracetamol", aliases: ["generic", "name", "medicine", "medicinename", "drug", "salt", "composition"] },
      { key: "brandName", label: "Brand name", example: "Crocin", aliases: ["brand", "tradename"] },
      { key: "strength", label: "Strength", example: "500 mg", aliases: ["dose", "potency"] },
      { key: "dosageForm", label: "Form", example: "Tablet", note: "Tablet, Syrup, Injection…", aliases: ["form", "type", "dosageform"] },
      { key: "manufacturer", label: "Manufacturer", example: "GSK", aliases: ["company", "mfg", "mfr", "maker"] },
      { key: "category", label: "Category", example: "Analgesic", aliases: ["group", "class"] },
      { key: "unit", label: "Unit", example: "strip", aliases: ["uom"] },
      { key: "packSize", label: "Pack size", example: "10", aliases: ["pack", "packing"] },
      { key: "barcode", label: "Barcode", example: "", aliases: ["ean", "upc", "code"] },
      { key: "purchasePrice", label: "Purchase price (₹)", example: "18.50", aliases: ["purchaserate", "cost", "costprice", "ptr", "buyprice"] },
      { key: "sellingPrice", label: "Selling price / MRP (₹)", example: "25", aliases: ["mrp", "price", "rate", "sellingrate", "saleprice"] },
      { key: "taxRate", label: "GST %", example: "12", aliases: ["gst", "tax", "gstpercent", "taxpercent"] },
      { key: "reorderLevel", label: "Reorder level", example: "20", aliases: ["reorder", "reorderqty"] },
      { key: "prescriptionRequired", label: "Prescription needed", example: "Yes", note: "Yes or No (default Yes)", aliases: ["rx", "prescription", "rxrequired"] },
      { key: "notes", label: "Notes", example: "" },
    ],
    build: (v) => clean({ genericName: v.genericName, brandName: v.brandName, strength: v.strength, dosageForm: v.dosageForm, manufacturer: v.manufacturer, category: v.category, unit: v.unit || "unit", packSize: intOrRaw(v.packSize ?? ""), barcode: v.barcode, purchasePriceMinor: rupeesToMinor(v.purchasePrice ?? ""), sellingPriceMinor: rupeesToMinor(v.sellingPrice ?? ""), taxRateBp: percentToBp(v.taxRate ?? ""), reorderLevel: intOrRaw(v.reorderLevel ?? ""), prescriptionRequired: yes(v.prescriptionRequired ?? "", true), notes: v.notes }),
    dupeKey: (i) => [i.genericName, i.brandName, i.strength].map((x) => String(x ?? "").trim().toLowerCase()).join("|"),
  },
  suppliers: {
    key: "suppliers", label: "Suppliers", description: "Add medicine suppliers. A supplier with the same name is skipped.",
    schema: supplierSchema,
    allowed: (c) => c.permissions.has("pharmacy.suppliers") && c.user.role !== "SUPER_ADMIN",
    fields: [
      { key: "supplierName", label: "Supplier name", required: true, example: "Punjab Pharma Distributors", aliases: ["name", "supplier", "vendor", "vendorname", "company"] },
      { key: "contactPerson", label: "Contact person", example: "Mr. Sharma", aliases: ["contact", "person"] },
      { key: "phone", label: "Phone", example: "9876500000", aliases: ["mobile", "phoneno", "contactno"] },
      { key: "email", label: "Email", example: "" },
      { key: "address", label: "Address", example: "" },
      { key: "taxId", label: "GSTIN", example: "", aliases: ["gst", "gstno", "taxid", "gstnumber"] },
      { key: "paymentTerms", label: "Payment terms", example: "30 days", aliases: ["terms", "credit"] },
      { key: "notes", label: "Notes", example: "" },
    ],
    build: (v) => clean({ supplierName: v.supplierName, contactPerson: v.contactPerson, phone: v.phone, email: v.email, address: v.address, taxId: v.taxId, paymentTerms: v.paymentTerms, notes: v.notes }),
    dupeKey: (i) => String(i.supplierName ?? "").trim().toLowerCase(),
  },
  "lab-tests": {
    key: "lab-tests", label: "Lab tests", description: "Add the investigations your clinic offers. A test code that already exists is skipped. Result parameters and reference ranges are set on each test afterwards.",
    schema: investigationSchema,
    allowed: (c) => c.permissions.has("lab.configure") && c.user.role !== "SUPER_ADMIN",
    fields: [
      { key: "testCode", label: "Test code", required: true, example: "CBC", aliases: ["code", "testid"] },
      { key: "testName", label: "Test name", required: true, example: "Complete Blood Count", aliases: ["name", "test"] },
      { key: "category", label: "Category", required: true, example: "Haematology", aliases: ["group", "section"] },
      { key: "shortName", label: "Short name", example: "CBC" },
      { key: "sampleType", label: "Sample type", example: "Blood (EDTA)", aliases: ["sample", "specimen"] },
      { key: "department", label: "Department", example: "Pathology", aliases: ["dept"] },
      { key: "turnaroundHours", label: "Turnaround (hours)", example: "6", aliases: ["tat", "turnaround", "hours"] },
      { key: "preparation", label: "Preparation", example: "", aliases: ["instructions", "fasting"] },
      { key: "description", label: "Description", example: "" },
    ],
    build: (v) => clean({ testCode: v.testCode, testName: v.testName, category: v.category, shortName: v.shortName, sampleType: v.sampleType, department: v.department, turnaroundHours: v.turnaroundHours, preparation: v.preparation, description: v.description }),
    dupeKey: (i) => String(i.testCode ?? "").trim().toUpperCase(),
  },
};

export const isImportKind = (k: string): k is ImportKindKey => k in IMPORT_KINDS;

/** Maps the sheet's header cells to field keys. Unknown columns are reported, never silently used. */
export function mapHeaders(kind: ImportKind, headers: string[]) {
  const byAlias = new Map<string, string>();
  for (const f of kind.fields) for (const a of [f.key, f.label, ...(f.aliases ?? [])]) byAlias.set(normHeader(a), f.key);
  const index: Record<string, number> = {}; const unknown: string[] = [];
  headers.forEach((h, i) => { const key = byAlias.get(normHeader(h)); if (key && !(key in index)) index[key] = i; else if (h) unknown.push(h); });
  const missing = kind.fields.filter((f) => f.required && !(f.key in index)).map((f) => f.label);
  return { index, unknown, missing };
}
