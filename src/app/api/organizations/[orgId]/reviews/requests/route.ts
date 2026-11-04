import { handle, ok, readJson, readQuery } from "@/lib/api";
import { enforceRateLimit } from "@/lib/rate-limit";
import { reviewsRoute } from "@/services/reviews/route-guard";
import { listRequests, listSchema, sendRequests, sendSchema } from "@/services/reviews/reviews";

type Ctx = { params: Promise<{ orgId: string }> };

export const GET = handle<Ctx>(async (req, { params }) => {
  const { ctx } = await reviewsRoute(req, params, "reviews:read");
  return ok({ requests: await listRequests(ctx.organizationId, readQuery(req, listSchema)) });
});

/** Sends feedback links on WhatsApp (or only creates them, to send by hand). */
export const POST = handle<Ctx>(async (req, { params }) => {
  const { ctx, access } = await reviewsRoute(req, params, "reviews:send");
  enforceRateLimit(`reviews-send:${access.organizationId}`, 20, 60_000);
  return ok(await sendRequests(ctx, await readJson(req, sendSchema)));
});
