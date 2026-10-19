import { ApiError, handle, ok, readJson } from "@/lib/api";
import { enforceRateLimit } from "@/lib/rate-limit";
import { orgRoute } from "@/lib/route-helpers";
import { adStatusSchema } from "@/lib/validations";
import { changeStatus } from "@/services/ads/ads";

type Ctx = { params: Promise<{ orgId: string; adId: string }> };

/** Start, pause or archive an ad. Starting spends money, so the caller must confirm the budget. */
export const POST = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "ads:manage");
  enforceRateLimit(`ads-status:${access.user.id}`, 30, 60 * 60_000);
  const input = await readJson(req, adStatusSchema);
  if (input.action === "activate" && input.confirmBudget !== true) throw new ApiError("VALIDATION_ERROR", "Confirm the daily budget before starting the ad.", { details: { confirmBudget: ["Confirm the budget"] } });
  return ok({ ad: await changeStatus(access, ids.adId, input.action, req) });
});
