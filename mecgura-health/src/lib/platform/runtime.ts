import "server-only";
import { cache } from "react";
import { db } from "@/lib/db";

/** Small runtime lookups used on EVERY request by the auth context. Cached briefly in-process; writers call invalidate*(). */
const settingCache = new Map<string, { exp: number; value: string | null }>();
const TTL = 5_000;
export async function getPlatformSettingRaw(key: string): Promise<string | null> {
  const hit = settingCache.get(key); if (hit && hit.exp > Date.now()) return hit.value;
  const row = await db.platformSetting.findUnique({ where: { key }, select: { value: true } });
  settingCache.set(key, { exp: Date.now() + TTL, value: row?.value ?? null }); return row?.value ?? null;
}
export function invalidatePlatformSetting(key?: string) { if (key) settingCache.delete(key); else settingCache.clear(); }
export async function getPlatformSetting<T>(key: string, fallback: T): Promise<T> { try { const v = await getPlatformSettingRaw(key); return v ? ({ ...(fallback as object), ...JSON.parse(v) } as T) : fallback; } catch { return fallback; } }

export interface Maintenance { enabled: boolean; message: string }
export const DEFAULT_MAINTENANCE: Maintenance = { enabled: false, message: "MECGURA HEALTH is undergoing scheduled maintenance. Please try again shortly." };

/** Feature keys switched OFF for a clinic (no row = on). One query per request. */
export const disabledFeaturesOf = cache(async (tenantId: string): Promise<string[]> => {
  const rows = await db.tenantFeature.findMany({ where: { tenantId, enabled: false }, select: { key: true } });
  return rows.map((r) => r.key);
});

export const maintenanceFor = cache(async (tenantId: string | null): Promise<{ on: boolean; message: string; scope: "global" | "clinic" | null }> => {
  const g = await getPlatformSetting<Maintenance>("maintenance", DEFAULT_MAINTENANCE);
  if (g.enabled) return { on: true, message: g.message || DEFAULT_MAINTENANCE.message, scope: "global" };
  if (tenantId) {
    const t = await db.tenantConfig.findUnique({ where: { tenantId }, select: { maintenanceMode: true, maintenanceMessage: true } });
    if (t?.maintenanceMode) return { on: true, message: t.maintenanceMessage || DEFAULT_MAINTENANCE.message, scope: "clinic" };
  }
  return { on: false, message: "", scope: null };
});

/** An OPEN (not ended, not expired) support-access row for this Super Admin and clinic, or null. */
export const openSupportAccess = cache(async (actorId: string, tenantId: string) =>
  db.supportAccess.findFirst({ where: { actorId, tenantId, endedAt: null, expiresAt: { gt: new Date() } }, orderBy: { startedAt: "desc" }, select: { id: true, reason: true, expiresAt: true, startedAt: true } }));

/** Platform admins get a shorter absolute session than clinic staff. */
export const SUPER_ADMIN_SESSION_MS = 4 * 60 * 60 * 1000;
export const SUPPORT_ACCESS_MS = 60 * 60 * 1000;
