import { handle, ok, readJson } from "@/lib/api";
import { requireSuperAdmin } from "@/lib/session";
import { adminList, blogPostSchema, createPost } from "@/services/site/blog";

export const GET = handle(async (req) => {
  await requireSuperAdmin(req);
  return ok({ posts: await adminList() });
});

export const POST = handle(async (req) => {
  const admin = await requireSuperAdmin(req);
  return ok({ post: await createPost(admin.id, await readJson(req, blogPostSchema), req) }, { status: 201 });
});
