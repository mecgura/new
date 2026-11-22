import { handle, ok, readJson, clientIp } from "@/lib/api";
import { enforceRateLimit } from "@/lib/rate-limit";
import { decisionSchema, getReviewView, submitReviewDecision } from "@/services/onepost/review-link";

type Ctx = { params: Promise<{ token: string }> };
const NO_STORE = { "cache-control": "no-store", "referrer-policy": "no-referrer", "x-robots-tag": "noindex" };

/** Public (no login): the post a client was asked to review. The long random link is the key; it expires and is tied to the exact content shown. */
export const GET = handle<Ctx>(async (req, { params }) => {
  enforceRateLimit(`onepost-review-get:${clientIp(req)}`, 120, 15 * 60_000);
  return ok(await getReviewView((await params).token), { headers: NO_STORE });
});

/** Public (no login): the client's approval or request for changes. One answer per link. */
export const POST = handle<Ctx>(async (req, { params }) => {
  enforceRateLimit(`onepost-review-post:${clientIp(req)}`, 15, 15 * 60_000);
  return ok(await submitReviewDecision((await params).token, await readJson(req, decisionSchema), req), { headers: NO_STORE });
});
