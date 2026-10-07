import { handle, ok } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { getBillingOverview } from "@/services/billing/billing";

type Ctx = { params: Promise<{ orgId: string }> };

export const GET = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "billing:read");
  return ok(await getBillingOverview(access.organizationId));
});
