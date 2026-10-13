import "server-only";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

/** Persists an unexpected server error for the monitoring page. Throttled (one row per route+code per 30 s) so an outage can't fill the table. Message is generic text only. */
const last = new Map<string, number>();
export async function recordServerError(o: { route: string; method: string; status: number; code: string; requestId: string; message: string; tenantId?: string | null }) {
  const key = `${o.method}:${o.route}:${o.code}`; const now = Date.now(); if ((last.get(key) ?? 0) > now - 30_000) return; last.set(key, now); if (last.size > 2000) last.clear();
  try { await db.errorEvent.create({ data: { route: o.route.slice(0, 160), method: o.method, status: o.status, code: o.code, requestId: o.requestId, message: o.message.replace(/[A-Za-z0-9_-]{24,}/g, "…").slice(0, 200), env: process.env.APP_ENV ?? process.env.NODE_ENV ?? "unknown", tenantId: o.tenantId ?? null } }); }
  catch (e) { logger.error("error store unavailable", { error: e }); }
}
