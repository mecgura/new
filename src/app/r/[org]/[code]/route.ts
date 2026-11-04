import { clientIp, ApiError } from "@/lib/api";
import { enforceRateLimit } from "@/lib/rate-limit";
import { referralTarget } from "@/services/loyalty/loyalty";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ org: string; code: string }> };

/** A customer's referral link: opens the business's WhatsApp with the referral code already typed. */
export async function GET(req: Request, { params }: Ctx) {
  try {
    enforceRateLimit(`ref-link:${clientIp(req)}`, 60, 60_000);
  } catch (e) {
    if (e instanceof ApiError) return new Response("Too many requests. Please try again in a minute.", { status: 429 });
    throw e;
  }
  const { org, code } = await params;
  const target = /^[a-z0-9]{10,40}$/i.test(org) ? await referralTarget(org, code.toUpperCase().slice(0, 12)) : null;
  if (!target) {
    return new Response(
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Link not active</title><style>body{font-family:system-ui,sans-serif;background:#f6f1e7;color:#10231a;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px}main{max-width:26rem;background:#fff;border-radius:16px;padding:28px}</style></head><body><main><h1>This referral link isn't active</h1><p>Ask your friend for a new link.</p></main></body></html>`,
      { status: 404, headers: { "content-type": "text/html; charset=utf-8", "x-robots-tag": "noindex" } }
    );
  }
  return Response.redirect(target.url, 302);
}
