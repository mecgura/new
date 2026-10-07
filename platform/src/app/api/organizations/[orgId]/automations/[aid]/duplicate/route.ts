import { handle, ok } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { duplicateAutomation } from "@/services/automations/automations";

type Ctx = { params: Promise<{ orgId: string; aid: string }> };

export const POST = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "automations:manage");
  return ok({ automation: await duplicateAutomation(access, ids.aid, req) }, { status: 201 });
});
