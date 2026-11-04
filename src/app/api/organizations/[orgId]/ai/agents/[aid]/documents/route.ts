import { z } from "zod";
import { ApiError, handle, ok, readJson } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { addDocument, MAX_DOCUMENT_BYTES, MAX_UPLOAD_BYTES } from "@/services/ai/agents";
import { ExtractError, extractFile } from "@/lib/doc-extract";

type Ctx = { params: Promise<{ orgId: string; aid: string }> };

const pasted = z.object({ name: z.string().trim().min(1, "Name the document").max(120), content: z.string().min(1, "Paste some text").max(MAX_DOCUMENT_BYTES) });

/**
 * Adds knowledge: multipart "file" (PDF, .docx, .txt, .md, .csv, .html) or JSON
 * { name, content } for pasted text. Only the extracted text is kept.
 */
export const POST = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "ai:manage");
  if ((req.headers.get("content-type") ?? "").includes("application/json")) {
    const input = await readJson(req, pasted);
    return ok({ document: await addDocument(access, ids.aid, { ...input, mimeType: "text/plain" }) }, { status: 201 });
  }
  if (Number(req.headers.get("content-length") ?? 0) > MAX_UPLOAD_BYTES + 10_000) throw new ApiError("VALIDATION_ERROR", `Files can be up to ${MAX_UPLOAD_BYTES / 1_000_000} MB.`);
  const form = await req.formData().catch(() => {
    throw new ApiError("VALIDATION_ERROR", "Upload the document as multipart/form-data.");
  });
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) throw new ApiError("VALIDATION_ERROR", "Choose a file.", { details: { file: ["Required"] } });
  if (file.size > MAX_UPLOAD_BYTES) throw new ApiError("VALIDATION_ERROR", `Files can be up to ${MAX_UPLOAD_BYTES / 1_000_000} MB.`, { details: { file: ["Too large"] } });
  let extracted;
  try {
    extracted = await extractFile(file.name, Buffer.from(await file.arrayBuffer()));
  } catch (e) {
    if (e instanceof ExtractError) throw new ApiError("VALIDATION_ERROR", e.message, { details: { file: [e.message] } });
    throw e;
  }
  if (Buffer.byteLength(extracted.text, "utf8") > MAX_DOCUMENT_BYTES) throw new ApiError("VALIDATION_ERROR", `This file has more than ${MAX_DOCUMENT_BYTES / 1000} KB of text. Split it into smaller files.`, { details: { file: ["Too much text"] } });
  return ok({ document: await addDocument(access, ids.aid, { name: file.name, mimeType: extracted.mimeType, content: extracted.text }) }, { status: 201 });
});
