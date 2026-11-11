import { AppError, toFailure } from "@/lib/errors";
import { requireTenantApiContext } from "@/lib/auth/context";
import { LAB_DOC_HEADERS, labHtmlFile, renderLabReport } from "@/lib/lab/lab-html";
import { labReportDocument, recordReportAccess } from "@/lib/services/lab-results";

export const dynamic = "force-dynamic";

/** Authenticated, tenant-checked download of ONE released report version (HTML; "Save as PDF" from the print dialog). Never public. */
export async function GET(req: Request, routeCtx: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireTenantApiContext("tests.view");
    const { id } = await routeCtx.params;
    const version = Number(new URL(req.url).searchParams.get("version")) || undefined;
    const doc = await labReportDocument(ctx, id, version);
    await recordReportAccess(ctx, id, "DOWNLOADED", doc.version);
    return new Response(labHtmlFile(`Report ${doc.snapshot.reportNumber}`, renderLabReport(doc)), { headers: { ...LAB_DOC_HEADERS, "Content-Disposition": `attachment; filename="${doc.snapshot.reportNumber}-v${doc.version}.html"` } });
  } catch (err) {
    const { failure, status } = toFailure(err instanceof AppError ? err : err, "doc");
    return Response.json(failure, { status, headers: { "Cache-Control": "no-store" } });
  }
}
