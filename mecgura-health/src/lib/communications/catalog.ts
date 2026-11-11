/**
 * What the communication engine can say, and when. Pure data — no I/O.
 * Only events that are actually wired to a trigger are listed; nothing here pretends to send.
 */
export const CHANNELS = ["WHATSAPP", "SMS", "EMAIL"] as const;
export type Channel = (typeof CHANNELS)[number];
export const CHANNEL_LABEL: Record<Channel, string> = { WHATSAPP: "WhatsApp", SMS: "SMS", EMAIL: "Email" };

export const CATEGORIES = ["TRANSACTIONAL", "SECURITY", "MARKETING"] as const;
export type Category = (typeof CATEGORIES)[number];
export const PRIORITIES = ["LOW", "NORMAL", "HIGH", "CRITICAL"] as const;
export type Priority = (typeof PRIORITIES)[number];
export const LANGUAGES = ["en", "hi", "pa"] as const;
export type Language = (typeof LANGUAGES)[number];
export const LANGUAGE_LABEL: Record<Language, string> = { en: "English", hi: "हिन्दी (Hindi)", pa: "ਪੰਜਾਬੀ (Punjabi)" };

/** Message statuses. SKIPPED = the engine decided NOT to send (reason in failureCode) — kept so staff can see why nothing went out. */
export const MESSAGE_STATUSES = ["QUEUED", "PROCESSING", "RETRYING", "SENT", "DELIVERED", "READ", "FAILED", "CANCELLED", "SKIPPED"] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];
export const STATUS_RANK: Record<string, number> = { QUEUED: 0, PROCESSING: 1, RETRYING: 1, SENT: 2, DELIVERED: 3, READ: 4 };

/** "appointments | followUps | billing | reports | general" = the patient's own category switches (Phase 10 preferences). */
export type PatientPref = "appointments" | "followUps" | "billing" | "reports" | "general";
/** Which staff roles may see messages of the event's group in the log. */
export type StaffGroup = "APPOINTMENT" | "OPD" | "PRESCRIPTION" | "LAB" | "FOLLOWUP" | "BILLING" | "ACCOUNT";

export interface EventDef { label: string; category: Category; priority: Priority; pref: PatientPref; group: StaffGroup; defaultOn: boolean; /** staff may resend */ resendable: boolean; description: string }

export const EVENTS = {
  APPOINTMENT_REQUESTED: { label: "Appointment requested", category: "TRANSACTIONAL", priority: "NORMAL", pref: "appointments", group: "APPOINTMENT", defaultOn: true, resendable: true, description: "Patient asked for an appointment that the clinic still has to confirm." },
  APPOINTMENT_CONFIRMED: { label: "Appointment confirmed", category: "TRANSACTIONAL", priority: "NORMAL", pref: "appointments", group: "APPOINTMENT", defaultOn: true, resendable: true, description: "Appointment is booked / confirmed." },
  APPOINTMENT_RESCHEDULED: { label: "Appointment rescheduled", category: "TRANSACTIONAL", priority: "HIGH", pref: "appointments", group: "APPOINTMENT", defaultOn: true, resendable: true, description: "Appointment moved to a new time or doctor." },
  APPOINTMENT_CANCELLED: { label: "Appointment cancelled", category: "TRANSACTIONAL", priority: "HIGH", pref: "appointments", group: "APPOINTMENT", defaultOn: true, resendable: true, description: "Appointment was cancelled." },
  APPOINTMENT_REMINDER: { label: "Appointment reminder", category: "TRANSACTIONAL", priority: "NORMAL", pref: "appointments", group: "APPOINTMENT", defaultOn: true, resendable: true, description: "Sent before the appointment, at the intervals the clinic chooses." },
  OPD_CHECKED_IN: { label: "OPD check-in / token", category: "TRANSACTIONAL", priority: "LOW", pref: "appointments", group: "OPD", defaultOn: false, resendable: false, description: "Token number when the patient is registered in the live queue." },
  OPD_CALLED: { label: "OPD — your turn", category: "TRANSACTIONAL", priority: "HIGH", pref: "appointments", group: "OPD", defaultOn: false, resendable: false, description: "Patient's number has been called." },
  PRESCRIPTION_AVAILABLE: { label: "Prescription available", category: "TRANSACTIONAL", priority: "NORMAL", pref: "reports", group: "PRESCRIPTION", defaultOn: true, resendable: true, description: "A finalized prescription is in the patient portal." },
  LAB_REPORT_RELEASED: { label: "Lab report available", category: "TRANSACTIONAL", priority: "NORMAL", pref: "reports", group: "LAB", defaultOn: true, resendable: true, description: "A released lab report is in the patient portal. Results are never sent in the message." },
  FOLLOW_UP_CREATED: { label: "Follow-up planned", category: "TRANSACTIONAL", priority: "LOW", pref: "followUps", group: "FOLLOWUP", defaultOn: false, resendable: false, description: "A follow-up was planned for the patient." },
  FOLLOW_UP_REMINDER: { label: "Follow-up reminder", category: "TRANSACTIONAL", priority: "NORMAL", pref: "followUps", group: "FOLLOWUP", defaultOn: true, resendable: true, description: "Reminder that a follow-up is due (no clinical advice)." },
  FOLLOW_UP_OVERDUE: { label: "Follow-up overdue", category: "TRANSACTIONAL", priority: "LOW", pref: "followUps", group: "FOLLOWUP", defaultOn: false, resendable: false, description: "Gentle nudge for a follow-up that was missed." },
  INVOICE_CREATED: { label: "Bill issued", category: "TRANSACTIONAL", priority: "NORMAL", pref: "billing", group: "BILLING", defaultOn: true, resendable: true, description: "A bill was issued. Payment happens at the clinic or in the portal when available." },
  INVOICE_DUE: { label: "Bill due", category: "TRANSACTIONAL", priority: "LOW", pref: "billing", group: "BILLING", defaultOn: false, resendable: false, description: "Bill reaches its due date." },
  INVOICE_OVERDUE: { label: "Bill overdue", category: "TRANSACTIONAL", priority: "LOW", pref: "billing", group: "BILLING", defaultOn: false, resendable: false, description: "Bill is past its due date." },
  PAYMENT_SUCCESS: { label: "Payment received / receipt", category: "TRANSACTIONAL", priority: "NORMAL", pref: "billing", group: "BILLING", defaultOn: true, resendable: true, description: "A payment was recorded; the receipt is in the portal." },
  PATIENT_ACCOUNT_ACTIVATED: { label: "Portal account activated", category: "SECURITY", priority: "HIGH", pref: "general", group: "ACCOUNT", defaultOn: true, resendable: false, description: "Patient portal account was activated or its access was reset." },
  ACCOUNT_SECURITY_ALERT: { label: "Account security alert", category: "SECURITY", priority: "HIGH", pref: "general", group: "ACCOUNT", defaultOn: true, resendable: false, description: "Password changed, sessions ended or access reset on the patient's portal account. Never contains a code or password." },
  CLINIC_ANNOUNCEMENT: { label: "Clinic announcement", category: "MARKETING", priority: "LOW", pref: "general", group: "ACCOUNT", defaultOn: false, resendable: false, description: "Non-essential announcements. Needs the patient's explicit opt-in. (Foundation only — no campaign tool in this phase.)" },
} as const satisfies Record<string, EventDef>;
export type EventType = keyof typeof EVENTS;
export const EVENT_TYPES = Object.keys(EVENTS) as EventType[];
export const isEventType = (v: unknown): v is EventType => typeof v === "string" && v in EVENTS;
export const isChannel = (v: unknown): v is Channel => typeof v === "string" && (CHANNELS as readonly string[]).includes(v);

/** Variables a template may use. Anything else is rejected when the template is saved and rendered as empty. */
export const VARIABLES = {
  patient_name: "Patient's first name", clinic_name: "Clinic name", clinic_phone: "Clinic phone", clinic_address: "Clinic address", doctor_name: "Doctor's name",
  appointment_date: "Appointment date", appointment_time: "Appointment time", appointment_type: "Appointment type", appointment_id: "Appointment booking id",
  token_number: "OPD token number", prescription_number: "Prescription number", report_number: "Lab report number", invoice_number: "Bill number",
  receipt_number: "Receipt number", amount_due: "Amount due", amount_paid: "Amount paid", payment_date: "Payment date", follow_up_date: "Follow-up date",
  security_event: "What happened (e.g. password changed)", portal_link: "Secure portal link",
} as const;
export type VarName = keyof typeof VARIABLES;
export const VAR_NAMES = Object.keys(VARIABLES) as VarName[];

/** Limits per channel (rendered text). SMS up to 3 segments; WhatsApp body limit of the Cloud API template body is 1024. */
export const LIMITS: Record<Channel, { body: number; subject: number }> = { SMS: { body: 480, subject: 0 }, WHATSAPP: { body: 1024, subject: 0 }, EMAIL: { body: 5000, subject: 150 } };

export const SAMPLE_VARS: Record<VarName, string> = {
  patient_name: "Gurjeet", clinic_name: "Demo Clinic", clinic_phone: "+91 98765 43210", clinic_address: "1 Sample Road, Sampletown", doctor_name: "Dr. Example",
  appointment_date: "12 October 2026", appointment_time: "10:30 AM", appointment_type: "Consultation", appointment_id: "APT-SAMPLE", token_number: "07",
  prescription_number: "RX-2026-000001", report_number: "LAB-2026-000001", invoice_number: "INV-2026-000001", receipt_number: "REC-2026-000001", amount_due: "₹500.00",
  amount_paid: "₹500.00", payment_date: "12 Oct 2026", follow_up_date: "19 October 2026", security_event: "your password was changed", portal_link: "https://clinic.example/portal/login",
};

export const REMINDER_CHOICES = [30, 60, 120, 240, 720, 1440, 2880] as const;
