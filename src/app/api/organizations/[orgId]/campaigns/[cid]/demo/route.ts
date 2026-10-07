import { handle, ok, readJson } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { campaignDemoSchema } from "@/lib/validations";
import { simulateCampaignOutcomes } from "@/services/campaigns/campaigns";

type Ctx = { params: Promise<{ orgId: string; cid: string }> };

/** Demo campaigns only: feeds simulated receipts/replies/opt-outs through the live webhook code paths. */
export const POST = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "campaigns:manage");
  const input = await readJson(req, campaignDemoSchema);
  return ok(await simulateCampaignOutcomes(access, ids.cid, input));
});
