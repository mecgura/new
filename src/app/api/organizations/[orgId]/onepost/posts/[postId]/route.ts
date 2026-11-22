import { handle, ok, readJson } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { deletePost, getPost, postInputSchema, updatePost } from "@/services/onepost/posts";

type Ctx = { params: Promise<{ orgId: string; postId: string }> };

export const GET = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "onepost:read");
  return ok({ post: await getPost(access, ids.postId) });
});

export const PATCH = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "onepost:write");
  return ok({ post: await updatePost(access, ids.postId, await readJson(req, postInputSchema), req) });
});

export const DELETE = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "onepost:write");
  await deletePost(access, ids.postId, req);
  return ok({ ok: true });
});
