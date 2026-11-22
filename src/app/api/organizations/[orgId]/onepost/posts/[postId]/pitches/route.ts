import { handle, ok, readJson } from "@/lib/api";
import { enforceRateLimit } from "@/lib/rate-limit";
import { orgRoute } from "@/lib/route-helpers";
import { listPitches, pitchSchema, sendPitches } from "@/services/onepost/pr";

type Ctx = { params: Promise<{ orgId: string; postId: string }> };

export const GET = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "onepost:read");
  return ok(await listPitches(access, ids.postId));
});
/** Emails the approved pitch to the contacts a person chose. Only an approved post can be sent. */
export const POST = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "onepost:publish");
  enforceRateLimit(`onepost-pitch:${access.user.id}`, 10, 15 * 60_000);
  return ok(await sendPitches(access, ids.postId, await readJson(req, pitchSchema), req));
});
