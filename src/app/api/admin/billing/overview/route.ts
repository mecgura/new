import { handle, ok } from "@/lib/api";
import { requireSuperAdmin } from "@/lib/session";
import { adminBillingOverview } from "@/services/billing/admin";
import { allGateways, availableGateways } from "@/providers/payments/registry";

export const GET = handle(async (req) => {
  await requireSuperAdmin(req);
  return ok({ ...(await adminBillingOverview()), gateways: { known: allGateways(), connected: await availableGateways() } });
});
