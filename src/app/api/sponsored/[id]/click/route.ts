import { NextResponse } from "next/server";
import { clientIp } from "@/lib/api";
import { rateLimit } from "@/lib/rate-limit";
import { recordClick } from "@/services/sponsored/sponsored";

export const dynamic = "force-dynamic";

/** A click on a Sponsored card: counted (once per visitor per ad every 10 minutes), then sent to the advertiser. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[a-z0-9]{20,40}$/.test(id)) return NextResponse.redirect(new URL("/blog", req.url), 302);
  const first = rateLimit(`sponsored:click:${clientIp(req)}:${id}`, 1, 10 * 60_000).allowed;
  const to = await recordClick(id, req.headers.get("user-agent") ?? "", first).catch(() => null);
  return NextResponse.redirect(to ?? new URL("/blog", req.url), { status: 302, headers: { "Cache-Control": "no-store", "Referrer-Policy": "origin" } });
}
