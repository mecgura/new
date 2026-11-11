import "server-only";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { pruneRateLimits } from "@/lib/security/rate-limit";

/**
 * Runs one scheduled job and keeps its history (JobRun): start/finish, duration, counters, and the error if it threw.
 * A failing job never stops the others in the same scheduler tick, and the failure is visible in System health and the Security Center.
 * Jobs themselves are idempotent (unique keys / compare-and-set), so a retry on the next tick is always safe.
 */
export async function recordJob<T>(name: string, fn: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  const started = Date.now(); let run: { id: string } | null = null;
  try { run = await db.jobRun.create({ data: { name }, select: { id: true } }); } catch (e) { logger.error("job history unavailable", { name, error: e }); }
  try {
    const value = await fn(); const ms = Date.now() - started;
    const summary = value && typeof value === "object" ? JSON.stringify(value).slice(0, 1500) : null; const errs = value && typeof value === "object" ? (value as unknown as { errors?: unknown }).errors : 0; const partial = typeof errs === "number" && errs > 0;
    if (run) await db.jobRun.update({ where: { id: run.id }, data: { finishedAt: new Date(), durationMs: ms, status: partial ? "PARTIAL" : "OK", summary } }).catch(() => undefined);
    logger.info("job finished", { channel: "job", name, ms, partial }); return { ok: true, value };
  } catch (e) {
    const msg = (e instanceof Error ? e.message : "error").slice(0, 300);
    if (run) await db.jobRun.update({ where: { id: run.id }, data: { finishedAt: new Date(), durationMs: Date.now() - started, status: "FAILED", error: msg } }).catch(() => undefined);
    logger.error("job failed", { channel: "job", name, error: e });
    const { securityEvent } = await import("@/lib/services/sec-events"); await securityEvent({ severity: "MEDIUM", category: "PROVIDER", type: "JOB_FAILED", summary: `Scheduled job “${name}” failed: ${msg.slice(0, 120)}`, metadata: { job: name } });
    return { ok: false, error: msg };
  }
}
/** Old history is pruned so the table never grows without bound (60 days for jobs, 30 for errors). */
export async function pruneOps(now = new Date()) {
  const j = await db.jobRun.deleteMany({ where: { startedAt: { lt: new Date(now.getTime() - 60 * 86_400_000) } } });
  const e = await db.errorEvent.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - 30 * 86_400_000) } } });
  const r = await pruneRateLimits(now);
  return { jobRuns: j.count, errors: e.count, rateLimits: r };
}
