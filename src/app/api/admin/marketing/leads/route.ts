import { handle, ok, readJson, readQuery } from "@/lib/api";
import { requireSuperAdmin } from "@/lib/session";
import { listLeads, listQuerySchema, newLeadSchema, recordLead, todayQueue } from "@/services/marketing/leads";

/** MECGURA's sales pipeline and today's call list. */
export const GET = handle(async (req) => {
  await requireSuperAdmin(req);
  const [leads, today] = await Promise.all([listLeads(readQuery(req, listQuerySchema)), todayQueue()]);
  return ok({ leads, today });
});

/** Add a lead by hand (a number that already exists gets a note instead of a duplicate). */
export const POST = handle(async (req) => {
  const admin = await requireSuperAdmin(req);
  const r = await recordLead(await readJson(req, newLeadSchema), admin.id, req);
  return ok(r, { status: r.created ? 201 : 200 });
});
