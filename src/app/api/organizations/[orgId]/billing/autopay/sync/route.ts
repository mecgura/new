import { handle, ok } from "@/lib/api";
import { ApiError } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { db } from "@/lib/db";
import { syncAutopay } from "@/services/billing/autopay";

type Ctx = { params: Promise<{ orgId: string }> };

/** Re-reads this workspace's latest mandate from Razorpay (after the customer authorised it). */
export const POST = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "billing:manage");
  const a = await db.autopay.findFirst({ where: { organizationId: access.organizationId }, orderBy: { createdAt: "desc" }, select: { id: true } });
  if (!a) throw new ApiError("NOT_FOUND", "Auto-pay hasn't been set up.");
  const r = await syncAutopay(a.id);
  return ok({ mandate: r.mandate });
});
