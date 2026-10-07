import { z } from "zod";
import { ApiError, handle, ok, readJson } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { addDocument, MAX_DOCUMENT_BYTES } from "@/services/ai/agents";

type Ctx = { params: Promise<{ orgId: string; aid: string }> };

const pasted = z.object({ name: z.string().trim().min(1, "Name the document").max(120), content: z.string().min(1, "Paste some text").max(MAX_DOCUMENT_BYTES) });

/**
 * Adds knowledge as plain text: multipart "file" (.txt, .md, .csv) or JSON
 * { name, content } for pasted text. Only the text is kept.
 */
export const POST = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "ai:manage");
  if ((req.headers.get("content-type") ?? "").includes("application/json")) {
    const input = await readJson(req, pasted);
    return ok({ document: await addDocument(access, ids.aid, { ...input, mimeType: "text/plain" }) }, { status: 201 });
  }
  if (Number(req.headers.get("content-length") ?? 0) > MAX_DOCUMENT_BYTES + 10_000) throw new ApiError("VALIDATION_ERROR", `Documents can be up to ${MAX_DOCUMENT_BYTES / 1000} KB.`);
  const form = await req.formData().catch(() => {
    throw new ApiError("VALIDATION_ERROR", "Upload the document as multipart/form-data.");
  });
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) throw new ApiError("VALIDATION_ERROR", "Choose a file.", { details: { file: ["Required"] } });
  const ext = file.name.toLowerCase().split(".").pop() ?? "";
  const mime = ext === "md" ? "text/markdown" : ext === "csv" ? "text/csv" : ext === "txt" ? "text/plain" : file.type;
  return ok({ document: await addDocument(access, ids.aid, { name: file.name, mimeType: mime, content: await file.text() }) }, { status: 201 });
});
