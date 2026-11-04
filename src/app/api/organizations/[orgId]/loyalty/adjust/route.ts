import { handle, ok, readJson } from "@/lib/api";
import { loyaltyRoute } from "@/services/loyalty/route-guard";
import { adjust, adjustSchema } from "@/services/loyalty/loyalty";

type Ctx = { params: Promise<{ orgId: string }> };

/** Owner/manager: add or remove points by hand, with a reason (audited). */
export const POST = handle<Ctx>(async (req, { params }) => {
  const { ctx } = await loyaltyRoute(req, params, "loyalty:manage");
  return ok({ wallet: await adjust(ctx, await readJson(req, adjustSchema)) });
});
