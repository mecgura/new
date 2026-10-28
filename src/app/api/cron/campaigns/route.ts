import { NextResponse } from "next/server";
import { safeEqual } from "@/lib/crypto";
import { runScheduledWork } from "@/services/scheduler";
import { verifyGithubOidc } from "@/lib/github-oidc";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Scheduler tick: starts due scheduled campaigns and continues sending ones,
 * and runs due automation work (delays, reply timeouts, retries, schedules). Call every minute from a cron (Vercel Cron sends
 * "Authorization: Bearer $CRON_SECRET"), or from the repository's GitHub Actions workflow with its OIDC token.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  // Either the shared secret (Vercel Cron / cron-job.org) or a GitHub Actions token from this repository's workflow.
  const bySecret = Boolean(secret) && safeEqual(auth, `Bearer ${secret}`);
  const byGithub = !bySecret && bearer.split(".").length === 3 && Boolean(await verifyGithubOidc(bearer, process.env.SCHEDULER_GITHUB_REPO || "mecgura/new"));
  if (!bySecret && !byGithub) {
    if (!secret && !bearer) return NextResponse.json({ error: "CRON_SECRET is not configured." }, { status: 503 });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const r = await runScheduledWork(50_000);
  return NextResponse.json({ ok: true, via: bySecret ? "secret" : "github", campaigns: { started: r.campaigns.started, processed: r.campaigns.processed }, automations: r.automations, social: r.social });
}
