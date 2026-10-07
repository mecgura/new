import { handle, ok, readJson } from "@/lib/api";
import { requireSuperAdmin } from "@/lib/session";
import { assignPlanSchema, idSchema } from "@/lib/validations";
import { assignPlan } from "@/lib/services/clients";

type Ctx = { params: Promise<{ id: string }> };

export const PUT = handle<Ctx>(async (req, { params }) => {
  const admin = await requireSuperAdmin(req);
  const id = idSchema.parse((await params).id);
  const { planId, billingMode } = await readJson(req, assignPlanSchema);
  return ok({ subscription: await assignPlan(admin.id, id, planId, req, billingMode) });
});
