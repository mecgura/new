import { ALL_PERMISSIONS, type Permission, type RoleKey } from "./constants";

const view = (...r: string[]) => r.map((x) => `${x}.view`) as Permission[];

const CLINIC_ADMIN: Permission[] = ALL_PERMISSIONS.filter((p) => p !== "platform.manage");

/**
 * Default role -> permission grants. Seeded into the Role/Permission tables; request-time
 * checks use this map (the role key is re-validated from the database on every request).
 * When tenant-defined custom roles arrive, `permissionsForRole` is the single place that
 * switches to database-driven grants.
 */
export const ROLE_PERMISSIONS: Record<RoleKey, readonly Permission[]> = {
  SUPER_ADMIN: ALL_PERMISSIONS,
  CLINIC_ADMIN,
  DOCTOR: [
    "dashboard.view",
    ...view("patients", "opd", "appointments", "consultations", "prescription", "tests", "reports", "documents", "followups", "tasks"),
    "patients.create", "patients.edit", "opd.manage", "appointments.create", "appointments.edit",
    "consultations.create", "consultations.edit", "prescription.create", "prescription.edit",
    "tests.order", "reports.review", "followups.manage", "tasks.manage", "settings.view",
  ],
  RECEPTIONIST: [
    "dashboard.view",
    ...view("patients", "opd", "appointments", "billing", "followups", "communications"),
    "patients.create", "patients.edit", "opd.manage", "appointments.create", "appointments.edit",
    "billing.create", "followups.manage", "settings.view",
  ],
  COMPOUNDER: [
    "dashboard.view",
    ...view("patients", "opd", "prescription", "tasks", "inventory"),
    "tasks.manage", "settings.view",
  ],
  NURSE: [
    "dashboard.view",
    ...view("patients", "opd", "consultations", "prescription", "tests", "reports", "tasks"),
    "tasks.manage", "reports.upload", "settings.view",
  ],
  LAB_STAFF: [
    "dashboard.view",
    ...view("patients", "tests", "reports", "tasks"),
    "reports.upload", "tasks.manage", "settings.view",
  ],
  ACCOUNTANT: [
    "dashboard.view",
    ...view("billing", "analytics", "patients"),
    "billing.create", "billing.edit", "settings.view",
  ],
  STAFF: ["dashboard.view", ...view("patients", "appointments", "tasks"), "settings.view"],
  // Patients use the (later) patient portal, never the staff app.
  PATIENT: [],
};

export function permissionsForRole(role: RoleKey): ReadonlySet<Permission> {
  return new Set(ROLE_PERMISSIONS[role] ?? []);
}

/** Roles allowed to sign in to the staff application. */
export const STAFF_APP_ROLES: readonly RoleKey[] = [
  "SUPER_ADMIN", "CLINIC_ADMIN", "DOCTOR", "RECEPTIONIST", "COMPOUNDER", "NURSE", "LAB_STAFF", "ACCOUNTANT", "STAFF",
];
