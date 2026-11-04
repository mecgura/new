import { handle, ok } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { clientResolve } from "@/services/support/tickets";

type Ctx = { params: Promise<{ orgId: string; id: string }> };

export const POST = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "support:use");
  return ok({ ticket: await clientResolve(access.organizationId, { userId: access.user.id, req }, ids.id) });
});
