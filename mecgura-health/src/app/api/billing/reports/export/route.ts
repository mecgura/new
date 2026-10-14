import { csvToXlsx } from "@/lib/export/csv-to-xlsx";
import { AppError, toFailure } from "@/lib/errors";
import { requireTenantApiContext } from "@/lib/auth/context";
import { exportReport } from "@/lib/services/billing-reports";

export const dynamic = "force-dynamic";
/** CSV export for finance users. Authenticated, tenant-scoped, audited; never cached. */
export async function GET(req: Request) {
  try {
    const ctx = await requireTenantApiContext("billing.export");
    const s = new URL(req.url).searchParams;
    const r = await exportReport(ctx, s.get("kind") ?? "", { from: s.get("from") ?? undefined, to: s.get("to") ?? undefined, doctorId: s.get("doctorId") ?? undefined, serviceId: s.get("serviceId") ?? undefined, method: s.get("method") ?? undefined });
    if (s.get("format") === "xlsx") return new Response(Buffer.from(csvToXlsx(r.csv, r.filename.replace(/\.csv$/, ""))), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${r.filename.replace(/\.csv$/, ".xlsx")}"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
    return new Response(r.csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${r.filename}"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (err) {
    const { failure, status } = toFailure(err instanceof AppError ? err : err, "export");
    return Response.json(failure, { status, headers: { "Cache-Control": "no-store" } });
  }
}
