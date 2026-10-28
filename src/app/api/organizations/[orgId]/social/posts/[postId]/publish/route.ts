import { handle, ok } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { publishPost } from "@/services/social/posts";
import { assertServiceEnabled } from "@/services/whatsapp/guards";

type Ctx = { params: Promise<{ orgId: string; postId: string }> };

/** Publish now to the post's channels. */
export const POST = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "social:manage");
  await assertServiceEnabled(access.organizationId, "SOCIAL_MEDIA");
  return ok({ post: await publishPost(access.organizationId, ids.postId, access.user.id, req) });
});
