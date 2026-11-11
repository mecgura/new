import { requireTenantApiContext } from "@/lib/auth/context";
import { AppError, toFailure } from "@/lib/errors";
import { MAX_FILE_BYTES } from "@/lib/import/table";
import { isSameOrigin } from "@/lib/security/origin";
import { runImport } from "@/lib/services/data-import";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
/** multipart: `file` + `mode` (preview | commit). Preview writes nothing; commit creates the valid rows through the normal services. */
export async function POST(req: Request, routeCtx: { params: Promise<{ kind: string }> }) {
  try {
    if (!isSameOrigin(req)) throw new AppError("FORBIDDEN", { message: "Request origin not allowed." });
    const len = Number(req.headers.get("content-length") ?? 0);
    if (len > MAX_FILE_BYTES + 64 * 1024) throw new AppError("VALIDATION_ERROR", { message: `The file is larger than ${MAX_FILE_BYTES / 1024 / 1024} MB.` });
    const ctx = await requireTenantApiContext();
    const { kind } = await routeCtx.params;
    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) throw new AppError("VALIDATION_ERROR", { message: "Choose a file to upload." });
    const mode = form?.get("mode") === "commit" ? "commit" : "preview";
    const report = await runImport(ctx, kind, { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) }, mode);
    return Response.json({ ok: true, data: report }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    const { failure, status } = toFailure(err instanceof AppError ? err : err, "import");
    return Response.json(failure, { status, headers: { "Cache-Control": "no-store" } });
  }
}
