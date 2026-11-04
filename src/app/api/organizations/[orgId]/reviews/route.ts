import { handle, ok } from "@/lib/api";
import { reviewsRoute } from "@/services/reviews/route-guard";
import { reviewStats } from "@/services/reviews/reviews";

type Ctx = { params: Promise<{ orgId: string }> };

/** Last 8 weeks: average rating, distribution, open/response/Google-click rates, trend and each location. */
export const GET = handle<Ctx>(async (req, { params }) => {
  const { ctx } = await reviewsRoute(req, params, "reviews:read");
  return ok(await reviewStats(ctx.organizationId));
});
