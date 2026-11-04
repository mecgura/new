import { handle, ok, readJson } from "@/lib/api";
import { loyaltyRoute } from "@/services/loyalty/route-guard";
import { rewardSchema, saveReward } from "@/services/loyalty/loyalty";

type Ctx = { params: Promise<{ orgId: string; id: string }> };

/** Edit a reward, or switch it off (rewards are never deleted so past redemptions keep their name). */
export const PATCH = handle<Ctx>(async (req, { params }) => {
  const { ctx, ids } = await loyaltyRoute(req, params, "loyalty:manage");
  return ok({ reward: await saveReward(ctx, ids.id, await readJson(req, rewardSchema)) });
});
