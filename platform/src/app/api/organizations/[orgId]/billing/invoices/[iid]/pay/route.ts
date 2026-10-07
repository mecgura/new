import { z } from "zod";
import { handle, ok, readJson } from "@/lib/api";
import { enforceRateLimit } from "@/lib/rate-limit";
import { orgRoute } from "@/lib/route-helpers";
import { startPayment } from "@/services/billing/billing";

type Ctx = { params: Promise<{ orgId: string; iid: string }> };

/** Starts a checkout with a connected gateway. Refuses (409) when no gateway is connected — it never pretends. */
export const POST = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "billing:manage");
  enforceRateLimit(`billing-pay:${access.user.id}`, 20, 60 * 60_000);
  const { gateway } = await readJson(req, z.object({ gateway: z.string().min(1).max(30) }));
  return ok({ checkout: await startPayment(access, ids.iid, gateway) }, { status: 201 });
});
