import { handle, ok } from "@/lib/api";
import { requireSuperAdmin } from "@/lib/session";
import { readinessList } from "@/services/admin/readiness";

export const GET = handle(async (req) => {
  await requireSuperAdmin(req);
  return ok(await readinessList());
});
