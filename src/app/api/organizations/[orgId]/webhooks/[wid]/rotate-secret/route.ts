import { handle, ok } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { rotateSecret } from "@/services/webhooks/endpoints";

type Ctx = { params: Promise<{ orgId: string; wid: string }> };

/** Replaces the signing secret. The old one stops working immediately; the new one is shown once. */
export const POST = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "webhooks:manage");
  return ok(await rotateSecret(access, ids.wid, req), { status: 201, headers: { "Cache-Control": "no-store" } });
});
