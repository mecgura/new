/**
 * Self-hosted servers (`next start`) run the scheduler (campaigns + automations) in-process:
 * one cheap "anything due?" query a minute. Serverless deployments (Vercel)
 * have no long-lived process, so they use the cron route
 * (/api/cron/campaigns + CRON_SECRET) instead. CAMPAIGN_SCHEDULER=off disables it.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.VERCEL || process.env.CAMPAIGN_SCHEDULER === "off") return;
  const g = globalThis as unknown as { __mecguraScheduler?: NodeJS.Timeout };
  if (g.__mecguraScheduler) return;
  const { runScheduledWork } = await import("@/services/scheduler");
  let running = false;
  g.__mecguraScheduler = setInterval(() => {
    if (running) return;
    running = true;
    runScheduledWork(55_000)
      .catch((e) => console.error("[scheduler] tick failed:", e))
      .finally(() => {
        running = false;
      });
  }, 60_000);
  g.__mecguraScheduler.unref?.();
}
