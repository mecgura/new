import { ApiError, handle, ok } from "@/lib/api";
import { enforceRateLimit } from "@/lib/rate-limit";
import { orgRoute } from "@/lib/route-helpers";
import { idSchema } from "@/lib/validations";
import { sendMessage } from "@/services/inbox/messaging";
import { ALLOWED_MEDIA as ALLOWED, kindFor } from "@/services/inbox/media";

type Ctx = { params: Promise<{ orgId: string; cid: string }> };

/** Multipart upload → forwarded to Meta's media store → sent. MECGURA keeps metadata only. */
export const POST = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "inbox:reply");
  enforceRateLimit(`media:${access.user.id}`, 20, 60_000);
  if (Number(req.headers.get("content-length") ?? 0) > 17 * 1024 * 1024) throw new ApiError("VALIDATION_ERROR", "Files can be up to 16 MB.");
  const form = await req.formData().catch(() => {
    throw new ApiError("VALIDATION_ERROR", "Send the file as multipart/form-data.");
  });
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) throw new ApiError("VALIDATION_ERROR", "Choose a file to send.", { details: { file: ["Required"] } });
  const kind = kindFor(file.type);
  if (!kind) throw new ApiError("VALIDATION_ERROR", "WhatsApp doesn't support this file type.", { details: { file: [`Unsupported type ${file.type || "unknown"}`] } });
  if (file.size > ALLOWED[kind].max) throw new ApiError("VALIDATION_ERROR", `This ${kind} is too large (max ${ALLOWED[kind].max / 1024 / 1024} MB).`);
  const caption = String(form.get("caption") ?? "").slice(0, 1024);
  const replyRaw = form.get("replyToId");
  const replyToId = replyRaw ? idSchema.parse(String(replyRaw)) : undefined;
  const filename = file.name.replace(/[^\w.\- ()]/g, "_").slice(0, 200) || kind;
  const message = await sendMessage(
    access,
    ids.cid,
    { type: kind, link: "https://upload.local", caption: kind === "audio" ? undefined : caption || undefined, filename, replyToId },
    { file, filename, mimeType: file.type, size: file.size }
  );
  return ok({ message }, { status: 201 });
});
