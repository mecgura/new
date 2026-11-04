import { handle, ok } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { enforceRateLimit } from "@/lib/rate-limit";
import { campaignPerformance } from "@/services/campaigns/insights";

type Ctx = { params: Promise<{ orgId: string }> };
export const maxDuration = 30;

/** Recent campaigns compared side by side, each template's results, and the best hour to send. */
export const GET = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "campaigns:read");
  enforceRateLimit(`campaign-perf:${access.organizationId}`, 30, 60_000);
  return ok(await campaignPerformance(access.organizationId));
});
