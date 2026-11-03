import { clientIp, ApiError } from "@/lib/api";
import { enforceRateLimit } from "@/lib/rate-limit";
import { unsubscribe } from "@/services/marketing/outreach";

export const dynamic = "force-dynamic";

const page = (title: string, text: string, status = 200) =>
  new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{font-family:system-ui,sans-serif;background:#f6f1e7;color:#10231a;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px}main{max-width:28rem;background:#fff;border-radius:16px;padding:28px;box-shadow:0 10px 30px rgba(0,0,0,.08)}h1{font-size:1.3rem;margin:0 0 8px}p{color:#54656f;margin:0}</style></head><body><main><h1>${title}</h1><p>${text}</p></main></body></html>`,
    { status, headers: { "content-type": "text/html; charset=utf-8", "x-content-type-options": "nosniff", "x-robots-tag": "noindex" } }
  );

/** One-click unsubscribe from MECGURA outreach email (link in every outreach email). */
export async function GET(req: Request) {
  try {
    enforceRateLimit(`unsub:${clientIp(req)}`, 30, 60_000);
  } catch (e) {
    if (e instanceof ApiError) return page("Too many requests", "Please try again in a minute.", 429);
    throw e;
  }
  const q = new URL(req.url).searchParams;
  const lead = (q.get("l") ?? "").slice(0, 64);
  const token = (q.get("t") ?? "").slice(0, 64);
  if (!lead || !token || !(await unsubscribe(lead, token))) return page("Link not valid", "This unsubscribe link isn't valid. Reply to the email and we'll remove you by hand.", 400);
  return page("You're unsubscribed", "MECGURA won't send you outreach emails again. Sorry for the trouble.");
}
