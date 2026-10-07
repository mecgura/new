/**
 * Registry of models that hold tenant-owned data. Every model listed here is automatically
 * constrained to the caller's tenant by `tenantDb()`.
 *
 * RULE FOR NEW MODELS (Phase 1+): any table with a `tenantId` column MUST be added here,
 * in the same commit as its migration. `scoped-models.test.ts` fails if a model with a
 * tenantId column is missing from this list.
 *
 *  softDelete: model has `deletedAt`; reads exclude soft-deleted rows.
 */
export const TENANT_SCOPED_MODELS: Record<string, { softDelete?: boolean }> = {
  User: { softDelete: true },
  AuditLog: {},
  TenantAsset: {},
  DoctorProfile: {},
  StaffProfile: {},
  UserPermissionGrant: {},
  Invitation: {},
  Website: {},
  WebsiteService: {},
  DoctorPublicProfile: {},
  Testimonial: {},
  FaqItem: {},
  Article: {},
  ContactEnquiry: {},
  Patient: { softDelete: true },
  TenantCounter: {},
  DoctorSchedule: {},
  AvailabilityWindow: {},
  BlockedTime: {},
  Appointment: {},
  OpdVisit: {},
  OpdSettings: {},
};

/** Models that carry a tenantId but are intentionally NOT auto-scoped (explained). */
export const TENANT_ID_EXEMPT_MODELS: Record<string, string> = {
  TenantBranding: "1:1 child of Tenant, always loaded through the tenant relation",
  Subscription: "1:1 child of Tenant, platform-managed",
  Role: "tenantId null = system role shared by all tenants; custom roles arrive later",
};
