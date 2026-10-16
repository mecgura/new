import { describe, expect, it } from "vitest";
import { email, isoDate, numeric, password, phone } from "./fields";
import { loginSchema, normalizeIdentifier } from "./schemas";
import { brandingSchema, clinicCreateSchema, domainSchema, userCreateSchema } from "./clinic";
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
      parseOrThrow(loginSchema, { identifier: "bad", password: "" });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(AppError);
      const err = e as AppError;
      expect(err.code).toBe("VALIDATION_ERROR");
      expect(err.fieldErrors?.identifier).toBe("Enter a valid email address or 10-digit mobile number.");
      expect(err.fieldErrors?.password).toBe("Password is required.");
    }
  });
  it("login identifier accepts email or phone", () => {
    expect(normalizeIdentifier(" Doc@Clinic.com ")).toEqual({ kind: "email", value: "doc@clinic.com" });
    expect(normalizeIdentifier("98765 43210")).toEqual({ kind: "phone", value: "+919876543210" });
    expect(normalizeIdentifier("12345")).toBeNull();
  });
  it("branding rejects colours that are unreadable with white text", () => {
    const r = brandingSchema.safeParse({ primaryColor: "#ffff00", secondaryColor: "#0e7c86", accentColor: "#12a06a" });
    expect(r.success).toBe(false);
    expect(brandingSchema.safeParse({ primaryColor: "#14529e", secondaryColor: "#0e7c86", accentColor: "#12a06a" }).success).toBe(true);
    expect(brandingSchema.safeParse({ primaryColor: "red", secondaryColor: "#0e7c86", accentColor: "#12a06a" }).success).toBe(false);
  });
  it("domain validation blocks schemes, paths and reserved labels", () => {
    expect(domainSchema.safeParse({ customDomain: "https://x.com" }).success).toBe(false);
    expect(domainSchema.safeParse({ customDomain: "drsharma.com" }).success).toBe(true);
    expect(domainSchema.safeParse({ subdomain: "admin" }).success).toBe(false);
    expect(domainSchema.safeParse({ subdomain: "dr-sharma" }).success).toBe(true);
  });
  it("clinic creation requires admin/doctor role and valid slug", () => {
    const base = { profile: { name: "A Clinic", clinicType: "MULTI_DOCTOR", timezone: "Asia/Kolkata", country: "India" }, slug: "a-clinic", branding: { primaryColor: "#14529e", secondaryColor: "#0e7c86", accentColor: "#12a06a" }, admin: { name: "Dr A", email: "a@a.test", role: "DOCTOR" } };
    expect(clinicCreateSchema.safeParse(base).success).toBe(true);
    expect(clinicCreateSchema.safeParse({ ...base, admin: { ...base.admin, role: "SUPER_ADMIN" } }).success).toBe(false);
    expect(clinicCreateSchema.safeParse({ ...base, slug: "Bad Slug" }).success).toBe(false);
  });
  it("users can't be created as SUPER_ADMIN or PATIENT from a clinic", () => {
    const u = { name: "N", email: "n@n.test" };
    expect(userCreateSchema.safeParse({ ...u, role: "NURSE" }).success).toBe(true);
    expect(userCreateSchema.safeParse({ ...u, role: "SUPER_ADMIN" }).success).toBe(false);
    expect(userCreateSchema.safeParse({ ...u, role: "PATIENT" }).success).toBe(false);
  });
});
