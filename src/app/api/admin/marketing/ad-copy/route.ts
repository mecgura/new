import { handle, ok, readJson } from "@/lib/api";
import { requireSuperAdmin } from "@/lib/session";
import { enforceRateLimit } from "@/lib/rate-limit";
import { copySchema, writeAdCopy } from "@/services/marketing/ai-studio";

export const maxDuration = 60;

/** Three headlines, three primary texts, a call to action and hashtags for an ad. */
export const POST = handle(async (req) => {
  const admin = await requireSuperAdmin(req);
  enforceRateLimit(`ai-copy:${admin.id}`, 10, 60_000);
  return ok({ copy: await writeAdCopy(await readJson(req, copySchema), admin.id, req) });
});
