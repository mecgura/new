import { handle, ok } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { cancelSubscription } from "@/services/billing/billing";

type Ctx = { params: Promise<{ orgId: string }> };

export const POST = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "billing:manage");
  return ok(await cancelSubscription(access, req));
});
