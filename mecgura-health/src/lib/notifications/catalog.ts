/**
 * Phase 12 notification catalogue — pure data. One row per kind of notification: who gets it by default, how important it is,
 * and where "Open" leads. In-app delivery is always available; WhatsApp / SMS / email to PATIENTS is delegated to the Phase 11 engine.
 */
export const CATEGORIES = ["APPOINTMENT", "OPD", "PATIENT", "CLINICAL", "LAB", "FOLLOWUP", "BILLING", "PHARMACY", "SECURITY", "SYSTEM", "GENERAL"] as const;
export type NCategory = (typeof CATEGORIES)[number];
export const CATEGORY_LABEL: Record<NCategory, string> = { APPOINTMENT: "Appointments", OPD: "Live OPD", PATIENT: "Patients", CLINICAL: "Prescriptions", LAB: "Lab", FOLLOWUP: "Follow-ups", BILLING: "Billing", PHARMACY: "Pharmacy", SECURITY: "Security", SYSTEM: "System", GENERAL: "Other" };
export const PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT", "CRITICAL"] as const;
export type NPriority = (typeof PRIORITIES)[number];
export const PRIORITY_RANK: Record<string, number> = { LOW: 0, NORMAL: 1, HIGH: 2, URGENT: 3, CRITICAL: 4 };
export const PRIORITY_LABEL: Record<NPriority, string> = { LOW: "Low", NORMAL: "Normal", HIGH: "High", URGENT: "Urgent", CRITICAL: "Critical" };
/** An admin can set a rule up to URGENT. CRITICAL is reserved for security / system incidents raised by the system itself. */
export const MAX_RULE_PRIORITY: NPriority = "URGENT";

/** Audience tokens: a role key, or  @doctor (the responsible doctor of the entity) · @assignee · @self (the person the event is about) · @patient (that patient's portal login). */
export type Audience = string;
export interface NDef {
  label: string; category: NCategory; priority: NPriority; audience: Audience[]; defaultOn: boolean; ack?: boolean; group?: boolean; description: string;
  /** shown to staff or to patients */
  for: "STAFF" | "PATIENT";
  title: (v: Record<string, string>) => string; message: (v: Record<string, string>) => string;
  /** the Phase 11 event that carries the same news to the patient's phone / inbox */
  comm?: string;
}
const T = (s: string) => (v: Record<string, string>) => s.replace(/\{(\w+)\}/g, (_m, k: string) => v[k] ?? "");

export const TYPES = {
  APPOINTMENT_REQUESTED: { label: "Appointment requested", category: "APPOINTMENT", priority: "NORMAL", audience: ["RECEPTIONIST", "CLINIC_ADMIN"], defaultOn: true, for: "STAFF", description: "A patient asked for an appointment that needs confirming.", title: T("Appointment request"), message: T("{patient} asked for an appointment on {when} with {doctor}."), comm: "APPOINTMENT_REQUESTED" },
  APPOINTMENT_CONFIRMED_STAFF: { label: "Appointment booked (doctor)", category: "APPOINTMENT", priority: "NORMAL", audience: ["@doctor"], defaultOn: true, for: "STAFF", description: "A new appointment is on the doctor's list.", title: T("New appointment"), message: T("{patient} is booked for {when}.") },
  APPOINTMENT_CONFIRMED: { label: "Appointment confirmed", category: "APPOINTMENT", priority: "NORMAL", audience: ["@patient"], defaultOn: true, for: "PATIENT", description: "The patient's appointment is confirmed.", title: T("Appointment confirmed"), message: T("{when} with {doctor}."), comm: "APPOINTMENT_CONFIRMED" },
  APPOINTMENT_RESCHEDULED: { label: "Appointment rescheduled", category: "APPOINTMENT", priority: "HIGH", audience: ["@patient", "@doctor", "RECEPTIONIST"], defaultOn: true, for: "STAFF", description: "An appointment moved to a new time.", title: T("Appointment rescheduled"), message: T("{patient}: now {when} with {doctor}."), comm: "APPOINTMENT_RESCHEDULED" },
  APPOINTMENT_CANCELLED: { label: "Appointment cancelled", category: "APPOINTMENT", priority: "HIGH", audience: ["@patient", "@doctor", "RECEPTIONIST"], defaultOn: true, for: "STAFF", description: "An appointment was cancelled.", title: T("Appointment cancelled"), message: T("{patient}: {when} with {doctor} was cancelled."), comm: "APPOINTMENT_CANCELLED" },
  APPOINTMENT_REMINDER: { label: "Appointment reminder", category: "APPOINTMENT", priority: "LOW", audience: ["@patient"], defaultOn: true, for: "PATIENT", description: "Reminder before the appointment.", title: T("Appointment reminder"), message: T("{when} with {doctor}."), comm: "APPOINTMENT_REMINDER" },
  APPOINTMENT_NO_SHOW: { label: "Appointment missed", category: "APPOINTMENT", priority: "LOW", audience: ["RECEPTIONIST"], defaultOn: true, for: "STAFF", description: "A patient did not come.", title: T("Missed appointment"), message: T("{patient} did not come for {when}.") },
  OPD_CHECKED_IN: { label: "Patient checked in", category: "OPD", priority: "NORMAL", audience: ["@doctor", "COMPOUNDER", "NURSE"], defaultOn: true, group: true, for: "STAFF", description: "A patient joined the live queue. Several check-ins fold into one notification.", title: T("Patient checked in"), message: T("{patient} is waiting (token {token}).") },
  OPD_EMERGENCY: { label: "Emergency patient", category: "OPD", priority: "URGENT", audience: ["@doctor", "CLINIC_ADMIN"], defaultOn: true, ack: true, for: "STAFF", description: "An emergency patient was registered. Needs acknowledging.", title: T("Emergency patient waiting"), message: T("{patient} (token {token}) was registered as an emergency.") },
  OPD_CALLED: { label: "Your turn", category: "OPD", priority: "HIGH", audience: ["@patient"], defaultOn: true, for: "PATIENT", description: "The patient's token was called.", title: T("It's your turn"), message: T("Token {token} has been called. Please go to the consultation room."), comm: "OPD_CALLED" },
  OPD_DONE: { label: "Consultation completed", category: "OPD", priority: "LOW", audience: ["RECEPTIONIST"], defaultOn: false, for: "STAFF", description: "The doctor finished with a patient (billing may be due).", title: T("Consultation completed"), message: T("{patient} is done with {doctor}.") },
  PATIENT_REGISTERED: { label: "New patient registered", category: "PATIENT", priority: "LOW", audience: ["CLINIC_ADMIN"], defaultOn: false, for: "STAFF", description: "A new patient file was created.", title: T("New patient registered"), message: T("{patient} was added.") },
  PATIENT_REQUEST_RECEIVED: { label: "Patient request received", category: "PATIENT", priority: "NORMAL", audience: ["RECEPTIONIST", "CLINIC_ADMIN"], defaultOn: true, for: "STAFF", description: "A patient sent a correction, support or account request from the portal.", title: T("New patient request"), message: T("{patient} sent a request ({kind}).") },
  PRESCRIPTION_AVAILABLE: { label: "Prescription available", category: "CLINICAL", priority: "NORMAL", audience: ["@patient"], defaultOn: true, for: "PATIENT", description: "A finalized prescription is in the portal.", title: T("Your prescription is available"), message: T("{number}"), comm: "PRESCRIPTION_AVAILABLE" },
  PRESCRIPTION_READY: { label: "Prescription ready to dispense", category: "PHARMACY", priority: "NORMAL", audience: ["PHARMACY_STAFF", "PHARMACY_MANAGER"], defaultOn: true, for: "STAFF", description: "A prescription was finalized and can be dispensed.", title: T("Prescription ready to dispense"), message: T("{patient} — {number}.") },
  LAB_ORDERED: { label: "New investigation", category: "LAB", priority: "NORMAL", audience: ["LAB_STAFF"], defaultOn: true, for: "STAFF", description: "A doctor ordered tests.", title: T("New lab order"), message: T("{patient}: {tests}.") },
  LAB_SAMPLE_COLLECTED: { label: "Sample collected", category: "LAB", priority: "NORMAL", audience: ["LAB_STAFF"], defaultOn: true, for: "STAFF", description: "A sample is waiting to be received and processed.", title: T("Sample collected"), message: T("{patient} — order {number}.") },
  LAB_SAMPLE_REJECTED: { label: "Sample rejected", category: "LAB", priority: "HIGH", audience: ["@doctor", "CLINIC_ADMIN"], defaultOn: true, for: "STAFF", description: "The lab rejected a sample.", title: T("Sample rejected"), message: T("{patient} — order {number}. A new sample is needed.") },
  LAB_REPORT_RELEASED: { label: "Report ready for review", category: "LAB", priority: "HIGH", audience: ["@doctor"], defaultOn: true, for: "STAFF", description: "A released report is waiting for the doctor's review.", title: T("Lab report ready for review"), message: T("{patient} — {number}.") },
  LAB_REPORT_AVAILABLE: { label: "Lab report available", category: "LAB", priority: "NORMAL", audience: ["@patient"], defaultOn: true, for: "PATIENT", description: "A released report is in the portal.", title: T("Your lab report is ready"), message: T("{number}"), comm: "LAB_REPORT_RELEASED" },
  LAB_REPORT_AMENDED: { label: "Report amended", category: "LAB", priority: "HIGH", audience: ["@doctor", "@patient"], defaultOn: true, for: "STAFF", description: "A released report was corrected and re-released.", title: T("Lab report updated"), message: T("{number} has a new version.") },
  FOLLOWUP_CREATED: { label: "Follow-up assigned", category: "FOLLOWUP", priority: "NORMAL", audience: ["@assignee"], defaultOn: true, for: "STAFF", description: "A follow-up was assigned to you.", title: T("Follow-up assigned"), message: T("{patient} — due {date}.") },
  FOLLOWUP_REMINDER: { label: "Follow-up reminder", category: "FOLLOWUP", priority: "LOW", audience: ["@patient"], defaultOn: true, for: "PATIENT", description: "Reminder that a follow-up is due.", title: T("A follow-up visit is due"), message: T("Due {date}."), comm: "FOLLOW_UP_REMINDER" },
  FOLLOWUP_OVERDUE: { label: "Follow-ups overdue", category: "FOLLOWUP", priority: "NORMAL", audience: ["CLINIC_ADMIN"], defaultOn: true, for: "STAFF", description: "Daily note when follow-ups are overdue.", title: T("Follow-ups overdue"), message: T("{count} follow-up(s) are overdue.") },
  INVOICE_ISSUED: { label: "Bill issued", category: "BILLING", priority: "LOW", audience: ["ACCOUNTANT"], defaultOn: false, for: "STAFF", description: "A bill was issued.", title: T("Bill issued"), message: T("{number} — {patient}.") },
  INVOICE_AVAILABLE: { label: "New bill", category: "BILLING", priority: "NORMAL", audience: ["@patient"], defaultOn: true, for: "PATIENT", description: "A bill is in the portal.", title: T("A new bill was issued"), message: T("{number}"), comm: "INVOICE_CREATED" },
  PAYMENT_RECEIVED: { label: "Payment received", category: "BILLING", priority: "NORMAL", audience: ["ACCOUNTANT"], defaultOn: true, for: "STAFF", description: "A payment was recorded.", title: T("Payment received"), message: T("{amount} from {patient} ({number}).") },
  PAYMENT_CONFIRMED: { label: "Payment confirmed", category: "BILLING", priority: "NORMAL", audience: ["@patient"], defaultOn: true, for: "PATIENT", description: "The patient's payment was recorded.", title: T("Payment received"), message: T("Receipt {number}."), comm: "PAYMENT_SUCCESS" },
  REFUND_REQUESTED: { label: "Refund requested", category: "BILLING", priority: "HIGH", audience: ["ACCOUNTANT", "CLINIC_ADMIN"], defaultOn: true, for: "STAFF", description: "A refund needs approval.", title: T("Refund requested"), message: T("{amount} for {patient}.") },
  INVOICE_OVERDUE: { label: "Bills overdue", category: "BILLING", priority: "NORMAL", audience: ["ACCOUNTANT", "CLINIC_ADMIN"], defaultOn: true, for: "STAFF", description: "Daily note when bills are past due.", title: T("Overdue bills"), message: T("{count} bill(s) are overdue.") },
  SUBSCRIPTION_TRIAL_STARTED: { label: "Trial started", category: "BILLING", priority: "NORMAL", audience: ["CLINIC_ADMIN"], defaultOn: true, for: "STAFF", description: "Your MECGURA HEALTH trial began.", title: T("Your trial has started"), message: T("{plan}: trial ends {date}.") },
  SUBSCRIPTION_TRIAL_ENDING: { label: "Trial ending", category: "BILLING", priority: "HIGH", audience: ["CLINIC_ADMIN"], defaultOn: true, for: "STAFF", description: "The trial is about to end.", title: T("Your trial is ending"), message: T("{plan}: trial ends {date}. Choose a plan to continue without interruption.") },
  SUBSCRIPTION_TRIAL_ENDED: { label: "Trial ended", category: "BILLING", priority: "HIGH", audience: ["CLINIC_ADMIN"], defaultOn: true, for: "STAFF", description: "The trial ended without a paid plan.", title: T("Your trial has ended"), message: T("Choose a plan to continue. Your data is safe.") },
  SUBSCRIPTION_ACTIVATED: { label: "Subscription activated", category: "BILLING", priority: "NORMAL", audience: ["CLINIC_ADMIN"], defaultOn: true, for: "STAFF", description: "A subscription became active after payment.", title: T("Subscription active"), message: T("{plan} is active until {date}.") },
  SUBSCRIPTION_INVOICE_ISSUED: { label: "Subscription invoice issued", category: "BILLING", priority: "NORMAL", audience: ["CLINIC_ADMIN"], defaultOn: true, for: "STAFF", description: "A MECGURA HEALTH invoice needs payment.", title: T("Subscription invoice issued"), message: T("{number}: {amount}, due {date}.") },
  SUBSCRIPTION_RENEWAL_UPCOMING: { label: "Renewal coming up", category: "BILLING", priority: "NORMAL", audience: ["CLINIC_ADMIN"], defaultOn: true, for: "STAFF", description: "The subscription renews soon.", title: T("Subscription renews soon"), message: T("{number}: {amount}, due {date}.") },
  SUBSCRIPTION_PAYMENT_SUCCEEDED: { label: "Subscription payment received", category: "BILLING", priority: "NORMAL", audience: ["CLINIC_ADMIN"], defaultOn: true, for: "STAFF", description: "A subscription payment was confirmed.", title: T("Payment received"), message: T("{amount} for {number}. Receipt {receipt}.") },
  SUBSCRIPTION_PAYMENT_FAILED: { label: "Subscription payment failed", category: "BILLING", priority: "URGENT", audience: ["CLINIC_ADMIN"], defaultOn: true, for: "STAFF", description: "A subscription payment did not go through.", title: T("Subscription payment failed"), message: T("{number}: {amount}. Please pay again to avoid interruption.") },
  SUBSCRIPTION_PAYMENT_OVERDUE: { label: "Subscription payment overdue", category: "BILLING", priority: "URGENT", audience: ["CLINIC_ADMIN"], defaultOn: true, for: "STAFF", description: "A subscription invoice passed its due date.", title: T("Subscription payment overdue"), message: T("{number}: {amount} was due {date}. Pay now to avoid interruption.") },
  SUBSCRIPTION_GRACE_STARTED: { label: "Grace period started", category: "BILLING", priority: "URGENT", audience: ["CLINIC_ADMIN"], defaultOn: true, for: "STAFF", description: "Payment is overdue; the grace period began.", title: T("Payment overdue — grace period"), message: T("Pay {number} by {date} to keep full access.") },
  SUBSCRIPTION_SUSPENDED: { label: "Subscription suspended", category: "BILLING", priority: "CRITICAL", audience: ["CLINIC_ADMIN"], defaultOn: true, for: "STAFF", description: "The subscription was suspended.", title: T("Subscription suspended"), message: T("Pay {number} to restore access. Your data is safe.") },
  SUBSCRIPTION_REACTIVATED: { label: "Subscription reactivated", category: "BILLING", priority: "NORMAL", audience: ["CLINIC_ADMIN"], defaultOn: true, for: "STAFF", description: "Access was restored.", title: T("Subscription reactivated"), message: T("{plan} is active again.") },
  SUBSCRIPTION_CANCELLED: { label: "Subscription cancelled", category: "BILLING", priority: "HIGH", audience: ["CLINIC_ADMIN"], defaultOn: true, for: "STAFF", description: "The subscription was cancelled or is set to end.", title: T("Subscription cancellation"), message: T("{plan}: access until {date}.") },
  SUBSCRIPTION_LIMIT_WARNING: { label: "Plan limit warning", category: "BILLING", priority: "HIGH", audience: ["CLINIC_ADMIN"], defaultOn: true, for: "STAFF", description: "Usage reached 80%, 90% or 100% of a plan limit.", title: T("Plan limit {level}%"), message: T("{limit}: {used} of {max} used.") },
  SUBSCRIPTION_PLAN_UPGRADED: { label: "Plan upgraded", category: "BILLING", priority: "NORMAL", audience: ["CLINIC_ADMIN"], defaultOn: true, for: "STAFF", description: "The plan was upgraded.", title: T("Plan upgraded"), message: T("You are now on {plan}.") },
  SUBSCRIPTION_PLAN_DOWNGRADED: { label: "Plan downgrade scheduled", category: "BILLING", priority: "NORMAL", audience: ["CLINIC_ADMIN"], defaultOn: true, for: "STAFF", description: "A downgrade was scheduled or applied.", title: T("Plan change"), message: T("{plan} starts {date}.") },
  SUBSCRIPTION_REFUND: { label: "Subscription refund", category: "BILLING", priority: "NORMAL", audience: ["CLINIC_ADMIN"], defaultOn: true, for: "STAFF", description: "A subscription refund was processed.", title: T("Refund processed"), message: T("{amount} for {number}.") },
  STOCK_LOW: { label: "Medicines low", category: "PHARMACY", priority: "HIGH", audience: ["PHARMACY_MANAGER", "PHARMACY_STAFF"], defaultOn: true, for: "STAFF", description: "Medicines are at or below their reorder level.", title: T("Medicines running low"), message: T("{count} medicine(s) are below the reorder level.") },
  STOCK_OUT: { label: "Medicines out of stock", category: "PHARMACY", priority: "URGENT", audience: ["PHARMACY_MANAGER", "CLINIC_ADMIN"], defaultOn: true, for: "STAFF", description: "Medicines have no sellable stock.", title: T("Medicines out of stock"), message: T("{count} medicine(s) have no sellable stock.") },
  BATCH_EXPIRING: { label: "Batches expiring", category: "PHARMACY", priority: "NORMAL", audience: ["PHARMACY_MANAGER"], defaultOn: true, for: "STAFF", description: "Batches reach their expiry soon.", title: T("Batches expiring soon"), message: T("{count} batch(es) expire within {days} days.") },
  BATCH_EXPIRED: { label: "Batches expired", category: "PHARMACY", priority: "HIGH", audience: ["PHARMACY_MANAGER", "CLINIC_ADMIN"], defaultOn: true, for: "STAFF", description: "Expired stock is still on the shelf.", title: T("Expired stock on hand"), message: T("{count} expired batch(es) still have stock.") },
  PURCHASE_RECEIVED: { label: "Purchase received", category: "PHARMACY", priority: "LOW", audience: ["PHARMACY_MANAGER"], defaultOn: false, for: "STAFF", description: "A purchase was received into stock.", title: T("Purchase received"), message: T("{number}") },
  SECURITY_NEW_LOGIN: { label: "New sign-in", category: "SECURITY", priority: "LOW", audience: ["@self"], defaultOn: false, for: "STAFF", description: "Someone signed in to your account.", title: T("New sign-in to your account"), message: T("If this wasn't you, change your password.") },
  PASSWORD_CHANGED: { label: "Password changed", category: "SECURITY", priority: "HIGH", audience: ["@self"], defaultOn: true, for: "STAFF", description: "Your password was changed.", title: T("Your password was changed"), message: T("If this wasn't you, contact your clinic admin immediately.") },
  ACCOUNT_LOCKED: { label: "Account locked", category: "SECURITY", priority: "CRITICAL", audience: ["@self", "CLINIC_ADMIN"], defaultOn: true, for: "STAFF", description: "Too many failed sign-ins locked an account.", title: T("Account locked"), message: T("{who} was locked after repeated failed sign-ins.") },
  ROLE_CHANGED: { label: "Role changed", category: "SECURITY", priority: "HIGH", audience: ["@self", "CLINIC_ADMIN"], defaultOn: true, for: "STAFF", description: "A user's role was changed.", title: T("Role changed"), message: T("{who}: now {role}.") },
  PATIENT_SECURITY: { label: "Portal security alert", category: "SECURITY", priority: "HIGH", audience: ["@patient"], defaultOn: true, for: "PATIENT", description: "Password changed or sessions ended on the patient's portal account.", title: T("Security alert"), message: T("{event}. If this wasn't you, call the clinic."), comm: "ACCOUNT_SECURITY_ALERT" },
  PROVIDER_FAILURE: { label: "Messaging provider problem", category: "SYSTEM", priority: "HIGH", audience: ["CLINIC_ADMIN"], defaultOn: true, for: "STAFF", description: "Messages are failing because of a provider problem.", title: T("Messaging provider problem"), message: T("{count} {channel} message(s) failed in the last hour ({code}).") },
  SCHEDULER_STALE: { label: "Scheduler not running", category: "SYSTEM", priority: "CRITICAL", audience: ["SUPER_ADMIN"], defaultOn: true, for: "STAFF", description: "The reminder / retry scheduler has not run.", title: T("Scheduler is not running"), message: T("The scheduler endpoint was not called for {minutes} minutes. Reminders and retries are paused.") },
  QUEUE_BACKLOG: { label: "Message queue backlog", category: "SYSTEM", priority: "HIGH", audience: ["SUPER_ADMIN"], defaultOn: true, for: "STAFF", description: "Many messages are overdue to send.", title: T("Message queue backlog"), message: T("{count} message(s) are overdue to send.") },
  NOTIFICATION_ESCALATED: { label: "Not acknowledged", category: "SYSTEM", priority: "URGENT", audience: ["CLINIC_ADMIN"], defaultOn: true, for: "STAFF", description: "An important notification was not acknowledged in time.", title: T("Not acknowledged in time"), message: T("{what} — {who} has not acknowledged it after {minutes} minutes.") },
  DAILY_DIGEST: { label: "Daily summary", category: "GENERAL", priority: "LOW", audience: ["@self"], defaultOn: true, for: "STAFF", description: "Your day in numbers (opt-in).", title: T("Today's summary"), message: T("{summary}") },
} as const satisfies Record<string, NDef>;
export type NType = keyof typeof TYPES;
export const TYPE_KEYS = Object.keys(TYPES) as NType[];
export const isType = (v: unknown): v is NType => typeof v === "string" && v in TYPES;
export const def = (t: string): NDef | null => (isType(t) ? (TYPES[t] as NDef) : null);

/** Category for rows created before Phase 12 (they only have a free-text `type`). */
const LEGACY: [RegExp, NCategory][] = [[/^(appointment|a_)/i, "APPOINTMENT"], [/report|lab|sample/i, "LAB"], [/follow|recall/i, "FOLLOWUP"], [/invoice|payment|bill/i, "BILLING"], [/prescription/i, "CLINICAL"]];
export function categoryOfType(type: string, stored?: string | null): NCategory {
  if (stored && stored !== "GENERAL" && (CATEGORIES as readonly string[]).includes(stored)) return stored as NCategory;
  const d = def(type); if (d) return d.category;
  return LEGACY.find(([re]) => re.test(type))?.[1] ?? "GENERAL";
}

/** Which permission a staff member needs before an entity link is offered. */
export const ENTITY_PERMISSION: Record<string, string> = { appointment: "appointments.view", patient: "patients.view", opd_visit: "opd.view", lab_order: "tests.view", lab_report: "reports.view", followup: "followups.view", invoice: "billing.view", payment: "billing.view", prescription: "prescription.view", medicine: "pharmacy.view", purchase: "pharmacy.view", user: "users.view", consultation: "consultation.view", dispensing: "pharmacy.view" };
/** Staff link for an entity (patients get portal links built where the notification is created). */
export function staffHref(entityType: string | null | undefined, entityId: string | null | undefined, patientId?: string | null): string | null {
  const id = entityId ? encodeURIComponent(entityId) : null;
  switch (entityType) {
    case "appointment": return "/appointments"; case "opd_visit": return "/opd"; case "patient": return id ? `/patients/${id}` : "/patients";
    case "lab_order": return id ? `/lab/orders/${id}` : "/lab"; case "lab_report": return id ? `/lab/reports/${id}` : "/lab"; case "followup": return id ? `/followups/${id}` : "/followups";
    case "invoice": return id ? `/billing/invoices/${id}` : "/billing"; case "payment": return "/billing/payments"; case "prescription": return patientId ? `/patients/${encodeURIComponent(patientId)}` : null;
    case "medicine": return "/pharmacy/stock"; case "purchase": return "/pharmacy/purchases"; case "user": return id ? `/team/${id}` : "/team"; case "stock": return "/pharmacy/stock"; case "expiry": return "/pharmacy/expiry";
    case "patient_request": return "/patients/requests"; case "communications": return "/communications"; default: return null;
  }
}
/** Only in-app paths are ever stored or followed. */
export const safeActionUrl = (u: string | null | undefined): string | null => (u && /^\/[A-Za-z0-9._~/\-?=&%#]*$/.test(u) && !u.startsWith("//") && u.length <= 300 ? u : null);

export const FILTER_CATEGORIES: { key: string; label: string; categories: NCategory[] }[] = [
  { key: "appointments", label: "Appointments", categories: ["APPOINTMENT"] }, { key: "opd", label: "OPD", categories: ["OPD"] }, { key: "patients", label: "Patients", categories: ["PATIENT"] }, { key: "lab", label: "Lab", categories: ["LAB"] },
  { key: "clinical", label: "Prescriptions", categories: ["CLINICAL"] }, { key: "followups", label: "Follow-ups", categories: ["FOLLOWUP"] }, { key: "billing", label: "Billing", categories: ["BILLING"] }, { key: "pharmacy", label: "Pharmacy", categories: ["PHARMACY"] },
  { key: "security", label: "Security", categories: ["SECURITY"] }, { key: "system", label: "System", categories: ["SYSTEM", "GENERAL"] },
];
