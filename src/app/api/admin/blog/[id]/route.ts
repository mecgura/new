import { handle, ok, readJson } from "@/lib/api";
import { requireSuperAdmin } from "@/lib/session";
import { idSchema } from "@/lib/validations";
import { adminGet, blogPostSchema, deletePost, updatePost } from "@/services/site/blog";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle<Ctx>(async (req, { params }) => {
  await requireSuperAdmin(req);
  return ok({ post: await adminGet(idSchema.parse((await params).id)) });
});

export const PUT = handle<Ctx>(async (req, { params }) => {
  const admin = await requireSuperAdmin(req);
  return ok({ post: await updatePost(admin.id, idSchema.parse((await params).id), await readJson(req, blogPostSchema), req) });
});

export const DELETE = handle<Ctx>(async (req, { params }) => {
  const admin = await requireSuperAdmin(req);
  await deletePost(admin.id, idSchema.parse((await params).id), req);
  return ok({ ok: true });
});
