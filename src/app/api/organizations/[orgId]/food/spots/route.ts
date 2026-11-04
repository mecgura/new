import { handle, ok, readJson } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { addSpots, listSpots, spotsSchema } from "@/services/food/food";

type Ctx = { params: Promise<{ orgId: string }> };

export const GET = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "food:manage");
  return ok({ spots: await listSpots(access.organizationId) });
});

/** Add one room/table, or a numbered range (e.g. Room 101–120). */
export const POST = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "food:manage");
  return ok(await addSpots(access, await readJson(req, spotsSchema)), { status: 201 });
});
