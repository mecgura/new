import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TENANT_CACHE_ACTION, TenantCache } from "./tenant-cache";

describe("tenant-aware cache", () => {
  beforeEach(() => vi.useFakeTimers()); afterEach(() => vi.useRealTimers());
  it("serves until the TTL ends, then reloads", () => { const c = new TenantCache<string>(1000, 10, true); c.set("k", "t1", "v"); expect(c.get("k")).toBe("v"); vi.advanceTimersByTime(1001); expect(c.get("k")).toBeUndefined(); });
  it("invalidating one clinic never touches another", () => { const c = new TenantCache<string>(60_000, 10, true); c.set("a", "t1", "A"); c.set("b", "t2", "B"); c.set("a2", "t1", "A2"); c.invalidateTenant("t1"); expect(c.get("a")).toBeUndefined(); expect(c.get("a2")).toBeUndefined(); expect(c.get("b")).toBe("B"); });
  it("is bounded", () => { const c = new TenantCache<number>(60_000, 3, true); for (let i = 0; i < 10; i++) c.set(String(i), "t", i); expect(c.size).toBeLessThanOrEqual(3); });
  it("does nothing when disabled", () => { const c = new TenantCache<string>(1000, 10, false); c.set("k", "t", "v"); expect(c.get("k")).toBeUndefined(); });
  it("configuration-changing audit actions invalidate; clinical ones do not", () => { for (const a of ["website.published", "branding.updated", "domain.verified", "clinic.status_changed", "platform.feature_changed", "subscription.status_changed", "user.role_changed"]) expect(TENANT_CACHE_ACTION.test(a), a).toBe(true); for (const a of ["patient.viewed", "billing.payment_recorded", "appointment.created"]) expect(TENANT_CACHE_ACTION.test(a), a).toBe(false); });
});
