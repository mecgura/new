import { handle, ok } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { getOverview } from "@/services/ads/ads";

type Ctx = { params: Promise<{ orgId: string }> };

/** Ads Manager overview: connection, live WhatsApp numbers and the ads created from MECGURA with their results. */
export const GET = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "ads:read");
  return ok(await getOverview(access.organizationId));
});
