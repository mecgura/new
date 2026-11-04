import { handle, ok, readJson } from "@/lib/api";
import { db } from "@/lib/db";
import { reviewsRoute } from "@/services/reviews/route-guard";
import { getReviewSettings, reviewSettingsSchema, saveReviewSettings } from "@/services/reviews/reviews";

type Ctx = { params: Promise<{ orgId: string }> };

/** Settings plus the approved templates that can carry the link when a customer's 24-hour window is closed. */
export const GET = handle<Ctx>(async (req, { params }) => {
  const { ctx } = await reviewsRoute(req, params, "reviews:read");
  const templates = await db.messageTemplate.findMany({ where: { organizationId: ctx.organizationId, status: "approved" }, select: { id: true, name: true, language: true, body: true }, orderBy: { name: "asc" } });
  return ok({ settings: await getReviewSettings(ctx.organizationId), templates });
});

export const PUT = handle<Ctx>(async (req, { params }) => {
  const { ctx } = await reviewsRoute(req, params, "reviews:manage");
  return ok({ settings: await saveReviewSettings(ctx, await readJson(req, reviewSettingsSchema)) });
});
