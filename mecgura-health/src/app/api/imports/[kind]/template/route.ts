import { requireTenantApiContext } from "@/lib/auth/context";
import { AppError, toFailure } from "@/lib/errors";
import { tableToFile } from "@/lib/export/table";
import { importTemplate } from "@/lib/services/data-import";

export const dynamic = "force-dynamic";
/** A header row plus one example row, as Excel (.xlsx) or CSV. */
export async function GET(req: Request, routeCtx: { params: Promise<{ kind: string }> }) {
  try {
    const ctx = await requireTenantApiContext();
    const { kind } = await routeCtx.params;
    const t = importTemplate(ctx, kind);
    const format = new URL(req.url).searchParams.get("format") === "csv" ? "csv" : "xlsx";
    const meta = { name: `${t.kind.label} import template`, description: "Fill one record per row. Columns marked * are required. Delete the example row before uploading.", dataSource: "", range: "", timezone: "UTC", generatedAt: new Date().toISOString(), generatedBy: "", filters: "" };
    const out = tableToFile(meta, t.columns.map((c) => ({ key: c.key, label: c.label })), [t.example], format, `${t.kind.key}-import-template`);
    return new Response(typeof out.body === "string" ? out.body : Buffer.from(out.body), { headers: { "Content-Type": out.contentType, "Content-Disposition": `attachment; filename="${out.filename}"`, "Cache-Control": "private, no-store" } });
  } catch (err) {
    const { failure, status } = toFailure(err instanceof AppError ? err : err, "import-template");
    return Response.json(failure, { status, headers: { "Cache-Control": "no-store" } });
  }
}
