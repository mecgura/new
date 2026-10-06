/** Controlled value sets shared by UI, validation and services. Stored as plain strings in the DB. */

export const CLINIC_TYPES = {
  INDIVIDUAL_DOCTOR: "Individual doctor",
  SINGLE_SPECIALIST: "Single-specialist clinic",
  MULTI_DOCTOR: "Multi-doctor clinic",
  SPECIALIST_CLINIC: "Specialist clinic",
  DIAGNOSTIC: "Diagnostic / service clinic",
  OTHER: "Other",
} as const;
export type ClinicType = keyof typeof CLINIC_TYPES;
export const CLINIC_TYPE_KEYS = Object.keys(CLINIC_TYPES) as [ClinicType, ...ClinicType[]];

export const TENANT_STATUSES = {
  ACTIVE: { label: "Active", tone: "success" },
  TRIAL: { label: "Trial", tone: "info" },
  SUSPENDED: { label: "Suspended", tone: "warning" },
  INACTIVE: { label: "Inactive", tone: "neutral" },
} as const;
export type TenantStatus = keyof typeof TENANT_STATUSES;
export const TENANT_STATUS_KEYS = Object.keys(TENANT_STATUSES) as [TenantStatus, ...TenantStatus[]];
/** Clinic users can sign in and use the workspace only in these states. */
export const TENANT_ACCESS_STATUSES: readonly string[] = ["ACTIVE", "TRIAL"];

export const USER_STATUSES = {
  ACTIVE: { label: "Active", tone: "success" },
  INVITED: { label: "Invited", tone: "info" },
  SUSPENDED: { label: "Suspended", tone: "warning" },
  DISABLED: { label: "Disabled", tone: "danger" },
} as const;
export type UserStatus = keyof typeof USER_STATUSES;
export const USER_STATUS_KEYS = Object.keys(USER_STATUSES) as [UserStatus, ...UserStatus[]];

export const GENDERS = { MALE: "Male", FEMALE: "Female", OTHER: "Other", UNDISCLOSED: "Prefer not to say" } as const;
export type Gender = keyof typeof GENDERS;
export const GENDER_KEYS = Object.keys(GENDERS) as [Gender, ...Gender[]];

export const TIMEZONES = ["Asia/Kolkata", "Asia/Dubai", "Asia/Singapore", "Europe/London", "America/New_York", "Australia/Sydney"] as const;

/** Subdomain / slug labels that can never belong to a clinic. */
export const RESERVED_LABELS: readonly string[] = [
  "www", "api", "app", "admin", "platform", "mail", "smtp", "ftp", "static", "assets", "cdn", "login", "auth",
  "support", "help", "status", "docs", "blog", "mecgura", "health", "demo-platform",
];
