import { handle, ok } from "@/lib/api";
import { enforceRateLimit } from "@/lib/rate-limit";
import { orgRoute } from "@/lib/route-helpers";
import { handoffWhatsApp } from "@/services/onepost/handoff";

type Ctx = { params: Promise<{ orgId: string; postId: string }> };

/** Creates a DRAFT template in WhatsApp → Templates from the approved WhatsApp text. Nothing is submitted or sent. */
export const POST = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "onepost:publish");
  enforceRateLimit(`onepost-handoff:${access.user.id}`, 20, 15 * 60_000);
  return ok(await handoffWhatsApp(access, ids.postId, req), { status: 201 });
});
