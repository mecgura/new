import { handle, ok, readJson } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { automationPublishSchema } from "@/lib/validations";
import { publishAutomation } from "@/services/automations/automations";

type Ctx = { params: Promise<{ orgId: string; aid: string }> };

export const POST = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "automations:manage");
  const { note } = await readJson(req, automationPublishSchema);
  return ok(await publishAutomation(access, ids.aid, note, req));
});
