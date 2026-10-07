import { esc, foot, head, safeColor, style } from "@/lib/billing/billing-html";
import { formatMoney } from "@/lib/billing/money";
import type { PharmacyDoc } from "@/lib/services/pharmacy-docs";

/** Clinic-branded pharmacy documents. Pure; every value is escaped; branding is the tenant's, never MECGURA's. */
const ID = "ph-doc";
const bp = (v: number) => (v % 100 === 0 ? String(v / 100) : (v / 100).toFixed(2));
const typeLabel = (t: string) => t.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

export function renderPharmacyDoc(d: PharmacyDoc): { style: string; body: string } {
  const c = d.clinic; const m = "currency" in d ? (x: number) => esc(formatMoney(x, d.currency)) : (x: number) => esc(x);
  let inner = ""; let title = "";
  if (d.kind === "purchase") {
    const p = d.purchase; title = `Purchase invoice ${p.purchaseNumber}`;
    inner = `<div class="meta"><div><strong>Purchase ${esc(p.purchaseNumber)}</strong><br><small>${esc(p.status.toLowerCase())}</small></div><div style="text-align:right">Date: ${esc(p.purchaseDate)}${p.supplierInvoiceNumber ? `<br>Supplier invoice: ${esc(p.supplierInvoiceNumber)}` : ""}</div></div>
<div class="meta"><div><strong>Supplier:</strong> ${esc(p.supplier.supplierName)} (${esc(p.supplier.supplierCode)})</div>${p.supplier.taxId ? `<div><strong>Tax ID:</strong> ${esc(p.supplier.taxId)}</div>` : ""}${p.receivedBy ? `<div><strong>Received by:</strong> ${esc(p.receivedBy)}</div>` : ""}</div>
<div class="tw"><table><thead><tr><th>#</th><th>Medicine</th><th>Batch</th><th>Expiry</th><th class="r">Qty</th><th class="r">Free</th><th class="r">Rate</th><th class="r">Tax</th><th class="r">Total</th></tr></thead><tbody>${p.items.map((i, n) => `<tr><td>${n + 1}</td><td>${esc(i.medicineName)} <small>${esc(i.medicineCode)}</small></td><td>${esc(i.batchNumber)}</td><td>${esc(i.expiryDate)}</td><td class="r">${i.quantity}</td><td class="r">${i.freeQuantity}</td><td class="r">${m(i.unitPurchasePriceMinor)}</td><td class="r">${i.taxRateBp ? `${bp(i.taxRateBp)}%` : "—"}</td><td class="r">${m(i.lineTotalMinor)}</td></tr>`).join("")}</tbody></table></div>
<div class="totals"><div><span>Subtotal</span><span>${m(p.subtotalMinor)}</span></div>${p.discountMinor ? `<div><span>Discount</span><span>−${m(p.discountMinor)}</span></div>` : ""}<div><span>Tax</span><span>${m(p.taxMinor)}</span></div><div class="grand"><span>Total</span><span>${m(p.totalMinor)}</span></div></div>`;
  } else if (d.kind === "bill") {
    const p = d.dispensing; title = `Pharmacy bill ${p.dispensingNumber}`;
    inner = `<div class="meta"><div><strong>Pharmacy bill</strong><br><small>${esc(p.dispensingNumber)}</small></div><div style="text-align:right">Date: ${esc(p.dispensedAt.slice(0, 10))}${p.invoice ? `<br>Invoice: ${esc(p.invoice.invoiceNumber)}` : ""}</div></div>
<div class="meta"><div><strong>Patient:</strong> ${esc(p.patientName)}</div><div><strong>ID:</strong> ${esc(p.patientCode)}</div>${p.prescriptionNumber ? `<div><strong>Prescription:</strong> ${esc(p.prescriptionNumber)}</div>` : ""}${p.dispensedBy ? `<div><strong>Dispensed by:</strong> ${esc(p.dispensedBy)}</div>` : ""}</div>
<div class="tw"><table><thead><tr><th>#</th><th>Medicine</th><th>Batch</th><th>Expiry</th><th class="r">Qty</th><th class="r">Price</th><th class="r">Tax</th><th class="r">Total</th></tr></thead><tbody>${p.items.filter((i) => i.status !== "CANCELLED").map((i, n) => `<tr><td>${n + 1}</td><td>${esc(i.medicineName)}</td><td>${esc(i.batchNumber)}</td><td>${esc(i.expiry)}</td><td class="r">${i.dispensedQuantity}</td><td class="r">${m(i.unitPriceMinor)}</td><td class="r">${i.taxRateBp ? `${bp(i.taxRateBp)}%` : "—"}</td><td class="r">${m(i.totalMinor)}</td></tr>`).join("")}</tbody></table></div>
<div class="totals"><div class="grand"><span>Total</span><span>${m(p.totalMinor)}</span></div>${p.invoice ? `<div><span>Payment status</span><span>${esc(p.invoice.status.replace(/_/g, " ").toLowerCase())}</span></div>` : ""}</div>${d.footer ? "" : ""}`;
  } else if (d.kind === "slip") {
    const p = d.dispensing; title = `Dispensing slip ${p.dispensingNumber}`;
    inner = `<div class="meta"><div><strong>Dispensing slip</strong><br><small>${esc(p.dispensingNumber)}</small></div><div style="text-align:right">Date: ${esc(p.dispensedAt.slice(0, 10))}</div></div>
<div class="meta"><div><strong>Patient:</strong> ${esc(p.patientName)}</div><div><strong>ID:</strong> ${esc(p.patientCode)}</div>${p.prescriptionNumber ? `<div><strong>Prescription:</strong> ${esc(p.prescriptionNumber)}</div>` : ""}${d.doctorName ? `<div><strong>Doctor:</strong> ${esc(d.doctorName)}</div>` : ""}</div>
<div class="tw"><table><thead><tr><th>Medicine</th><th>Batch / expiry</th><th class="r">Prescribed</th><th class="r">Given</th><th>Instructions (as written by the doctor)</th></tr></thead><tbody>${p.items.filter((i) => i.status !== "CANCELLED").map((i) => { const ins = d.instructions.find((x) => i.medicineName.toLowerCase().includes(x.name.toLowerCase()) || x.name.toLowerCase().includes(i.medicineName.toLowerCase())); const text = ins ? [ins.dose, ins.frequency, ins.foodTiming ? typeLabel(ins.foodTiming) : null, ins.durationDays ? `${ins.durationDays} days` : null, ins.instructions].filter(Boolean).join(" · ") : ""; return `<tr><td>${esc(i.medicineName)}</td><td>${esc(i.batchNumber)} / ${esc(i.expiry)}</td><td class="r">${i.prescribedQuantity || "—"}</td><td class="r">${i.dispensedQuantity}</td><td>${esc(text)}</td></tr>`; }).join("")}</tbody></table></div>`;
  } else if (d.kind === "stock" || d.kind === "expiry") {
    const r = d.report; title = r.title;
    const cell = (col: { key: string; type: string }, row: Record<string, string | number | null>) => (col.type === "money" ? m(Number(row[col.key] ?? 0)) : esc(row[col.key] ?? "—"));
    inner = `<div class="meta"><div><strong>${esc(r.title)} report</strong></div><div style="text-align:right">As of ${esc(r.to)}</div></div>${r.summary.map((s) => `<div><strong>${esc(s.label)}:</strong> ${s.type === "money" ? m(Number(s.value)) : esc(s.value)}</div>`).join("")}
<div class="tw"><table><thead><tr>${r.columns.map((col) => `<th${col.type === "money" || col.type === "int" ? ' class="r"' : ""}>${esc(col.label)}</th>`).join("")}</tr></thead><tbody>${r.rows.map((row) => `<tr>${r.columns.map((col) => `<td${col.type === "money" || col.type === "int" ? ' class="r"' : ""}>${cell(col, row)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>${r.note ? `<p><small>${esc(r.note)}</small></p>` : ""}${r.capped ? "<p><small>Showing the first 5,000 rows.</small></p>" : ""}`;
  } else if (d.kind === "return") {
    const r = d.ret; title = `Return ${r.returnNumber}`;
    inner = `<div class="meta"><div><strong>Medicine return ${esc(r.returnNumber)}</strong><br><small>${esc(typeLabel(r.type))} · ${esc(typeLabel(r.status))}</small></div><div style="text-align:right">Date: ${esc(r.date)}</div></div>
<div class="meta"><div><strong>Medicine:</strong> ${esc(r.medicine)}</div><div><strong>Batch:</strong> ${esc(r.batchNumber)}${r.expiryDate ? ` (exp. ${esc(r.expiryDate)})` : ""}</div><div><strong>Quantity:</strong> ${r.quantity}</div>${r.condition ? `<div><strong>Condition:</strong> ${esc(typeLabel(r.condition))}</div>` : ""}${r.supplier ? `<div><strong>Supplier:</strong> ${esc(r.supplier)}</div>` : ""}${r.reference ? `<div><strong>Reference:</strong> ${esc(r.reference)}</div>` : ""}</div>
<p><strong>Reason:</strong> ${esc(r.reason)}</p><div class="meta">${r.requestedBy ? `<div><strong>Requested by:</strong> ${esc(r.requestedBy)}</div>` : ""}${r.approvedBy ? `<div><strong>Approved by:</strong> ${esc(r.approvedBy)}</div>` : ""}${r.receivedBy ? `<div><strong>Received by:</strong> ${esc(r.receivedBy)}</div>` : ""}</div><p><small>Any refund to the patient is handled separately in Billing.</small></p>`;
  }
  const extra = d.kind === "bill" ? d.footer : null;
  return { style: style(ID, safeColor(c.color)), body: `<article id="${ID}" aria-label="${esc(title)}">${head(c)}${inner}${foot(c, extra)}</article>` };
}
export const pharmacyDocTitle = (d: PharmacyDoc) => d.file.replace(/-/g, " ");
