import { handle, ok } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { autopayOverview, startAutopay, stopAutopay } from "@/services/billing/autopay";

type Ctx = { params: Promise<{ orgId: string }> };

export const GET = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "billing:manage");
  return ok({ autopay: await autopayOverview(access.organizationId) });
});

/** Starts a card / UPI AutoPay mandate; returns Razorpay's hosted authorisation link. */
export const POST = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "billing:manage");
  return ok({ mandate: await startAutopay(access, req) }, { status: 201 });
});

export const DELETE = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "billing:manage");
  await stopAutopay(access, req);
  return ok({ stopped: true });
});
