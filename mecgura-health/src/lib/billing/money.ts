/**
 * Money rules (pure, shared by server and UI).
 *  - Amounts are INTEGER minor units (paise/cents). Never floats. Currency is stored next to every amount.
 *  - Rounding: half away from zero, done ONCE per line with integer arithmetic (BigInt for the multiply/divide), so
 *    item totals, discounts, tax, invoice totals, balances and refunds all use the same rule.
 *  - The server is the only source of truth for totals; the UI calls the preview endpoint and never trusts its own sums.
 */
export const MAX_MINOR = 2_000_000_000; // stays inside a 32-bit column: about 2 crore for 2-decimal currencies
export const MAX_QTY = 999;
export const PAYMENT_METHODS = ["CASH", "UPI", "CARD", "BANK_TRANSFER", "ONLINE", "CHEQUE", "OTHER"] as const;
/** Methods a clinic can record by hand. ONLINE needs a payment gateway, which is not configured. */
export const MANUAL_METHODS = PAYMENT_METHODS.filter((m) => m !== "ONLINE");
export const SERVICE_TYPES = ["CONSULTATION", "FOLLOW_UP", "PROCEDURE", "INVESTIGATION", "MEDICINE", "DOCUMENT", "OTHER"] as const;
/** Statuses that can still carry an unpaid balance (a refund never re-creates a due amount, but an invoice that was only partly paid still owes the rest). */
export const COLLECTIBLE = ["ISSUED", "PARTIALLY_PAID", "PARTIALLY_REFUNDED", "REFUNDED"] as const;
export const INVOICE_STATUSES = ["DRAFT", "ISSUED", "PARTIALLY_PAID", "PAID", "CANCELLED", "REFUNDED", "PARTIALLY_REFUNDED"] as const;
export type DiscountType = "PERCENT" | "FIXED";
export interface Discount { type: DiscountType; value: number } // PERCENT: basis points (500 = 5%), FIXED: minor units

/** a*b/d rounded half away from zero (non-negative inputs). */
export function mulDivRound(a: number, b: number, d: number): number {
  if (d <= 0) throw new RangeError("divisor must be positive");
  const n = BigInt(Math.trunc(a)) * BigInt(Math.trunc(b)); const D = BigInt(d);
  return Number((n * BigInt(2) + D) / (BigInt(2) * D));
}
export const pct = (amount: number, bp: number) => mulDivRound(amount, bp, 10000);

/** Split `total` across `weights` so the parts add up exactly (largest remainder, stable order). */
export function allocate(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (total <= 0 || sum <= 0) return weights.map(() => 0);
  const raw = weights.map((w) => (BigInt(total) * BigInt(w)));
  const S = BigInt(sum);
  const base = raw.map((r) => Number(r / S));
  let left = total - base.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, rem: r % S })).sort((a, b) => (a.rem === b.rem ? a.i - b.i : a.rem > b.rem ? -1 : 1));
  for (const o of order) { if (left <= 0) break; if (weights[o.i] > 0) { base[o.i] += 1; left -= 1; } }
  return base;
}

export interface LineInput { quantity: number; unitPriceMinor: number; discount?: Discount | null; taxRateBp: number; discountEligible?: boolean }
export interface LineResult { lineSubtotalMinor: number; discountMinor: number; invoiceDiscountMinor: number; taxMinor: number; lineTotalMinor: number }
export interface InvoiceResult { lines: LineResult[]; subtotalMinor: number; discountMinor: number; taxMinor: number; totalMinor: number }
export class MoneyError extends Error { constructor(public field: string, message: string) { super(message); } }

export function computeInvoice(lines: LineInput[], invoiceDiscount: Discount | null, taxMode: "EXCLUSIVE" | "INCLUSIVE"): InvoiceResult {
  const gross = lines.map((l, n) => {
    if (!Number.isInteger(l.quantity) || l.quantity < 1 || l.quantity > MAX_QTY) throw new MoneyError(`items.${n}.quantity`, `Quantity must be between 1 and ${MAX_QTY}.`);
    if (!Number.isInteger(l.unitPriceMinor) || l.unitPriceMinor < 0 || l.unitPriceMinor > MAX_MINOR) throw new MoneyError(`items.${n}.unitPriceMinor`, "Enter a valid price.");
    const g = l.quantity * l.unitPriceMinor;
    if (g > MAX_MINOR) throw new MoneyError(`items.${n}.unitPriceMinor`, "This line is too large.");
    return g;
  });
  const own = lines.map((l, n) => {
    const d = l.discount; if (!d) return 0;
    if (!Number.isInteger(d.value) || d.value < 0) throw new MoneyError(`items.${n}.discount`, "Enter a valid discount.");
    const v = d.type === "PERCENT" ? (d.value > 10000 ? (() => { throw new MoneyError(`items.${n}.discount`, "A percentage can't exceed 100%."); })() : pct(gross[n], d.value)) : d.value;
    if (v > gross[n]) throw new MoneyError(`items.${n}.discount`, "A discount can't exceed the line amount.");
    return v;
  });
  const base = gross.map((g, n) => g - own[n]);
  const weights = base.map((b, n) => (lines[n].discountEligible === false ? 0 : b));
  const eligibleBase = weights.reduce((a, b) => a + b, 0);
  let inv = 0;
  if (invoiceDiscount) {
    if (!Number.isInteger(invoiceDiscount.value) || invoiceDiscount.value < 0) throw new MoneyError("discount", "Enter a valid discount.");
    if (invoiceDiscount.type === "PERCENT" && invoiceDiscount.value > 10000) throw new MoneyError("discount", "A percentage can't exceed 100%.");
    inv = invoiceDiscount.type === "PERCENT" ? pct(eligibleBase, invoiceDiscount.value) : invoiceDiscount.value;
    if (inv > eligibleBase) throw new MoneyError("discount", "The discount can't exceed the amount it applies to.");
  }
  const share = allocate(inv, weights);
  const out: LineResult[] = lines.map((l, n) => {
    const net = base[n] - share[n];
    const tax = l.taxRateBp > 0 ? (taxMode === "EXCLUSIVE" ? pct(net, l.taxRateBp) : mulDivRound(net, l.taxRateBp, 10000 + l.taxRateBp)) : 0;
    return { lineSubtotalMinor: gross[n], discountMinor: own[n], invoiceDiscountMinor: share[n], taxMinor: tax, lineTotalMinor: taxMode === "EXCLUSIVE" ? net + tax : net };
  });
  const sum = (f: (r: LineResult) => number) => out.reduce((a, r) => a + f(r), 0);
  const res = { lines: out, subtotalMinor: sum((r) => r.lineSubtotalMinor), discountMinor: sum((r) => r.discountMinor + r.invoiceDiscountMinor), taxMinor: sum((r) => r.taxMinor), totalMinor: sum((r) => r.lineTotalMinor) };
  if (res.totalMinor > MAX_MINOR || res.subtotalMinor > MAX_MINOR) throw new MoneyError("items", "This invoice is too large.");
  return res;
}

/** Invoice status from the money that actually moved. DRAFT and CANCELLED are decided by explicit actions, not by this. */
export function deriveInvoiceStatus(inv: { totalMinor: number; collectedMinor: number; refundedMinor: number }): "ISSUED" | "PARTIALLY_PAID" | "PAID" | "REFUNDED" | "PARTIALLY_REFUNDED" {
  if (inv.refundedMinor > 0) return inv.refundedMinor >= inv.collectedMinor ? "REFUNDED" : "PARTIALLY_REFUNDED";
  if (inv.collectedMinor <= 0) return "ISSUED";
  return inv.collectedMinor >= inv.totalMinor ? "PAID" : "PARTIALLY_PAID";
}
export const dueOf = (inv: { totalMinor: number; collectedMinor: number }) => Math.max(0, inv.totalMinor - inv.collectedMinor);
/** OVERDUE is a view of an open balance past its due date; it is never stored. */
export function isOverdue(inv: { status: string; dueDate: string | null; totalMinor: number; collectedMinor: number }, today: string) {
  return (COLLECTIBLE as readonly string[]).includes(inv.status) && !!inv.dueDate && inv.dueDate < today && dueOf(inv) > 0;
}

/** "1,250.50" / "1250.5" -> 125050. Strings only, no floating point. Returns null when invalid. */
export function moneyToMinor(input: string, exponent = 2): number | null {
  const s = input.trim().replace(/[,\s₹]/g, "");
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const [w, f = ""] = s.split(".");
  if (f.length > exponent) return null;
  const n = Number(w) * 10 ** exponent + Number(f.padEnd(exponent, "0"));
  return Number.isSafeInteger(n) && n <= MAX_MINOR ? n : null;
}
export function formatMoney(minor: number, currency = "INR"): string {
  const neg = minor < 0; const abs = Math.abs(minor);
  const whole = Math.floor(abs / 100); const frac = String(abs % 100).padStart(2, "0");
  const lang = currency === "INR" ? "en-IN" : "en-US";
  let sym = currency; try { sym = new Intl.NumberFormat(lang, { style: "currency", currency, currencyDisplay: "narrowSymbol" }).formatToParts(0).find((p) => p.type === "currency")?.value ?? currency; } catch { /* unknown code: show it */ }
  return `${neg ? "-" : ""}${sym}${new Intl.NumberFormat(lang).format(whole)}.${frac}`;
}
export const minorToInput = (minor: number) => `${Math.floor(minor / 100)}.${String(minor % 100).padStart(2, "0")}`;
export const bpToInput = (bp: number) => (bp % 100 === 0 ? String(bp / 100) : (bp / 100).toFixed(2));
export function percentToBp(input: string): number | null {
  const s = input.trim().replace("%", "");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [w, f = ""] = s.split(".");
  return Number(w) * 100 + Number(f.padEnd(2, "0"));
}
