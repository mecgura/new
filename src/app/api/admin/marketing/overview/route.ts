import { z } from "zod";
import { handle, ok, readQuery } from "@/lib/api";
import { requireSuperAdmin } from "@/lib/session";
import { marketingOverview } from "@/services/marketing/stats";

const q = z.object({ days: z.coerce.number().int().refine((n) => [7, 30, 90].includes(n)).default(30) });

/** Website traffic, sources, the lead funnel and money won (Super Admin). */
export const GET = handle(async (req) => {
  await requireSuperAdmin(req);
  return ok(await marketingOverview(readQuery(req, q).days));
});
