import { handle } from "@/lib/api";
import { requireSuperAdmin } from "@/lib/session";
import { audit } from "@/lib/audit";
import { revenueCsv } from "@/services/billing/revenue";

/** Revenue by client as CSV. */
export const GET = handle(async (req) => {
  const admin = await requireSuperAdmin(req);
  const csv = await revenueCsv();
  await audit({ action: "revenue.exported", actorUserId: admin.id, targetType: "revenue_report", metadata: { report: "revenue_by_client" }, req });
  return new Response(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="mecgura-revenue-${new Date().toISOString().slice(0, 10)}.csv"`, "cache-control": "no-store" } });
});
