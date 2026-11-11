import type { InvoiceDoc, ReceiptDoc, RefundReceiptDoc, StatementDoc } from "@/lib/services/billing-docs";
import { formatMoney } from "./money";

/** Clinic-branded financial documents. Pure; every value is escaped; branding comes from the tenant, never MECGURA. */
export const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
export const safeColor = (c: string) => (/^#[0-9a-f]{6}$/i.test(c) ? c : "#14529e");
const safeUrl = (u: string | null | undefined) => (u && /^(\/|https:\/\/)/.test(u) ? u : null);
const METHOD: Record<string, string> = { CASH: "Cash", UPI: "UPI", CARD: "Card", BANK_TRANSFER: "Bank transfer", ONLINE: "Online", CHEQUE: "Cheque", OTHER: "Other" };
export type Clinic = { name: string; logoUrl?: string | null; address?: string; phone?: string | null; email?: string | null; color: string; generatedAt: string };

export const head = (c: Clinic) => { const logo = safeUrl(c.logoUrl); return `<header>${logo ? `<img src="${esc(logo)}" alt="">` : ""}<div><h1>${esc(c.name)}</h1><small>${[c.address, c.phone && `Tel: ${c.phone}`, c.email].filter(Boolean).map(esc).join(" · ")}</small></div></header>`; };
export const style = (id: string, color: string) => `
#${id}{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#1f2933;background:#fff;max-width:820px;margin:0 auto;padding:28px;border:1px solid #d5dde5;border-radius:8px;line-height:1.45;position:relative}
#${id} header{display:flex;gap:16px;align-items:center;border-bottom:3px solid ${color};padding-bottom:12px;margin-bottom:12px}
#${id} header img{height:56px;width:56px;object-fit:contain}
#${id} h1{margin:0;font-size:22px;color:${color}} #${id} h2{font-size:16px;margin:16px 0 6px;color:${color}} #${id} small{color:#52606d}
#${id} .meta{display:grid;grid-template-columns:1fr 1fr;gap:4px 16px;margin:10px 0;font-size:14px}
#${id} .tw{overflow-x:auto} #${id} table{width:100%;border-collapse:collapse;margin:6px 0 12px;font-size:14px} #${id} th{background:${color};color:#fff;text-align:left;padding:6px 8px} #${id} td{border-bottom:1px solid #d5dde5;padding:6px 8px;vertical-align:top}
#${id} .r{text-align:right;font-variant-numeric:tabular-nums} #${id} .totals{margin-left:auto;width:min(100%,320px);font-size:14px} #${id} .totals div{display:flex;justify-content:space-between;padding:3px 0} #${id} .totals .grand{border-top:2px solid ${color};font-weight:700;font-size:16px;margin-top:4px;padding-top:6px}
#${id} .stamp{position:absolute;top:40px;right:28px;border:3px solid #b42318;color:#b42318;font-weight:800;letter-spacing:2px;padding:4px 12px;transform:rotate(8deg);border-radius:6px}
#${id} footer{margin-top:22px;display:flex;justify-content:space-between;gap:16px;font-size:12px;color:#52606d;border-top:1px solid #d5dde5;padding-top:10px}
@media (max-width:640px){#${id}{padding:14px}#${id} .meta{grid-template-columns:1fr}#${id} footer{flex-direction:column}}
@media print{body *{visibility:hidden}#${id},#${id} *{visibility:visible}#${id}{position:absolute;left:0;top:0;width:100%;max-width:none;border:0;border-radius:0}#${id} .tw{overflow:visible}@page{margin:12mm}}`;
export const foot = (c: Clinic, extra?: string | null) => `${extra ? `<p><small>${esc(extra).replace(/\n/g, "<br>")}</small></p>` : ""}<footer><span>${esc(c.name)} · generated ${esc(c.generatedAt)}</span><span>This document contains confidential information.</span></footer>`;
export const patientBlock = (p: { code: string; name: string; phone: string | null }) => `<div><strong>Patient:</strong> ${esc(p.name)}</div><div><strong>ID:</strong> ${esc(p.code)}</div>`;

export function renderInvoice(d: InvoiceDoc): { style: string; body: string } {
  const c = d.clinic; const m = (x: number) => esc(formatMoney(x, d.currency)); const id = "bill-doc";
  const rows = d.items.map((i, n) => `<tr><td>${n + 1}</td><td>${esc(i.description)}${i.code ? ` <small>${esc(i.code)}</small>` : ""}</td><td class="r">${esc(i.quantity)}</td><td class="r">${m(i.unitPriceMinor)}</td><td class="r">${i.discountMinor ? m(i.discountMinor) : "—"}</td><td class="r">${i.taxRateBp ? `${esc(i.taxName ?? "Tax")} ${esc((i.taxRateBp / 100).toFixed(2).replace(/\.00$/, ""))}%<br><small>${m(i.taxMinor)}</small>` : "—"}</td><td class="r">${m(i.lineTotalMinor)}</td></tr>`).join("");
  const pays = d.payments.length ? `<h2>Payments</h2><div class="tw"><table><thead><tr><th>Receipt</th><th>Date</th><th>Method</th><th class="r">Amount</th></tr></thead><tbody>${d.payments.map((p) => `<tr><td>${esc(p.receipt ?? p.number)}</td><td>${esc(p.date)}</td><td>${esc(METHOD[p.method] ?? p.method)}</td><td class="r">${m(p.amountMinor)}</td></tr>`).join("")}</tbody></table></div>` : "";
  const body = `<article id="${id}" aria-label="Invoice ${esc(d.number)}">${d.cancelled ? '<div class="stamp">CANCELLED</div>' : ""}${head(c)}
<div class="meta"><div><strong>Invoice ${esc(d.number)}</strong><br><small>${esc(d.status.replace(/_/g, " ").toLowerCase())}</small></div><div style="text-align:right">Date: ${esc(d.date)}${d.dueDate ? `<br>Due: ${esc(d.dueDate)}` : ""}</div></div>
<div class="meta">${patientBlock(d.patient)}${d.doctorName ? `<div><strong>Doctor:</strong> ${esc(d.doctorName)}</div>` : ""}</div>
<div class="tw"><table><thead><tr><th>#</th><th>Service</th><th class="r">Qty</th><th class="r">Price</th><th class="r">Discount</th><th class="r">Tax</th><th class="r">Total</th></tr></thead><tbody>${rows}</tbody></table></div>
<div class="totals"><div><span>Subtotal</span><span>${m(d.subtotalMinor)}</span></div>${d.discountMinor ? `<div><span>Discount</span><span>- ${m(d.discountMinor)}</span></div>` : ""}<div><span>${d.taxMode === "INCLUSIVE" ? "Tax (included)" : "Tax"}</span><span>${m(d.taxMinor)}</span></div><div class="grand"><span>Total</span><span>${m(d.totalMinor)}</span></div><div><span>Paid</span><span>${m(d.collectedMinor - d.refundedMinor)}</span></div>${d.refundedMinor ? `<div><span>Refunded</span><span>${m(d.refundedMinor)}</span></div>` : ""}<div><strong>Balance due</strong><strong>${m(d.dueMinor)}</strong></div></div>
${pays}${d.notes ? `<p><strong>Notes:</strong> ${esc(d.notes)}</p>` : ""}${d.terms ? `<p><small><strong>Payment terms:</strong> ${esc(d.terms)}</small></p>` : ""}${foot(c, d.footer)}</article>`;
  return { style: style(id, safeColor(c.color)), body };
}
export function renderReceipt(d: ReceiptDoc): { style: string; body: string } {
  const c = d.clinic; const m = (x: number) => esc(formatMoney(x, d.currency)); const id = "bill-doc";
  const body = `<article id="${id}" aria-label="Receipt ${esc(d.receiptNumber)}">${head(c)}
<div class="meta"><div><strong>Payment receipt ${esc(d.receiptNumber)}</strong><br><small>Payment ${esc(d.paymentNumber)}</small></div><div style="text-align:right">Date: ${esc(d.date)}</div></div>
<div class="meta">${patientBlock(d.patient)}<div><strong>Invoice:</strong> ${esc(d.invoiceNumber)}</div><div><strong>Method:</strong> ${esc(METHOD[d.method] ?? d.method)}</div>${d.reference ? `<div><strong>Reference:</strong> ${esc(d.reference)}</div>` : ""}${d.receivedBy ? `<div><strong>Received by:</strong> ${esc(d.receivedBy)}</div>` : ""}</div>
<div class="totals"><div class="grand"><span>Amount received</span><span>${m(d.amountMinor)}</span></div><div><span>Invoice total</span><span>${m(d.invoiceTotalMinor)}</span></div>${d.refundedMinor ? `<div><span>Refunded from this payment</span><span>${m(d.refundedMinor)}</span></div>` : ""}<div><strong>Balance remaining</strong><strong>${m(d.balanceMinor)}</strong></div></div>
${foot(c, d.footer)}</article>`;
  return { style: style(id, safeColor(c.color)), body };
}
export function renderRefundReceipt(d: RefundReceiptDoc): { style: string; body: string } {
  const c = d.clinic; const m = (x: number) => esc(formatMoney(x, d.currency)); const id = "bill-doc";
  const body = `<article id="${id}" aria-label="Refund receipt ${esc(d.refundNumber)}">${head(c)}
<div class="meta"><div><strong>Refund receipt ${esc(d.refundNumber)}</strong></div><div style="text-align:right">Date: ${esc(d.date)}</div></div>
<div class="meta">${patientBlock(d.patient)}<div><strong>Invoice:</strong> ${esc(d.invoiceNumber)}</div><div><strong>Original payment:</strong> ${esc(d.paymentNumber)}</div><div><strong>Refunded by:</strong> ${esc(METHOD[d.method] ?? d.method)}</div>${d.reference ? `<div><strong>Reference:</strong> ${esc(d.reference)}</div>` : ""}${d.approvedBy ? `<div><strong>Approved by:</strong> ${esc(d.approvedBy)}</div>` : ""}${d.processedBy ? `<div><strong>Processed by:</strong> ${esc(d.processedBy)}</div>` : ""}</div>
<p><strong>Reason:</strong> ${esc(d.reason)}</p><div class="totals"><div class="grand"><span>Amount refunded</span><span>${m(d.amountMinor)}</span></div></div>${foot(c)}</article>`;
  return { style: style(id, safeColor(c.color)), body };
}
export function renderStatement(d: StatementDoc): { style: string; body: string } {
  const c = d.clinic; const m = (x: number) => esc(formatMoney(x, d.currency)); const id = "bill-doc";
  const rows = d.invoices.map((i) => `<tr><td>${esc(i.number)}</td><td>${esc(i.date)}</td><td>${esc(i.dueDate ?? "—")}${i.overdue ? " <small>(overdue)</small>" : ""}</td><td class="r">${m(i.totalMinor)}</td><td class="r">${m(i.paidMinor)}</td><td class="r">${m(i.dueMinor)}</td></tr>`).join("");
  const body = `<article id="${id}" aria-label="Outstanding statement">${head(c)}
<div class="meta"><div><strong>Outstanding statement</strong></div><div style="text-align:right">As of ${esc(d.asOf)}</div></div><div class="meta">${patientBlock(d.patient)}</div>
${d.invoices.length ? `<div class="tw"><table><thead><tr><th>Invoice</th><th>Date</th><th>Due</th><th class="r">Total</th><th class="r">Paid</th><th class="r">Due</th></tr></thead><tbody>${rows}</tbody></table></div>` : "<p>No outstanding invoices.</p>"}
<div class="totals"><div class="grand"><span>Total outstanding</span><span>${m(d.totalDueMinor)}</span></div></div>${foot(c)}</article>`;
  return { style: style(id, safeColor(c.color)), body };
}
export const billHtmlFile = (title: string, d: { style: string; body: string }) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title><style>body{margin:0;padding:16px;background:#f4f7fa}${d.style}</style></head><body>${d.body}</body></html>`;
