import { handle, ok, readQuery } from "@/lib/api";
import { requireSuperAdmin } from "@/lib/session";
import { adminList, adminListSchema, supportReport } from "@/services/support/tickets";

/** Support desk: tickets (SLA-breached and urgent first) and the 30-day resolution report. */
export const GET = handle(async (req) => {
  await requireSuperAdmin(req);
  const [tickets, report] = await Promise.all([adminList(readQuery(req, adminListSchema)), supportReport()]);
  return ok({ tickets, report });
});
