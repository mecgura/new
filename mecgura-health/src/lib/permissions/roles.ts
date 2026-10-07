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
    "tests.view", "tests.order", "tests.print", "reports.view", "reports.review", "documents.view",
    "followups.view", "followups.manage", "followups.create", "followups.contact", "recalls.manage", "communications.view", "billing.view_own", "pharmacy.availability", "tasks.view", "tasks.manage",
    "website.view", "website.profile", "website.articles",
  ),
  RECEPTIONIST: P(
    "dashboard.view", "clinic.view", "settings.view",
    "patients.view", "patients.identity", "patients.create", "patients.edit", "portal.manage", "opd.view", "opd.manage", "opd.priority",
    "appointments.view", "appointments.create", "appointments.edit",
    "billing.view", "billing.create", "billing.edit", "billing.collect", "billing.discount", "billing.refund_request", "followups.view", "followups.manage", "followups.create", "followups.contact", "recalls.manage", "communications.view", "communications.resend",
    "enquiries.view", "enquiries.manage", "tests.view", "tests.print",
  ),
  COMPOUNDER: P(
    "dashboard.view", "clinic.view", "settings.view",
    "patients.view", "patients.identity", "opd.view", "opd.manage", "appointments.view", "prescription.view", "prescription.print", "orders.view", "orders.update", "tests.view", "tasks.view", "tasks.manage", "inventory.view",
  ),
  NURSE: P(
    "dashboard.view", "clinic.view", "settings.view",
    "patients.view", "patients.identity", "patients.clinical", "patients.clinical_edit", "opd.view", "appointments.view", "consultation.view", "vitals.record", "orders.view", "orders.update", "prescription.view", "tests.view", "lab.collect", "reports.view", "reports.upload", "tasks.view", "tasks.manage", "followups.view", "followups.contact",
  ),
  LAB_STAFF: P("dashboard.view", "clinic.view", "settings.view", "patients.identity", "communications.view", "tests.view", "tests.print", "lab.collect", "lab.result", "reports.view", "reports.upload", "tasks.view", "tasks.manage"),
  ACCOUNTANT: P("dashboard.view", "clinic.view", "settings.view", "patients.identity", "communications.view", "billing.view", "billing.create", "billing.edit", "billing.collect", "billing.discount", "billing.cancel", "billing.refund_request", "billing.refund_process", "billing.reports", "billing.export", "analytics.view"),
  PHARMACY_STAFF: P("dashboard.view", "clinic.view", "settings.view", "patients.identity", "pharmacy.view", "pharmacy.dispense", "pharmacy.return_request", "inventory.view"),
  PHARMACY_MANAGER: P("dashboard.view", "clinic.view", "settings.view", "patients.identity", "pharmacy.view", "pharmacy.dispense", "pharmacy.receive", "pharmacy.purchase", "pharmacy.medicines", "pharmacy.suppliers", "pharmacy.adjust", "pharmacy.return_request", "pharmacy.return_approve", "pharmacy.reports", "inventory.view", "inventory.edit"),
  // STAFF holds only the basics; anything more must be granted explicitly per user.
  STAFF: P("dashboard.view", "clinic.view", "settings.view"),
  // Patients use the (later) patient portal, never the staff app.
  PATIENT: [], // portal patients hold NO staff permission: the portal authorises through session -> PatientAccount -> Patient ownership
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
  "SUPER_ADMIN", "CLINIC_ADMIN", "DOCTOR", "RECEPTIONIST", "COMPOUNDER", "NURSE", "LAB_STAFF", "ACCOUNTANT", "PHARMACY_STAFF", "PHARMACY_MANAGER", "STAFF",
];

/** Roles a tenant (clinic) can create. SUPER_ADMIN and PATIENT are never created from clinic screens. */
export const TENANT_ASSIGNABLE_ROLES: readonly RoleKey[] = STAFF_APP_ROLES.filter((r) => r !== "SUPER_ADMIN");
