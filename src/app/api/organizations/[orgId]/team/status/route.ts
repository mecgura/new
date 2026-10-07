import { handle, ok, readJson } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { agentStatusSchema } from "@/lib/validations";
import { setAgentStatus } from "@/services/inbox/team";

type Ctx = { params: Promise<{ orgId: string }> };

/** Sets the caller's own availability (online / away / offline). */
export const PUT = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "team:status");
  const { status } = await readJson(req, agentStatusSchema);
  return ok(await setAgentStatus(access, status));
});
