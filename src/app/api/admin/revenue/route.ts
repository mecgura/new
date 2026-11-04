import { handle, ok } from "@/lib/api";
import { requireSuperAdmin } from "@/lib/session";
import { revenueAnalytics } from "@/services/billing/revenue";

/** MRR trend, ARR, movements, churn, renewals, revenue by client and plan, wallet ledger and reconciliation. */
export const GET = handle(async (req) => {
  await requireSuperAdmin(req);
  return ok(await revenueAnalytics());
});
