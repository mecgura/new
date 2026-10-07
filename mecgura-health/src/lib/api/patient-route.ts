import "server-only";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { AppError, toFailure, type ApiResult } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { requirePatientApiContext, type PatientContext } from "@/lib/portal/ctx";
import { SAFE_METHODS, isSameOrigin } from "@/lib/security/origin";
import { getEnv } from "@/lib/env";

/**
 * The way to write a patient-portal API route: CSRF same-origin check, a patient session (role PATIENT -> account -> patient -> clinic),
 * the standard { ok, data } format and safe error handling. The handler receives a PatientContext; routes never take a patient id from the client.
 */
export function patientRoute(handler: (args: { req: Request; ctx: PatientContext; params: Record<string, string> }) => Promise<unknown>) {
  return async (req: Request, routeCtx?: { params?: Promise<Record<string, string>> }): Promise<Response> => {
    const requestId = randomUUID();
    try {
      if (!SAFE_METHODS.has(req.method) && !isSameOrigin(req) && getEnv().isProd) throw new AppError("FORBIDDEN", { message: "Cross-site request blocked." });
      const ctx = await requirePatientApiContext();
      const data = await handler({ req, ctx, params: (await routeCtx?.params) ?? {} });
      const body: ApiResult<unknown> = { ok: true, data };
      return NextResponse.json(body, { headers: { "Cache-Control": "no-store", "X-Request-Id": requestId } });
    } catch (err) {
      const { failure, status, unexpected } = toFailure(err, requestId);
      if (unexpected) logger.error("portal api error", { requestId, path: new URL(req.url).pathname, error: err });
      return NextResponse.json(failure, { status, headers: { "Cache-Control": "no-store", "X-Request-Id": requestId } });
    }
  };
}
