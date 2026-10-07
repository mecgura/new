import { handle, ok } from "@/lib/api";
import { enforceRateLimit } from "@/lib/rate-limit";
import { orgRoute } from "@/lib/route-helpers";
import { sendTest } from "@/services/webhooks/endpoints";

type Ctx = { params: Promise<{ orgId: string; wid: string }> };

export const POST = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "webhooks:manage");
  enforceRateLimit(`webhook-test:${access.user.id}`, 20, 60_000);
  return ok({ delivery: await sendTest(access, ids.wid) });
});
