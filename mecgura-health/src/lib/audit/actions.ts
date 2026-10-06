/**
 * Audit action catalogue. Format: "<entity>.<verb>" (past tense).
 * EMITTED: written by Phase 0 code.  DECLARED: reserved names for later phases — the module
 * that ships the feature must call `recordAudit` with the declared name.
 */
export const AUDIT_ACTIONS = {
  // EMITTED in Phase 0
  LOGIN_SUCCEEDED: "auth.login.succeeded",
  LOGIN_FAILED: "auth.login.failed",
  LOGOUT: "auth.logout",
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
