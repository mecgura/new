import { handle, ok, readJson } from "@/lib/api";
import { audit } from "@/lib/audit";
import { requireSuperAdmin } from "@/lib/session";
import { getMetaRates, metaRatesSchema, saveMetaRates } from "@/services/meta-rates";

/** Meta's per-message rates (paise) used for cost estimates. */
export const GET = handle(async (req) => {
  await requireSuperAdmin(req);
  return ok({ rates: await getMetaRates() });
});

export const PUT = handle(async (req) => {
  const admin = await requireSuperAdmin(req);
  const rates = await saveMetaRates(await readJson(req, metaRatesSchema));
  await audit({ action: "wallet.settings_updated", actorUserId: admin.id, targetType: "meta_rates", metadata: { metaRates: rates }, req });
  return ok({ rates });
});
