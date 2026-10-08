import { ZodError } from "zod";

/**
 * One error model for the whole product. Server code throws AppError (or a ZodError);
 * API routes and server actions convert it to the standard `ApiFailure` shape.
 * Unknown errors are logged server-side and shown to users as a generic message.
 */
export const ERROR_CODES = {
  VALIDATION_ERROR: { status: 400, message: "Please check the highlighted fields and try again." },
  UNAUTHENTICATED: { status: 401, message: "Please sign in to continue." },
  FORBIDDEN: { status: 403, message: "You don't have permission to do this." },
  NOT_FOUND: { status: 404, message: "We couldn't find what you were looking for." },
  LIMIT_REACHED: { status: 403, message: "Your plan limit has been reached. Upgrade your plan to add more." },
  CONFLICT: { status: 409, message: "This conflicts with existing data." },
  RATE_LIMITED: { status: 429, message: "Too many attempts. Please wait a moment and try again." },
  NETWORK_ERROR: { status: 0, message: "Can't reach the server. Check your internet connection and try again." },
  INTERNAL: { status: 500, message: "Something went wrong on our side. Please try again." },
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;
export type FieldErrors = Record<string, string>;

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly fieldErrors?: FieldErrors;
  readonly retryAfterSeconds?: number;

  constructor(code: ErrorCode, opts: { message?: string; fieldErrors?: FieldErrors; retryAfterSeconds?: number } = {}) {
    super(opts.message ?? ERROR_CODES[code].message);
    this.name = "AppError";
    this.code = code;
    this.fieldErrors = opts.fieldErrors;
    this.retryAfterSeconds = opts.retryAfterSeconds;
  }

  get status() {
    return ERROR_CODES[this.code].status;
  }
}

export interface ApiSuccess<T> {
  ok: true;
  data: T;
}
export interface ApiFailure {
  ok: false;
  error: { code: ErrorCode; message: string; fieldErrors?: FieldErrors; requestId?: string };
}
export type ApiResult<T> = ApiSuccess<T> | ApiFailure;

/** First message per field, e.g. { email: "Enter a valid email address." } */
export function zodFieldErrors(error: ZodError): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_form";
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}

/** Normalises anything thrown into a safe, user-presentable failure. Never leaks internals. */
export function toFailure(err: unknown, requestId?: string): { failure: ApiFailure; status: number; unexpected: boolean } {
  if (err instanceof AppError) {
    return {
      failure: { ok: false, error: { code: err.code, message: err.message, fieldErrors: err.fieldErrors, requestId } },
      status: err.status,
      unexpected: false,
    };
  }
  if (err instanceof ZodError) {
    const e = new AppError("VALIDATION_ERROR", { fieldErrors: zodFieldErrors(err) });
    return toFailure(e, requestId);
  }
  return {
    failure: { ok: false, error: { code: "INTERNAL", message: ERROR_CODES.INTERNAL.message, requestId } },
    status: 500,
    unexpected: true,
  };
}
