import { handle, ok } from "@/lib/api";
import { enforceRateLimit } from "@/lib/rate-limit";
import { orgRoute } from "@/lib/route-helpers";
import { syncAll } from "@/services/ads/ads";

export const maxDuration = 60;
type Ctx = { params: Promise<{ orgId: string }> };

/** Pulls live status, review result and results for every live ad from Meta (run when the Ads page opens). */
export const POST = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "ads:read");
  enforceRateLimit(`ads-sync-all:${access.organizationId}`, 30, 60 * 60_000);
  return ok(await syncAll(access));
});
