import { describe, expect, it } from "vitest";
import { ALL_PERMISSIONS, GRANTABLE_PERMISSIONS, NON_GRANTABLE_PERMISSIONS, ROLES, assertPermission, can, canAny, effectivePermissions, ROLE_PERMISSIONS } from "./index";

describe("permissions", () => {
  it("every granted permission exists in the catalogue", () => {
    for (const role of ROLES) for (const p of ROLE_PERMISSIONS[role]) expect(ALL_PERMISSIONS).toContain(p);
  });
  it("doctor and receptionist match the spec examples", () => {
    expect(can("DOCTOR", "prescription.create")).toBe(true);
    expect(can("DOCTOR", "billing.view")).toBe(false);
    expect(can("RECEPTIONIST", "billing.create")).toBe(true);
    expect(can("RECEPTIONIST", "prescription.view")).toBe(false);
  });
  it("only SUPER_ADMIN holds platform.manage; patients hold nothing", () => {
    expect(ROLES.filter((r) => can(r, "platform.manage"))).toEqual(["SUPER_ADMIN"]);
    expect(ROLE_PERMISSIONS.PATIENT).toHaveLength(0);
  });
  it("admin-only powers are held by CLINIC_ADMIN but not by doctor/reception/staff", () => {
    for (const p of ["users.create", "users.edit", "users.disable", "clinic.edit", "clinic.settings", "settings.edit"] as const) {
      expect(can("CLINIC_ADMIN", p)).toBe(true);
      for (const r of ["DOCTOR", "RECEPTIONIST", "COMPOUNDER", "NURSE", "LAB_STAFF", "ACCOUNTANT", "STAFF"] as const) expect(can(r, p)).toBe(false);
    }
  });
  it("STAFF only has the basics unless granted", () => {
    expect([...effectivePermissions("STAFF")].sort()).toEqual(["clinic.view", "dashboard.view", "settings.view"]);
    expect(effectivePermissions("STAFF", ["patients.view"]).has("patients.view")).toBe(true);
  });
  it("per-user grants can never include administration or platform permissions", () => {
    const eff = effectivePermissions("STAFF", [...NON_GRANTABLE_PERMISSIONS, "not.a.permission"]);
    for (const p of NON_GRANTABLE_PERMISSIONS) expect(eff.has(p)).toBe(false);
    for (const p of NON_GRANTABLE_PERMISSIONS) expect(GRANTABLE_PERMISSIONS).not.toContain(p);
  });
  it("assertPermission throws FORBIDDEN", () => {
    expect(() => assertPermission(effectivePermissions("STAFF"), "billing.edit")).toThrow();
    expect(canAny("STAFF", ["billing.edit", "dashboard.view"])).toBe(true);
  });
});
