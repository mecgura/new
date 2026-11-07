import { NextResponse } from "next/server";
import { clientIp } from "@/lib/api";
import { rateLimit } from "@/lib/rate-limit";
import { serveAds } from "@/services/sponsored/sponsored";

export const dynamic = "force-dynamic";

/** The ads for the website's Sponsored panel. Public; one view is counted per ad shown. */
export async function GET(req: Request) {
  const ip = clientIp(req);
  const limited = !rateLimit(`sponsored:serve:${ip}`, 40, 60_000).allowed;
  const ads = await serveAds({ userAgent: req.headers.get("user-agent") ?? "", countViews: !limited }).catch(() => []);
  return NextResponse.json({ ads }, { headers: { "Cache-Control": "no-store" } });
}
