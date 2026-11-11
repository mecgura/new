import { AppError, toFailure } from "@/lib/errors";
import { readJson } from "@/lib/api/handler";
import { requirePatientApiContext } from "@/lib/portal/ctx";
import { patientRoute } from "@/lib/api/patient-route";
import { renderPortalDocument, portalHtmlFile } from "@/lib/portal/portal-html";
import { portalDocument, recordPortalDocAccess } from "@/lib/services/portal-docs";

export const dynamic = "force-dynamic";

/** Authenticated download of ONE of the patient's own documents. Ownership is proven server-side on every request; there is no public URL. */
export async function GET(req: Request, routeCtx: { params: Promise<{ kind: string; id: string }> }) {
  try {
    const ctx = await requirePatientApiContext();
    const { kind, id } = await routeCtx.params;
    const v = Number(new URL(req.url).searchParams.get("version") ?? "") || undefined;
    const d = await portalDocument(ctx, kind, id, v);
    await recordPortalDocAccess(ctx, kind, id, "DOWNLOADED");
    const html = portalHtmlFile(d.file, renderPortalDocument(d));
    return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Content-Disposition": `attachment; filename="${d.file}-${id.slice(-6)}.html"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "X-Robots-Tag": "noindex, nofollow", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' https: data:" } });
  } catch (err) {
    const { failure, status } = toFailure(err instanceof AppError ? err : err, "doc");
    return Response.json(failure, { status, headers: { "Cache-Control": "no-store" } });
  }
}
/** Called when a document page is opened / before window.print(), so the access is audited. */
export const POST = patientRoute(async ({ req, ctx, params }) => {
  const b = (await readJson(req).catch(() => ({}))) as { access?: string };
  return recordPortalDocAccess(ctx, params.kind, params.id, b.access === "PRINTED" ? "PRINTED" : "VIEWED");
});
