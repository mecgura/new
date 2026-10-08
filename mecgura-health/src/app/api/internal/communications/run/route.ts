import { NextResponse } from "next/server";
import { runNotificationJobs } from "@/lib/notifications/jobs";
import { safeEqual } from "@/lib/communications/providers/verify";
import { processDue } from "@/lib/communications/worker";
import { runScheduler } from "@/lib/communications/triggers";
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
  const scheduled = await runScheduler(); const delivery = await processDue({ limit: 200 });
  const notifications = await runNotificationJobs(); // the notification centre rides the same tick (reminders, stock, escalation, retention, digests)
  return NextResponse.json({ ok: true, scheduled, delivery, notifications }, { headers: { "Cache-Control": "no-store" } });
}
export const POST = run;
export const GET = run;
