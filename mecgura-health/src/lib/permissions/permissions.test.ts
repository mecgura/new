import { describe, expect, it } from "vitest";
import { ALL_PERMISSIONS, ROLES, can, canAny, assertCan, ROLE_PERMISSIONS } from "./index";

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
  it("assertCan throws FORBIDDEN", () => {
    expect(() => assertCan("STAFF", "billing.edit")).toThrow();
    expect(canAny("STAFF", ["billing.edit", "dashboard.view"])).toBe(true);
  });
});
