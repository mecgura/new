import { handle, ok, readJson } from "@/lib/api";
import { loyaltyRoute } from "@/services/loyalty/route-guard";
import { redeem, redeemSchema } from "@/services/loyalty/loyalty";

type Ctx = { params: Promise<{ orgId: string }> };

export const POST = handle<Ctx>(async (req, { params }) => {
  const { ctx } = await loyaltyRoute(req, params, "loyalty:write");
  return ok({ wallet: await redeem(ctx, await readJson(req, redeemSchema)) });
});
