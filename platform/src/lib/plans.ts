import { z } from "zod";
import { formatNumber } from "@/lib/catalog";

/**
 * Plan vocabulary shared by server and browser. NO plan values live in code: names, prices, limits and
 * features are rows in the database that the admin edits. A limit of -1 means "unlimited".
 */
export const UNLIMITED = -1;
export const isUnlimited = (limit: number) => limit < 0;

/** Would using `adding` more push `used` past `limit`? Unlimited never does. */
export const wouldExceed = (used: number, limit: number, adding = 1) => !isUnlimited(limit) && used + adding > limit;
export const remaining = (used: number, limit: number) => (isUnlimited(limit) ? Infinity : Math.max(0, limit - used));
export const limitLabel = (limit: number) => (isUnlimited(limit) ? "Unlimited" : formatNumber(limit));

export const FEATURES = {
  campaigns: "Campaigns",
  automations: "Automations",
  flows: "WhatsApp Flows",
  ai_agent: "AI agent",
  api: "API access",
  webhooks: "Webhooks",
  analytics: "Analytics",
} as const;
export type FeatureKey = keyof typeof FEATURES;
export const FEATURE_KEYS = Object.keys(FEATURES) as [FeatureKey, ...FeatureKey[]];

export function parseFeatures(raw: string | null | undefined): FeatureKey[] {
  try {
    const v = JSON.parse(raw || "[]") as unknown;
    return Array.isArray(v) ? (v.filter((x) => typeof x === "string" && x in FEATURES) as FeatureKey[]) : [];
  } catch {
    return [];
  }
}

export type PlanLimits = { users: number; whatsappNumbers: number; messages: number; contacts: number; campaigns: number; automations: number; aiReplies: number; apiRequests: number };

export const LIMIT_META: Record<keyof PlanLimits, { label: string; per: string; field: string }> = {
  users: { label: "Team members", per: "seats", field: "maxUsers" },
  whatsappNumbers: { label: "WhatsApp numbers", per: "numbers", field: "maxWhatsAppNumbers" },
  messages: { label: "Messages", per: "per month", field: "maxMonthlyMessages" },
  contacts: { label: "New contacts", per: "per month", field: "maxContacts" },
  campaigns: { label: "Campaigns launched", per: "per month", field: "maxCampaigns" },
  automations: { label: "Active automations", per: "at once", field: "maxAutomations" },
  aiReplies: { label: "AI replies", per: "per month", field: "maxAiReplies" },
  apiRequests: { label: "API requests", per: "per month", field: "maxApiRequests" },
};

type PlanRow = { maxUsers: number; maxWhatsAppNumbers: number; maxMonthlyMessages: number; maxContacts: number; maxCampaigns: number; maxAutomations: number; maxAiReplies: number; maxApiRequests: number };
export const limitsOf = (p: PlanRow): PlanLimits => ({
  users: p.maxUsers,
  whatsappNumbers: p.maxWhatsAppNumbers,
  messages: p.maxMonthlyMessages,
  contacts: p.maxContacts,
  campaigns: p.maxCampaigns,
  automations: p.maxAutomations,
  aiReplies: p.maxAiReplies,
  apiRequests: p.maxApiRequests,
});

const limit = (min: number) => z.coerce.number().int().min(-1).max(2_000_000_000).refine((n) => n >= min || n === -1, `Use ${min} or more, or -1 for unlimited`);

const planBase = z.object({
  name: z.string().trim().min(2, "Plan name is required").max(60),
  slug: z.string().trim().min(2).max(60).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Lowercase letters, numbers and dashes"),
  description: z.string().trim().max(300).optional(),
  /** Rupees in the API; stored as paise. */
  priceMonthly: z.coerce.number().min(0).max(10_000_000),
  maxUsers: limit(1),
  maxWhatsAppNumbers: limit(0),
  maxMonthlyMessages: limit(0),
  maxContacts: limit(0),
  maxCampaigns: limit(0).optional(),
  maxAutomations: limit(0).optional(),
  maxAiReplies: limit(0).optional(),
  maxApiRequests: limit(0).optional(),
  features: z.array(z.enum(FEATURE_KEYS)).max(FEATURE_KEYS.length).optional(),
  isActive: z.boolean().optional(),
  selfServe: z.boolean().optional(),
  sortOrder: z.coerce.number().int().min(0).max(1000).optional(),
});

/** Create: omitted optional fields get neutral defaults (unlimited, all features, active). */
export const planSchema = planBase.transform((v) => ({
  ...v,
  description: v.description ?? "",
  maxCampaigns: v.maxCampaigns ?? UNLIMITED,
  maxAutomations: v.maxAutomations ?? UNLIMITED,
  maxAiReplies: v.maxAiReplies ?? UNLIMITED,
  maxApiRequests: v.maxApiRequests ?? UNLIMITED,
  features: v.features ?? [...FEATURE_KEYS],
  isActive: v.isActive ?? true,
  selfServe: v.selfServe ?? true,
  sortOrder: v.sortOrder ?? 0,
}));
/** Update: only the fields that are sent change — nothing is reset by omission. */
export const planUpdateSchema = planBase.partial();
