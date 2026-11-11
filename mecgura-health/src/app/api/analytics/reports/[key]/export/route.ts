import { requireTenantApiContext } from "@/lib/auth/context";
import { AppError, toFailure } from "@/lib/errors";
import { queryFromSearchParams } from "@/lib/services/analytics-core";
import { exportReport } from "@/lib/services/analytics-reports";

export const dynamic = "force-dynamic";
/** CSV / XLSX / printable page. Authorised again inside the service (report permission + export permission + identity rules), audited, never cached, streamed in chunks. */
export async function GET(req: Request, routeCtx: { params: Promise<{ key: string }> }) {
  try {
    const ctx = await requireTenantApiContext("analytics.view");
    const { key } = await routeCtx.params; const sp = new URL(req.url).searchParams;
    const out = await exportReport(ctx, key, queryFromSearchParams(sp), sp.get("format") ?? "csv");
    const enc = new TextEncoder(); let i = 0;
    const body = new ReadableStream<Uint8Array>({ pull(c) { if (i >= out.chunks.length) return c.close(); const x = out.chunks[i++]; c.enqueue(typeof x === "string" ? enc.encode(x) : x); } });
    const inline = out.contentType.startsWith("text/html");
    return new Response(body, { headers: { "Content-Type": out.contentType, "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${out.filename}"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", ...(inline ? { "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'" } : {}) } });
  } catch (err) {
    const { failure, status } = toFailure(err instanceof AppError ? err : err, "export");
    return Response.json(failure, { status, headers: { "Cache-Control": "no-store" } });
  }
}
