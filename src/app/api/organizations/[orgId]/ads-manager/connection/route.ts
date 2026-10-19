import { handle, ok, readJson } from "@/lib/api";
import { enforceRateLimit } from "@/lib/rate-limit";
import { orgRoute } from "@/lib/route-helpers";
import { adConnectSchema } from "@/lib/validations";
import { connectAdAccount, disconnectAdAccount } from "@/services/ads/ads";

type Ctx = { params: Promise<{ orgId: string }> };

/** Link the Meta ad account and Facebook Page. The token is verified with Meta, stored encrypted and never returned. */
export const PUT = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "ads:connect");
  enforceRateLimit(`ads-connect:${access.user.id}`, 10, 15 * 60_000);
  const input = await readJson(req, adConnectSchema);
  return ok(await connectAdAccount(access, input, req));
});

export const DELETE = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "ads:connect");
  await disconnectAdAccount(access);
  return ok({ disconnected: true });
});
