import "server-only";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { FEATURE_KEYS } from "@/lib/platform/features";
import { LIMITS, limitDef, parseJson, type PlanFeatures, type PlanLimits } from "@/lib/subscriptions/catalog";
import { accessFor, type AccessLevel } from "@/lib/subscriptions/state";
import { addMonths } from "@/lib/subscriptions/period";
import { getPolicy } from "./sub-config";

/**
 * EntitlementService + SubscriptionAccessService — THE one place that answers "may this clinic do/use/add that?".
 * Everything is derived on the server from the clinic's own subscription snapshot; the browser is never asked.
 *
 * A clinic whose subscription is not `managed` (legacy / demo data created before Phase 15) is unrestricted, exactly as before.
 * Features are the Phase 14 feature keys: effective access = the plan includes it AND the Super Admin has not switched it off.
 */
export interface Entitlement {
  managed: boolean; subscriptionId: string | null; status: string | null; access: AccessLevel; planName: string | null;
  features: PlanFeatures | null; limits: PlanLimits | null; windowStart: Date | null; periodEnd: Date | null;
  /** feature keys the PLAN does not include (empty for unmanaged subscriptions) */
  disabledFeatures: string[];
}
const UNMANAGED: Entitlement = { managed: false, subscriptionId: null, status: null, access: "FULL", planName: null, features: null, limits: null, windowStart: null, periodEnd: null, disabledFeatures: [] };

const cache = new Map<string, { exp: number; v: Entitlement }>(); const TTL = 5_000;
export const invalidateEntitlements = (tenantId?: string) => { if (tenantId) cache.delete(tenantId); else cache.clear(); };

export async function entitlementOf(tenantId: string, now = new Date()): Promise<Entitlement> {
  const hit = cache.get(tenantId); if (hit && hit.exp > Date.now()) return hit.v;
  const sub = await db.subscription.findUnique({ where: { tenantId } });
  let v: Entitlement = UNMANAGED;
  if (sub?.managed) {
    const snap = parseJson<{ name?: string; features?: PlanFeatures; limits?: PlanLimits }>(sub.snapshot, {});
    const features = snap.features ?? {}; const base = sub.status === "TRIAL" ? sub.trialStart ?? sub.startsAt : sub.currentPeriodStart ?? sub.startsAt;
    v = {
      managed: true, subscriptionId: sub.id, status: sub.status, access: accessFor(sub.status, await getPolicy()), planName: snap.name ?? null, features, limits: snap.limits ?? {},
      windowStart: usageWindowStart(base, now), periodEnd: sub.status === "TRIAL" ? sub.trialEnd : sub.currentPeriodEnd,
      disabledFeatures: FEATURE_KEYS.filter((k) => features[k] !== true),
    };
  }
  cache.set(tenantId, { exp: Date.now() + TTL, v }); return v;
}

/** Monthly counters restart on each monthly anniversary of the period start (so a yearly plan still gets a fresh monthly allowance). */
export function usageWindowStart(base: Date, now: Date): Date {
  let k = Math.max(0, (now.getUTCFullYear() - base.getUTCFullYear()) * 12 + (now.getUTCMonth() - base.getUTCMonth())); let start = addMonths(base, k);
  while (start > now && k > 0) start = addMonths(base, --k);
  return start;
}

export const canUseFeature = async (tenantId: string, key: string) => !(await entitlementOf(tenantId)).disabledFeatures.includes(key);
export async function assertFeature(tenantId: string, key: string, message?: string) {
  if (!(await canUseFeature(tenantId, key))) throw new AppError("FORBIDDEN", { message: message ?? "This feature is not included in your plan. Upgrade your plan to use it." });
}

/** Counting rules are documented in LIMITS[].description; every number is read from live data, not from a drifting counter. */
export async function usageOf(tenantId: string, key: string, e: Entitlement, now = new Date()): Promise<number> {
  const since = e.windowStart ?? new Date(0); void now;
  switch (key) {
    case "maxDoctors": return db.user.count({ where: { tenantId, deletedAt: null, status: { in: ["ACTIVE", "INVITED"] }, role: { key: "DOCTOR" } } });
    case "maxStaff": return db.user.count({ where: { tenantId, deletedAt: null, status: { in: ["ACTIVE", "INVITED"] }, role: { key: { notIn: ["DOCTOR", "PATIENT", "SUPER_ADMIN"] } } } });
    case "maxPatients": return db.patient.count({ where: { tenantId, deletedAt: null, status: { not: "ARCHIVED" } } });
    case "maxAppointmentsPerMonth": return db.appointment.count({ where: { tenantId, createdAt: { gte: since } } });
    case "maxStorageMb": { const a = await db.tenantAsset.aggregate({ where: { tenantId }, _sum: { size: true } }); return Math.ceil((a._sum.size ?? 0) / 1_048_576); }
    case "maxWhatsAppMessages": case "maxSmsMessages": case "maxEmailMessages": {
      const channel = key === "maxWhatsAppMessages" ? "WHATSAPP" : key === "maxSmsMessages" ? "SMS" : "EMAIL";
      return db.communicationMessage.count({ where: { tenantId, channel, createdAt: { gte: since }, status: { notIn: ["SKIPPED", "CANCELLED"] } } });
    }
    default: return 0;
  }
}

export type UsageLevel = "ok" | "warn80" | "warn90" | "full";
export interface UsageRow { key: string; label: string; unit: string; metered: boolean; mode: "LIMITED" | "UNLIMITED" | "DISABLED"; limit: number | null; used: number; percent: number | null; level: UsageLevel; period: "stock" | "period"; description: string }
export const levelOf = (used: number, limit: number): UsageLevel => (limit <= 0 ? (used > 0 ? "full" : "ok") : used >= limit ? "full" : used / limit >= 0.9 ? "warn90" : used / limit >= 0.8 ? "warn80" : "ok");

export async function usageSnapshot(tenantId: string, now = new Date()): Promise<{ managed: boolean; rows: UsageRow[]; windowStart: Date | null }> {
  const e = await entitlementOf(tenantId, now); if (!e.managed) return { managed: false, rows: [], windowStart: null };
  const rows = await Promise.all(LIMITS.map(async (d): Promise<UsageRow> => {
    const l = e.limits?.[d.key] ?? { mode: "UNLIMITED" as const }; const used = d.metered ? await usageOf(tenantId, d.key, e, now) : 0; const limit = l.mode === "LIMITED" ? l.value ?? 0 : null;
    return { key: d.key, label: d.label, unit: d.unit, metered: d.metered, mode: l.mode, limit, used, percent: limit ? Math.min(100, Math.round((used / limit) * 100)) : limit === 0 ? (used > 0 ? 100 : 0) : null, level: limit === null ? "ok" : levelOf(used, limit), period: d.kind, description: d.description };
  }));
  return { managed: true, rows, windowStart: e.windowStart };
}

export interface LimitCheck { allowed: boolean; mode: "LIMITED" | "UNLIMITED" | "DISABLED"; used: number; limit: number | null; reason: string | null }
export async function checkLimit(tenantId: string, key: string, adding = 1): Promise<LimitCheck> {
  const e = await entitlementOf(tenantId); const d = limitDef(key);
  if (!e.managed || !d || !d.metered) return { allowed: true, mode: "UNLIMITED", used: 0, limit: null, reason: null };
  const l = e.limits?.[key] ?? { mode: "UNLIMITED" as const };
  if (l.mode === "UNLIMITED") return { allowed: true, mode: "UNLIMITED", used: 0, limit: null, reason: null };
  if (l.mode === "DISABLED") return { allowed: false, mode: "DISABLED", used: 0, limit: 0, reason: `${d.label} are not included in your plan.` };
  const used = await usageOf(tenantId, key, e); const limit = l.value ?? 0;
  return used + adding <= limit ? { allowed: true, mode: "LIMITED", used, limit, reason: null } : { allowed: false, mode: "LIMITED", used, limit, reason: `Your plan allows ${limit.toLocaleString("en-IN")} ${d.unit}${d.kind === "period" ? " per billing month" : ""} and ${used.toLocaleString("en-IN")} are already used.` };
}
/** Blocks ONLY the action being limited. Existing data is never touched. */
export async function assertCanCreate(tenantId: string, key: string, adding = 1) {
  const c = await checkLimit(tenantId, key, adding);
  if (!c.allowed) throw new AppError("LIMIT_REACHED", { message: `${c.reason} Upgrade your plan to add more.` });
}
/** After a successful create: warn the clinic admins ONCE per limit, period and threshold (80 / 90 / 100%). Never throws. */
export async function noteUsage(tenantId: string, key: string) {
  try {
    const e = await entitlementOf(tenantId); const l = e.limits?.[key]; const d = limitDef(key);
    if (!e.managed || !d || !l || l.mode !== "LIMITED" || !l.value) return;
    const used = await usageOf(tenantId, key, e); const lvl = levelOf(used, l.value); if (lvl === "ok") return;
    const level = lvl === "full" ? 100 : lvl === "warn90" ? 90 : 80;
    const { notifySubscription } = await import("./sub-notify");
    await notifySubscription(tenantId, "SUBSCRIPTION_LIMIT_WARNING", `limit:${key}:${e.windowStart?.getTime() ?? 0}:${level}`, { level: String(level), limit: d.label, used: String(used), max: String(l.value) });
  } catch { /* a warning must never break the action that caused it */ }
}
export async function recordUsageHistory(tenantId: string, now = new Date()) {
  const e = await entitlementOf(tenantId, now); if (!e.managed || !e.windowStart || !e.subscriptionId) return;
  const snap = await usageSnapshot(tenantId, now); const end = e.periodEnd ?? addMonths(e.windowStart, 1);
  for (const r of snap.rows.filter((x) => x.metered)) {
    await db.subscriptionUsage.upsert({ where: { tenantId_limitKey_periodStart: { tenantId, limitKey: r.key, periodStart: e.windowStart } }, create: { tenantId, subscriptionId: e.subscriptionId, limitKey: r.key, periodStart: e.windowStart, periodEnd: end, used: r.used, limitValue: r.limit }, update: { used: r.used, limitValue: r.limit, periodEnd: end } });
  }
}
export function violationsFor(newLimits: PlanLimits, usage: UsageRow[]): { key: string; label: string; used: number; limit: number | null; mode: string }[] {
  const out: { key: string; label: string; used: number; limit: number | null; mode: string }[] = [];
  for (const u of usage) {
    if (!u.metered || u.period === "period") continue; // monthly counters restart; only current totals must fit the new plan
    const l = newLimits[u.key] ?? { mode: "UNLIMITED" as const };
    if (l.mode === "DISABLED" && u.used > 0) out.push({ key: u.key, label: u.label, used: u.used, limit: 0, mode: l.mode });
    else if (l.mode === "LIMITED" && u.used > (l.value ?? 0)) out.push({ key: u.key, label: u.label, used: u.used, limit: l.value ?? 0, mode: l.mode });
  }
  return out;
}

/** Doctors and everyone else are separate seat pools (invited people hold a seat until they are removed). */
export const seatKey = (role: string) => (role === "DOCTOR" ? "maxDoctors" : "maxStaff");
