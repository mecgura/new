import { handle, ok } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { supervisorView } from "@/services/inbox/sla";

type Ctx = { params: Promise<{ orgId: string }> };

/** Live team view: who is waiting and for how long, each agent's load, reply speed and CSAT. */
export const GET = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "inbox:view_all");
  return ok(await supervisorView(access.organizationId));
});
