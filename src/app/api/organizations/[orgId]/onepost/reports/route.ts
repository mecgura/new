import { z } from "zod";
import { handle, ok, readQuery } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { MONTH_RE, buildReport } from "@/services/onepost/reports";

type Ctx = { params: Promise<{ orgId: string }> };
const query = z.object({ month: z.string().regex(MONTH_RE) });

export const GET = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "onepost:read");
  return ok(await buildReport(access, readQuery(req, query).month));
});
