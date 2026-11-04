import { handle, ok, readJson } from "@/lib/api";
import { loyaltyRoute } from "@/services/loyalty/route-guard";
import { getLoyaltySettings, loyaltySettingsSchema, saveLoyaltySettings } from "@/services/loyalty/loyalty";

type Ctx = { params: Promise<{ orgId: string }> };

export const GET = handle<Ctx>(async (req, { params }) => {
  const { ctx } = await loyaltyRoute(req, params, "loyalty:read");
  return ok({ settings: await getLoyaltySettings(ctx.organizationId) });
});

export const PUT = handle<Ctx>(async (req, { params }) => {
  const { ctx } = await loyaltyRoute(req, params, "loyalty:manage");
  return ok({ settings: await saveLoyaltySettings(ctx, await readJson(req, loyaltySettingsSchema)) });
});
