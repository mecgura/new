import { csvToXlsx } from "@/lib/export/csv-to-xlsx";
import { AppError, toFailure } from "@/lib/errors";
import { requireTenantApiContext } from "@/lib/auth/context";
import { exportPharmacyReport } from "@/lib/services/pharmacy-reports";

export const dynamic = "force-dynamic";
/** CSV export. Authenticated, tenant-scoped, permission-checked, audited; never cached. */
export async function GET(req: Request) {
  try {
    const ctx = await requireTenantApiContext("pharmacy.reports");
    const s = new URL(req.url).searchParams;
    const r = await exportPharmacyReport(ctx, s.get("kind") ?? "", { from: s.get("from") ?? undefined, to: s.get("to") ?? undefined, medicineId: s.get("medicineId") ?? undefined, category: s.get("category") ?? undefined, batchId: s.get("batchId") ?? undefined, supplierId: s.get("supplierId") ?? undefined, userId: s.get("userId") ?? undefined, state: s.get("state") ?? undefined });
    if (s.get("format") === "xlsx") return new Response(Buffer.from(csvToXlsx(r.csv, r.filename.replace(/\.csv$/, ""))), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${r.filename.replace(/\.csv$/, ".xlsx")}"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
    return new Response(r.csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${r.filename}"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (err) {
    const { failure, status } = toFailure(err instanceof AppError ? err : err, "export");
    return Response.json(failure, { status, headers: { "Cache-Control": "no-store" } });
  }
}
