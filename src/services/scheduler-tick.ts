import { db } from "@/lib/db";
import { runAfterResponse } from "@/lib/background";
import { runScheduledWork } from "@/services/scheduler";

/**
 * Backup scheduler for serverless hosting. GitHub's scheduled workflow is the main tick, but GitHub often runs it
 * late or skips runs, so busy requests (notification polling, Meta webhooks) also start a short tick after their
 * response at most once a minute. A database claim makes sure only one instance runs it at a time.
 */
const KEY = "scheduler:lastTick";
const EVERY_MS = 60_000;
const BUDGET_MS = 20_000;
let lastLocal = 0;

export async function claimTick(now = Date.now()) {
  const r = await db.siteSetting.updateMany({ where: { key: KEY, updatedAt: { lt: new Date(now - EVERY_MS) } }, data: { value: String(now) } });
  if (r.count) return true;
  try {
    await db.siteSetting.create({ data: { key: KEY, value: String(now) } });
    return true;
  } catch {
    return false; // the row exists and was claimed within the last minute
  }
}

export function tickSoon() {
  // Local/self-hosted servers run the in-process scheduler (instrumentation.ts).
  if (!process.env.VERCEL || process.env.CAMPAIGN_SCHEDULER === "off") return;
  const now = Date.now();
  if (now - lastLocal < EVERY_MS) return;
  lastLocal = now;
  runAfterResponse(async () => {
    if (await claimTick(now)) await runScheduledWork(BUDGET_MS);
  });
}
