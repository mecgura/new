import { handle, ok } from "@/lib/api";
import { enforceRateLimit } from "@/lib/rate-limit";
import { orgRoute } from "@/lib/route-helpers";
import { syncInsights } from "@/services/ads/ads";

type Ctx = { params: Promise<{ orgId: string; adId: string }> };

/** Refreshes spend, impressions and clicks for one ad from Meta. */
export const POST = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "ads:read");
  enforceRateLimit(`ads-sync:${access.user.id}`, 60, 60 * 60_000);
  return ok({ ad: await syncInsights(access, ids.adId) });
});
