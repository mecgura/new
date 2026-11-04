import { handle, ok, readQuery } from "@/lib/api";
import { loyaltyRoute } from "@/services/loyalty/route-guard";
import { listMembers, membersQuerySchema } from "@/services/loyalty/loyalty";

type Ctx = { params: Promise<{ orgId: string }> };

export const GET = handle<Ctx>(async (req, { params }) => {
  const { ctx } = await loyaltyRoute(req, params, "loyalty:read");
  return ok({ members: await listMembers(ctx.organizationId, readQuery(req, membersQuerySchema)) });
});
