import { ApiError, handle, ok } from "@/lib/api";
import { enforceRateLimit } from "@/lib/rate-limit";
import { orgRoute } from "@/lib/route-helpers";
import { uploadImage } from "@/services/ads/ads";

type Ctx = { params: Promise<{ orgId: string }> };
const MAX_BYTES = 4 * 1024 * 1024;

/** Uploads the ad picture straight to the Meta ad account (nothing is stored here) and returns its hash. */
export const POST = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "ads:manage");
  enforceRateLimit(`ads-image:${access.user.id}`, 30, 60 * 60_000);
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BYTES + 20_000) throw new ApiError("VALIDATION_ERROR", "Images can be up to 4 MB.");
  const form = await req.formData().catch(() => {
    throw new ApiError("VALIDATION_ERROR", "Upload the image as multipart/form-data.");
  });
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) throw new ApiError("VALIDATION_ERROR", "Choose an image.", { details: { file: ["Required"] } });
  if (file.size > MAX_BYTES) throw new ApiError("VALIDATION_ERROR", "Images can be up to 4 MB.");
  if (!/^image\/(jpeg|png)$/.test(file.type)) throw new ApiError("VALIDATION_ERROR", "Use a JPG or PNG image.", { details: { file: ["JPG or PNG only"] } });
  return ok(await uploadImage(access, Buffer.from(await file.arrayBuffer()).toString("base64")));
});
