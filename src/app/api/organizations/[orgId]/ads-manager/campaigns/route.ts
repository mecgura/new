import { handle, ok, readJson } from "@/lib/api";
import { enforceRateLimit } from "@/lib/rate-limit";
import { orgRoute } from "@/lib/route-helpers";
import { adCreateSchema } from "@/lib/validations";
import { createAd } from "@/services/ads/ads";

type Ctx = { params: Promise<{ orgId: string }> };

/** Creates a click-to-WhatsApp ad on Meta. It is always created PAUSED; starting it is a separate confirmed step. */
export const POST = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "ads:manage");
  enforceRateLimit(`ads-create:${access.user.id}`, 10, 60 * 60_000);
  const input = await readJson(req, adCreateSchema);
  return ok({ ad: await createAd(access, input, req) }, { status: 201 });
});
