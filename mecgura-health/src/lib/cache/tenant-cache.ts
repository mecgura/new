/**
 * Small in-process, TENANT-AWARE read cache for configuration-like data that is expensive to rebuild and safe to share (public website content,
 * host → clinic resolution). It never holds patient data.
 *  - Every entry belongs to exactly one tenant, so `invalidateTenant(id)` drops everything for that clinic at once.
 *  - Writers don't need to remember: recordAudit() calls invalidateTenant() for website / branding / domain / clinic / feature / subscription actions.
 *  - TTL bounds staleness even if an invalidation is missed (and across several app instances, where each keeps its own copy).
 */
interface Entry<T> { exp: number; tenantId: string; value: T }
export class TenantCache<T> {
  private map = new Map<string, Entry<T>>();
  private enabled: boolean;
  /** Under the test runner caching is OFF by default (tests change rows directly, bypassing audit invalidation); the cache's own tests pass `enabled: true`. */
  constructor(private ttlMs: number, private max = 2000, enabled?: boolean) { this.enabled = enabled ?? !(process.env.NODE_ENV === "test" && process.env.TENANT_CACHE_TEST !== "on"); }
  get(key: string): T | undefined { if (!this.enabled) return undefined; const e = this.map.get(key); if (!e) return undefined; if (e.exp <= Date.now()) { this.map.delete(key); return undefined; } return e.value; }
  set(key: string, tenantId: string, value: T) { if (!this.enabled) return; if (this.map.size >= this.max) this.map.delete(this.map.keys().next().value as string); this.map.set(key, { exp: Date.now() + this.ttlMs, tenantId, value }); }
  invalidateTenant(tenantId: string) { for (const [k, e] of this.map) if (e.tenantId === tenantId) this.map.delete(k); }
  clear() { this.map.clear(); }
  get size() { return this.map.size; }
}
const registry: TenantCache<unknown>[] = [];
export function tenantCache<T>(ttlMs: number, max?: number): TenantCache<T> { const c = new TenantCache<T>(ttlMs, max); registry.push(c as TenantCache<unknown>); return c; }
export const invalidateTenantCaches = (tenantId: string) => { for (const c of registry) c.invalidateTenant(tenantId); };
export const TENANT_CACHE_ACTION = /^(website|service|doctor_profile|testimonial|faq|article|branding|domain|clinic|tenant|platform\.(feature|branding|domain|clinic|settings)|subscription|user\.(role|status))/;
