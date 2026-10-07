import { describe, expect, it } from "vitest";
import { MODULE_KEYS } from "@/config/modules";
import { effectivePermissions } from "@/lib/permissions";
import { getVisibleNav } from "./navigation";

const labels = (items: { label: string }[]) => items.map((i) => i.label);
const clinicModules = MODULE_KEYS.filter((m) => m !== "platform");

describe("getVisibleNav", () => {
  it("hides unbuilt modules in production-like mode", () => {
    const nav = getVisibleNav({ permissions: effectivePermissions("DOCTOR"), enabledModules: clinicModules, showPlanned: false });
    expect(labels(nav)).toEqual(["Dashboard", "Live OPD", "Appointments", "Website", "Settings"]);
  });
  it("receptionist reaches enquiries through their own entry, admin through Website", () => {
    const r = getVisibleNav({ permissions: effectivePermissions("RECEPTIONIST"), enabledModules: clinicModules, showPlanned: false });
    expect(labels(r)).toContain("Enquiries");
    expect(labels(r)).not.toContain("Website");
    const a = getVisibleNav({ permissions: effectivePermissions("CLINIC_ADMIN"), enabledModules: clinicModules, showPlanned: false });
    expect(labels(a)).toContain("Website");
    expect(labels(a)).not.toContain("Enquiries");
  });
  it("shows Team only to roles with users.view", () => {
    const admin = getVisibleNav({ permissions: effectivePermissions("CLINIC_ADMIN"), enabledModules: clinicModules, showPlanned: false });
    expect(labels(admin)).toContain("Team");
    const reception = getVisibleNav({ permissions: effectivePermissions("RECEPTIONIST"), enabledModules: clinicModules, showPlanned: false });
    expect(labels(reception)).not.toContain("Team");
  });
  it("shows Clinics only to Super Admin", () => {
    const sa = getVisibleNav({ permissions: effectivePermissions("SUPER_ADMIN"), enabledModules: ["dashboard", "settings", "platform"], showPlanned: false });
    expect(labels(sa)).toContain("Clinics");
    const admin = getVisibleNav({ permissions: effectivePermissions("CLINIC_ADMIN"), enabledModules: [...clinicModules, "platform"], showPlanned: false });
    expect(labels(admin)).not.toContain("Clinics");
  });
  it("shows role-appropriate planned modules as disabled when enabled", () => {
    const doctor = getVisibleNav({ permissions: effectivePermissions("DOCTOR"), enabledModules: clinicModules, showPlanned: true });
    expect(labels(doctor)).toContain("Prescriptions");
    expect(labels(doctor)).not.toContain("Billing");
    const reception = getVisibleNav({ permissions: effectivePermissions("RECEPTIONIST"), enabledModules: clinicModules, showPlanned: true });
    expect(labels(reception)).toContain("Billing");
    expect(labels(reception)).not.toContain("Prescriptions");
    expect(doctor.find((i) => i.label === "Patients")?.planned).toBe(true);
  });
  it("respects the plan's enabled modules", () => {
    const nav = getVisibleNav({ permissions: effectivePermissions("CLINIC_ADMIN"), enabledModules: ["dashboard", "settings"], showPlanned: true });
    expect(labels(nav)).toEqual(["Dashboard", "Settings"]);
  });
});
