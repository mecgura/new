import { handle, ok, readQuery } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { executionListSchema } from "@/lib/validations";
import { listExecutions } from "@/services/automations/automations";

type Ctx = { params: Promise<{ orgId: string; aid: string }> };

export const GET = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "automations:read");
  const q = readQuery(req, executionListSchema);
  return ok(await listExecutions(access, ids.aid, { status: q.status || undefined, page: q.page, tests: q.tests }));
});
