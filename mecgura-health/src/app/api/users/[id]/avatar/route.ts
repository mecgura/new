import { apiRoute } from "@/lib/api/handler";
import type { TenantRequestContext } from "@/lib/auth/context";
import { AppError } from "@/lib/errors";
import { IMAGE_LIMITS } from "@/lib/security/images";
import { removeImage, saveImage } from "@/lib/services/clinic-settings";

export const POST = apiRoute<TenantRequestContext>({ tenant: true }, async ({ req, ctx, params }) => {
  const file = (await req.formData()).get("file");
  if (!(file instanceof File)) throw new AppError("VALIDATION_ERROR", { fieldErrors: { file: "Choose an image to upload." } });
  if (file.size > IMAGE_LIMITS.AVATAR) throw new AppError("VALIDATION_ERROR", { fieldErrors: { file: "Image is too large." } });
  return saveImage(ctx, "AVATAR", new Uint8Array(await file.arrayBuffer()), params.id);
});

export const DELETE = apiRoute<TenantRequestContext>({ tenant: true }, async ({ ctx, params }) => {
  await removeImage(ctx, "AVATAR", params.id);
  return { removed: true };
});
