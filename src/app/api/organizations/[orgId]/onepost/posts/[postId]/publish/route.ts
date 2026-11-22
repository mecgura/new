import { handle, ok, readJson } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { cancelScheduled, publishInputSchema, publishOptions, queueDeliveries } from "@/services/onepost/delivery";

export const maxDuration = 60;
type Ctx = { params: Promise<{ orgId: string; postId: string }> };

/** Which channels this post can go to right now, and what happened to it on each one. */
export const GET = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "onepost:read");
  return ok(await publishOptions(access, ids.postId));
});

/** Publish now or schedule an approved post. Everything is checked first; if any chosen channel has a problem, nothing is queued. */
export const POST = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "onepost:publish");
  return ok(await queueDeliveries(access, ids.postId, await readJson(req, publishInputSchema), req));
});

/** Cancels everything still waiting to be published. */
export const DELETE = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "onepost:publish");
  return ok(await cancelScheduled(access, ids.postId, req));
});
