import { handle, ok, readJson } from "@/lib/api";
import { loyaltyRoute } from "@/services/loyalty/route-guard";
import { listRewards, rewardSchema, saveReward } from "@/services/loyalty/loyalty";

type Ctx = { params: Promise<{ orgId: string }> };

export const GET = handle<Ctx>(async (req, { params }) => {
  const { ctx } = await loyaltyRoute(req, params, "loyalty:read");
  return ok({ rewards: await listRewards(ctx.organizationId) });
});

export const POST = handle<Ctx>(async (req, { params }) => {
  const { ctx } = await loyaltyRoute(req, params, "loyalty:manage");
  return ok({ reward: await saveReward(ctx, null, await readJson(req, rewardSchema)) }, { status: 201 });
});
