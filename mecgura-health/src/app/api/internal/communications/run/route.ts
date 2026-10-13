import { NextResponse } from "next/server";
import { runNotificationJobs } from "@/lib/notifications/jobs";
import { safeEqual } from "@/lib/communications/providers/verify";
import { recordJob, pruneOps } from "@/lib/ops/jobs";
import { sealAudit } from "@/lib/services/sec-audit";
import { runSubscriptionJobs } from "@/lib/services/sub-jobs";
import { processDue } from "@/lib/communications/worker";
import { runScheduler } from "@/lib/communications/triggers";
import { db } from "@/lib/db";
import { rateLimit } from "@/lib/security/rate-limit";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Scheduler tick for an external cron (system cron, Vercel Cron, a cloud scheduler): queues due reminders, then delivers due messages.
 * Protected by CRON_SECRET (`Authorization: Bearer …`). Without CRON_SECRET the endpoint is OFF — there is no unauthenticated mode.
 * Safe to call as often as every minute and by several callers at once (idempotent keys + claim-by-compare-and-swap).
 */
async function run(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16) return NextResponse.json({ ok: false, error: "scheduler_not_configured" }, { status: 503 });
  const given = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!safeEqual(given, secret)) return NextResponse.json({ ok: false }, { status: 401 });
  const lim = await rateLimit("comm:cron", { limit: 30, windowMs: 60_000 }); if (!lim.allowed) return NextResponse.json({ ok: false }, { status: 429 });
  // Each part is recorded in the job history and isolated: one failing part never stops the others.
  const [sc, de, no, su] = [await recordJob("scheduler", () => runScheduler()), await recordJob("message-delivery", () => processDue({ limit: 200 })), await recordJob("notifications", () => runNotificationJobs()), await recordJob("subscription-billing", () => runSubscriptionJobs())];
  const scheduled = sc.ok ? sc.value : null, delivery = de.ok ? de.value : null, notifications = no.ok ? no.value : null, subscriptions = su.ok ? su.value : null; // (notification centre rides this tick; subscription billing clock = trials, renewals, dunning, grace, suspension)
  const sealed = await recordJob("audit-seal", () => sealAudit(null)); await recordJob("ops-prune", () => pruneOps());
  await db.platformSetting.upsert({ where: { key: "scheduler.heartbeat" }, update: { value: JSON.stringify({ at: new Date().toISOString() }) }, create: { key: "scheduler.heartbeat", value: JSON.stringify({ at: new Date().toISOString() }) } }).catch(() => undefined); // lets the Super Admin console show a REAL last-run time
  const failed = [sc, de, no, su, sealed].filter((r) => !r.ok).length;
  return NextResponse.json({ ok: failed === 0, failedJobs: failed, scheduled, delivery, notifications, subscriptions }, { headers: { "Cache-Control": "no-store" } });
}
export const POST = run;
export const GET = run;
