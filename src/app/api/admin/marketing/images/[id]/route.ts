import { NextResponse } from "next/server";
import { handle, ok } from "@/lib/api";
import { requireSuperAdmin } from "@/lib/session";
import { idSchema } from "@/lib/validations";
import { deleteImage, imageFile } from "@/services/marketing/ai-studio";

type Ctx = { params: Promise<{ id: string }> };

/** The image file (Super Admin only). ?download=1 saves it. */
export const GET = handle<Ctx>(async (req, { params }) => {
  await requireSuperAdmin(req);
  const id = idSchema.parse((await params).id);
  const img = await imageFile(id);
  const ext = img.mimeType === "image/jpeg" ? "jpg" : img.mimeType === "image/webp" ? "webp" : "png";
  const download = new URL(req.url).searchParams.get("download") === "1";
  return new NextResponse(new Uint8Array(img.data), {
    headers: {
      "content-type": img.mimeType,
      "cache-control": "private, max-age=86400",
      "x-content-type-options": "nosniff",
      ...(download ? { "content-disposition": `attachment; filename="mecgura-ai-${id}.${ext}"` } : {}),
    },
  });
});

export const DELETE = handle<Ctx>(async (req, { params }) => {
  await requireSuperAdmin(req);
  await deleteImage(idSchema.parse((await params).id));
  return ok({ ok: true });
});
