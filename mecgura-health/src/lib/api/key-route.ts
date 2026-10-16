import "server-only";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { AppError, toFailure } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { authenticateApiKey, type ApiPrincipal, type ApiScope } from "@/lib/services/sec-apikeys";

/** Route wrapper for the integration API (/api/v1/*): API-key auth + scope, read-only methods, standard envelope, safe errors. No cookies are ever honoured here. */
export function keyRoute(scope: ApiScope | null, handler: (a: { req: Request; principal: ApiPrincipal }) => Promise<unknown>) {
  return async (req: Request): Promise<Response> => {
    const requestId = randomUUID();
    try {
      const principal = await authenticateApiKey(req, scope);
      const data = await handler({ req, principal });
      return NextResponse.json({ ok: true, data }, { headers: { "Cache-Control": "no-store", "X-Request-Id": requestId } });
    } catch (err) {
      const { failure, status, unexpected } = toFailure(err, requestId);
      if (unexpected) logger.error("api v1 error", { requestId, error: err });
      return NextResponse.json(failure, { status, headers: { "Cache-Control": "no-store", "X-Request-Id": requestId, ...(status === 401 ? { "WWW-Authenticate": "Bearer" } : {}) } });
    }
  };
}
export const needTenant = (p: ApiPrincipal) => { if (!p.tenantId) throw new AppError("FORBIDDEN", { message: "This key is not tied to a clinic." }); return p.tenantId; };
export function pageOf(req: Request, max = 50) { const q = new URL(req.url).searchParams; const page = Math.max(1, Math.floor(Number(q.get("page")) || 1)); const size = Math.min(max, Math.max(1, Math.floor(Number(q.get("pageSize")) || 25))); return { page, size, skip: (page - 1) * size, q }; }
