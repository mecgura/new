import { describe, expect, it } from "vitest";
import { canAssignRole, isSuperAdmin, normalizePlatformRole, ORG_PERMISSIONS, roleHasPermission } from "@/lib/authz";

describe("role model", () => {
  it("maps legacy 'admin' and SUPER_ADMIN to SUPER_ADMIN, everything else to USER", () => {
    expect(normalizePlatformRole("admin")).toBe("SUPER_ADMIN");
    expect(normalizePlatformRole("SUPER_ADMIN")).toBe("SUPER_ADMIN");
    for (const r of ["USER", "CLIENT_OWNER", "MANAGER", "AGENT", "", null, undefined, "super_admin"]) {
      expect(normalizePlatformRole(r)).toBe("USER");
      expect(isSuperAdmin(r)).toBe(false);
    }
  });

  it("permission matrix", () => {
    expect(roleHasPermission("CLIENT_OWNER", "org:update")).toBe(true);
    expect(roleHasPermission("MANAGER", "org:update")).toBe(false);
    expect(roleHasPermission("AGENT", "org:update")).toBe(false);
    expect(roleHasPermission("MANAGER", "members:read")).toBe(true);
    expect(roleHasPermission("AGENT", "members:read")).toBe(false);
    expect(roleHasPermission("MANAGER", "members:manage")).toBe(false);
    expect(roleHasPermission("AGENT", "audit:read")).toBe(false);
    for (const role of ["CLIENT_OWNER", "MANAGER", "AGENT"] as const) expect(roleHasPermission(role, "org:read")).toBe(true);
    expect(Object.keys(ORG_PERMISSIONS).length).toBeGreaterThan(0);
  });

  it("only owners assign roles", () => {
    expect(canAssignRole("CLIENT_OWNER", "MANAGER")).toBe(true);
    expect(canAssignRole("MANAGER", "AGENT")).toBe(false);
    expect(canAssignRole("AGENT", "AGENT")).toBe(false);
  });
});
