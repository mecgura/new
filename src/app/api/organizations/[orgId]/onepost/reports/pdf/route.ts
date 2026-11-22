import { z } from "zod";
import { handle, readQuery } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { MONTH_RE, buildReportPdf } from "@/services/onepost/reports";

type Ctx = { params: Promise<{ orgId: string }> };
const query = z.object({ month: z.string().regex(MONTH_RE) });

export const GET = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "onepost:read");
  const { month } = readQuery(req, query);
  const bytes = await buildReportPdf(access, month);
  return new Response(Buffer.from(bytes), { headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="content-report-${month}.pdf"`, "cache-control": "no-store" } });
});
