import { handle, ok } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { salesForecast } from "@/services/crm/deals";

type Ctx = { params: Promise<{ orgId: string }> };

/** 3-month forecast by expected close date: best case, stage-weighted and history-based, plus recent wins. */
export const GET = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "deals:read");
  return ok(await salesForecast(access.organizationId));
});
