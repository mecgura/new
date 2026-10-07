import { handle, ok } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { restoreVersion } from "@/services/automations/automations";

type Ctx = { params: Promise<{ orgId: string; aid: string; vid: string }> };

/** Copies a published version back into the draft. */
export const POST = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "automations:manage");
  return ok({ automation: await restoreVersion(access, ids.aid, ids.vid, req) });
});
