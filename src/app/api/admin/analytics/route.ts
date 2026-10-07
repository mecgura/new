import { z } from "zod";
import { handle, ok, readQuery } from "@/lib/api";
import { requireSuperAdmin } from "@/lib/session";
import { getAdminAnalytics } from "@/services/analytics/admin";

const query = z.object({ days: z.coerce.number().int().min(7).max(90).default(30) });

export const GET = handle(async (req) => {
  await requireSuperAdmin(req);
  return ok(await getAdminAnalytics(readQuery(req, query).days));
});
