import { handle, ok } from "@/lib/api";
import { enforceRateLimit } from "@/lib/rate-limit";
import { orgRoute } from "@/lib/route-helpers";
import { retryFailed } from "@/services/onepost/delivery";

export const maxDuration = 60;
type Ctx = { params: Promise<{ orgId: string; postId: string }> };

export const POST = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "onepost:publish");
  enforceRateLimit(`onepost-retry:${access.user.id}`, 10, 15 * 60_000);
  return ok(await retryFailed(access, ids.postId, req));
});
