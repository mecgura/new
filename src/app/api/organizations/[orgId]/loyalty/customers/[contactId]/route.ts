import { handle, ok } from "@/lib/api";
import { loyaltyRoute } from "@/services/loyalty/route-guard";
import { customerCard } from "@/services/loyalty/loyalty";

type Ctx = { params: Promise<{ orgId: string; contactId: string }> };

/** One customer's points, tier, history, purchases, lifetime value and referral link. */
export const GET = handle<Ctx>(async (req, { params }) => {
  const { ctx, ids } = await loyaltyRoute(req, params, "loyalty:read");
  return ok(await customerCard(ctx.organizationId, ids.contactId));
});
