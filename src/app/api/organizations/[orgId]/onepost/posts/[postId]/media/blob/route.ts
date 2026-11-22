import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { ApiError, handle, ok } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { assertMayUpload } from "@/services/onepost/posts";
import { IMAGE_TYPES, MAX_BLOB_VIDEO_BYTES, VIDEO_TYPES, requireBlob } from "@/services/onepost/storage";

type Ctx = { params: Promise<{ orgId: string; postId: string }> };

/**
 * Gives the browser a short-lived token to upload one photo or video straight to Blob (large files can't pass through a server function).
 * The token only allows this post's own folder, image and video types, and the size limit. The file is attached afterwards by the
 * explicit "register" call, so no upload-completed callback is requested.
 */
export const POST = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "onepost:write");
  const body = (await req.json().catch(() => null)) as HandleUploadBody | null;
  if (!body || typeof body !== "object" || typeof (body as { type?: unknown }).type !== "string") throw new ApiError("VALIDATION_ERROR", "Request body must be a Blob upload request.");
  // This workspace's own post, still editable, with room for another file: checked before anything about storage is revealed.
  const prefix = await assertMayUpload(access, ids.postId);
  requireBlob();
  const json = await handleUpload({
    body,
    request: req,
    onBeforeGenerateToken: async (pathname) => {
      if (!pathname.startsWith(prefix) || pathname.includes("..")) throw new ApiError("FORBIDDEN", "That upload location isn't allowed.");
      return { allowedContentTypes: [...IMAGE_TYPES, ...VIDEO_TYPES], maximumSizeInBytes: MAX_BLOB_VIDEO_BYTES, addRandomSuffix: true, tokenPayload: JSON.stringify({ o: access.organizationId, p: ids.postId }) };
    },
  });
  return ok(json);
});
