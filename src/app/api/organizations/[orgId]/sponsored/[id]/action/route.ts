import { handle, ok, readJson } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { adAction, adActionSchema } from "@/services/sponsored/sponsored";

type Ctx = { params: Promise<{ orgId: string; id: string }> };

/** Send for review, pause or resume. */
export const POST = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "sponsored:manage");
  const { action } = await readJson(req, adActionSchema);
  return ok({ ad: await adAction(access, ids.id, action, req) });
});
