/** Role keys (system roles). Stored in Role.key and carried in the session. */
export const ROLES = [
  "SUPER_ADMIN",
  "CLINIC_ADMIN",
  "DOCTOR",
  "RECEPTIONIST",
  "COMPOUNDER",
  "NURSE",
  "LAB_STAFF",
  "ACCOUNTANT",
  "STAFF",
  "PATIENT",
] as const;
export type RoleKey = (typeof ROLES)[number];

export const ROLE_LABELS: Record<RoleKey, string> = {
  SUPER_ADMIN: "Super Admin",
  CLINIC_ADMIN: "Clinic Admin",
  DOCTOR: "Doctor",
  RECEPTIONIST: "Receptionist",
  COMPOUNDER: "Compounder",
  NURSE: "Nurse",
  LAB_STAFF: "Lab Staff",
  ACCOUNTANT: "Accountant",
  STAFF: "Staff",
  PATIENT: "Patient",
};

/**
 * Permission catalogue: "<resource>.<action>". Adding a permission = add it here, grant it in
 * roles.ts, run the seed. Phase 1+ modules reuse these keys instead of inventing new ones.
 */
export const PERMISSIONS = {
  "dashboard.view": { module: "dashboard", description: "View the dashboard" },

  "patients.view": { module: "patients", description: "View patients" },
  "patients.create": { module: "patients", description: "Register patients" },
  "patients.edit": { module: "patients", description: "Edit patients" },

  "opd.view": { module: "opd", description: "View the live OPD queue" },
  "opd.manage": { module: "opd", description: "Move tokens and manage the queue" },

  "appointments.view": { module: "appointments", description: "View appointments" },
  "appointments.create": { module: "appointments", description: "Book appointments" },
  "appointments.edit": { module: "appointments", description: "Reschedule or cancel appointments" },

  "consultations.view": { module: "consultations", description: "View consultations" },
  "consultations.create": { module: "consultations", description: "Record consultations" },
  "consultations.edit": { module: "consultations", description: "Edit consultations" },

  "prescription.view": { module: "prescriptions", description: "View prescriptions" },
  "prescription.create": { module: "prescriptions", description: "Write prescriptions" },
  "prescription.edit": { module: "prescriptions", description: "Edit prescriptions" },

  "tests.view": { module: "tests", description: "View tests and orders" },
  "tests.order": { module: "tests", description: "Order tests" },
  "reports.view": { module: "tests", description: "View reports" },
  "reports.upload": { module: "tests", description: "Upload reports" },
  "reports.review": { module: "tests", description: "Review reports" },

  "documents.view": { module: "documents", description: "View documents" },
  "documents.upload": { module: "documents", description: "Upload documents" },

  "tasks.view": { module: "tasks", description: "View staff tasks and orders" },
  "tasks.manage": { module: "tasks", description: "Create and complete tasks" },

  "billing.view": { module: "billing", description: "View billing" },
  "billing.create": { module: "billing", description: "Create invoices" },
  "billing.edit": { module: "billing", description: "Edit billing" },

  "inventory.view": { module: "inventory", description: "View inventory" },
  "inventory.edit": { module: "inventory", description: "Edit inventory" },

  "followups.view": { module: "followups", description: "View follow-ups" },
  "followups.manage": { module: "followups", description: "Manage follow-ups" },

  "communications.view": { module: "communications", description: "View communications" },
  "communications.send": { module: "communications", description: "Send messages" },

  "analytics.view": { module: "analytics", description: "View analytics" },
  "website.manage": { module: "website", description: "Manage the clinic website" },

  "settings.view": { module: "settings", description: "View settings" },
  "settings.edit": { module: "settings", description: "Change settings" },
  "users.view": { module: "settings", description: "View staff accounts" },
  "users.manage": { module: "settings", description: "Manage staff accounts" },
  "audit.view": { module: "settings", description: "View the audit log" },

  "platform.manage": { module: "platform", description: "Manage tenants and plans (platform only)" },
} as const;

export type Permission = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];
