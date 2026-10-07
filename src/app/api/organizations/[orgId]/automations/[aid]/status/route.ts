import { handle, ok, readJson } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { automationActionSchema } from "@/lib/validations";
import { setAutomationStatus } from "@/services/automations/automations";

type Ctx = { params: Promise<{ orgId: string; aid: string }> };

export const POST = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "automations:manage");
  const { action } = await readJson(req, automationActionSchema);
  return ok({ automation: await setAutomationStatus(access, ids.aid, action, req) });
});
