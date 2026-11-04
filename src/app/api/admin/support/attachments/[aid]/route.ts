import { handle, ApiError } from "@/lib/api";
import { requireSuperAdmin } from "@/lib/session";
import { idSchema } from "@/lib/validations";
import { attachmentFor } from "@/services/support/tickets";

type Ctx = { params: Promise<{ aid: string }> };

export const GET = handle<Ctx>(async (req, { params }) => {
  await requireSuperAdmin(req);
  const a = await attachmentFor(idSchema.parse((await params).aid), "admin");
  if (!a) throw new ApiError("NOT_FOUND", "File not found.");
  return new Response(new Uint8Array(a.data), { headers: { "content-type": a.mimeType, "content-disposition": `attachment; filename="${a.filename.replace(/"/g, "")}"`, "x-content-type-options": "nosniff", "cache-control": "private, no-store" } });
});
