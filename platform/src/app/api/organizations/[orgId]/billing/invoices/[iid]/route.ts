import { handle, ok } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { getInvoice } from "@/services/billing/billing";

type Ctx = { params: Promise<{ orgId: string; iid: string }> };

export const GET = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "billing:read");
  return ok({ invoice: await getInvoice(access.organizationId, ids.iid) });
});
