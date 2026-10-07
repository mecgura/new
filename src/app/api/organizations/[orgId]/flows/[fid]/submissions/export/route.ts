import { handle } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { exportSubmissionsCsv } from "@/services/flows/flows";

type Ctx = { params: Promise<{ orgId: string; fid: string }> };

export const GET = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "contacts:export");
  const { filename, csv } = await exportSubmissionsCsv(access.organizationId, ids.fid);
  return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${filename}"`, "Cache-Control": "no-store" } });
});
