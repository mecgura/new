import { ApiError, handle, ok, readJson } from "@/lib/api";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requireSuperAdmin } from "@/lib/session";
import { planSchema } from "@/lib/validations";
import { mrrAt } from "@/lib/services/clients";

export const GET = handle(async (req) => {
  await requireSuperAdmin(req);
  const plans = await db.plan.findMany({
    orderBy: [{ sortOrder: "asc" }, { priceMonthly: "asc" }],
    include: { _count: { select: { subscriptions: { where: { status: "active" } } } } },
  });
  const [mrr, activeSubscriptions, clientsWithoutPlan] = await Promise.all([
    mrrAt(new Date()),
    db.subscription.count({ where: { status: "active", organization: { status: "active" } } }),
    db.organization.count({ where: { subscriptions: { none: { status: "active" } } } }),
  ]);
  return ok({ plans, summary: { mrr, activeSubscriptions, clientsWithoutPlan } });
});

export const POST = handle(async (req) => {
  const admin = await requireSuperAdmin(req);
  const input = await readJson(req, planSchema);
  if (await db.plan.findUnique({ where: { slug: input.slug } })) throw new ApiError("CONFLICT", "A plan with this slug already exists.", { details: { slug: ["Already used"] } });
  const plan = await db.plan.create({ data: { ...input, features: JSON.stringify(input.features), priceMonthly: Math.round(input.priceMonthly * 100) } });
  await audit({ action: "plan.created", actorUserId: admin.id, targetType: "plan", targetId: plan.id, metadata: { slug: plan.slug, priceMonthly: plan.priceMonthly }, req });
  return ok({ plan }, { status: 201 });
});
