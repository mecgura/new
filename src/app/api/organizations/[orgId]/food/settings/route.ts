import { handle, ok, readJson } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { getSettings, saveSettings, settingsSchema } from "@/services/food/food";

type Ctx = { params: Promise<{ orgId: string }> };

export const GET = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "food:manage");
  return ok(await getSettings(access.organizationId));
});

/** Payment options, WhatsApp number, tax and the client's own Razorpay keys (secrets are write-only). */
export const PUT = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "food:manage");
  return ok({ settings: await saveSettings(access, await readJson(req, settingsSchema), req) });
});
