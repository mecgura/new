import { handle, ok, readJson } from "@/lib/api";
import { requireSuperAdmin } from "@/lib/session";
import { addProspects, addSchema } from "@/services/marketing/outreach";

/** Adds chosen Maps results to Marketing → Leads (a number already there gets a note, not a duplicate). */
export const POST = handle(async (req) => {
  const admin = await requireSuperAdmin(req);
  return ok(await addProspects(await readJson(req, addSchema), admin.id, req));
});
