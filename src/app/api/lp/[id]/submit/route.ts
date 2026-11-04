import { clientIp, handle, ok, readJson } from "@/lib/api";
import { enforceRateLimit } from "@/lib/rate-limit";
import { submitForm, submitSchema } from "@/services/landing/pages";

type Ctx = { params: Promise<{ id: string }> };

/** Public: a visitor sent a landing page's lead form. */
export const POST = handle<Ctx>(async (req, { params }) => {
  enforceRateLimit(`lp-submit:${clientIp(req)}`, 8, 60_000);
  return ok(await submitForm((await params).id, await readJson(req, submitSchema)));
});
