import { handle, ok, readJson } from "@/lib/api";
import { enforceRateLimit } from "@/lib/rate-limit";
import { pagesRoute } from "@/services/landing/route-guard";
import { imageSchema, uploadImage } from "@/services/landing/pages";

type Ctx = { params: Promise<{ orgId: string }> };

export const maxDuration = 30;

/** Upload a photo for a page (resized to WebP, max 1600px). */
export const POST = handle<Ctx>(async (req, { params }) => {
  const { ctx, access } = await pagesRoute(req, params, "pages:manage");
  enforceRateLimit(`lp-image:${access.user.id}`, 30, 60_000);
  return ok(await uploadImage(ctx, await readJson(req, imageSchema)), { status: 201 });
});
