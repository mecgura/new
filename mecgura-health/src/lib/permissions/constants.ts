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
  "PHARMACY_STAFF",
  "PHARMACY_MANAGER",
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
  PHARMACY_STAFF: "Pharmacy Staff",
  PHARMACY_MANAGER: "Pharmacy Manager",
  STAFF: "Staff",
  PATIENT: "Patient",
};

/**
 * Permission catalogue: "<resource>.<action>". Adding a permission = add it here, grant it in
 * roles.ts, run the seed. Phase 1+ modules reuse these keys instead of inventing new ones.
 */
export const PERMISSIONS = {
  "dashboard.view": { module: "dashboard", description: "View the dashboard" },

  "clinic.view": { module: "clinic", description: "View clinic profile and branding" },
  "clinic.edit": { module: "clinic", description: "Edit clinic profile" },
  "clinic.settings": { module: "clinic", description: "Change clinic branding and settings" },

  "patients.view": { module: "patients", description: "View patients" },
  "patients.create": { module: "patients", description: "Register patients" },
  "patients.edit": { module: "patients", description: "Edit patients" },
  "patients.identity": { module: "patients", description: "See a patient's name and ID only (billing / lab workflows)" },
  "patients.clinical": { module: "patients", description: "View allergies, medical history, medicines, family history and clinical notes" },
  "patients.clinical_edit": { module: "patients", description: "Record allergies, medical history, medicines and clinical notes" },
  "patients.archive": { module: "patients", description: "Archive and restore patients" },
  "patients.export": { module: "patients", description: "Export a patient's data" },

  "opd.view": { module: "opd", description: "View the live OPD queue" },
  "opd.manage": { module: "opd", description: "Run the queue for any doctor: call, hold, resume, skip, reassign" },
  "opd.call": { module: "opd", description: "Call and consult patients in your own queue" },
  "opd.priority": { module: "opd", description: "Change queue priority and mark emergencies" },
  "schedule.manage": { module: "appointments", description: "Manage every doctor's availability, blocked time and OPD settings" },
  "schedule.own": { module: "appointments", description: "Manage your own availability and blocked time" },

  "appointments.view": { module: "appointments", description: "View appointments" },
  "appointments.create": { module: "appointments", description: "Book appointments" },
  "appointments.edit": { module: "appointments", description: "Reschedule or cancel appointments" },

  "consultation.view": { module: "consultations", description: "View consultations" },
  "consultation.create": { module: "consultations", description: "Record consultations" },
  "consultation.edit": { module: "consultations", description: "Edit consultations" },
  "consultation.finalize": { module: "consultations", description: "Finalize and amend your own consultations (doctors only)" },
  "vitals.record": { module: "consultations", description: "Record vitals on an open consultation" },
  "orders.view": { module: "consultations", description: "View doctor orders / tasks" },
  "orders.create": { module: "consultations", description: "Create doctor orders" },
  "orders.update": { module: "consultations", description: "Move assigned doctor orders through their operational steps" },
  "medicines.manage": { module: "consultations", description: "Manage the clinic's medicine list" },

  "prescription.view": { module: "prescriptions", description: "View prescriptions" },
  "prescription.create": { module: "prescriptions", description: "Write prescriptions" },
  "prescription.edit": { module: "prescriptions", description: "Edit prescriptions" },
  "prescription.finalize": { module: "prescriptions", description: "Finalize and amend your own prescriptions (doctors only)" },
  "prescription.print": { module: "prescriptions", description: "Print or download finalized prescriptions" },

  "tests.view": { module: "tests", description: "View tests and orders" },
  "tests.order": { module: "tests", description: "Order tests" },
  "reports.view": { module: "tests", description: "View reports" },
  "reports.upload": { module: "tests", description: "Upload reports" },
  "reports.review": { module: "tests", description: "Review reports" },
  "tests.print": { module: "tests", description: "Print investigation slips and sample labels" },
  "lab.collect": { module: "tests", description: "Collect, receive and reject samples" },
  "lab.result": { module: "tests", description: "Enter and submit laboratory results" },
  "lab.review": { module: "tests", description: "Verify, release and amend laboratory reports (lab reviewer)" },
  "lab.configure": { module: "tests", description: "Configure the investigation list, lab settings and lab partners" },

  "documents.view": { module: "documents", description: "View documents" },
  "documents.upload": { module: "documents", description: "Upload documents" },

  "tasks.view": { module: "tasks", description: "View staff tasks and orders" },
  "tasks.manage": { module: "tasks", description: "Create and complete tasks" },

  "billing.view": { module: "billing", description: "View billing" },
  "billing.create": { module: "billing", description: "Create invoices" },
  "billing.edit": { module: "billing", description: "Edit draft invoices" },
  "billing.collect": { module: "billing", description: "Record payments and print receipts" },
  "billing.discount": { module: "billing", description: "Apply discounts (limits are set in billing settings)" },
  "billing.cancel": { module: "billing", description: "Cancel issued invoices and payments" },
  "billing.refund_request": { module: "billing", description: "Request refunds" },
  "billing.refund_approve": { module: "billing", description: "Approve or reject refunds" },
  "billing.refund_process": { module: "billing", description: "Process approved refunds" },
  "billing.reports": { module: "billing", description: "View financial reports" },
  "billing.export": { module: "billing", description: "Export financial data (CSV)" },
  "billing.configure": { module: "billing", description: "Configure services, taxes, discount rules and billing settings" },
  "billing.view_own": { module: "billing", description: "View billing status of own consultations" },

  "inventory.view": { module: "inventory", description: "View inventory" },
  "inventory.edit": { module: "inventory", description: "Edit inventory" },
  "portal.manage": { module: "patients", description: "Give patients portal access, reset it, and review patient portal requests" },
  "portal.configure": { module: "patients", description: "Configure the patient portal policy" },
  "pharmacy.view": { module: "inventory", description: "View medicines, stock, batches and suppliers" },
  "pharmacy.dispense": { module: "inventory", description: "Dispense finalized prescriptions" },
  "pharmacy.receive": { module: "inventory", description: "Receive a purchase into stock" },
  "pharmacy.purchase": { module: "inventory", description: "Create, edit, complete and cancel purchases; return stock to suppliers" },
  "pharmacy.medicines": { module: "inventory", description: "Add and edit medicines (price changes are audited)" },
  "pharmacy.suppliers": { module: "inventory", description: "Manage suppliers" },
  "pharmacy.adjust": { module: "inventory", description: "Stock adjustments, physical counts, damage, expiry write-off and blocking batches" },
  "pharmacy.return_request": { module: "inventory", description: "Request medicine returns" },
  "pharmacy.return_approve": { module: "inventory", description: "Approve, receive and resolve medicine returns; cancel dispensing" },
  "pharmacy.reports": { module: "inventory", description: "View and export pharmacy reports" },
  "pharmacy.configure": { module: "inventory", description: "Pharmacy settings, categories, forms, units and opening stock" },
  "pharmacy.availability": { module: "inventory", description: "See whether a medicine is in stock (doctors)" },

  "followups.view": { module: "followups", description: "View follow-ups" },
  "followups.manage": { module: "followups", description: "Reassign, reschedule, complete and cancel follow-ups" },
  "followups.create": { module: "followups", description: "Create follow-ups" },
  "followups.contact": { module: "followups", description: "Log patient contact on follow-ups" },
  "followups.configure": { module: "followups", description: "Configure follow-up rules and outcomes" },
  "recalls.manage": { module: "followups", description: "Create and manage patient recalls" },

  "communications.view": { module: "communications", description: "View communications" },
  "communications.send": { module: "communications", description: "Send messages" },

  "analytics.view": { module: "analytics", description: "View analytics" },
  "website.view": { module: "website", description: "View the clinic website settings" },
  "website.edit": { module: "website", description: "Edit the clinic website content" },
  "website.publish": { module: "website", description: "Publish or unpublish the clinic website and its content" },
  "website.profile": { module: "website", description: "Edit your own public doctor profile" },
  "website.articles": { module: "website", description: "Write article drafts" },
  "enquiries.view": { module: "website", description: "View website contact enquiries" },
  "enquiries.manage": { module: "website", description: "Mark website enquiries as read or archived" },

  "settings.view": { module: "settings", description: "View settings" },
  "settings.edit": { module: "settings", description: "Change settings" },
  "users.view": { module: "team", description: "View staff accounts" },
  "users.create": { module: "team", description: "Add or invite staff accounts" },
  "users.edit": { module: "team", description: "Edit staff accounts and roles" },
  "users.disable": { module: "team", description: "Suspend, disable or re-activate staff accounts" },
  "audit.view": { module: "settings", description: "View the audit log" },

  "platform.manage": { module: "platform", description: "Manage tenants and plans (platform only)" },
} as const;

export type Permission = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

/**
 * Permissions that can NEVER be handed to an individual user as an extra grant — they come only from
 * the role (admin/platform powers). Everything else may be granted to e.g. a STAFF member.
 */
export const NON_GRANTABLE_PERMISSIONS: readonly Permission[] = [
  "platform.manage", "website.publish", "schedule.manage", "clinic.edit", "clinic.settings", "settings.edit", "users.view", "users.create", "users.edit", "users.disable", "audit.view", "patients.archive", "patients.export", "consultation.finalize", "prescription.finalize", "lab.configure", "followups.configure", "portal.configure", "pharmacy.configure", "pharmacy.adjust", "pharmacy.return_approve", "pharmacy.purchase", "pharmacy.medicines", "pharmacy.suppliers", "billing.configure", "billing.refund_approve",
];
export const GRANTABLE_PERMISSIONS = ALL_PERMISSIONS.filter((p) => !NON_GRANTABLE_PERMISSIONS.includes(p));
