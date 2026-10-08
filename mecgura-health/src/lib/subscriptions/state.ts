/** Subscription state machine and access policy. Pure; every status change in the system goes through canTransition(). */
export const STATUSES = ["PENDING_PAYMENT", "TRIAL", "ACTIVE", "PAST_DUE", "GRACE", "PAUSED", "SUSPENDED", "CANCELLED", "EXPIRED"] as const;
export type SubStatus = (typeof STATUSES)[number];
export const STATUS_LABEL: Record<SubStatus, string> = { PENDING_PAYMENT: "Awaiting payment", TRIAL: "Trial", ACTIVE: "Active", PAST_DUE: "Past due", GRACE: "Grace period", PAUSED: "Paused", SUSPENDED: "Suspended", CANCELLED: "Cancelled", EXPIRED: "Expired" };

/** Allowed moves. Anything not listed is refused (e.g. EXPIRED → ACTIVE directly: a lapsed clinic must go through PENDING_PAYMENT, i.e. a new paid subscription). */
export const TRANSITIONS: Record<SubStatus, readonly SubStatus[]> = {
  PENDING_PAYMENT: ["ACTIVE", "TRIAL", "CANCELLED"],
  TRIAL: ["ACTIVE", "EXPIRED", "CANCELLED", "SUSPENDED"],
  ACTIVE: ["PAST_DUE", "PAUSED", "CANCELLED", "SUSPENDED", "EXPIRED"],
  PAST_DUE: ["ACTIVE", "GRACE", "CANCELLED", "SUSPENDED"],
  GRACE: ["ACTIVE", "SUSPENDED", "CANCELLED"],
  PAUSED: ["ACTIVE", "CANCELLED"],
  SUSPENDED: ["ACTIVE", "CANCELLED", "EXPIRED"],
  CANCELLED: ["PENDING_PAYMENT"],
  EXPIRED: ["PENDING_PAYMENT"],
};
export const canTransition = (from: string, to: string) => (TRANSITIONS[from as SubStatus] ?? []).includes(to as SubStatus);
/** Statuses in which the clinic is using the paid/trial service normally. */
export const LIVE: readonly SubStatus[] = ["TRIAL", "ACTIVE", "PAST_DUE"];
export const TERMINAL: readonly SubStatus[] = ["CANCELLED", "EXPIRED"];

export type AccessLevel = "FULL" | "READ_ONLY" | "BLOCK";
export type PortalPolicy = "BLOCK" | "READ_ONLY" | "ALLOW";
export interface SubscriptionPolicy {
  graceDays: number; dunningDays: number; renewalInvoiceLeadDays: number; invoiceDueDays: number;
  trial: { maxDays: number; requireBillingProfile: boolean; allowExtension: boolean; maxExtensionDays: number };
  access: { grace: AccessLevel; paused: AccessLevel; suspended: AccessLevel; ended: AccessLevel; pending: AccessLevel };
  portalDuringSuspension: PortalPolicy;
}
export const DEFAULT_POLICY: SubscriptionPolicy = {
  graceDays: 7, dunningDays: 3, renewalInvoiceLeadDays: 7, invoiceDueDays: 7,
  trial: { maxDays: 30, requireBillingProfile: false, allowExtension: true, maxExtensionDays: 14 },
  access: { grace: "FULL", paused: "READ_ONLY", suspended: "READ_ONLY", ended: "READ_ONLY", pending: "BLOCK" },
  portalDuringSuspension: "READ_ONLY",
};
export function mergePolicy(raw: Partial<SubscriptionPolicy> | null | undefined): SubscriptionPolicy {
  const r = raw ?? {}; const lvl = (v: unknown, d: AccessLevel): AccessLevel => (v === "FULL" || v === "READ_ONLY" || v === "BLOCK" ? v : d);
  const n = (v: unknown, d: number, lo: number, hi: number) => (typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi ? v : d);
  const t = (r.trial ?? {}) as Partial<SubscriptionPolicy["trial"]>; const a = (r.access ?? {}) as Partial<SubscriptionPolicy["access"]>; const D = DEFAULT_POLICY;
  return {
    graceDays: n(r.graceDays, D.graceDays, 0, 90), dunningDays: n(r.dunningDays, D.dunningDays, 0, 30), renewalInvoiceLeadDays: n(r.renewalInvoiceLeadDays, D.renewalInvoiceLeadDays, 0, 60), invoiceDueDays: n(r.invoiceDueDays, D.invoiceDueDays, 0, 60),
    trial: { maxDays: n(t.maxDays, D.trial.maxDays, 1, 90), requireBillingProfile: t.requireBillingProfile === true, allowExtension: t.allowExtension !== false, maxExtensionDays: n(t.maxExtensionDays, D.trial.maxExtensionDays, 0, 90) },
    access: { grace: lvl(a.grace, D.access.grace), paused: lvl(a.paused, D.access.paused), suspended: lvl(a.suspended, D.access.suspended), ended: lvl(a.ended, D.access.ended), pending: lvl(a.pending, D.access.pending) },
    portalDuringSuspension: r.portalDuringSuspension === "BLOCK" || r.portalDuringSuspension === "ALLOW" || r.portalDuringSuspension === "READ_ONLY" ? r.portalDuringSuspension : D.portalDuringSuspension,
  };
}
/** How much of the product a clinic gets in each state. */
export function accessFor(status: string, policy: SubscriptionPolicy): AccessLevel {
  switch (status) {
    case "TRIAL": case "ACTIVE": case "PAST_DUE": return "FULL";
    case "GRACE": return policy.access.grace; case "PAUSED": return policy.access.paused; case "SUSPENDED": return policy.access.suspended;
    case "CANCELLED": case "EXPIRED": return policy.access.ended; case "PENDING_PAYMENT": return policy.access.pending;
    default: return "BLOCK";
  }
}
/** Permissions kept in READ_ONLY mode: viewing, identity and clinical reading, printing and report reading. Everything that creates or changes data is dropped. */
export const isReadPermission = (p: string) => /\.(view|view_own|identity|clinical|print|reports|availability|export|export_patient|export_financial)$/.test(p) || p === "clinic.view";
