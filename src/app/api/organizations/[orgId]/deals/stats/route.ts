import { handle, ok } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { pipelineStats } from "@/services/crm/deals";

type Ctx = { params: Promise<{ orgId: string }> };

/** Open value, weighted forecast, this month's wins, win rate and each salesperson's numbers. */
export const GET = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "deals:read");
  return ok(await pipelineStats(access.organizationId));
});
