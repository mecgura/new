import type { Permission } from "@/lib/permissions/constants";
import type { ModuleKey } from "./modules";

export type NavIcon =
  | "dashboard" | "patients" | "opd" | "appointments" | "consultations" | "prescriptions" | "tests"
  | "documents" | "tasks" | "billing" | "inventory" | "followups" | "communications" | "analytics"
  | "website" | "settings" | "clinics" | "team";

export interface NavItemConfig {
  /** Module this entry belongs to (plan/subscription gate) */
  module: ModuleKey;
  label: string;
  href: string;
  icon: NavIcon;
  /** Permission required to see it (role gate) */
  permission: Permission;
}

/** Single source of truth for sidebar order. Visibility = role permission ∧ plan module ∧ implemented. */
export const NAV_ITEMS: readonly NavItemConfig[] = [
  { module: "dashboard", label: "Dashboard", href: "/dashboard", icon: "dashboard", permission: "dashboard.view" },
  { module: "platform", label: "Clinics", href: "/platform/clinics", icon: "clinics", permission: "platform.manage" },
  { module: "team", label: "Team", href: "/team", icon: "team", permission: "users.view" },
  { module: "patients", label: "Patients", href: "/patients", icon: "patients", permission: "patients.view" },
  { module: "opd", label: "Live OPD", href: "/opd", icon: "opd", permission: "opd.view" },
  { module: "appointments", label: "Appointments", href: "/appointments", icon: "appointments", permission: "appointments.view" },
  { module: "consultations", label: "Consultations", href: "/consultations", icon: "consultations", permission: "consultation.view" },
  { module: "prescriptions", label: "Prescriptions", href: "/prescriptions", icon: "prescriptions", permission: "prescription.view" },
  { module: "tests", label: "Tests & Reports", href: "/tests", icon: "tests", permission: "tests.view" },
  { module: "documents", label: "Documents", href: "/documents", icon: "documents", permission: "documents.view" },
  { module: "tasks", label: "Tasks / Orders", href: "/tasks", icon: "tasks", permission: "tasks.view" },
  { module: "billing", label: "Billing", href: "/billing", icon: "billing", permission: "billing.view" },
  { module: "inventory", label: "Inventory", href: "/inventory", icon: "inventory", permission: "inventory.view" },
  { module: "followups", label: "Follow-ups", href: "/followups", icon: "followups", permission: "followups.view" },
  { module: "communications", label: "Communications", href: "/communications", icon: "communications", permission: "communications.view" },
  { module: "analytics", label: "Analytics", href: "/analytics", icon: "analytics", permission: "analytics.view" },
  { module: "website", label: "Website", href: "/website", icon: "website", permission: "website.view" },
  { module: "settings", label: "Settings", href: "/settings", icon: "settings", permission: "settings.view" },
];

export interface NavItemView extends NavItemConfig {
  /** Not built yet: render as a disabled "Soon" entry, never as a link */
  planned: boolean;
}
