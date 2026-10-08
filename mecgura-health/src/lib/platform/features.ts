import { PERMISSIONS, type Permission } from "@/lib/permissions/constants";

/**
 * Clinic feature switches (Phase 14). A switch hides AND blocks: disabled features lose their permissions server-side
 * (see applyFeatureGates), so no page, API or service guard can be reached from the browser. Disabling never deletes data.
 */
export interface FeatureDef { key: string; label: string; group: "Clinical" | "Operations" | "Patients" | "Channels" | "Insights"; description: string; /** permission modules this switch controls */ modules: readonly string[]; /** channel / portal switches are enforced where the feature runs, not through permissions */ enforcedAt?: "portal" | "channel"; channel?: "WHATSAPP" | "SMS" | "EMAIL"; /** switching this off cripples other modules */ critical?: boolean }
export const FEATURES: readonly FeatureDef[] = [
  { key: "appointments", label: "Appointments", group: "Operations", description: "Booking, calendar and schedules.", modules: ["appointments"] },
  { key: "liveOPD", label: "Live OPD", group: "Operations", description: "Check-in, tokens and the live queue.", modules: ["opd"] },
  { key: "patientCRM", label: "Patient CRM", group: "Patients", description: "Patient records and files. Most other modules depend on it.", modules: ["patients"], critical: true },
  { key: "consultation", label: "Consultation & prescriptions", group: "Clinical", description: "Consultations, prescriptions and doctor orders.", modules: ["consultations", "prescriptions"] },
  { key: "lab", label: "Laboratory", group: "Clinical", description: "Investigations, samples and lab reports.", modules: ["tests"] },
  { key: "followUp", label: "Follow-ups", group: "Operations", description: "Follow-up CRM and recalls.", modules: ["followups"] },
  { key: "billing", label: "Billing", group: "Operations", description: "Invoices, payments and refunds.", modules: ["billing"] },
  { key: "pharmacy", label: "Pharmacy & inventory", group: "Operations", description: "Medicines, stock and dispensing.", modules: ["inventory"] },
  { key: "patientPortal", label: "Patient portal", group: "Patients", description: "Patient login, bookings and records access.", modules: [], enforcedAt: "portal" },
  { key: "whatsapp", label: "WhatsApp messages", group: "Channels", description: "Outgoing WhatsApp to patients.", modules: [], enforcedAt: "channel", channel: "WHATSAPP" },
  { key: "sms", label: "SMS messages", group: "Channels", description: "Outgoing SMS to patients.", modules: [], enforcedAt: "channel", channel: "SMS" },
  { key: "email", label: "Email messages", group: "Channels", description: "Outgoing email to patients.", modules: [], enforcedAt: "channel", channel: "EMAIL" },
  { key: "analytics", label: "Analytics & reports", group: "Insights", description: "Analytics, Report Center and exports.", modules: ["analytics"] },
];
export const FEATURE_KEYS = FEATURES.map((f) => f.key);
export const isFeatureKey = (k: unknown): k is string => typeof k === "string" && FEATURE_KEYS.includes(k);
export const featureDef = (k: string) => FEATURES.find((f) => f.key === k);

/** Permission modules switched off by the given disabled feature keys. */
export function disabledModules(disabled: Iterable<string>): Set<string> {
  const out = new Set<string>(); const off = new Set(disabled);
  for (const f of FEATURES) if (off.has(f.key)) for (const m of f.modules) out.add(m);
  return out;
}
/** The single server-side gate: drop every permission whose module is switched off for this clinic. */
export function applyFeatureGates(perms: ReadonlySet<Permission>, disabled: Iterable<string>): ReadonlySet<Permission> {
  const off = disabledModules(disabled); if (!off.size) return perms;
  return new Set([...perms].filter((p) => !off.has(PERMISSIONS[p].module)));
}
