import { handle, ok } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { automationLibrary } from "@/services/automations/automations";

type Ctx = { params: Promise<{ orgId: string }> };

/** Ready-made automations to start from; the long ones need the Ready-made automations service. */
export const GET = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "automations:read");
  return ok({ templates: await automationLibrary(access.organizationId) });
});
