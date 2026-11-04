import { handle, ok } from "@/lib/api";
import { requireSuperAdmin } from "@/lib/session";
import { securityOverview } from "@/services/admin/security";
import { adminDataRequests } from "@/services/account/data";

export const GET = handle(async (req) => {
  await requireSuperAdmin(req);
  const [overview, requests] = await Promise.all([securityOverview(), adminDataRequests()]);
  const now = Date.now();
  return ok({ ...overview, dataRequests: requests.map((r) => ({ ...r, canExecute: r.status === "pending" && r.earliestAt.getTime() <= now })) });
});
