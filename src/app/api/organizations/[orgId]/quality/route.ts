import { handle, ok } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { getQualityOverview } from "@/services/quality/quality";

type Ctx = { params: Promise<{ orgId: string }> };

export const GET = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "quality:read");
  return ok(await getQualityOverview(access.organizationId));
});
