import { clientIp, handle, ok, readJson } from "@/lib/api";
import { enforceRateLimit } from "@/lib/rate-limit";
import { rateSchema, submitFeedback } from "@/services/reviews/reviews";

type Ctx = { params: Promise<{ token: string }> };

/** Public: the customer's rating from their feedback link. */
export const POST = handle<Ctx>(async (req, { params }) => {
  enforceRateLimit(`feedback:${clientIp(req)}`, 20, 60_000);
  const { token } = await params;
  return ok(await submitFeedback(token.slice(0, 40), await readJson(req, rateSchema)));
});
