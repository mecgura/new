/** Clinic lifecycle rules (pure). Clinics are never deleted: they move between these states and every move is recorded. */
export const LIFECYCLE_ACTIONS = ["activate", "suspend", "deactivate", "archive", "restore"] as const;
export type LifecycleAction = (typeof LIFECYCLE_ACTIONS)[number];
export const REASON_CATEGORIES = ["ADMINISTRATIVE", "SECURITY", "TECHNICAL", "CONTRACTUAL", "OTHER"] as const;
export type ReasonCategory = (typeof REASON_CATEGORIES)[number];

/** action -> allowed source statuses and the status it leads to */
export const TRANSITIONS: Record<LifecycleAction, { from: readonly string[]; to: string; reasonRequired: boolean; sensitive: boolean; impact: string }> = {
  activate: { from: ["PENDING", "SUSPENDED", "INACTIVE", "TRIAL"], to: "ACTIVE", reasonRequired: false, sensitive: false, impact: "Clinic users and patients can sign in and use the clinic's workspace, website and portal again." },
  suspend: { from: ["ACTIVE", "TRIAL"], to: "SUSPENDED", reasonRequired: true, sensitive: true, impact: "Suspending this clinic prevents its staff and patients from signing in, stops its public website and new bookings, and holds outgoing messages. All clinical data and audit history are preserved." },
  deactivate: { from: ["ACTIVE", "TRIAL", "SUSPENDED"], to: "INACTIVE", reasonRequired: true, sensitive: true, impact: "The clinic is switched off like a suspension but marked as no longer operating. All data is preserved and it can be reactivated." },
  archive: { from: ["SUSPENDED", "INACTIVE", "PENDING"], to: "ARCHIVED", reasonRequired: true, sensitive: true, impact: "Archiving removes the clinic from normal use and routing. Nothing is deleted; a Super Admin can restore it." },
  restore: { from: ["ARCHIVED"], to: "INACTIVE", reasonRequired: true, sensitive: true, impact: "The clinic returns from the archive as Inactive. Activate it afterwards to let users sign in." },
};
export function planTransition(action: string, current: string): { ok: true; to: string; def: (typeof TRANSITIONS)[LifecycleAction] } | { ok: false; message: string } {
  if (!(LIFECYCLE_ACTIONS as readonly string[]).includes(action)) return { ok: false, message: "Unknown action." };
  const def = TRANSITIONS[action as LifecycleAction];
  if (!def.from.includes(current)) return { ok: false, message: `A clinic that is ${current.toLowerCase()} can't be moved this way.` };
  return { ok: true, to: def.to, def };
}

/* ---------------------------------------------------- setup checklist ---------------------------------------------------- */
export interface SetupFacts {
  name: string | null; clinicType: string | null; contactEmail: string | null; contactPhone: string | null; timezone: string | null;
  activeAdmins: number; hasLogo: boolean; hasBrandColors: boolean; subdomain: string | null; customDomain: string | null; customDomainVerified: boolean;
  doctors: number; schedules: number; anyChannelUsable: boolean; portalEnabled: boolean; websiteEnabled: boolean;
}
export interface SetupItem { key: string; label: string; done: boolean; /** required to activate */ required: boolean; hint: string }
export function setupChecklist(f: SetupFacts): { items: SetupItem[]; done: number; total: number; requiredMissing: SetupItem[] } {
  const items: SetupItem[] = [
    { key: "basic", label: "Basic information", done: !!f.name && !!f.clinicType && (!!f.contactEmail || !!f.contactPhone), required: true, hint: "Name, type and a contact email or phone." },
    { key: "admin", label: "Admin account", done: f.activeAdmins > 0, required: true, hint: "At least one active Clinic Admin (the invitation must be accepted)." },
    { key: "timezone", label: "Timezone", done: !!f.timezone, required: true, hint: "Dates and reports follow the clinic timezone." },
    { key: "branding", label: "Branding", done: f.hasLogo || f.hasBrandColors, required: true, hint: "A logo or brand colours." },
    { key: "domain", label: "Domain", done: !!f.subdomain || f.customDomainVerified, required: true, hint: "A clinic subdomain, or a verified custom domain." },
    { key: "doctor", label: "Doctor added", done: f.doctors > 0, required: false, hint: "At least one doctor." },
    { key: "schedule", label: "Appointment settings", done: f.schedules > 0, required: false, hint: "A doctor schedule so patients can book." },
    { key: "comms", label: "Communication channel", done: f.anyChannelUsable, required: false, hint: "A channel switched on by the clinic AND configured on the server." },
    { key: "portal", label: "Patient portal", done: f.portalEnabled, required: false, hint: "Portal enabled for patients." },
  ];
  return { items, done: items.filter((i) => i.done).length, total: items.length, requiredMissing: items.filter((i) => i.required && !i.done) };
}
