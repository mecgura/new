/** Internal data sensitivity classes. Used to decide logging, export and monitoring behaviour; healthcare data is treated as highly sensitive by default. */
export const SENSITIVITY = ["PUBLIC", "INTERNAL", "CONFIDENTIAL", "SENSITIVE", "HIGHLY_SENSITIVE"] as const;
export type Sensitivity = (typeof SENSITIVITY)[number];
const MAP: Record<string, Sensitivity> = {
  website: "PUBLIC", branding: "PUBLIC", service: "PUBLIC",
  appointment: "SENSITIVE", opd: "SENSITIVE", followup: "SENSITIVE", notification: "CONFIDENTIAL", communication: "SENSITIVE",
  patient: "HIGHLY_SENSITIVE", consultation: "HIGHLY_SENSITIVE", prescription: "HIGHLY_SENSITIVE", lab: "HIGHLY_SENSITIVE", report: "HIGHLY_SENSITIVE", allergy: "HIGHLY_SENSITIVE", medical: "HIGHLY_SENSITIVE", dispensing: "SENSITIVE",
  invoice: "CONFIDENTIAL", payment: "CONFIDENTIAL", subscription: "CONFIDENTIAL", pharmacy: "CONFIDENTIAL", analytics: "CONFIDENTIAL",
  audit: "CONFIDENTIAL", user: "CONFIDENTIAL", security: "CONFIDENTIAL", apikey: "HIGHLY_SENSITIVE", mfa: "HIGHLY_SENSITIVE",
};
export const classify = (entity: string): Sensitivity => MAP[entity.toLowerCase().split(/[:._-]/)[0]] ?? "CONFIDENTIAL";
/** Exports of anything above CONFIDENTIAL deserve extra scrutiny (kept as a single rule so UI, logs and monitors agree). */
export const needsExtraScrutiny = (s: Sensitivity) => s === "SENSITIVE" || s === "HIGHLY_SENSITIVE";
