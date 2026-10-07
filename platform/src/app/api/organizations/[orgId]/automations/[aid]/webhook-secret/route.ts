import { handle, ok } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { rotateWebhookSecret } from "@/services/automations/automations";

type Ctx = { params: Promise<{ orgId: string; aid: string }> };

/** Generates a new inbound-webhook secret. Shown once; only its hash is stored. */
export const POST = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "automations:manage");
  return ok(await rotateWebhookSecret(access, ids.aid, req), { headers: { "Cache-Control": "no-store" } });
});
