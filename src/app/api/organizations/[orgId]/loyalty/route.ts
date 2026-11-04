import { handle, ok } from "@/lib/api";
import { loyaltyRoute } from "@/services/loyalty/route-guard";
import { loyaltyOverview } from "@/services/loyalty/loyalty";

type Ctx = { params: Promise<{ orgId: string }> };

/** Programme numbers: members, points issued and redeemed, sales, repeat rate, referrals. */
export const GET = handle<Ctx>(async (req, { params }) => {
  const { ctx } = await loyaltyRoute(req, params, "loyalty:read");
  return ok(await loyaltyOverview(ctx.organizationId));
});
