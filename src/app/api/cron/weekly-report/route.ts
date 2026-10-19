import { NextResponse } from "next/server";
import { safeEqual } from "@/lib/crypto";
import { sendWeeklyReports } from "@/services/reports/weekly";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Weekly summaries. Call once a week from a cron (Vercel Cron sends "Authorization: Bearer $CRON_SECRET"). Disabled until CRON_SECRET is set. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET is not configured." }, { status: 503 });
  if (!safeEqual(req.headers.get("authorization") ?? "", `Bearer ${secret}`)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ ok: true, ...(await sendWeeklyReports()) });
}
