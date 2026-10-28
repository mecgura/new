import { handle, ok, readJson } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { deletePost, postSchema, updatePost } from "@/services/social/posts";

type Ctx = { params: Promise<{ orgId: string; postId: string }> };

export const PUT = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "social:manage");
  return ok({ post: await updatePost(access, ids.postId, await readJson(req, postSchema), req) });
});

export const DELETE = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "social:manage");
  await deletePost(access, ids.postId, req);
  return ok({ deleted: true });
});
