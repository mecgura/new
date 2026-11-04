import { clientIp, handle, ok, readJson } from "@/lib/api";
import { enforceRateLimit } from "@/lib/rate-limit";
import { createDraft, draftSchema } from "@/services/food/food";

type Ctx = { params: Promise<{ org: string; code: string }> };

/** Public: a guest built an order on the menu page. It's confirmed only when they send its code from WhatsApp. */
export const POST = handle<Ctx>(async (req, { params }) => {
  enforceRateLimit(`food-draft:${clientIp(req)}`, 12, 10 * 60_000);
  const { org, code } = await params;
  return ok(await createDraft(org.slice(0, 80), code.slice(0, 40), await readJson(req, draftSchema)), { status: 201 });
});
