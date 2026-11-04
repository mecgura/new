import { handle, ok } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { kitchenOrders } from "@/services/food/food";

type Ctx = { params: Promise<{ orgId: string }> };

/** Kitchen screen: active orders (default) or the last 24 hours. */
export const GET = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "food:kitchen");
  const view = new URL(req.url).searchParams.get("view") === "today" ? "today" : "active";
  return ok({ orders: await kitchenOrders(access.organizationId, view), at: new Date().toISOString() });
});
