import { z } from "zod";
import { handle, ok, readJson } from "@/lib/api";
import { enforceRateLimit } from "@/lib/rate-limit";
import { orgRoute } from "@/lib/route-helpers";
import { idSchema } from "@/lib/validations";
import { changePlan } from "@/services/billing/billing";

type Ctx = { params: Promise<{ orgId: string }> };

/** Upgrade (invoice, applies when paid), downgrade (applies at period end) or first plan. */
export const POST = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "billing:manage");
  enforceRateLimit(`billing-change:${access.user.id}`, 20, 60 * 60_000);
  const { planId } = await readJson(req, z.object({ planId: idSchema }));
  return ok(await changePlan(access, planId, req));
});
