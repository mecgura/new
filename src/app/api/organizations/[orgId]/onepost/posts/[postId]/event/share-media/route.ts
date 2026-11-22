import { handle, ok } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { shareMediaWithGroup } from "@/services/onepost/event-mode";

type Ctx = { params: Promise<{ orgId: string; postId: string }> };

export const POST = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "onepost:write");
  return ok(await shareMediaWithGroup(access, ids.postId, req));
});
