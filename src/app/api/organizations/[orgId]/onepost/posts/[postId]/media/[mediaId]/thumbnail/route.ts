import { handle, ok, readJson } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { setVideoThumbnail, thumbnailSchema } from "@/services/onepost/media-studio";

type Ctx = { params: Promise<{ orgId: string; postId: string; mediaId: string }> };

/** Saves the cover frame a person picked for a video. */
export const POST = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "onepost:write");
  return ok({ post: await setVideoThumbnail(access, ids.postId, ids.mediaId, (await readJson(req, thumbnailSchema)).url, req) });
});
