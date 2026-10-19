import { handle, ok, readJson } from "@/lib/api";
import { requireSuperAdmin } from "@/lib/session";
import { idSchema, walletPricesSchema } from "@/lib/validations";
import { getPriceCard, setPrices } from "@/services/wallet-pricing";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle<Ctx>(async (req, { params }) => {
  await requireSuperAdmin(req);
  return ok({ card: await getPriceCard(idSchema.parse((await params).id)) });
});

/** Client-specific fees: a number sets an override, null goes back to the default. */
export const PUT = handle<Ctx>(async (req, { params }) => {
  const admin = await requireSuperAdmin(req);
  const id = idSchema.parse((await params).id);
  const input = await readJson(req, walletPricesSchema);
  await setPrices(id, input, admin.id, req);
  return ok({ card: await getPriceCard(id) });
});
