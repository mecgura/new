import { ApiError, handle, ok } from "@/lib/api";
import { db } from "@/lib/db";
import { orgRoute } from "@/lib/route-helpers";
import { publishPost } from "@/services/social/posts";
import { assertMayPublish } from "@/services/social/workflow";
import { assertServiceEnabled } from "@/services/whatsapp/guards";

type Ctx = { params: Promise<{ orgId: string; postId: string }> };

/** Publish now to the post's channels (needs the owner's approval first when approval is on). */
export const POST = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "social:manage");
  await assertServiceEnabled(access.organizationId, "SOCIAL_MEDIA");
  const post = await db.socialPost.findFirst({ where: { id: ids.postId, organizationId: access.organizationId }, select: { approvedAt: true, status: true } });
  if (!post) throw new ApiError("NOT_FOUND", "Post not found.");
  await assertMayPublish(access, post);
  return ok({ post: await publishPost(access.organizationId, ids.postId, access.user.id, req) });
});
