import { handle, ok, readJson } from "@/lib/api";
import { idSchema } from "@/lib/validations";
import { requireSuperAdmin } from "@/lib/session";
import { adminDaily, adminReview, reviewSchema } from "@/services/sponsored/sponsored";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle<Ctx>(async (req, { params }) => {
  await requireSuperAdmin(req);
  return ok({ daily: await adminDaily(idSchema.parse((await params).id)) });
});

/** Approve, reject (with a reason the client sees), pause, resume or end — and set the view cap and dates. */
export const POST = handle<Ctx>(async (req, { params }) => {
  const admin = await requireSuperAdmin(req);
  return ok(await adminReview(admin.id, idSchema.parse((await params).id), await readJson(req, reviewSchema), req));
});
