import { handle, ok, readJson } from "@/lib/api";
import { runAfterResponse } from "@/lib/background";
import { enforceRateLimit } from "@/lib/rate-limit";
import { orgRoute } from "@/lib/route-helpers";
import { campaignLaunchSchema } from "@/lib/validations";
import { launchCampaign } from "@/services/campaigns/campaigns";
import { processCampaign } from "@/services/campaigns/sender";

type Ctx = { params: Promise<{ orgId: string; cid: string }> };

export const maxDuration = 60;

/** Step 7: freezes the audience and schedules it, or starts sending right after the response. */
export const POST = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "campaigns:manage");
  enforceRateLimit(`launch:${access.organizationId}`, 20, 60 * 60_000);
  await readJson(req, campaignLaunchSchema);
  const r = await launchCampaign(access, ids.cid, req);
  if (r.startNow) runAfterResponse(() => processCampaign(ids.cid));
  return ok({ campaign: r.campaign, review: r.report });
});
