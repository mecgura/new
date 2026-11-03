import { handle, ok, readJson } from "@/lib/api";
import { requireSuperAdmin } from "@/lib/session";
import { emailBatchSchema, sendEmailBatch } from "@/services/marketing/outreach";

export const maxDuration = 60;

/** Sends the outreach email to chosen leads, within today's limit, each with an unsubscribe link. */
export const POST = handle(async (req) => {
  const admin = await requireSuperAdmin(req);
  return ok(await sendEmailBatch(await readJson(req, emailBatchSchema), admin.id, req));
});
