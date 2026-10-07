import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ApiError, assertSameOrigin, handle, readJson } from "@/lib/api";
import { redact } from "@/lib/audit";
import { rateLimit, resetRateLimits } from "@/lib/rate-limit";
import { passwordSchema, emailSchema, paginationSchema, idSchema } from "@/lib/validations";

const r = (method: string, headers: Record<string, string> = {}, body?: string) =>
  new Request("http://localhost:3000/api/x", { method, headers: { host: "localhost:3000", ...headers }, body });

describe("API error format", () => {
  it.each([
    ["VALIDATION_ERROR", 400],
    ["UNAUTHENTICATED", 401],
    ["FORBIDDEN", 403],
    ["NOT_FOUND", 404],
    ["CONFLICT", 409],
    ["RATE_LIMITED", 429],
    ["SERVER_ERROR", 500],
  ] as const)("%s → %i with { error, code }", async (code, status) => {
    const res = await handle(async () => {
      throw new ApiError(code);
    })(r("GET"), {});
    expect(res.status).toBe(status);
    const body = await res.json();
    expect(body.code).toBe(code);
    expect(typeof body.error).toBe("string");
  });

  it("hides internal errors (no stack trace / message leak)", async () => {
    const res = await handle(async () => {
      throw new Error("db password=hunter2 at /srv/app.ts:12");
    })(r("GET"), {});
    const text = await res.text();
    expect(res.status).toBe(500);
    expect(text).not.toContain("hunter2");
    expect(text).not.toContain("app.ts");
  });

  it("validates JSON bodies", async () => {
    await expect(readJson(r("POST", { "content-type": "application/json" }, "not json"), z.object({}))).rejects.toMatchObject({ status: 400 });
    await expect(readJson(r("POST", {}, JSON.stringify({ a: 1 })), z.object({ a: z.string() }))).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("blocks cross-origin state-changing requests", () => {
    expect(() => assertSameOrigin(r("POST", { origin: "https://evil.example" }))).toThrow(ApiError);
    expect(() => assertSameOrigin(r("POST", { origin: "http://localhost:3000" }))).not.toThrow();
    expect(() => assertSameOrigin(r("GET", { origin: "https://evil.example" }))).not.toThrow();
  });
});

describe("validation", () => {
  it("passwords need 8+ chars, a letter and a number", () => {
    expect(passwordSchema.safeParse("short1").success).toBe(false);
    expect(passwordSchema.safeParse("allletters").success).toBe(false);
    expect(passwordSchema.safeParse("12345678").success).toBe(false);
    expect(passwordSchema.safeParse("Passw0rd!").success).toBe(true);
  });
  it("emails are normalised", () => {
    expect(emailSchema.parse("  Foo@Example.COM ")).toBe("foo@example.com");
    expect(emailSchema.safeParse("nope").success).toBe(false);
  });
  it("pagination is bounded", () => {
    expect(paginationSchema.parse({})).toEqual({ page: 1, pageSize: 20 });
    expect(paginationSchema.safeParse({ pageSize: "1000" }).success).toBe(false);
    expect(paginationSchema.safeParse({ page: "-1" }).success).toBe(false);
  });
  it("ids reject injection-shaped input", () => {
    expect(idSchema.safeParse("abc123_-").success).toBe(true);
    expect(idSchema.safeParse("1 OR 1=1").success).toBe(false);
    expect(idSchema.safeParse("../etc").success).toBe(false);
  });
});

describe("audit redaction", () => {
  it("never keeps secrets", () => {
    const out = redact({ email: "a@b.c", password: "x", newPassword: "y", nested: { accessToken: "t", apiKey: "k", ok: 1 } }) as Record<string, unknown>;
    expect(out.email).toBe("a@b.c");
    expect(out.password).toBe("[redacted]");
    expect(out.newPassword).toBe("[redacted]");
    expect(out.nested).toEqual({ accessToken: "[redacted]", apiKey: "[redacted]", ok: 1 });
  });
});

describe("rate limiter", () => {
  it("blocks after the limit within the window", () => {
    resetRateLimits();
    for (let i = 0; i < 3; i++) expect(rateLimit("k", 3, 60_000).allowed).toBe(true);
    expect(rateLimit("k", 3, 60_000).allowed).toBe(false);
  });
});
