import { handle, ok, readJson } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { getStages, saveStages, stagesSchema } from "@/services/crm/deals";

type Ctx = { params: Promise<{ orgId: string }> };

export const GET = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "deals:read");
  return ok({ stages: await getStages(access.organizationId) });
});

/** Rename, recolour, reorder, add or remove pipeline stages (a stage must be empty to remove it). */
export const PUT = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "deals:manage");
  return ok({ stages: await saveStages({ organizationId: access.organizationId, actorUserId: access.user.id, req }, await readJson(req, stagesSchema)) });
});
