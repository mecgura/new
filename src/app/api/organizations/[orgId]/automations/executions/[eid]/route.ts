import { handle, ok, readJson } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { executionActionSchema } from "@/lib/validations";
import { executionAction, getExecution } from "@/services/automations/automations";

type Ctx = { params: Promise<{ orgId: string; eid: string }> };

export const GET = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "automations:read");
  return ok({ execution: await getExecution(access, ids.eid) });
});

export const POST = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "automations:manage");
  const { action } = await readJson(req, executionActionSchema);
  return ok({ execution: await executionAction(access, ids.eid, action, req) });
});
