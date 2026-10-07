import { NextResponse } from "next/server";
import { ZodError, type ZodType } from "zod";

/**
 * Consistent API error shape for all new endpoints:
 *   { error: string, code: ApiErrorCode, details?: Record<string, string[]> }
 * `error` stays a human-readable string so it is backwards compatible with the
 * existing admin UI, which reads `data.error` directly.
 */
export type ApiErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "SERVICE_UNAVAILABLE"
  | "SERVER_ERROR";

const STATUS: Record<ApiErrorCode, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  SERVICE_UNAVAILABLE: 503,
  SERVER_ERROR: 500,
};

const DEFAULT_MESSAGE: Record<ApiErrorCode, string> = {
  VALIDATION_ERROR: "Validation error",
  UNAUTHENTICATED: "Authentication required",
  FORBIDDEN: "Permission denied",
  NOT_FOUND: "Not found",
  CONFLICT: "Conflict",
  RATE_LIMITED: "Too many requests. Please try again later.",
  SERVICE_UNAVAILABLE: "Service unavailable",
  SERVER_ERROR: "Something went wrong. Please try again.",
};

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly details?: Record<string, string[] | undefined>;
  readonly headers?: Record<string, string>;

  constructor(
    code: ApiErrorCode,
    message?: string,
    opts: { details?: Record<string, string[] | undefined>; headers?: Record<string, string> } = {}
  ) {
    super(message ?? DEFAULT_MESSAGE[code]);
    this.code = code;
    this.status = STATUS[code];
    this.details = opts.details;
    this.headers = opts.headers;
  }
}

export function errorResponse(err: ApiError) {
  return NextResponse.json(
    { error: err.message, code: err.code, ...(err.details ? { details: err.details } : {}) },
    { status: err.status, headers: err.headers }
  );
}

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

/** Maps any thrown value to the standard error response (internals are never leaked on 500). */
export function toErrorResponse(e: unknown): Response {
  if (e instanceof ApiError) return errorResponse(e);
  if (e instanceof ZodError) {
    return errorResponse(new ApiError("VALIDATION_ERROR", "Invalid input.", { details: flattenZod(e) }));
  }
  console.error("[api] unhandled error:", e);
  return errorResponse(new ApiError("SERVER_ERROR"));
}

/** Wraps a route handler: maps ApiError/ZodError to the standard shape and hides internals on 500. */
export function handle<Ctx>(fn: (req: Request, ctx: Ctx) => Promise<Response>) {
  return async (req: Request, ctx?: Ctx): Promise<Response> => {
    try {
      assertSameOrigin(req);
      return await fn(req, ctx as Ctx);
    } catch (e) {
      return toErrorResponse(e);
    }
  };
}

function flattenZod(e: ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of e.issues) {
    const key = issue.path.join(".") || "_";
    (out[key] ??= []).push(issue.message);
  }
  return out;
}

/** Parse + validate a JSON body. Never trust browser input. */
export async function readJson<T>(req: Request, schema: ZodType<T>): Promise<T> {
  const body: unknown = await req.json().catch(() => {
    throw new ApiError("VALIDATION_ERROR", "Request body must be valid JSON.");
  });
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError("VALIDATION_ERROR", "Invalid input.", { details: flattenZod(parsed.error) });
  }
  return parsed.data;
}

export function readQuery<T>(req: Request, schema: ZodType<T>): T {
  const params = Object.fromEntries(new URL(req.url).searchParams.entries());
  const parsed = schema.safeParse(params);
  if (!parsed.success) {
    throw new ApiError("VALIDATION_ERROR", "Invalid query parameters.", { details: flattenZod(parsed.error) });
  }
  return parsed.data;
}

/**
 * CSRF defence for cookie-authenticated JSON APIs: state-changing requests that
 * carry an Origin header must come from this host. (Auth.js protects its own
 * endpoints with a CSRF token; session cookies are SameSite=Lax.)
 */
export function assertSameOrigin(req: Request) {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return;
  const origin = req.headers.get("origin");
  if (!origin) return;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new ApiError("FORBIDDEN", "Cross-origin request blocked.");
  }
  if (!host || originHost !== host) throw new ApiError("FORBIDDEN", "Cross-origin request blocked.");
}

export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  return (fwd?.split(",")[0] ?? req.headers.get("x-real-ip") ?? "").trim().slice(0, 64);
}
