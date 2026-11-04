import { z } from "zod";
import { handle, ok, readJson } from "@/lib/api";
import { loyaltyRoute } from "@/services/loyalty/route-guard";
import { decideReferral } from "@/services/loyalty/loyalty";

type Ctx = { params: Promise<{ orgId: string; id: string }> };

/** Owner/manager approves (pays the points) or rejects a referral. */
export const POST = handle<Ctx>(async (req, { params }) => {
  const { ctx, ids } = await loyaltyRoute(req, params, "loyalty:manage");
  const { decision } = await readJson(req, z.object({ decision: z.enum(["approve", "reject"]) }).strict());
  return ok({ referral: await decideReferral(ctx, ids.id, decision) });
});
