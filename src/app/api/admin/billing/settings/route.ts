import { handle, ok, readJson } from "@/lib/api";
import { audit } from "@/lib/audit";
import { requireSuperAdmin } from "@/lib/session";
import { billingSettingsSchema, getBillingSettings, saveBillingSettings } from "@/services/billing/settings";

export const GET = handle(async (req) => {
  await requireSuperAdmin(req);
  return ok({ settings: await getBillingSettings() });
});

export const PUT = handle(async (req) => {
  const admin = await requireSuperAdmin(req);
  const input = await readJson(req, billingSettingsSchema);
  await saveBillingSettings(input);
  await audit({ action: "billing.settings_updated", actorUserId: admin.id, targetType: "billing", metadata: { taxPercent: input.taxPercent, dueDays: input.dueDays, graceDays: input.graceDays }, req });
  return ok({ settings: await getBillingSettings() });
});
