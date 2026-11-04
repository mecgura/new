import { handle, ok } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { approvePost } from "@/services/social/workflow";

type Ctx = { params: Promise<{ orgId: string; postId: string }> };

export const POST = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "social:approve");
  const p = await approvePost(access, ids.postId, req);
  return ok({ post: { id: p.id, status: p.status, approvedAt: p.approvedAt } });
});
