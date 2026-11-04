import { clientIp, ApiError } from "@/lib/api";
import { enforceRateLimit } from "@/lib/rate-limit";
import { track, trackSchema } from "@/services/landing/pages";

type Ctx = { params: Promise<{ id: string }> };

/** Public beacon: a page view or button click. Always answers 204 so it can't be used to probe pages. */
export async function POST(req: Request, { params }: Ctx) {
  try {
    enforceRateLimit(`lp-event:${clientIp(req)}`, 120, 60_000);
    const raw = await req.text();
    if (raw.length > 4000) return new Response(null, { status: 204 });
    const p = trackSchema.safeParse(JSON.parse(raw));
    if (p.success) await track((await params).id, p.data);
  } catch (e) {
    if (!(e instanceof ApiError) && !(e instanceof SyntaxError)) console.error("[landing] event not recorded:", e);
  }
  return new Response(null, { status: 204 });
}
