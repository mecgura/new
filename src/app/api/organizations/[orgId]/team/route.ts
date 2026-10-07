import { handle, ok } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { listTeam } from "@/services/inbox/team";

type Ctx = { params: Promise<{ orgId: string }> };

/** Team availability + workload (used by assignment pickers; visible to every member). */
export const GET = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "inbox:read");
  return ok({ members: await listTeam(access.organizationId) });
});
