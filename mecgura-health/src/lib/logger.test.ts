/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from "vitest";
import { redact } from "./logger";

describe("logger redaction", () => {
  it("redacts credentials, contact and medical fields at any depth", () => {
    const out = redact({ userId: "u1", password: "x", nested: { authToken: "t", diagnosis: "d", phone: "9", ok: 1 }, list: [{ email: "a@b.c" }] }) as Record<string, any>;
    expect(out.userId).toBe("u1");
    expect(out.password).toBe("[REDACTED]");
    expect(out.nested.authToken).toBe("[REDACTED]");
    expect(out.nested.diagnosis).toBe("[REDACTED]");
    expect(out.nested.phone).toBe("[REDACTED]");
    expect(out.nested.ok).toBe(1);
    expect(out.list[0].email).toBe("[REDACTED]");
  });
  it("reduces Error objects to name+message (no stack)", () => {
    const out = redact({ error: new Error("boom") }) as Record<string, any>;
    expect(out.error).toEqual({ name: "Error", message: "boom" });
  });
});
