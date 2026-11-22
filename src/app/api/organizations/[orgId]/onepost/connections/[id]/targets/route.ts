import { handle, ok, readJson } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { listTargets, selectTarget, selectTargetSchema } from "@/services/onepost/connections";

type Ctx = { params: Promise<{ orgId: string; id: string }> };

/** The accounts or locations this connection can post to. */
export const GET = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "onepost:connect");
  return ok(await listTargets(access, ids.id));
});

export const PUT = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "onepost:connect");
  return ok({ connection: await selectTarget(access, ids.id, await readJson(req, selectTargetSchema), req) });
});
