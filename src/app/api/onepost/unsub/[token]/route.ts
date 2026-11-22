import { clientIp } from "@/lib/api";
import { enforceRateLimit } from "@/lib/rate-limit";
import { contactByOptToken, optOut } from "@/services/onepost/pr";

type Ctx = { params: Promise<{ token: string }> };
const H = { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex", "referrer-policy": "no-referrer" };
const page = (body: string, status = 200) => new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Email preferences</title><body style="font-family:Arial,sans-serif;max-width:460px;margin:15vh auto;padding:0 20px;color:#111">${body}</body>`, { status, headers: H });

/** Public: shows a confirm button. A mail scanner opening the link does not unsubscribe anyone by itself. */
export async function GET(req: Request, { params }: Ctx) {
  enforceRateLimit(`onepost-unsub:${clientIp(req)}`, 60, 15 * 60_000);
  const c = await contactByOptToken((await params).token);
  if (!c) return page("<h2>Link not valid</h2><p>This link is not valid any more.</p>", 404);
  if (c.optedOut) return page("<h2>You are unsubscribed</h2><p>You will not receive press emails from us again.</p>");
  return page(`<h2>Stop press emails?</h2><p>Confirm that you do not want to receive press emails from this sender.</p><form method="post"><button style="padding:10px 18px;font-size:15px">Unsubscribe me</button></form>`);
}

/** Also used for one-click unsubscribe from the email app's own button. */
export async function POST(req: Request, { params }: Ctx) {
  enforceRateLimit(`onepost-unsub:${clientIp(req)}`, 30, 15 * 60_000);
  const done = await optOut((await params).token);
  return done ? page("<h2>You are unsubscribed</h2><p>You will not receive press emails from us again.</p>") : page("<h2>Link not valid</h2><p>This link is not valid any more.</p>", 404);
}
