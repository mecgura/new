import { handle, ok } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { mediaFile, removeMedia } from "@/services/onepost/posts";

type Ctx = { params: Promise<{ orgId: string; postId: string; mediaId: string }> };

/** The image itself, for team members only. */
export const GET = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "onepost:read");
  const m = await mediaFile(access, ids.postId, ids.mediaId);
  return new Response(new Uint8Array(m.bytes), { headers: { "content-type": m.mimeType, "cache-control": "private, max-age=3600", "x-content-type-options": "nosniff" } });
});

export const DELETE = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "onepost:write");
  return ok({ post: await removeMedia(access, ids.postId, ids.mediaId, req) });
});
