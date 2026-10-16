import "server-only";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { redact } from "@/lib/logger";
import { safeNotify } from "@/lib/notifications/engine";
import { getRequestMeta } from "@/lib/security/request";

export const SEVERITIES = ["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export type Severity = (typeof SEVERITIES)[number];
export const CATEGORIES = ["AUTH", "ACCESS", "API", "WEBHOOK", "PROVIDER", "EXPORT", "SUPPORT", "API_KEY", "CONFIG", "PRIVACY", "INTEGRITY"] as const;
export type Category = (typeof CATEGORIES)[number];
export const SEVERITY_RANK: Record<string, number> = { INFO: 0, LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };

export interface SecurityEventInput { severity: Severity; category: Category; type: string; summary: string; tenantId?: string | null; actorId?: string | null; metadata?: Record<string, unknown>; ip?: string | null; userAgent?: string | null }
/**
 * Records a security-relevant event for the Super Admin Security Center. HIGH and CRITICAL events also raise an in-app alert for Super Admins
 * (Phase 12 notification centre). External alerting (email/pager) is NOT sent from here — it only happens if such a provider is configured elsewhere.
 * Never throws; never stores secrets or patient content (metadata is redacted and size-capped).
 */
export async function securityEvent(i: SecurityEventInput): Promise<void> {
  try {
    const meta = i.ip === undefined && i.userAgent === undefined ? await getRequestMeta().catch(() => ({ ip: null, userAgent: null })) : { ip: i.ip ?? null, userAgent: i.userAgent ?? null };
    let md: string | null = i.metadata ? JSON.stringify(redact(i.metadata)) : null; if (md && md.length > 1500) md = JSON.stringify({ truncated: true });
    await db.securityEvent.create({ data: { severity: i.severity, category: i.category, type: i.type, summary: i.summary.slice(0, 300), tenantId: i.tenantId ?? null, actorId: i.actorId ?? null, ip: meta.ip, userAgent: meta.userAgent?.slice(0, 200) ?? null, metadata: md } });
    if (SEVERITY_RANK[i.severity] >= SEVERITY_RANK.HIGH) {
      const bucket = Math.floor(Date.now() / 3_600_000);
      await safeNotify({ tenantId: null, type: "SECURITY_ALERT", eventKey: `sec:${i.type}:${i.tenantId ?? "-"}:${bucket}`, entityType: "security_event", vars: { severity: i.severity, summary: i.summary.slice(0, 160) }, actionUrl: "/platform/security" });
    }
  } catch (e) { logger.error("security event write failed", { type: i.type, error: e }); }
}

/** Failed-login bookkeeping with simple, explainable detection (no ML): many failures from one address, or a success right after several failures. */
export async function onLoginFailure(o: { identifierKnown: boolean; userId?: string | null; tenantId?: string | null; reason: string; ip?: string | null }) {
  await securityEvent({ severity: "LOW", category: "AUTH", type: "LOGIN_FAILED", summary: `Sign-in rejected (${o.reason})`, tenantId: o.tenantId ?? null, actorId: o.userId ?? null, metadata: { reason: o.reason, known: o.identifierKnown }, ip: o.ip });
  try {
    const ip = o.ip ?? (await getRequestMeta().catch(() => ({ ip: null }))).ip; if (!ip) return; const since = new Date(Date.now() - 15 * 60_000);
    const n = await db.securityEvent.count({ where: { type: "LOGIN_FAILED", ip, createdAt: { gte: since } } });
    if (n >= 10 && !(await db.securityEvent.findFirst({ where: { type: "BRUTE_FORCE_SUSPECTED", ip, createdAt: { gte: since } }, select: { id: true } })))
      await securityEvent({ severity: "HIGH", category: "AUTH", type: "BRUTE_FORCE_SUSPECTED", summary: `${n} failed sign-ins from one address in 15 minutes`, metadata: { failures: n }, ip });
  } catch (e) { logger.error("login failure detection failed", { error: e }); }
}
export async function onLoginSuccess(o: { userId: string; tenantId: string | null; ip?: string | null }) {
  try {
    const since = new Date(Date.now() - 30 * 60_000); const n = await db.securityEvent.count({ where: { type: "LOGIN_FAILED", actorId: o.userId, createdAt: { gte: since } } });
    if (n >= 5) await securityEvent({ severity: "MEDIUM", category: "AUTH", type: "LOGIN_AFTER_FAILURES", summary: `Successful sign-in after ${n} failures on the same account`, tenantId: o.tenantId, actorId: o.userId, metadata: { failures: n }, ip: o.ip });
  } catch (e) { logger.error("login success detection failed", { error: e }); }
}

/** In-process throttle so a client hammering a forbidden route doesn't flood the table: one event per actor+route per minute; escalate on volume. */
const seen = new Map<string, { at: number; count: number }>();
export async function onAuthzDenied(o: { actorId: string | null; tenantId: string | null; path: string; code: "FORBIDDEN" | "UNAUTHENTICATED" }) {
  const key = `${o.actorId ?? "anon"}:${o.path}`; const now = Date.now(); const cur = seen.get(key);
  if (seen.size > 5000) for (const [k, v] of seen) if (now - v.at > 600_000) seen.delete(k);
  if (cur && now - cur.at < 60_000) { cur.count++; return; }
  const count = (cur?.count ?? 0) + 1; seen.set(key, { at: now, count: 0 });
  if (o.code === "UNAUTHENTICATED") return; // expired sessions are normal; only authenticated denials are interesting
  await securityEvent({ severity: count >= 20 ? "MEDIUM" : "LOW", category: "ACCESS", type: "AUTHZ_DENIED", summary: `Permission denied on ${o.path.slice(0, 120)}`, tenantId: o.tenantId, actorId: o.actorId, metadata: { repeated: count } });
}

/** Every data export leaves a trace; many exports by one person in an hour is flagged for review. */
export async function onExport(o: { actorId: string; tenantId: string | null; kind: string }) {
  await securityEvent({ severity: "INFO", category: "EXPORT", type: "DATA_EXPORT", summary: `Data export: ${o.kind}`, tenantId: o.tenantId, actorId: o.actorId, metadata: { kind: o.kind } });
  try {
    const n = await db.securityEvent.count({ where: { type: "DATA_EXPORT", actorId: o.actorId, createdAt: { gte: new Date(Date.now() - 3_600_000) } } });
    if (n === 8) await securityEvent({ severity: "MEDIUM", category: "EXPORT", type: "UNUSUAL_EXPORT_VOLUME", summary: "Eight data exports by one user within an hour", tenantId: o.tenantId, actorId: o.actorId });
  } catch (e) { logger.error("export detection failed", { error: e }); }
}
