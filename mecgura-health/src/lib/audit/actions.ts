/**
 * Audit action catalogue. Format: "<entity>.<verb>" (past tense).
 * EMITTED: written by Phase 0 code.  DECLARED: reserved names for later phases — the module
 * that ships the feature must call `recordAudit` with the declared name.
 */
export const AUDIT_ACTIONS = {
  // EMITTED (Phase 0 + Phase 1)
  LOGIN_SUCCEEDED: "auth.login.succeeded",
  LOGIN_FAILED: "auth.login.failed",
  LOGOUT: "auth.logout",
  INVITATION_ACCEPTED: "invitation.accepted",
  CLINIC_CREATED: "clinic.created",
  CLINIC_UPDATED: "clinic.updated",
  CLINIC_STATUS_CHANGED: "clinic.status_changed",
  BRANDING_UPDATED: "branding.updated",
  DOMAIN_UPDATED: "domain.updated",
  DOMAIN_VERIFIED: "domain.verified",
  TENANT_ENTERED: "tenant.entered",
  TENANT_EXITED: "tenant.exited",
  USER_CREATED: "user.created",
  USER_INVITED: "user.invited",
  USER_UPDATED: "user.updated",
  USER_ROLE_CHANGED: "user.role_changed",
  USER_STATUS_CHANGED: "user.status_changed",
  // DECLARED for later phases
  PATIENT_VIEWED: "patient.viewed",
  PATIENT_CREATED: "patient.created",
  PRESCRIPTION_CREATED: "prescription.created",
  PRESCRIPTION_EDITED: "prescription.edited",
  REPORT_UPLOADED: "report.uploaded",
  REPORT_VIEWED: "report.viewed",
  TOKEN_MOVED: "token.moved",
  EMERGENCY_MARKED: "emergency.marked",
  BILLING_MODIFIED: "billing.modified",
  DOCUMENT_DOWNLOADED: "document.downloaded",
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];
