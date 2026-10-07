import { handle, ok } from "@/lib/api";
import { requireSuperAdmin } from "@/lib/session";
import { runBillingCycle } from "@/services/billing/billing";

/** Runs the renewal / scheduled-change / overdue pass now (the scheduler also runs it every minute). Idempotent. */
export const POST = handle(async (req) => {
  await requireSuperAdmin(req);
  return ok({ result: await runBillingCycle() });
});
