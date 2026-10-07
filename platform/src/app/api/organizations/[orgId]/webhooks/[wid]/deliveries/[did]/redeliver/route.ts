import { handle, ok } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { redeliver } from "@/services/webhooks/endpoints";

type Ctx = { params: Promise<{ orgId: string; wid: string; did: string }> };

export const POST = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "webhooks:manage");
  return ok({ delivery: await redeliver(access, ids.wid, ids.did) });
});
