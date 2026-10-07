import { handle, ok } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { automationAnalytics } from "@/services/automations/automations";

type Ctx = { params: Promise<{ orgId: string; aid: string }> };

export const GET = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "automations:read");
  return ok(await automationAnalytics(access, ids.aid));
});
