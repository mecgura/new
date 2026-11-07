import { handle, ok } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { adReport } from "@/services/sponsored/sponsored";

type Ctx = { params: Promise<{ orgId: string; id: string }> };

export const GET = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "sponsored:read");
  return ok({ daily: await adReport(access.organizationId, ids.id) });
});
