import { describe, expect, it } from "vitest";
import { safeRedirectPath } from "@/lib/auth/redirect";
import { isSameOrigin } from "./origin";
import { rateLimit } from "./rate-limit";
import { validateUpload } from "./uploads";
import { buildCsp } from "./csp";
import { brandToCss, resolveBrandColors, DEFAULT_BRAND } from "@/theme/tokens";

describe("security helpers", () => {
  it("blocks open redirects", () => {
    expect(safeRedirectPath("/patients")).toBe("/patients");
    for (const bad of ["https://evil.com", "//evil.com", "javascript:alert(1)", "/\\evil.com", undefined]) expect(safeRedirectPath(bad)).toBe("/dashboard");
  });
  it("same-origin check compares Origin to Host", () => {
    const mk = (origin?: string) => new Request("http://app.test/api/x", { method: "POST", headers: { host: "app.test", ...(origin ? { origin } : {}) } });
    expect(isSameOrigin(mk("http://app.test"))).toBe(true);
    expect(isSameOrigin(mk("http://evil.test"))).toBe(false);
    expect(isSameOrigin(mk())).toBe(false);
  });
  it("rate limiter blocks after the limit", async () => {
    const key = `t:${Math.random()}`;
    const results = [];
    for (let i = 0; i < 4; i++) results.push((await rateLimit(key, { limit: 3, windowMs: 1000 })).allowed);
    expect(results).toEqual([true, true, true, false]);
  });
  it("upload policy checks size, type and extension", () => {
    expect(validateUpload("medicalDocument", { name: "r.pdf", type: "application/pdf", size: 1000 })).toBeNull();
    expect(validateUpload("medicalDocument", { name: "r.exe", type: "application/pdf", size: 1000 })).not.toBeNull();
    expect(validateUpload("medicalDocument", { name: "r.pdf", type: "application/x-msdownload", size: 1000 })).not.toBeNull();
    expect(validateUpload("brandingImage", { name: "l.png", type: "image/png", size: 9_000_000 })).not.toBeNull();
  });
  it("CSP uses a nonce and forbids framing", () => {
    const csp = buildCsp("abc", { isDev: false });
    expect(csp).toContain("'nonce-abc'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain("unsafe-eval");
  });
  it("theme only accepts valid hex colours (no CSS injection)", () => {
    const b = resolveBrandColors({ primaryColor: "red;} body{display:none", secondaryColor: "#ABCDEF" });
    expect(b.primary).toBe(DEFAULT_BRAND.primary);
    expect(b.secondary).toBe("#abcdef");
    expect(brandToCss(b)).toBe(`:root{--brand-primary:${DEFAULT_BRAND.primary};--brand-secondary:#abcdef;--brand-accent:${DEFAULT_BRAND.accent}}`);
  });
});
