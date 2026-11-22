import { handle, ok, readJson } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { rescheduleDelivery, rescheduleSchema } from "@/services/onepost/delivery";

type Ctx = { params: Promise<{ orgId: string; deliveryId: string }> };

/** Moves a waiting post to another time (the calendar uses this when a post is dragged to a new day). */
export const PATCH = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "onepost:publish");
  return ok(await rescheduleDelivery(access, ids.deliveryId, (await readJson(req, rescheduleSchema)).scheduledAt, req));
});
