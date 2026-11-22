import { clientIp } from "@/lib/api";
import { enforceRateLimit } from "@/lib/rate-limit";
import { recordOpen } from "@/services/onepost/pr";

type Ctx = { params: Promise<{ token: string }> };
// 1x1 transparent GIF
const GIF = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");

/** Public: the tiny image in a pitch email. Counts an open (email apps may block or pre-load it, so this is only a rough signal). */
export async function GET(req: Request, { params }: Ctx) {
  try {
    enforceRateLimit(`onepost-open:${clientIp(req)}`, 300, 15 * 60_000);
    await recordOpen((await params).token);
  } catch {
    /* always return the image */
  }
  return new Response(GIF, { headers: { "content-type": "image/gif", "cache-control": "no-store, max-age=0" } });
}
