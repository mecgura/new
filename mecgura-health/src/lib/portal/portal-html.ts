import { renderInvoice, renderReceipt, billHtmlFile } from "@/lib/billing/billing-html";
import { renderPrescription } from "@/lib/clinical/prescription-html";
import { renderLabReport } from "@/lib/lab/lab-html";
import type { portalDocument } from "@/lib/services/portal-docs";

type Doc = Awaited<ReturnType<typeof portalDocument>>;
/** The clinic's own renderers (clinic branding, escaped values) applied to the patient's copy of the data. */
export function renderPortalDocument(d: Doc): { style: string; body: string } {
  switch (d.kind) {
    case "prescription": return renderPrescription(d.doc);
    case "report": return renderLabReport(d.doc);
    case "invoice": return renderInvoice(d.doc);
    case "receipt": return renderReceipt(d.doc);
  }
}
export const portalHtmlFile = (title: string, d: { style: string; body: string }) => billHtmlFile(title, d);
