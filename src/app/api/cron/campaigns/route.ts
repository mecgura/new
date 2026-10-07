import { NextResponse } from "next/server";
import { safeEqual } from "@/lib/crypto";
import { runScheduledWork } from "@/services/scheduler";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Scheduler tick: starts due scheduled campaigns and continues sending ones,
 * and runs due automation work (delays, reply timeouts, retries, schedules). Call every minute from a cron (Vercel Cron sends
 * "Authorization: Bearer $CRON_SECRET"). Disabled until CRON_SECRET is set.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET is not configured." }, { status: 503 });
  const auth = req.headers.get("authorization") ?? "";
  if (!safeEqual(auth, `Bearer ${secret}`)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const r = await runScheduledWork(50_000);
  return NextResponse.json({ ok: true, campaigns: { started: r.campaigns.started, processed: r.campaigns.processed }, automations: r.automations });
}
