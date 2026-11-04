import { handle, ok, readJson } from "@/lib/api";
import { reviewsRoute } from "@/services/reviews/route-guard";
import { resolveFeedback, resolveSchema } from "@/services/reviews/reviews";

type Ctx = { params: Promise<{ orgId: string; id: string }> };

/** Marks unhappy feedback as handled, with what was done. */
export const POST = handle<Ctx>(async (req, { params }) => {
  const { ctx, ids } = await reviewsRoute(req, params, "reviews:manage");
  await resolveFeedback(ctx, ids.id, await readJson(req, resolveSchema));
  return ok({ ok: true });
});
