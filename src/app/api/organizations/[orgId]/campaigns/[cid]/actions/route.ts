import { handle, ok, readJson } from "@/lib/api";
import { runAfterResponse } from "@/lib/background";
import { orgRoute } from "@/lib/route-helpers";
import { campaignActionSchema } from "@/lib/validations";
import { campaignAction } from "@/services/campaigns/campaigns";
import { processCampaign } from "@/services/campaigns/sender";

type Ctx = { params: Promise<{ orgId: string; cid: string }> };

export const maxDuration = 60;

export const POST = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "campaigns:manage");
  const { action } = await readJson(req, campaignActionSchema);
  const r = await campaignAction(access, ids.cid, action, req);
  if (r.startNow) runAfterResponse(() => processCampaign(ids.cid));
  return ok({ campaign: r.campaign });
});
