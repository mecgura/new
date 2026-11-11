import { MAX_MINOR, pct } from "@/lib/billing/money";

/** Pure inventory rules (no database): expiry classification, batch status, FEFO allocation, purchase totals. */
export const MAX_STOCK_QTY = 1_000_000;
export const LEDGER_TYPES = ["OPENING", "PURCHASE", "DISPENSE", "RETURN", "SALE_RETURN", "PURCHASE_RETURN", "ADJUSTMENT_IN", "ADJUSTMENT_OUT", "DAMAGE", "EXPIRY", "TRANSFER_IN", "TRANSFER_OUT", "REVERSAL"] as const;
export type LedgerType = (typeof LEDGER_TYPES)[number];
export const ADJUST_REASONS = ["PHYSICAL_COUNT_CORRECTION", "DAMAGE", "DATA_CORRECTION", "OTHER"] as const;
export const RETURN_CONDITIONS = ["SEALED", "OPENED", "DAMAGED", "EXPIRED"] as const;

export type ExpiryState = "EXPIRED" | "NEAR_EXPIRY" | "VALID";
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}
/** A batch is valid through its expiry date; the day after it, it is expired. */
export const daysRemaining = (expiryDate: string, today: string) => daysBetween(today, expiryDate);
export function expiryState(expiryDate: string, today: string, nearDays: number): ExpiryState {
  const d = daysRemaining(expiryDate, today);
  return d < 0 ? "EXPIRED" : d <= nearDays ? "NEAR_EXPIRY" : "VALID";
}

export interface BatchLike { id: string; status: string; expiryDate: string; quantityAvailable: number; batchNumber?: string }
export type BatchDisplayStatus = "ACTIVE" | "LOW_STOCK" | "EXPIRED" | "BLOCKED" | "DEPLETED";
export function batchDisplayStatus(b: BatchLike, today: string, lowAt: number): BatchDisplayStatus {
  if (b.status === "BLOCKED") return "BLOCKED";
  if (b.expiryDate < today) return "EXPIRED";
  if (b.quantityAvailable <= 0) return "DEPLETED";
  return b.quantityAvailable <= lowAt ? "LOW_STOCK" : "ACTIVE";
}
export const isDispensable = (b: BatchLike, today: string) => b.status !== "BLOCKED" && b.expiryDate >= today && b.quantityAvailable > 0;

/** First Expiry, First Out: earliest expiry first (batch number, then id as stable tie-breakers). Never includes expired, blocked or empty batches. */
export function fefoOrder<T extends BatchLike>(batches: T[], today: string): T[] {
  return batches.filter((b) => isDispensable(b, today)).sort((a, b) => a.expiryDate.localeCompare(b.expiryDate) || (a.batchNumber ?? "").localeCompare(b.batchNumber ?? "") || a.id.localeCompare(b.id));
}
export interface Allocation { batchId: string; quantity: number }
/** Suggests an allocation for `quantity` units by FEFO; `short` is what could not be covered. */
export function allocateFefo<T extends BatchLike>(batches: T[], quantity: number, today: string): { allocations: Allocation[]; short: number } {
  let left = quantity; const allocations: Allocation[] = [];
  for (const b of fefoOrder(batches, today)) { if (left <= 0) break; const q = Math.min(left, b.quantityAvailable); allocations.push({ batchId: b.id, quantity: q }); left -= q; }
  return { allocations, short: Math.max(0, left) };
}

export interface PurchaseLineInput { quantity: number; unitPurchasePriceMinor: number; taxRateBp: number; discountMinor: number }
export interface PurchaseLineResult { grossMinor: number; discountMinor: number; taxMinor: number; lineTotalMinor: number }
/** Server-side purchase totals in integer minor units. Tax is added on the discounted amount; free quantity costs nothing. */
export function computePurchase(lines: PurchaseLineInput[]): { lines: PurchaseLineResult[]; subtotalMinor: number; discountMinor: number; taxMinor: number; totalMinor: number } {
  const out = lines.map((l) => {
    const gross = l.quantity * l.unitPurchasePriceMinor;
    if (!Number.isSafeInteger(gross) || gross > MAX_MINOR) throw new RangeError("Line amount is too large.");
    const discountMinor = Math.min(l.discountMinor, gross);
    const taxMinor = pct(gross - discountMinor, l.taxRateBp);
    return { grossMinor: gross, discountMinor, taxMinor, lineTotalMinor: gross - discountMinor + taxMinor };
  });
  const sum = (k: keyof PurchaseLineResult) => out.reduce((a, l) => a + l[k], 0);
  const r = { lines: out, subtotalMinor: sum("grossMinor"), discountMinor: sum("discountMinor"), taxMinor: sum("taxMinor"), totalMinor: sum("lineTotalMinor") };
  if (r.totalMinor > MAX_MINOR) throw new RangeError("Purchase total is too large.");
  return r;
}

/** Stable key for a prescription line that survives amendments (item ids are recreated when a prescription is amended). */
export const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
export function itemKeys(items: { name: string; strength: string | null }[]): string[] {
  const seen = new Map<string, number>();
  return items.map((i) => { const base = `${norm(i.name)}|${norm(i.strength)}`; const n = seen.get(base) ?? 0; seen.set(base, n + 1); return `${base}#${n}`; });
}
/** Prescribed quantity in whole units (a fractional prescription quantity is rounded UP so the patient is never short-changed). */
export const prescribedUnits = (q: number | null | undefined) => (q != null && q > 0 ? Math.ceil(q) : 0);

/** Sums a ledger: the result must equal the batch's available quantity. */
export const ledgerBalance = (rows: { quantity: number }[]) => rows.reduce((a, r) => a + r.quantity, 0);

/**
 * Does an inventory medicine correspond to a prescribed line? Generic or brand name must match exactly (case-insensitive) and, when both
 * sides state a strength, the strength must match too. There is NO fuzzy matching and no substitution: anything else is "does not match"
 * and the pharmacist has to contact the doctor.
 */
export function medicineMatchesItem(m: { genericName: string; brandName: string | null; strength: string | null }, item: { name: string; genericName: string | null; brandName: string | null; strength: string | null }): boolean {
  const mine = [m.genericName, m.brandName].map(norm).filter(Boolean);
  const wanted = [item.name, item.genericName, item.brandName].map(norm).filter(Boolean);
  if (!mine.some((x) => wanted.includes(x))) return false;
  const a = norm(m.strength).replace(/\s/g, ""); const b = norm(item.strength).replace(/\s/g, "");
  return !a || !b || a === b;
}
