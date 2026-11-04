import { handle, ok, readQuery } from "@/lib/api";
import { loyaltyRoute } from "@/services/loyalty/route-guard";
import { listReferrals, referralListSchema } from "@/services/loyalty/loyalty";

type Ctx = { params: Promise<{ orgId: string }> };

export const GET = handle<Ctx>(async (req, { params }) => {
  const { ctx } = await loyaltyRoute(req, params, "loyalty:read");
  return ok({ referrals: await listReferrals(ctx.organizationId, readQuery(req, referralListSchema)) });
});
