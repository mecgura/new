import "server-only";
import { db } from "@/lib/db";
import { scannerStatus } from "@/lib/security/malware";
import { usingDerivedKey } from "@/lib/security/crypto";
import { onlineProvider } from "@/lib/subscriptions/providers/registry";
import { configuredProvider } from "@/lib/communications/providers/registry";
import pkg from "../../../package.json";

export const APP_VERSION = process.env.APP_VERSION ?? pkg.version;
export interface Check { name: string; status: "ok" | "warn" | "down" | "not_configured"; detail: string; ms?: number }
const BOOT = new Date();

/** Readiness: can this instance serve traffic safely? Down only when a REQUIRED part is down (database, migrations). Optional parts degrade to warn / not_configured. No secrets or hostnames are ever included. */
export async function readiness(): Promise<{ status: "ready" | "degraded" | "not_ready"; checks: Check[] }> {
  const checks: Check[] = []; let dbOk = true;
  const t0 = Date.now(); try { await db.$queryRaw`SELECT 1`; checks.push({ name: "database", status: "ok", detail: "responding", ms: Date.now() - t0 }); } catch { dbOk = false; checks.push({ name: "database", status: "down", detail: "not responding" }); }
  if (dbOk) {
    try { const rows = await db.$queryRaw<{ n: bigint | number }[]>`SELECT COUNT(*) AS n FROM "_prisma_migrations" WHERE finished_at IS NULL`; const pending = Number(rows[0]?.n ?? 0); checks.push({ name: "migrations", status: pending === 0 ? "ok" : "down", detail: pending === 0 ? "all applied" : `${pending} unfinished migration(s)` }); }
    catch { checks.push({ name: "migrations", status: "warn", detail: "migration table not readable" }); }
    try { const hb = await db.platformSetting.findUnique({ where: { key: "scheduler.heartbeat" } }); const at = hb ? new Date(JSON.parse(hb.value).at).getTime() : 0; const configured = !!process.env.CRON_SECRET && process.env.CRON_SECRET.length >= 16;
      checks.push({ name: "scheduler", status: !configured ? "not_configured" : Date.now() - at < 15 * 60_000 ? "ok" : "warn", detail: !configured ? "CRON_SECRET not set — reminders, billing clock and retries do not run" : at ? `last tick ${Math.round((Date.now() - at) / 60000)} min ago` : "no tick yet" }); } catch { checks.push({ name: "scheduler", status: "warn", detail: "unreadable" }); }
    try { const stuck = await db.communicationMessage.count({ where: { status: { in: ["QUEUED", "RETRYING"] }, scheduledAt: { lt: new Date(Date.now() - 30 * 60_000) } } }); checks.push({ name: "queue", status: stuck === 0 ? "ok" : "warn", detail: stuck === 0 ? "no overdue messages" : `${stuck} message(s) overdue by 30+ min` }); } catch { /* optional */ }
    try { const a = await db.tenantAsset.count(); checks.push({ name: "storage", status: "ok", detail: `${a} stored file(s) readable` }); } catch { checks.push({ name: "storage", status: "down", detail: "file store not readable" }); }
  }
  checks.push({ name: "cache", status: "ok", detail: "in-process (tenant-aware, short TTL)" });
  const pay = onlineProvider(); checks.push({ name: "payment_provider", status: pay ? "ok" : "not_configured", detail: pay ? `${pay.displayName} configured` : "none — online subscription payments are off" });
  for (const ch of ["EMAIL", "SMS", "WHATSAPP"] as const) { const p = configuredProvider(ch); checks.push({ name: `${ch.toLowerCase()}_provider`, status: p ? "ok" : "not_configured", detail: p ? "configured" : "not configured" }); }
  checks.push({ name: "upload_scanner", status: scannerStatus().configured ? "ok" : "not_configured", detail: scannerStatus().configured ? "configured" : "no malware scanner registered (images only)" });
  checks.push({ name: "security_keys", status: usingDerivedKey() ? "warn" : "ok", detail: usingDerivedKey() ? "derived from AUTH_SECRET — set SECURITY_KEYS for production" : "dedicated key ring" });
  const down = checks.some((c) => c.status === "down"); const warn = checks.some((c) => c.status === "warn");
  return { status: down ? "not_ready" : warn ? "degraded" : "ready", checks };
}
export const versionInfo = () => ({ name: "mecgura-health", version: APP_VERSION, commit: (process.env.GIT_SHA ?? process.env.VERCEL_GIT_COMMIT_SHA ?? "unknown").slice(0, 12), environment: process.env.APP_ENV ?? process.env.NODE_ENV ?? "unknown", node: process.version, startedAt: BOOT.toISOString() });
