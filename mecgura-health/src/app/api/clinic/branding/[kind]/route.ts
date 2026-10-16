import { apiRoute } from "@/lib/api/handler";
import type { TenantRequestContext } from "@/lib/auth/context";
import { AppError } from "@/lib/errors";
import { IMAGE_LIMITS } from "@/lib/security/images";
import { removeImage, saveImage } from "@/lib/services/clinic-settings";

const KINDS = { logo: "LOGO", favicon: "FAVICON" } as const;
const kindOf = (k: string) => {
  const kind = (KINDS as Record<string, "LOGO" | "FAVICON">)[k];
  if (!kind) throw new AppError("NOT_FOUND");
  return kind;
};

/** multipart/form-data with a single `file` field. Type is decided by the file's bytes, not its name/MIME. */
export const POST = apiRoute<TenantRequestContext>({ tenant: true, permission: "clinic.settings" }, async ({ req, ctx, params }) => {
  const kind = kindOf(params.kind);
  const file = (await req.formData()).get("file");
  if (!(file instanceof File)) throw new AppError("VALIDATION_ERROR", { fieldErrors: { file: "Choose an image to upload." } });
  if (file.size > IMAGE_LIMITS[kind]) throw new AppError("VALIDATION_ERROR", { fieldErrors: { file: "Image is too large." } });
  return saveImage(ctx, kind, new Uint8Array(await file.arrayBuffer()));
});

export const DELETE = apiRoute<TenantRequestContext>({ tenant: true, permission: "clinic.settings" }, async ({ ctx, params }) => {
  await removeImage(ctx, kindOf(params.kind));
  return { removed: true };
});
