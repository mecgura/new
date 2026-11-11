import "server-only";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

/**
 * Rate limiting behind a small interface so the store can be swapped (Redis/Upstash)
 * without touching callers. Production uses the database store (shared by every serverless
 * instance). The in-memory store (development, tests, or RATE_LIMIT_STORE=memory, and the
 * fallback if the database is unreachable) is PER SERVER INSTANCE.
 */
export interface RateLimitStore {
  hit(key: string, windowMs: number): Promise<{ count: number; resetAt: number }>;
}

class MemoryStore implements RateLimitStore {
  private buckets = new Map<string, { count: number; resetAt: number }>();

  async hit(key: string, windowMs: number) {
    const now = Date.now();
    if (this.buckets.size > 10_000) {
      for (const [k, b] of this.buckets) if (b.resetAt <= now) this.buckets.delete(k);
    }
    const existing = this.buckets.get(key);
    if (!existing || existing.resetAt <= now) {
      const fresh = { count: 1, resetAt: now + windowMs };
      this.buckets.set(key, fresh);
      return fresh;
    }
    existing.count += 1;
    return existing;
  }
}

/** Counters in the `RateLimitBucket` table: window reset and increment are single atomic statements, so concurrent instances agree. */
export class DbStore implements RateLimitStore {
  private fallback = new MemoryStore();
  async hit(key: string, windowMs: number) {
    const now = new Date(); const resetAt = new Date(now.getTime() + windowMs);
    try {
      const renewed = await db.rateLimitBucket.updateMany({ where: { key, resetAt: { lte: now } }, data: { count: 1, resetAt } });
      if (renewed.count > 0) return { count: 1, resetAt: resetAt.getTime() };
      const row = await db.rateLimitBucket.upsert({ where: { key }, create: { key, count: 1, resetAt }, update: { count: { increment: 1 } } });
      return { count: row.count, resetAt: row.resetAt.getTime() };
    } catch (e) {
      logger.warn("rate limit store unavailable; using per-instance counters", { error: e instanceof Error ? e.message : String(e) });
      return this.fallback.hit(key, windowMs);
    }
  }
}

/** Deletes expired counters (called from the scheduled job). */
export async function pruneRateLimits(now = new Date()) { return (await db.rateLimitBucket.deleteMany({ where: { resetAt: { lt: now } } })).count; }

let store: RateLimitStore = process.env.NODE_ENV === "production" && process.env.RATE_LIMIT_STORE !== "memory" ? new DbStore() : new MemoryStore();
export function setRateLimitStore(next: RateLimitStore) {
  store = next;
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

export async function rateLimit(key: string, opts: { limit: number; windowMs: number }): Promise<RateLimitResult> {
  const { count, resetAt } = await store.hit(key, opts.windowMs);
  return { allowed: count <= opts.limit, retryAfterSeconds: Math.max(1, Math.ceil((resetAt - Date.now()) / 1000)) };
}
