import "server-only";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { AppError, toFailure, type ApiResult } from "@/lib/errors";
import { logger } from "@/lib/logger";
import type { Permission } from "@/lib/permissions";
import { requireApiContext, requireTenantApiContext, type RequestContext, type TenantRequestContext } from "@/lib/auth/context";
import { SAFE_METHODS, isSameOrigin } from "@/lib/security/origin";
import { getEnv } from "@/lib/env";

type Options = { permission?: Permission; auth?: boolean; tenant?: boolean };

/**
 * THE way to write an API route. It gives every endpoint, uniformly:
 *   - CSRF same-origin check on state-changing methods
 *   - authentication (unless `auth: false`) + server-side permission check
 *   - tenant context (`tenant: true` => ctx.tenantId guaranteed, use with tenantDb(ctx))
 *   - the standard { ok, data } / { ok:false, error } response format
 *   - safe error handling: unexpected errors are logged with a requestId, never leaked
 */
export function apiRoute<C extends RequestContext | TenantRequestContext | null = RequestContext>(
  options: Options,
  handler: (args: { req: Request; ctx: C; params: Record<string, string> }) => Promise<unknown>,
) {
  return async (req: Request, routeCtx?: { params?: Promise<Record<string, string>> }): Promise<Response> => {
    const requestId = randomUUID();
    try {
      if (!SAFE_METHODS.has(req.method) && !isSameOrigin(req) && getEnv().isProd) {
        throw new AppError("FORBIDDEN", { message: "Cross-site request blocked." });
      }
      let ctx: RequestContext | TenantRequestContext | null = null;
      if (options.auth !== false) {
        ctx = options.tenant ? await requireTenantApiContext(options.permission) : await requireApiContext(options.permission);
      }
      const data = await handler({ req, ctx: ctx as C, params: (await routeCtx?.params) ?? {} });
      const body: ApiResult<unknown> = { ok: true, data };
      return NextResponse.json(body, { headers: { "Cache-Control": "no-store", "X-Request-Id": requestId } });
    } catch (err) {
      const { failure, status, unexpected } = toFailure(err, requestId);
      if (unexpected) logger.error("api error", { requestId, path: new URL(req.url).pathname, error: err });
      return NextResponse.json(failure, {
        status,
        headers: { "Cache-Control": "no-store", "X-Request-Id": requestId, ...(failure.error.code === "RATE_LIMITED" ? { "Retry-After": "60" } : {}) },
      });
    }
  };
}

/** Reads a JSON request body (max 64 KB). Bad/oversized bodies become a VALIDATION_ERROR, not a crash. */
export async function readJson(req: Request): Promise<unknown> {
  const text = await req.text();
  if (text.length > 64 * 1024) throw new AppError("VALIDATION_ERROR", { message: "Request is too large." });
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new AppError("VALIDATION_ERROR", { message: "Request body must be valid JSON." });
  }
}
