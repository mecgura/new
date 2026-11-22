import { handle, ok, readJson } from "@/lib/api";
import { enforceRateLimit } from "@/lib/rate-limit";
import { orgRoute } from "@/lib/route-helpers";
import { createEventCampaign, eventInputSchema } from "@/services/onepost/event-mode";

type Ctx = { params: Promise<{ orgId: string }> };

/** Creates the five posts of an event campaign (as drafts). The AI is asked to write each one separately afterwards. */
export const POST = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "onepost:write");
  enforceRateLimit(`onepost-event:${access.user.id}`, 10, 15 * 60_000);
  return ok(await createEventCampaign(access, await readJson(req, eventInputSchema), req), { status: 201 });
});
