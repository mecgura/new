import { AppError, toFailure } from "@/lib/errors";
import { apiRoute, readJson } from "@/lib/api/handler";
import { requireTenantApiContext, type TenantRequestContext } from "@/lib/auth/context";
import { billHtmlFile } from "@/lib/billing/billing-html";
import { renderPharmacyDoc } from "@/lib/pharmacy/pharmacy-html";
import { pharmacyDocument, recordPharmacyDocAccess } from "@/lib/services/pharmacy-docs";

export const dynamic = "force-dynamic";

/** Authenticated, tenant-checked download of ONE pharmacy document (HTML; "Save as PDF" from the print dialog). Never public. */
export async function GET(_req: Request, routeCtx: { params: Promise<{ kind: string; id: string }> }) {
  try {
    const ctx = await requireTenantApiContext();
    const { kind, id } = await routeCtx.params;
    const d = await pharmacyDocument(ctx, kind, id);
    await recordPharmacyDocAccess(ctx, kind, id, "DOWNLOADED");
    const html = billHtmlFile(d.file.replace(/-/g, " "), renderPharmacyDoc(d));
    return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Content-Disposition": `attachment; filename="${d.file}.html"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' https: data:" } });
  } catch (err) {
    const { failure, status } = toFailure(err instanceof AppError ? err : err, "doc");
    return Response.json(failure, { status, headers: { "Cache-Control": "no-store" } });
  }
}
/** Called when a document page is opened / right before window.print(), so access is audited. */
export const POST = apiRoute<TenantRequestContext>({ tenant: true }, async ({ req, ctx, params }) => {
  const b = (await readJson(req).catch(() => ({}))) as { access?: string };
  return recordPharmacyDocAccess(ctx, params.kind, params.id, b.access === "VIEWED" ? "VIEWED" : "PRINTED");
});
