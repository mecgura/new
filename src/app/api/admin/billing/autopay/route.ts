import { handle, ok } from "@/lib/api";
import { requireSuperAdmin } from "@/lib/session";
import { adminAutopayList } from "@/services/billing/autopay";

export const GET = handle(async (req) => {
  await requireSuperAdmin(req);
  return ok(await adminAutopayList());
});
