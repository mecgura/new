import { AppError, toFailure } from "@/lib/errors";
import { apiRoute, readJson } from "@/lib/api/handler";
import { requireTenantApiContext, type TenantRequestContext } from "@/lib/auth/context";
import { billHtmlFile, renderInvoice, renderReceipt, renderRefundReceipt, renderStatement } from "@/lib/billing/billing-html";
import { invoiceDocument, receiptDocument, recordDocAccess, refundReceiptDocument, statementDocument } from "@/lib/services/billing-docs";

export const dynamic = "force-dynamic";
const KINDS = ["invoice", "receipt", "refund", "statement"] as const;
type Kind = (typeof KINDS)[number];

/** Authenticated, tenant-checked download of ONE financial document (HTML; "Save as PDF" from the print dialog). Never public. */
export async function GET(_req: Request, routeCtx: { params: Promise<{ kind: string; id: string }> }) {
  try {
    const ctx = await requireTenantApiContext("billing.view");
    const { kind, id } = await routeCtx.params;
    if (!(KINDS as readonly string[]).includes(kind)) throw new AppError("NOT_FOUND");
    const k = kind as Kind;
    const html = k === "invoice" ? (() => invoiceDocument(ctx, id).then((d) => ({ file: `${d.number}.html`, html: billHtmlFile(`Invoice ${d.number}`, renderInvoice(d)) })))()
      : k === "receipt" ? receiptDocument(ctx, id).then((d) => ({ file: `${d.receiptNumber}.html`, html: billHtmlFile(`Receipt ${d.receiptNumber}`, renderReceipt(d)) }))
      : k === "refund" ? refundReceiptDocument(ctx, id).then((d) => ({ file: `${d.refundNumber}.html`, html: billHtmlFile(`Refund ${d.refundNumber}`, renderRefundReceipt(d)) }))
      : statementDocument(ctx, id).then((d) => ({ file: `statement-${d.asOf}.html`, html: billHtmlFile("Outstanding statement", renderStatement(d)) }));
    const out = await html;
    await recordDocAccess(ctx, k, id, "DOWNLOADED");
    return new Response(out.html, { headers: { "Content-Type": "text/html; charset=utf-8", "Content-Disposition": `attachment; filename="${out.file}"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' https: data:" } });
  } catch (err) {
    const { failure, status } = toFailure(err instanceof AppError ? err : err, "doc");
    return Response.json(failure, { status, headers: { "Cache-Control": "no-store" } });
  }
}
/** Called when a document page is opened / right before window.print(), so access is audited. */
export const POST = apiRoute<TenantRequestContext>({ tenant: true }, async ({ req, ctx, params }) => {
  if (!(KINDS as readonly string[]).includes(params.kind)) throw new AppError("NOT_FOUND");
  const b = (await readJson(req).catch(() => ({}))) as { access?: string };
  return recordDocAccess(ctx, params.kind as Kind, params.id, b.access === "VIEWED" ? "VIEWED" : "PRINTED");
});
