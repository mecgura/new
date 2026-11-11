import { describe, expect, it } from "vitest";
import { isSecureRequest } from "./secure-request";

// Regression: behind Vercel the session cookie is `__Secure-authjs.session-token`; the proxy must look for that name or every signed-in request loops /login <-> /dashboard.
describe("isSecureRequest", () => {
  it("is true for https URLs and for x-forwarded-proto https (first value wins)", () => {
    expect(isSecureRequest("https://health.mecgura.tech/login", null)).toBe(true);
    expect(isSecureRequest("http://internal/login", "https")).toBe(true);
    expect(isSecureRequest("http://internal/login", "https, http")).toBe(true);
  });
  it("is false for plain http", () => {
    expect(isSecureRequest("http://localhost:3000/login", null)).toBe(false);
    expect(isSecureRequest("http://localhost:3000/login", "http")).toBe(false);
  });
});
