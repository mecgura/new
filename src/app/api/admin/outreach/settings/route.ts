import { handle, ok, readJson } from "@/lib/api";
import { requireSuperAdmin } from "@/lib/session";
import { saveOutreachSettings, settingsSchema } from "@/services/marketing/outreach";

/** Outreach message templates and daily limits. */
export const PUT = handle(async (req) => {
  const admin = await requireSuperAdmin(req);
  return ok({ settings: await saveOutreachSettings(await readJson(req, settingsSchema), admin.id, req) });
});
