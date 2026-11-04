import { handle, ok } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { contactJourney } from "@/services/crm/journey";

type Ctx = { params: Promise<{ orgId: string; id: string }> };

/** One contact's journey: first touch → conversations → deals → purchases → reviews, from existing records. */
export const GET = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "contacts:read");
  return ok(await contactJourney(access.organizationId, ids.id));
});
