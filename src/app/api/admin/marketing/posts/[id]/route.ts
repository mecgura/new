import { handle, ok, readJson } from "@/lib/api";
import { requireSuperAdmin } from "@/lib/session";
import { idSchema } from "@/lib/validations";
import { deletePost, postPatchSchema, updatePost } from "@/services/marketing/content";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = handle<Ctx>(async (req, { params }) => {
  const admin = await requireSuperAdmin(req);
  return ok({ post: await updatePost(idSchema.parse((await params).id), await readJson(req, postPatchSchema), admin.id, req) });
});

export const DELETE = handle<Ctx>(async (req, { params }) => {
  const admin = await requireSuperAdmin(req);
  await deletePost(idSchema.parse((await params).id), admin.id, req);
  return ok({ ok: true });
});
