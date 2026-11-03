import { NextResponse } from "next/server";
import { clientIp, ApiError } from "@/lib/api";
import { enforceRateLimit } from "@/lib/rate-limit";
import { trackEvent, trackSchema } from "@/services/marketing/tracking";

export const dynamic = "force-dynamic";

/**
 * Website analytics beacon (public, sent with navigator.sendBeacon). Always answers 204 so a blocked or bad beacon
 * never shows up for the visitor; invalid input is simply dropped.
 */
export async function POST(req: Request) {
  try {
    enforceRateLimit(`m-track:${clientIp(req)}`, 60, 60_000);
  } catch (e) {
    if (e instanceof ApiError) return new NextResponse(null, { status: 429 });
    throw e;
  }
  const raw = await req.text().catch(() => "");
  if (raw.length > 4_000) return new NextResponse(null, { status: 413 });
  let body: unknown = null;
  try {
    body = JSON.parse(raw);
  } catch {
    return new NextResponse(null, { status: 204 });
  }
  const parsed = trackSchema.safeParse(body);
  if (parsed.success) {
    const host = req.headers.get("host")?.split(":")[0] ?? "";
    await trackEvent(parsed.data, host).catch((e) => console.error("[track] not stored:", e instanceof Error ? e.message : e));
  }
  return new NextResponse(null, { status: 204 });
}
