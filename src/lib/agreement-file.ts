/** Sends a stored business document back to the browser (shown inline, never sniffed or cached publicly). */
export function documentResponse(d: { data: Uint8Array; mimeType: string; fileName: string }, download = false) {
  return new Response(new Uint8Array(d.data), {
    headers: {
      "Content-Type": d.mimeType,
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${d.fileName.replace(/"/g, "")}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox",
    },
  });
}

/** Reads `kind` + `file` from a multipart upload. */
export async function readUpload(req: Request): Promise<{ kind: string; file: File }> {
  const { ApiError } = await import("@/lib/api");
  const { MAX_DOC_BYTES } = await import("@/services/agreements/agreements");
  if (Number(req.headers.get("content-length") ?? 0) > MAX_DOC_BYTES + 50_000) throw new ApiError("VALIDATION_ERROR", "Files can be up to 4 MB.");
  const form = await req.formData().catch(() => {
    throw new ApiError("VALIDATION_ERROR", "Upload the file as multipart/form-data.");
  });
  const file = form.get("file");
  if (!(file instanceof File)) throw new ApiError("VALIDATION_ERROR", "Choose a file.", { details: { file: ["Required"] } });
  return { kind: String(form.get("kind") ?? ""), file };
}
