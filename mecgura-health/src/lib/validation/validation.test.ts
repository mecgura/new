import { describe, expect, it } from "vitest";
import { email, isoDate, numeric, password, phone } from "./fields";
import { loginSchema } from "./schemas";
import { parseOrThrow } from "./index";
import { AppError } from "@/lib/errors";

describe("validation", () => {
  it("normalises and validates email", () => {
    expect(email.parse("  Doc@Clinic.COM ")).toBe("doc@clinic.com");
    expect(email.safeParse("nope").success).toBe(false);
    expect(email.safeParse("").success).toBe(false);
  });
  it("normalises Indian phone numbers", () => {
    expect(phone.parse("98765 43210")).toBe("+919876543210");
    expect(phone.parse("+91-9876543210")).toBe("+919876543210");
    expect(phone.safeParse("12345").success).toBe(false);
    expect(phone.safeParse("5876543210").success).toBe(false);
  });
  it("enforces password policy", () => {
    expect(password.safeParse("short1").success).toBe(false);
    expect(password.safeParse("onlyletterslong").success).toBe(false);
    expect(password.safeParse("long-enough-1").success).toBe(true);
  });
  it("validates numbers and dates", () => {
    expect(numeric("Age", { min: 0, max: 120, integer: true }).safeParse("200").success).toBe(false);
    expect(numeric("Age", { min: 0 }).parse("42")).toBe(42);
    expect(isoDate("Date").safeParse("2026-02-30").success).toBe(false);
    expect(isoDate("Date").safeParse("2026-02-28").success).toBe(true);
    expect(isoDate("Date of birth", { allowFuture: false }).safeParse("2999-01-01").success).toBe(false);
  });
  it("parseOrThrow raises a VALIDATION_ERROR with per-field messages", () => {
    try {
      parseOrThrow(loginSchema, { email: "bad", password: "" });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(AppError);
      const err = e as AppError;
      expect(err.code).toBe("VALIDATION_ERROR");
      expect(err.fieldErrors?.email).toBe("Enter a valid email address.");
      expect(err.fieldErrors?.password).toBe("Password is required.");
    }
  });
});
