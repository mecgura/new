import { handle, ok, readJson } from "@/lib/api";
import { enforceRateLimit } from "@/lib/rate-limit";
import { orgRoute } from "@/lib/route-helpers";
import { createVariants, variantsSchema } from "@/services/onepost/media-studio";

export const maxDuration = 60;
type Ctx = { params: Promise<{ orgId: string; postId: string; mediaId: string }> };

/** Resized copies of one photo (1:1, 4:5, 9:16, 16:9), optionally with the brand logo. */
export const POST = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "onepost:write");
  enforceRateLimit(`onepost-variants:${access.user.id}`, 30, 15 * 60_000);
  return ok({ post: await createVariants(access, ids.postId, ids.mediaId, await readJson(req, variantsSchema), req) });
});
