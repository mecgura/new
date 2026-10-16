import { AppError, toFailure } from "@/lib/errors";
import { requireTenantApiContext } from "@/lib/auth/context";
import { saasDocumentHtml, type DocKind } from "@/lib/services/sub-docs";

export const dynamic = "force-dynamic";
const KINDS = ["invoice", "receipt", "credit"];
/** Private download of one MECGURA subscription document (HTML; "Save as PDF" from the print dialog). Only the clinic that owns it. */
export async function GET(_req: Request, routeCtx: { params: Promise<{ kind: string; id: string }> }) {
  try {
    const ctx = await requireTenantApiContext("subscription.view"); const { kind, id } = await routeCtx.params;
    if (!KINDS.includes(kind)) throw new AppError("NOT_FOUND");
    const out = await saasDocumentHtml(ctx, kind as DocKind, id, ctx.tenantId);
    return new Response(out.html, { headers: { "Content-Type": "text/html; charset=utf-8", "Content-Disposition": `attachment; filename="${out.file}"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' https: data:" } });
  } catch (err) { const { failure, status } = toFailure(err, "doc"); return Response.json(failure, { status, headers: { "Cache-Control": "no-store" } }); }
}
