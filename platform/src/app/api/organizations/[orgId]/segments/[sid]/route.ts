import { handle, ok } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { deleteSegment } from "@/services/campaigns/audience";

type Ctx = { params: Promise<{ orgId: string; sid: string }> };

export const DELETE = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "campaigns:manage");
  await deleteSegment(access, ids.sid, req);
  return ok({ ok: true });
});
