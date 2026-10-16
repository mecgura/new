import { requireTenantApiContext } from "@/lib/auth/context";
import { AppError, toFailure } from "@/lib/errors";
import { isSameOrigin } from "@/lib/security/origin";
import { exportList } from "@/lib/services/data-export";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
/** POST so it is CSRF-checked and a password can travel in the body. The file is built per request, returned once and never stored or linked. */
export async function POST(req: Request, routeCtx: { params: Promise<{ kind: string }> }) {
  try {
    if (!isSameOrigin(req)) throw new AppError("FORBIDDEN", { message: "Request origin not allowed." });
    const ctx = await requireTenantApiContext();
    const { kind } = await routeCtx.params;
    const body = (await req.json().catch(() => ({}))) as { format?: string; password?: string; code?: string };
    const out = await exportList(ctx, kind, String(body.format ?? "xlsx"), { password: typeof body.password === "string" ? body.password : undefined, code: typeof body.code === "string" ? body.code : undefined });
    return new Response(typeof out.body === "string" ? out.body : Buffer.from(out.body), { headers: { "Content-Type": out.contentType, "Content-Disposition": `attachment; filename="${out.filename}"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "X-Row-Count": String(out.rows) } });
  } catch (err) {
    const { failure, status } = toFailure(err instanceof AppError ? err : err, "export");
    return Response.json(failure, { status, headers: { "Cache-Control": "no-store" } });
  }
}
