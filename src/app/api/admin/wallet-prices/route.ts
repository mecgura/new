import { handle, ok, readJson } from "@/lib/api";
import { requireSuperAdmin } from "@/lib/session";
import { walletPricesSchema } from "@/lib/validations";
import { getDefaultPrices, setPrices } from "@/services/wallet-pricing";

/** Default per-message MECGURA fee (paise) for every client. A client can have its own override. */
export const GET = handle(async (req) => {
  await requireSuperAdmin(req);
  return ok({ prices: await getDefaultPrices() });
});

export const PUT = handle(async (req) => {
  const admin = await requireSuperAdmin(req);
  const input = await readJson(req, walletPricesSchema);
  await setPrices(null, input, admin.id, req);
  return ok({ prices: await getDefaultPrices() });
});
