import { ApiError } from "@/lib/api";

/**
 * Fixed-window in-memory rate limiter.
 *
 * NOTE: memory is per server instance. On serverless/multi-instance hosting
 * this is best-effort; swap `store` for Redis/Upstash (same interface) before
 * relying on it as a hard limit. Callers only use `rateLimit()`.
 */
type Bucket = { count: number; resetAt: number };
const store = new Map<string, Bucket>();

export type RateLimitResult = { allowed: boolean; retryAfterSec: number; limit: number; remaining: number; resetAtSec: number };

export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  let bucket = store.get(key);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + windowMs };
    store.set(key, bucket);
    if (store.size > 10_000) sweep(now);
  }
  bucket.count += 1;
  const allowed = bucket.count <= limit;
  return {
    allowed,
    retryAfterSec: allowed ? 0 : Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
    limit,
    remaining: Math.max(0, limit - bucket.count),
    resetAtSec: Math.ceil(bucket.resetAt / 1000),
  };
}

/** True when the key has already used up `limit` hits in the current window (does not count a hit). */
export function rateLimited(key: string, limit: number): boolean {
  const b = store.get(key);
  return Boolean(b && b.resetAt > Date.now() && b.count >= limit);
}

export function enforceRateLimit(key: string, limit: number, windowMs: number) {
  const r = rateLimit(key, limit, windowMs);
  if (!r.allowed) {
    throw new ApiError("RATE_LIMITED", undefined, { headers: { "Retry-After": String(r.retryAfterSec) } });
  }
}

/** For the older routes that build their own NextResponse: a ready 429 when the key is over its limit, else null. */
export function throttle(key: string, limit: number, windowMs: number): Response | null {
  const r = rateLimit(key, limit, windowMs);
  if (r.allowed) return null;
  return Response.json(
    { error: "Too many requests. Please wait a moment and try again.", code: "RATE_LIMITED" },
    { status: 429, headers: { "Retry-After": String(r.retryAfterSec) } }
  );
}

export function resetRateLimits() {
  store.clear();
}

function sweep(now: number) {
  for (const [k, b] of store) if (b.resetAt <= now) store.delete(k);
}
