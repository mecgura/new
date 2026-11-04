import { handle, ok } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { markPaid } from "@/services/food/food";

type Ctx = { params: Promise<{ orgId: string; id: string }> };

/** Staff received the money (counter, cash, room bill settled). */
export const POST = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "food:kitchen");
  return ok({ order: await markPaid(access, ids.id, req) });
});
