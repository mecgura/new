/**
 * Rate limiting behind a small interface so the store can be swapped (Redis/Upstash)
 * without touching callers. The default in-memory store is PER SERVER INSTANCE —
 * enough to slow brute force on one node, NOT a distributed guarantee.
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

let store: RateLimitStore = new MemoryStore();
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
