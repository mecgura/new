import { handle, ok, readJson } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { scoringSchema } from "@/lib/lead-scoring";
import { getScoring, saveScoring } from "@/services/crm/deals";

type Ctx = { params: Promise<{ orgId: string }> };

export const GET = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "deals:read");
  return ok({ scoring: await getScoring(access.organizationId) });
});

/** Lead scoring rules and the Hot / Warm thresholds. */
export const PUT = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "deals:manage");
  return ok({ scoring: await saveScoring({ organizationId: access.organizationId, actorUserId: access.user.id, req }, await readJson(req, scoringSchema)) });
});
