import { handle, ok, readJson } from "@/lib/api";
import { enforceRateLimit } from "@/lib/rate-limit";
import { loyaltyRoute } from "@/services/loyalty/route-guard";
import { purchaseSchema, recordPurchase } from "@/services/loyalty/loyalty";

type Ctx = { params: Promise<{ orgId: string }> };

/** Records a sale: earns points, and pays a pending referral on the friend's first qualifying purchase. */
export const POST = handle<Ctx>(async (req, { params }) => {
  const { ctx, access } = await loyaltyRoute(req, params, "loyalty:write");
  enforceRateLimit(`loyalty-purchase:${access.user.id}`, 120, 60_000);
  return ok(await recordPurchase(ctx, await readJson(req, purchaseSchema)), { status: 201 });
});
