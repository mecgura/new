import { AppError } from "@/lib/errors";
import { prescriptionHtmlFile } from "@/lib/clinical/prescription-html";
import { requireTenantApiContext } from "@/lib/auth/context";
import { prescriptionDocument, recordPrescriptionAccess } from "@/lib/services/prescription";
import { toFailure } from "@/lib/errors";

export const dynamic = "force-dynamic";

/** Authenticated, tenant-checked download of ONE finalized prescription version (HTML file; "Save as PDF" from the print dialog). Never public. */
export async function GET(req: Request, routeCtx: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireTenantApiContext("prescription.print");
    const { id } = await routeCtx.params;
    const version = Number(new URL(req.url).searchParams.get("version")) || undefined;
    const doc = await prescriptionDocument(ctx, id, version);
    await recordPrescriptionAccess(ctx, id, "DOWNLOADED", doc.version);
    return new Response(prescriptionHtmlFile(doc), { headers: { "Content-Type": "text/html; charset=utf-8", "Content-Disposition": `attachment; filename="${doc.snapshot.number}-v${doc.version}.html"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' https: data:" } });
  } catch (err) {
    const { failure, status } = toFailure(err instanceof AppError ? err : err, "doc");
    return Response.json(failure, { status, headers: { "Cache-Control": "no-store" } });
  }
}
