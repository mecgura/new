import { z } from "zod";
import { ApiError, handle, ok } from "@/lib/api";
import { enforceRateLimit } from "@/lib/rate-limit";
import { orgRoute } from "@/lib/route-helpers";
import { PREVIEW_FORMATS } from "@/providers/meta/ads";
import { adPreview } from "@/services/ads/ads";

type Ctx = { params: Promise<{ orgId: string; adId: string }> };

/** Meta's own preview of the ad in a placement (Facebook feed, Instagram feed or story). */
export const GET = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "ads:read");
  enforceRateLimit(`ads-preview:${access.user.id}`, 60, 60 * 60_000);
  const f = z.enum(PREVIEW_FORMATS).safeParse(new URL(req.url).searchParams.get("format") ?? "MOBILE_FEED_STANDARD");
  if (!f.success) throw new ApiError("VALIDATION_ERROR", "Unknown preview format.");
  return ok(await adPreview(access, ids.adId, f.data));
});
