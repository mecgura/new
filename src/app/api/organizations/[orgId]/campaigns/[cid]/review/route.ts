import { handle, ok } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { reviewCampaign } from "@/services/campaigns/campaigns";

type Ctx = { params: Promise<{ orgId: string; cid: string }> };

export const POST = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "campaigns:manage");
  return ok({ review: await reviewCampaign(access, ids.cid, req) });
});
