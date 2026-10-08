import { z } from "zod";
import { FEATURE_KEYS, FEATURES } from "@/lib/platform/features";

/**
 * Phase 15 vocabulary. Features are the SAME keys as the Phase 14 switches (one feature system, not two):
 * effective access = the plan allows it AND the Super Admin has not switched it off for that clinic.
 */
export const PLAN_FEATURE_KEYS: readonly string[] = FEATURE_KEYS;
export const PLAN_FEATURES = FEATURES;

export type LimitMode = "LIMITED" | "UNLIMITED" | "DISABLED";
export interface LimitDef { key: string; label: string; unit: string; /** "period" counts reset with the billing period; "stock" counts are current totals */ kind: "stock" | "period"; metered: boolean; description: string }
export const LIMITS: readonly LimitDef[] = [
  { key: "maxDoctors", label: "Doctors", unit: "doctors", kind: "stock", metered: true, description: "Doctor accounts that are not deactivated." },
  { key: "maxStaff", label: "Staff", unit: "staff", kind: "stock", metered: true, description: "Non-doctor staff accounts that are not deactivated." },
  { key: "maxPatients", label: "Patients", unit: "patients", kind: "stock", metered: true, description: "Active (not archived or deleted) patient records." },
  { key: "maxAppointmentsPerMonth", label: "Appointments / billing period", unit: "appointments", kind: "period", metered: true, description: "Appointments created during the current billing period." },
  { key: "maxStorageMb", label: "Storage", unit: "MB", kind: "stock", metered: true, description: "Files the platform stores for the clinic (logo, favicon and other uploads)." },
  { key: "maxWhatsAppMessages", label: "WhatsApp messages / billing period", unit: "messages", kind: "period", metered: true, description: "Patient WhatsApp messages accepted for sending in the billing period." },
  { key: "maxSmsMessages", label: "SMS / billing period", unit: "messages", kind: "period", metered: true, description: "Patient SMS accepted for sending in the billing period." },
  { key: "maxEmailMessages", label: "Email / billing period", unit: "messages", kind: "period", metered: true, description: "Patient emails accepted for sending in the billing period." },
  { key: "maxLocations", label: "Locations", unit: "locations", kind: "stock", metered: false, description: "Clinic locations. Multi-location management is not built yet, so this is recorded but not counted." },
];
export const LIMIT_KEYS = LIMITS.map((l) => l.key);
export const limitDef = (k: string) => LIMITS.find((l) => l.key === k);

export type PlanFeatures = Record<string, boolean>;
export type PlanLimits = Record<string, { mode: LimitMode; value?: number }>;
export const PLAN_STATUSES = ["DRAFT", "ACTIVE", "INACTIVE", "ARCHIVED"] as const;
export const BILLING_INTERVALS = ["MONTHLY", "YEARLY"] as const;
export type BillingInterval = (typeof BILLING_INTERVALS)[number];
export const CURRENCIES = ["INR"] as const; // architecture is currency-aware; only INR is offered today
export const MAX_PRICE_MINOR = 1_000_000_000; // ₹1 crore
export const MAX_TRIAL_DAYS = 90;

export const limitSchema = z.union([
  z.object({ mode: z.literal("LIMITED"), value: z.number().int().min(0).max(1_000_000_000) }),
  z.object({ mode: z.literal("UNLIMITED") }), z.object({ mode: z.literal("DISABLED") }),
]);
export const planInputSchema = z.object({
  name: z.string().trim().min(2).max(80), slug: z.string().trim().toLowerCase().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Use lowercase letters, numbers and hyphens.").min(2).max(40),
  description: z.string().trim().max(400).optional().or(z.literal("")), status: z.enum(PLAN_STATUSES).default("DRAFT"), currency: z.enum(CURRENCIES).default("INR"),
  monthlyPriceMinor: z.number().int().min(0).max(MAX_PRICE_MINOR), annualPriceMinor: z.number().int().min(0).max(MAX_PRICE_MINOR), setupFeeMinor: z.number().int().min(0).max(MAX_PRICE_MINOR).default(0),
  trialDays: z.number().int().min(0).max(MAX_TRIAL_DAYS).default(0), isPublic: z.boolean().default(false), sortOrder: z.number().int().min(0).max(10_000).default(0),
  supportLevel: z.string().trim().max(80).optional().or(z.literal("")),
  features: z.record(z.string(), z.boolean()), limits: z.record(z.string(), limitSchema),
});
export type PlanInput = z.infer<typeof planInputSchema>;

/** Fills every known feature/limit explicitly (missing feature = off, missing limit = unlimited is NOT assumed: it must be stated). */
export function normalizeFeatures(raw: Record<string, boolean>): PlanFeatures {
  const out: PlanFeatures = {}; for (const k of PLAN_FEATURE_KEYS) out[k] = raw[k] === true; return out;
}
export function normalizeLimits(raw: PlanLimits): PlanLimits {
  const out: PlanLimits = {}; for (const k of LIMIT_KEYS) out[k] = raw[k] ?? { mode: "UNLIMITED" }; return out;
}
export function validatePlanKeys(input: { features: Record<string, boolean>; limits: Record<string, unknown> }): string | null {
  for (const k of Object.keys(input.features)) if (!PLAN_FEATURE_KEYS.includes(k)) return `Unknown feature “${k}”.`;
  for (const k of Object.keys(input.limits)) if (!LIMIT_KEYS.includes(k)) return `Unknown limit “${k}”.`;
  return null;
}
export const parseJson = <T,>(s: string | null | undefined, d: T): T => { try { return s ? (JSON.parse(s) as T) : d; } catch { return d; } };

/** What a subscription remembers about its plan. Entitlements and prices come from THIS, so editing a plan never rewrites an existing customer. */
export interface PlanSnapshot { name: string; slug: string; version: number; features: PlanFeatures; limits: PlanLimits; setupFeeMinor: number; trialDays: number; monthlyPriceMinor: number; annualPriceMinor: number; currency: string }
export function snapshotOfPlan(p: { name: string; key: string; version: number; features: string; limits: string; setupFeeMinor: number; trialDays: number; monthlyPriceMinor: number; annualPriceMinor: number; currency: string }): PlanSnapshot {
  return { name: p.name, slug: p.key, version: p.version, features: normalizeFeatures(parseJson(p.features, {})), limits: normalizeLimits(parseJson(p.limits, {})), setupFeeMinor: p.setupFeeMinor, trialDays: p.trialDays, monthlyPriceMinor: p.monthlyPriceMinor, annualPriceMinor: p.annualPriceMinor, currency: p.currency };
}
export const priceFor = (p: { monthlyPriceMinor: number; annualPriceMinor: number }, interval: string) => (interval === "YEARLY" ? p.annualPriceMinor : p.monthlyPriceMinor);
/** annual saving versus 12 monthly payments, in minor units (never negative) */
export const annualSavingMinor = (p: { monthlyPriceMinor: number; annualPriceMinor: number }) => Math.max(0, p.monthlyPriceMinor * 12 - p.annualPriceMinor);
export function limitText(l: { mode: LimitMode; value?: number } | undefined, unit = ""): string {
  if (!l || l.mode === "UNLIMITED") return "Unlimited"; if (l.mode === "DISABLED") return "Not included"; return `${(l.value ?? 0).toLocaleString("en-IN")}${unit ? ` ${unit}` : ""}`;
}
