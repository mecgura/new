import { mulDivRound } from "@/lib/billing/money";

/** Server-side invoice maths in integer minor units (no floats). Tax is configuration-driven; nothing is assumed. */
export interface TaxConfig { enabled: boolean; mode: "EXCLUSIVE" | "INCLUSIVE"; name: string; rateBp: number; /** MECGURA's own GST state code; when it equals the clinic's, tax is split CGST+SGST, otherwise IGST */ vendorStateCode: string | null }
export const DEFAULT_TAX: TaxConfig = { enabled: false, mode: "EXCLUSIVE", name: "GST", rateBp: 0, vendorStateCode: null };
export function mergeTax(raw: Partial<TaxConfig> | null | undefined): TaxConfig {
  const r = raw ?? {}; const rate = typeof r.rateBp === "number" && Number.isInteger(r.rateBp) && r.rateBp >= 0 && r.rateBp <= 5000 ? r.rateBp : 0;
  return { enabled: r.enabled === true && rate > 0, mode: r.mode === "INCLUSIVE" ? "INCLUSIVE" : "EXCLUSIVE", name: typeof r.name === "string" && r.name.trim() ? r.name.trim().slice(0, 20) : "GST", rateBp: rate, vendorStateCode: typeof r.vendorStateCode === "string" && /^\d{2}$/.test(r.vendorStateCode) ? r.vendorStateCode : null };
}
export interface TaxLine { name: string; rateBp: number; amountMinor: number }
export interface InvoiceMath { subtotalMinor: number; discountMinor: number; taxableMinor: number; taxMinor: number; totalMinor: number; taxMode: "EXCLUSIVE" | "INCLUSIVE"; taxLines: TaxLine[]; placeOfSupply: "INTRA_STATE" | "INTER_STATE" | "NOT_APPLICABLE" }

/** items are line totals in minor units (may be negative for credits). */
export function computeInvoice(lineTotals: number[], discountMinor: number, tax: TaxConfig, clinicStateCode: string | null): InvoiceMath {
  if (![...lineTotals, discountMinor].every((n) => Number.isSafeInteger(n))) throw new RangeError("Amounts must be whole minor units.");
  const subtotal = lineTotals.reduce((a, b) => a + b, 0); const discount = Math.min(Math.max(0, discountMinor), Math.max(0, subtotal)); const taxable = subtotal - discount;
  if (!tax.enabled || taxable <= 0) return { subtotalMinor: subtotal, discountMinor: discount, taxableMinor: taxable, taxMinor: 0, totalMinor: taxable, taxMode: tax.mode, taxLines: [], placeOfSupply: "NOT_APPLICABLE" };
  // INCLUSIVE: the amount already contains tax, so tax = amount − amount/(1+rate); EXCLUSIVE: tax is added on top.
  const taxMinor = tax.mode === "INCLUSIVE" ? taxable - mulDivRound(taxable, 10000, 10000 + tax.rateBp) : mulDivRound(taxable, tax.rateBp, 10000);
  const intra = !!tax.vendorStateCode && !!clinicStateCode && tax.vendorStateCode === clinicStateCode;
  const lines: TaxLine[] = intra
    ? (() => { const half = Math.floor(taxMinor / 2); const rate = Math.floor(tax.rateBp / 2); return [{ name: "CGST", rateBp: rate, amountMinor: half }, { name: "SGST", rateBp: tax.rateBp - rate, amountMinor: taxMinor - half }]; })()
    : [{ name: tax.vendorStateCode && clinicStateCode ? "IGST" : tax.name, rateBp: tax.rateBp, amountMinor: taxMinor }];
  return { subtotalMinor: subtotal, discountMinor: discount, taxableMinor: taxable, taxMinor, totalMinor: tax.mode === "INCLUSIVE" ? taxable : taxable + taxMinor, taxMode: tax.mode, taxLines: lines, placeOfSupply: !tax.vendorStateCode || !clinicStateCode ? "NOT_APPLICABLE" : intra ? "INTRA_STATE" : "INTER_STATE" };
}
