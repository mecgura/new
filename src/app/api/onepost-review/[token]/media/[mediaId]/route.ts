import { handle, clientIp } from "@/lib/api";
import { enforceRateLimit } from "@/lib/rate-limit";
import { idSchema } from "@/lib/validations";
import { reviewMedia } from "@/services/onepost/review-link";

type Ctx = { params: Promise<{ token: string; mediaId: string }> };

/** Public (no login): a photo or video of the post under review, only while its link is active. */
export const GET = handle<Ctx>(async (req, { params }) => {
  enforceRateLimit(`onepost-review-media:${clientIp(req)}`, 300, 15 * 60_000);
  const p = await params;
  const m = await reviewMedia(p.token, idSchema.parse(p.mediaId));
  if (!m) return new Response("Not found", { status: 404 });
  if (m.storage === "blob" && m.blobUrl) return Response.redirect(m.blobUrl, 302);
  return new Response(new Uint8Array(m.bytes), { headers: { "content-type": m.mimeType, "cache-control": "private, max-age=600", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" } });
});
