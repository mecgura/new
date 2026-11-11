import type { LabReportDoc, LabSlipDoc, SampleLabelDoc } from "@/lib/services/lab-results";

/** Clinic-branded laboratory documents. Pure; every value is escaped. Branding comes from the tenant, never from MECGURA. */
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const safeColor = (c: string) => (/^#[0-9a-f]{6}$/i.test(c) ? c : "#14529e");
const safeUrl = (u: string | null | undefined) => (u && /^(\/|https:\/\/)/.test(u) ? u : null);
const FLAG_TEXT: Record<string, string> = { LOW: "Low", HIGH: "High", CRITICAL: "Critical", NORMAL: "Normal", POSITIVE: "Positive", NEGATIVE: "Negative", ABNORMAL: "Abnormal" };
const PRIORITY_TEXT: Record<string, string> = { NORMAL: "Normal", HIGH: "High", URGENT: "Urgent", STAT: "STAT" };

const head = (c: { name: string; logoUrl?: string | null; address?: string; phone?: string | null; email?: string | null }, id: string) => {
  const logo = safeUrl(c.logoUrl);
  return `<header>${logo ? `<img src="${esc(logo)}" alt="">` : ""}<div><h1>${esc(c.name)}</h1><small>${[c.address, c.phone && `Tel: ${c.phone}`, c.email].filter(Boolean).map(esc).join(" · ")}</small></div></header>`.replace("<header>", `<header data-doc="${id}">`);
};
const baseStyle = (id: string, color: string) => `
#${id}{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#1f2933;background:#fff;max-width:820px;margin:0 auto;padding:28px;border:1px solid #d5dde5;border-radius:8px;line-height:1.45}
#${id} header{display:flex;gap:16px;align-items:center;border-bottom:3px solid ${color};padding-bottom:12px;margin-bottom:12px}
#${id} header img{height:56px;width:56px;object-fit:contain}
#${id} h1{margin:0;font-size:22px;color:${color}} #${id} h2{font-size:16px;margin:18px 0 6px;color:${color}} #${id} small{color:#52606d}
#${id} .meta{display:grid;grid-template-columns:1fr 1fr;gap:4px 16px;margin:10px 0;font-size:14px}
#${id} table{width:100%;border-collapse:collapse;margin:6px 0 12px;font-size:14px} #${id} th{background:${color};color:#fff;text-align:left;padding:6px 8px} #${id} td{border-bottom:1px solid #d5dde5;padding:6px 8px;vertical-align:top}
#${id} .flag{font-weight:700} #${id} .flag.abn{text-decoration:underline}
#${id} footer{margin-top:24px;display:flex;justify-content:space-between;gap:16px;font-size:12px;color:#52606d;border-top:1px solid #d5dde5;padding-top:10px}
#${id} .tw{overflow-x:auto} #${id} .meta>div{min-width:0;overflow-wrap:anywhere}
@media (max-width:640px){#${id}{padding:14px}#${id} .meta{grid-template-columns:1fr}#${id} .meta>div[style]{text-align:left!important}#${id} footer{flex-direction:column}}
@media print{body *{visibility:hidden}#${id},#${id} *{visibility:visible}#${id}{position:absolute;left:0;top:0;width:100%;max-width:none;border:0;border-radius:0}#${id} .tw{overflow:visible}@page{margin:12mm}}`;

export function renderLabReport(doc: LabReportDoc): { style: string; body: string } {
  const { snapshot: s, clinic: c } = doc;
  const color = safeColor(c.color);
  const tests = s.tests.map((t) => `<h2>${esc(t.name)}${t.category ? ` <small>${esc(t.category)}</small>` : ""}</h2>
<div class="tw"><table><thead><tr><th>Parameter</th><th>Result</th><th>Unit</th><th>Reference range</th><th>Flag</th></tr></thead><tbody>${t.results.map((r) => `<tr><td>${esc(r.parameter)}${r.remarks ? `<br><small>${esc(r.remarks)}</small>` : ""}</td><td><strong>${esc(r.value)}</strong></td><td>${esc(r.unit ?? "")}</td><td>${r.refText ? esc(r.refText) : "<small>Reference range not configured.</small>"}</td><td>${r.flag ? `<span class="flag${r.flag === "NORMAL" || r.flag === "NEGATIVE" ? "" : " abn"}">${esc(FLAG_TEXT[r.flag] ?? r.flag)}</span>` : "—"}</td></tr>`).join("")}</tbody></table></div>`).join("");
  const body = `<article id="lab-doc" aria-label="Laboratory report ${esc(s.reportNumber)}">${head(c, "lab-report")}
<div class="meta"><div><strong>Laboratory report ${esc(s.reportNumber)}</strong>${s.version > 1 ? ` <small>(version ${esc(s.version)} — amended)</small>` : ""}<br><small>Order ${esc(s.orderNumber)} · priority ${esc(PRIORITY_TEXT[s.priority] ?? s.priority)}</small></div><div style="text-align:right">Released: ${esc(s.releasedAt.slice(0, 16).replace("T", " "))} UTC<br><small>Ordered: ${esc(s.orderedAt.slice(0, 10))}</small></div></div>
<div class="meta"><div><strong>Patient:</strong> ${esc(s.patient.name)}</div><div><strong>ID:</strong> ${esc(s.patient.code)}</div><div><strong>Age / sex:</strong> ${esc([s.patient.age, s.patient.gender && s.patient.gender.toLowerCase()].filter(Boolean).join(" / ") || "—")}</div><div><strong>Ordered by:</strong> ${esc(s.doctorName)}</div></div>
${s.samples.length ? `<p><small>Samples: ${s.samples.map((x) => `${esc(x.sampleNumber)} (${esc(x.sampleType)}, collected ${esc(x.collectedAt.slice(0, 16).replace("T", " "))})`).join("; ")}</small></p>` : ""}
${tests}
${s.version > 1 && s.reason ? `<p><small>Amendment reason: ${esc(s.reason)}</small></p>` : ""}
<p><small>${s.verifiedBy ? `Verified by ${esc(s.verifiedBy)}. ` : ""}${s.releasedBy ? `Released by ${esc(s.releasedBy)}. ` : ""}Results are reported exactly as entered by the laboratory; flags use the reference ranges configured by the clinic. Interpretation is by the treating doctor.</small></p>
<footer><span>${esc(c.name)} · generated ${esc(doc.generatedAt)} · ref ${esc(doc.hash)}</span><span>This document contains confidential medical information.</span></footer></article>`;
  return { style: baseStyle("lab-doc", color), body };
}

export function renderLabSlip(doc: LabSlipDoc): { style: string; body: string } {
  const c = doc.clinic; const color = safeColor(c.color);
  const body = `<article id="slip-doc" aria-label="Investigation slip ${esc(doc.orderNumber)}">${head(c, "lab-slip")}
<div class="meta"><div><strong>Investigation slip ${esc(doc.orderNumber)}</strong><br><small>Priority: ${esc(PRIORITY_TEXT[doc.priority] ?? doc.priority)}${doc.source === "EXTERNAL" ? " · external laboratory" : ""}</small></div><div style="text-align:right">Ordered: ${esc(doc.orderedAt)} UTC<br><small>By ${esc(doc.doctorName)}</small></div></div>
<div class="meta"><div><strong>Patient:</strong> ${esc(doc.patient.name)}</div><div><strong>ID:</strong> ${esc(doc.patient.code)}</div><div><strong>Age / sex:</strong> ${esc([doc.patient.age, doc.patient.gender && doc.patient.gender.toLowerCase()].filter(Boolean).join(" / ") || "—")}</div></div>
<div class="tw"><table><thead><tr><th>#</th><th>Test</th><th>Sample</th><th>Preparation</th></tr></thead><tbody>${doc.tests.map((t, n) => `<tr><td>${n + 1}</td><td>${esc(t.name)}</td><td>${esc(t.sampleType ?? "—")}</td><td>${t.preparation ? esc(t.preparation) : "—"}</td></tr>`).join("")}</tbody></table></div>
${doc.clinicalNotes ? `<p><strong>Note:</strong> ${esc(doc.clinicalNotes)}</p>` : ""}
<footer><span>${esc(c.name)}</span><span>Present this slip at sample collection.</span></footer></article>`;
  return { style: baseStyle("slip-doc", color), body };
}

export function renderSampleLabel(doc: SampleLabelDoc): { style: string; body: string } {
  const color = safeColor(doc.clinic.color);
  const style = `#label-doc{font-family:system-ui,sans-serif;width:320px;border:2px solid ${color};border-radius:6px;padding:10px;background:#fff;color:#111;font-size:13px;line-height:1.35}
#label-doc strong.num{font-size:18px;letter-spacing:.5px;display:block;color:${color}} #label-doc .tok{font-family:ui-monospace,monospace;font-size:11px;word-break:break-all;margin-top:6px;border-top:1px dashed #999;padding-top:4px}
@media print{body *{visibility:hidden}#label-doc,#label-doc *{visibility:visible}#label-doc{position:absolute;left:0;top:0}@page{size:auto;margin:6mm}}`;
  const body = `<article id="label-doc" aria-label="Sample label ${esc(doc.sampleNumber)}"><small>${esc(doc.clinic.name)}</small><strong class="num">${esc(doc.sampleNumber)}</strong>
<div>${esc(doc.patient.name)} · ${esc(doc.patient.code)}</div><div>${esc([doc.patient.age, doc.patient.gender && doc.patient.gender.toLowerCase()].filter(Boolean).join(" / "))}</div>
<div><strong>${esc(doc.sampleType)}</strong>${doc.attempt > 1 ? ` · recollection ${esc(doc.attempt)}` : ""} · ${esc(PRIORITY_TEXT[doc.priority] ?? doc.priority)}</div><div>Order ${esc(doc.orderNumber)} · ${esc(doc.collectedAt)} UTC</div>
<div class="tok">ID ${esc(doc.barcodeToken)}</div></article>`;
  return { style, body };
}

export const labHtmlFile = (title: string, d: { style: string; body: string }) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title><style>body{margin:0;padding:16px;background:#f4f7fa}${d.style}</style></head><body>${d.body}</body></html>`;
export const LAB_DOC_HEADERS = { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' https: data:" };
