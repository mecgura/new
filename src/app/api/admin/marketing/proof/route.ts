import { handle, ok } from "@/lib/api";
import { requireSuperAdmin } from "@/lib/session";
import { proofStats } from "@/services/marketing/stats";

/** Real platform totals (last 30 days, no client named) for proof posts in the creative maker. */
export const GET = handle(async (req) => {
  await requireSuperAdmin(req);
  return ok(await proofStats(30));
});
