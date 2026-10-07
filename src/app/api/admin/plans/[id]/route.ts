import { ApiError, handle, ok, readJson } from "@/lib/api";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requireSuperAdmin } from "@/lib/session";
import { idSchema, planUpdateSchema } from "@/lib/validations";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Price changes apply to NEW assignments only — existing subscriptions keep the
 * price snapshotted when they were assigned.
 */
export const PATCH = handle<Ctx>(async (req, { params }) => {
  const admin = await requireSuperAdmin(req);
  const id = idSchema.parse((await params).id);
  const input = await readJson(req, planUpdateSchema);
  if (!(await db.plan.findUnique({ where: { id } }))) throw new ApiError("NOT_FOUND", "Plan not found.");
  if (input.slug) {
    const clash = await db.plan.findUnique({ where: { slug: input.slug } });
    if (clash && clash.id !== id) throw new ApiError("CONFLICT", "A plan with this slug already exists.", { details: { slug: ["Already used"] } });
  }
  const plan = await db.plan.update({
    where: { id },
    data: { ...input, features: input.features ? JSON.stringify(input.features) : undefined, ...(input.priceMonthly !== undefined ? { priceMonthly: Math.round(input.priceMonthly * 100) } : {}) },
  });
  await audit({ action: "plan.updated", actorUserId: admin.id, targetType: "plan", targetId: id, metadata: { fields: Object.keys(input) }, req });
  return ok({ plan });
});

/** Plans with any subscription history can't be deleted (revenue history) — deactivate them instead. */
export const DELETE = handle<Ctx>(async (req, { params }) => {
  const admin = await requireSuperAdmin(req);
  const id = idSchema.parse((await params).id);
  const plan = await db.plan.findUnique({ where: { id }, include: { _count: { select: { subscriptions: true } } } });
  if (!plan) throw new ApiError("NOT_FOUND", "Plan not found.");
  if (plan._count.subscriptions > 0) throw new ApiError("CONFLICT", "This plan has been assigned to clients. Deactivate it instead of deleting.");
  await db.plan.delete({ where: { id } });
  await audit({ action: "plan.deleted", actorUserId: admin.id, targetType: "plan", targetId: id, metadata: { slug: plan.slug }, req });
  return ok({ ok: true });
});
