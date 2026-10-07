import { ALL_PERMISSIONS, GRANTABLE_PERMISSIONS, type Permission, type RoleKey } from "./constants";

const P = (...p: Permission[]) => p;

const CLINIC_ADMIN: Permission[] = ALL_PERMISSIONS.filter((p) => p !== "platform.manage");

/**
 * Default role -> permission grants (least privilege). Seeded into the Role/Permission tables;
 * request-time checks use this map plus any per-user grants (see `effectivePermissions`).
 */
export const ROLE_PERMISSIONS: Record<RoleKey, readonly Permission[]> = {
  SUPER_ADMIN: ALL_PERMISSIONS,
  CLINIC_ADMIN,
  DOCTOR: P(
    "dashboard.view", "clinic.view", "settings.view",
    "patients.view", "patients.identity", "patients.clinical", "patients.clinical_edit", "opd.view", "opd.call", "opd.priority", "schedule.own", "appointments.view",
    "consultation.view", "consultation.create", "consultation.edit", "consultation.finalize", "vitals.record", "orders.view", "orders.create", "orders.update",
    "prescription.view", "prescription.create", "prescription.edit", "prescription.finalize", "prescription.print",
    "tests.view", "tests.order", "reports.view", "reports.review", "documents.view",
    "followups.view", "followups.manage", "tasks.view", "tasks.manage",
    "website.view", "website.profile", "website.articles",
  ),
  RECEPTIONIST: P(
    "dashboard.view", "clinic.view", "settings.view",
    "patients.view", "patients.identity", "patients.create", "patients.edit", "opd.view", "opd.manage", "opd.priority",
    "appointments.view", "appointments.create", "appointments.edit",
    "billing.view", "billing.create", "followups.view", "followups.manage", "communications.view",
    "enquiries.view", "enquiries.manage",
  ),
  COMPOUNDER: P(
    "dashboard.view", "clinic.view", "settings.view",
    "patients.view", "patients.identity", "opd.view", "opd.manage", "appointments.view", "prescription.view", "prescription.print", "orders.view", "orders.update", "tests.view", "tasks.view", "tasks.manage", "inventory.view",
  ),
  NURSE: P(
    "dashboard.view", "clinic.view", "settings.view",
    "patients.view", "patients.identity", "patients.clinical", "patients.clinical_edit", "opd.view", "appointments.view", "consultation.view", "vitals.record", "orders.view", "orders.update", "prescription.view", "tests.view", "reports.view", "reports.upload", "tasks.view", "tasks.manage",
  ),
  LAB_STAFF: P("dashboard.view", "clinic.view", "settings.view", "patients.identity", "tests.view", "reports.view", "reports.upload", "tasks.view", "tasks.manage"),
  ACCOUNTANT: P("dashboard.view", "clinic.view", "settings.view", "patients.identity", "billing.view", "billing.create", "billing.edit", "analytics.view"),
  // STAFF holds only the basics; anything more must be granted explicitly per user.
  STAFF: P("dashboard.view", "clinic.view", "settings.view"),
  // Patients use the (later) patient portal, never the staff app.
  PATIENT: [],
};

/** Role defaults ∪ explicit per-user grants (grants outside the grantable set are ignored). */
export function effectivePermissions(role: RoleKey, grants: readonly string[] = []): ReadonlySet<Permission> {
  const set = new Set<Permission>(ROLE_PERMISSIONS[role] ?? []);
  for (const g of grants) if ((GRANTABLE_PERMISSIONS as readonly string[]).includes(g)) set.add(g as Permission);
  return set;
}

export function permissionsForRole(role: RoleKey): ReadonlySet<Permission> {
  return effectivePermissions(role);
}

/** Roles allowed to sign in to the staff application. */
export const STAFF_APP_ROLES: readonly RoleKey[] = [
  "SUPER_ADMIN", "CLINIC_ADMIN", "DOCTOR", "RECEPTIONIST", "COMPOUNDER", "NURSE", "LAB_STAFF", "ACCOUNTANT", "STAFF",
];

/** Roles a tenant (clinic) can create. SUPER_ADMIN and PATIENT are never created from clinic screens. */
export const TENANT_ASSIGNABLE_ROLES: readonly RoleKey[] = STAFF_APP_ROLES.filter((r) => r !== "SUPER_ADMIN");
