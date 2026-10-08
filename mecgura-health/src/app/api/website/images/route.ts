import { apiRoute } from "@/lib/api/handler";
import type { TenantRequestContext } from "@/lib/auth/context";
import { AppError } from "@/lib/errors";
import { IMAGE_LIMITS } from "@/lib/security/images";
import { saveSiteImage } from "@/lib/services/site-images";

/** multipart/form-data, field `file`. Returns { url } to store in a CMS image field. */
export const POST = apiRoute<TenantRequestContext>({ tenant: true }, async ({ req, ctx }) => {
  const file = (await req.formData()).get("file");
  if (!(file instanceof File)) throw new AppError("VALIDATION_ERROR", { fieldErrors: { file: "Choose an image to upload." } });
  if (file.size > IMAGE_LIMITS.SITE_IMAGE) throw new AppError("VALIDATION_ERROR", { fieldErrors: { file: "Image must be 4 MB or smaller." } });
  return saveSiteImage(ctx, new Uint8Array(await file.arrayBuffer()));
});
