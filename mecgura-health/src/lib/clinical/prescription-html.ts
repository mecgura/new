import type { PrescriptionDoc } from "@/lib/services/prescription";

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const safeColor = (c: string) => (/^#[0-9a-f]{6}$/i.test(c) ? c : "#14529e");
const safeUrl = (u: string | null) => (u && /^(\/|https:\/\/)/.test(u) ? u : null);
const FOOD: Record<string, string> = { BEFORE_FOOD: "Before food", AFTER_FOOD: "After food", WITH_FOOD: "With food", ANYTIME: "Any time" };

/** Clinic-branded prescription (pure, escapes every value). The clinic's name/logo/colours come from the tenant, never from MECGURA. */
export function renderPrescription(doc: PrescriptionDoc): { style: string; body: string } {
  const { snapshot: s, clinic: c } = doc;
  const color = safeColor(c.color);
  const logo = safeUrl(c.logoUrl);
  const when = (i: PrescriptionDoc["snapshot"]["items"][number]) => [i.morning && "Morning", i.afternoon && "Afternoon", i.evening && "Evening", i.night && "Night"].filter(Boolean).join(" + ");
  const rows = s.items.map((i, n) => `<tr><td>${n + 1}</td><td><strong>${esc(i.name)}</strong>${i.strength ? ` ${esc(i.strength)}` : ""}${i.genericName ? `<br><small>${esc(i.genericName)}</small>` : ""}${i.instructions ? `<br><small>${esc(i.instructions)}</small>` : ""}</td><td>${esc(i.dose)}${i.route ? ` · ${esc(i.route)}` : ""}</td><td>${esc(i.frequency)}${when(i) ? `<br><small>${esc(when(i))}</small>` : ""}${i.foodTiming ? `<br><small>${esc(FOOD[i.foodTiming] ?? i.foodTiming)}</small>` : ""}</td><td>${i.durationDays ? `${esc(i.durationDays)} days` : "—"}${i.quantity ? `<br><small>Qty ${esc(i.quantity)} ${esc(i.quantityUnit ?? "")}</small>` : ""}</td></tr>`).join("");
  const dx = s.diagnoses.length ? `<p><strong>Diagnosis:</strong> ${s.diagnoses.map((d) => `${esc(d.name)}${d.code ? ` (${esc(d.code)})` : ""}${d.type === "PRIMARY" ? " — primary" : ""}`).join("; ")}</p>` : "";
  const fu = s.followUp.required ? `<p><strong>Follow-up:</strong> ${s.followUp.afterDays ? `after ${esc(s.followUp.afterDays)} days` : s.followUp.date ? esc(s.followUp.date) : "as advised"}${s.followUp.notes ? ` — ${esc(s.followUp.notes)}` : ""}</p>` : "";
  const style = `
#rx-doc{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#1f2933;background:#fff;max-width:800px;margin:0 auto;padding:28px;border:1px solid #d5dde5;border-radius:8px;line-height:1.45}
#rx-doc header{display:flex;gap:16px;align-items:center;border-bottom:3px solid ${color};padding-bottom:12px;margin-bottom:12px}
#rx-doc header img{height:56px;width:56px;object-fit:contain}
#rx-doc h1{margin:0;font-size:22px;color:${color}} #rx-doc small{color:#52606d}
#rx-doc .meta{display:grid;grid-template-columns:1fr 1fr;gap:4px 16px;margin:10px 0;font-size:14px}
#rx-doc table{width:100%;border-collapse:collapse;margin:12px 0;font-size:14px} #rx-doc th{background:${color};color:#fff;text-align:left;padding:6px 8px} #rx-doc td{border-bottom:1px solid #d5dde5;padding:6px 8px;vertical-align:top}
#rx-doc footer{margin-top:28px;display:flex;justify-content:space-between;gap:16px;font-size:12px;color:#52606d;border-top:1px solid #d5dde5;padding-top:10px}
#rx-doc .sign{margin-top:36px;text-align:right;font-size:14px}
@media print{body *{visibility:hidden}#rx-doc,#rx-doc *{visibility:visible}#rx-doc{position:absolute;left:0;top:0;width:100%;max-width:none;border:0;border-radius:0}@page{margin:12mm}}`;
  const body = `<article id="rx-doc" aria-label="Prescription ${esc(s.number)}">
<header>${logo ? `<img src="${esc(logo)}" alt="">` : ""}<div><h1>${esc(c.name)}</h1><small>${[c.address, c.phone && `Tel: ${c.phone}`, c.email].filter(Boolean).map(esc).join(" · ")}</small></div></header>
<div class="meta"><div><strong>${esc(s.doctor.name)}</strong>${s.doctor.qualification ? `<br>${esc(s.doctor.qualification)}` : ""}${s.doctor.specialization ? `<br>${esc(s.doctor.specialization)}` : ""}${s.doctor.registrationNumber ? `<br><small>Reg. No. ${esc(s.doctor.registrationNumber)}</small>` : ""}</div>
<div style="text-align:right"><strong>Rx ${esc(s.number)}</strong>${s.version > 1 ? ` <small>(version ${esc(s.version)})</small>` : ""}<br>Date: ${esc(s.finalizedAt.slice(0, 10))}<br><small>Consultation ${esc(s.consultation.number)}</small></div></div>
<div class="meta"><div><strong>Patient:</strong> ${esc(s.patient.name)}</div><div><strong>ID:</strong> ${esc(s.patient.code)}</div><div><strong>Age / sex:</strong> ${esc([s.patient.age, s.patient.gender && s.patient.gender.toLowerCase()].filter(Boolean).join(" / ") || "—")}</div><div>${s.patient.phone ? `<strong>Mobile:</strong> ${esc(s.patient.phone)}` : ""}</div></div>
${dx}
<table><thead><tr><th>#</th><th>Medicine</th><th>Dose</th><th>Frequency</th><th>Duration</th></tr></thead><tbody>${rows}</tbody></table>
${s.advice ? `<p><strong>Advice:</strong><br>${esc(s.advice).replace(/\n/g, "<br>")}</p>` : ""}${fu}
${s.version > 1 && s.reason ? `<p><small>Amended: ${esc(s.reason)}</small></p>` : ""}
<div class="sign">${esc(s.doctor.name)}<br><small>Prescribed by the doctor above. Valid as finalized on ${esc(s.finalizedAt.slice(0, 16).replace("T", " "))} UTC.</small></div>
<footer><span>${esc(c.name)} · generated ${esc(doc.generatedAt)} · ref ${esc(doc.hash)}</span><span>This document contains confidential medical information.</span></footer></article>`;
  return { style, body };
}

export const prescriptionHtmlFile = (doc: PrescriptionDoc) => { const { style, body } = renderPrescription(doc); return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Prescription ${esc(doc.snapshot.number)}</title><style>body{margin:0;padding:16px;background:#f4f7fa}${style}</style></head><body>${body}</body></html>`; };
