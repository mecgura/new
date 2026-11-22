import { handle, ok } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { listConnections } from "@/services/onepost/connections";

type Ctx = { params: Promise<{ orgId: string }> };

export const GET = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "onepost:read");
  return ok(await listConnections(access));
});
