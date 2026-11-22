import { handle, ok } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { revokeReviewLink } from "@/services/onepost/review-link";

type Ctx = { params: Promise<{ orgId: string; postId: string; linkId: string }> };

export const DELETE = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "onepost:publish");
  await revokeReviewLink(access, ids.postId, ids.linkId, req);
  return ok({ ok: true });
});
