import { handle, ok } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { campaignInsights } from "@/services/campaigns/insights";

type Ctx = { params: Promise<{ orgId: string; cid: string }> };

/** A/B results, cost and ROI with attribution, failure diagnostics and recommendations for one campaign. */
export const GET = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "campaigns:read");
  return ok(await campaignInsights(access.organizationId, ids.cid));
});
