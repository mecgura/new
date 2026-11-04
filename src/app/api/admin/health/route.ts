import { handle, ok } from "@/lib/api";
import { requireSuperAdmin } from "@/lib/session";
import { recentFailures, systemHealth } from "@/services/admin/system-health";

/** Service health checks and the latest failures across the platform. */
export const GET = handle(async (req) => {
  await requireSuperAdmin(req);
  const [health, failures] = await Promise.all([systemHealth(), recentFailures()]);
  return ok({ ...health, failures });
});
