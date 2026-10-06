import { describe, expect, it } from "vitest";
import { MODULE_KEYS } from "@/config/modules";
import { getVisibleNav } from "./navigation";

const labels = (items: { label: string }[]) => items.map((i) => i.label);

describe("getVisibleNav", () => {
  it("hides unbuilt modules in production-like mode", () => {
    const nav = getVisibleNav({ role: "DOCTOR", enabledModules: MODULE_KEYS, showPlanned: false });
    expect(labels(nav)).toEqual(["Dashboard", "Settings"]);
  });
  it("shows role-appropriate planned modules as disabled when enabled", () => {
    const doctor = getVisibleNav({ role: "DOCTOR", enabledModules: MODULE_KEYS, showPlanned: true });
    expect(labels(doctor)).toContain("Prescriptions");
    expect(labels(doctor)).not.toContain("Billing");
    const reception = getVisibleNav({ role: "RECEPTIONIST", enabledModules: MODULE_KEYS, showPlanned: true });
    expect(labels(reception)).toContain("Billing");
    expect(labels(reception)).not.toContain("Prescriptions");
    expect(doctor.find((i) => i.label === "Patients")?.planned).toBe(true);
  });
  it("respects the plan's enabled modules", () => {
    const nav = getVisibleNav({ role: "CLINIC_ADMIN", enabledModules: ["dashboard", "settings"], showPlanned: true });
    expect(labels(nav)).toEqual(["Dashboard", "Settings"]);
  });
});
