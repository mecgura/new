import { esc, safeColor, style } from "@/lib/billing/billing-html";
import { formatMoney } from "@/lib/billing/money";

/** MECGURA-issued subscription documents (invoice · receipt · credit note). Pure; every value escaped. The ISSUER is MECGURA's legal entity (from platform billing settings), the customer is the clinic. */
export interface SaasDoc {
  kind: "invoice" | "receipt" | "credit"; number: string; status: string; currency: string; issuedOn: string; dueOn: string | null; periodText: string;
  vendor: { legalName: string; brandName: string; gstin: string; pan: string; address: string; email: string; phone: string; website: string; supportEmail: string; supportPhone: string; invoiceFooter: string; bankDetails: string };
  billTo: { name: string; email: string | null; phone: string | null; address: string; gstin: string | null; taxId: string | null };
  planName: string | null; items: { description: string; quantity: number; unitMinor: number; totalMinor: number }[];
  subtotalMinor: number; discountMinor: number; taxMinor: number; totalMinor: number; paidMinor: number; refundedMinor: number; taxMode: string; taxLines: { name: string; rateBp: number; amountMinor: number }[];
  payments: { receipt: string | null; date: string; method: string; amountMinor: number; reference: string | null }[];
  /** receipt / credit note extras */
  related?: { invoiceNumber: string; paymentMethod?: string; reference?: string | null; amountMinor: number; reason?: string | null };
  generatedAt: string;
}
const TITLE = { invoice: "Tax invoice", receipt: "Payment receipt", credit: "Credit note" } as const;
const METHOD: Record<string, string> = { ONLINE: "Online", CARD: "Card", UPI: "UPI", BANK_TRANSFER: "Bank transfer", OTHER: "Other" };
export function renderSaasDoc(d: SaasDoc): { style: string; body: string } {
  const m = (x: number) => esc(formatMoney(x, d.currency)); const id = "saas-doc"; const v = d.vendor;
  const issuer = `<header><div><h1>${esc(v.brandName)}</h1><small>${v.legalName ? `${esc(v.legalName)}<br>` : ""}${v.address ? `${esc(v.address)}<br>` : ""}${[v.email, v.phone].filter(Boolean).map(esc).join(" · ")}${v.gstin ? `<br>GSTIN: ${esc(v.gstin)}` : ""}${v.pan ? ` · PAN: ${esc(v.pan)}` : ""}</small></div></header>`;
  const bill = `<div><strong>Billed to</strong><br>${esc(d.billTo.name)}${d.billTo.address ? `<br><small>${esc(d.billTo.address)}</small>` : ""}${d.billTo.email ? `<br><small>${esc(d.billTo.email)}</small>` : ""}${d.billTo.gstin ? `<br><small>GSTIN: ${esc(d.billTo.gstin)}</small>` : ""}${d.billTo.taxId ? `<br><small>Tax ID: ${esc(d.billTo.taxId)}</small>` : ""}</div>`;
  const meta = `<div class="meta"><div><strong>${TITLE[d.kind]} ${esc(d.number)}</strong><br><small>${esc(d.status.replace(/_/g, " ").toLowerCase())}</small></div><div style="text-align:right">Date: ${esc(d.issuedOn)}${d.dueOn ? `<br>Due: ${esc(d.dueOn)}` : ""}${d.periodText ? `<br><small>Service period: ${esc(d.periodText)}</small>` : ""}</div></div><div class="meta">${bill}<div></div></div>`;
  let main = "";
  if (d.kind === "invoice") {
    const rows = d.items.map((i, n) => `<tr><td>${n + 1}</td><td>${esc(i.description)}</td><td class="r">${esc(i.quantity)}</td><td class="r">${m(i.unitMinor)}</td><td class="r">${m(i.totalMinor)}</td></tr>`).join("");
    const tax = d.taxLines.length ? d.taxLines.map((t) => `<div><span>${esc(t.name)} (${esc((t.rateBp / 100).toFixed(2).replace(/\.00$/, ""))}%)</span><span>${m(t.amountMinor)}</span></div>`).join("") : d.taxMinor ? `<div><span>Tax</span><span>${m(d.taxMinor)}</span></div>` : "";
    const pays = d.payments.length ? `<h2>Payments</h2><div class="tw"><table><thead><tr><th>Receipt</th><th>Date</th><th>Method</th><th class="r">Amount</th></tr></thead><tbody>${d.payments.map((p) => `<tr><td>${esc(p.receipt ?? "—")}</td><td>${esc(p.date)}</td><td>${esc(METHOD[p.method] ?? p.method)}${p.reference ? ` <small>${esc(p.reference)}</small>` : ""}</td><td class="r">${m(p.amountMinor)}</td></tr>`).join("")}</tbody></table></div>` : "";
    main = `<div class="tw"><table><thead><tr><th>#</th><th>Description</th><th class="r">Qty</th><th class="r">Price</th><th class="r">Amount</th></tr></thead><tbody>${rows}</tbody></table></div>
<div class="totals"><div><span>Subtotal</span><span>${m(d.subtotalMinor)}</span></div>${d.discountMinor ? `<div><span>Discount</span><span>- ${m(d.discountMinor)}</span></div>` : ""}${tax}<div><strong>Total${d.taxMode === "INCLUSIVE" && d.taxMinor ? " (tax included)" : ""}</strong><strong>${m(d.totalMinor)}</strong></div><div><span>Paid</span><span>${m(d.paidMinor)}</span></div>${d.refundedMinor ? `<div><span>Refunded</span><span>${m(d.refundedMinor)}</span></div>` : ""}<div><strong>Balance due</strong><strong>${m(Math.max(0, d.totalMinor - d.paidMinor))}</strong></div></div>${pays}`;
  } else {
    const r = d.related!;
    main = `<div class="tw"><table><tbody><tr><td>Against invoice</td><td>${esc(r.invoiceNumber)}</td></tr>${r.paymentMethod ? `<tr><td>Method</td><td>${esc(METHOD[r.paymentMethod] ?? r.paymentMethod)}</td></tr>` : ""}${r.reference ? `<tr><td>Reference</td><td>${esc(r.reference)}</td></tr>` : ""}${r.reason ? `<tr><td>Reason</td><td>${esc(r.reason)}</td></tr>` : ""}</tbody></table></div><div class="totals"><div><strong>${d.kind === "receipt" ? "Amount received" : "Amount credited / refunded"}</strong><strong>${m(r.amountMinor)}</strong></div></div>`;
  }
  const foot = `${v.bankDetails && d.kind === "invoice" ? `<p><small><strong>Bank details:</strong> ${esc(v.bankDetails)}</small></p>` : ""}${v.invoiceFooter ? `<p><small>${esc(v.invoiceFooter)}</small></p>` : ""}<footer><span>${esc(v.brandName)}${v.supportEmail ? ` · support: ${esc(v.supportEmail)}` : ""}${v.supportPhone ? ` · ${esc(v.supportPhone)}` : ""}</span><span>Generated ${esc(d.generatedAt)}. This is a computer-generated document.</span></footer>`;
  return { style: style(id, safeColor("#14529e")), body: `<article id="${id}" aria-label="${esc(TITLE[d.kind])} ${esc(d.number)}">${issuer}${meta}${main}${foot}</article>` };
}
