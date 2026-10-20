import { handle, ok, readJson } from "@/lib/api";
import { audit } from "@/lib/audit";
import { requireSuperAdmin } from "@/lib/session";
import { festivalsSchema, getFestivals, saveFestivals } from "@/services/site/festivals";

/** Festival calendar: greetings, offers and screen effects for the home page and client panels. */
export const GET = handle(async (req) => {
  await requireSuperAdmin(req);
  return ok(await getFestivals());
});

export const PUT = handle(async (req) => {
  const admin = await requireSuperAdmin(req);
  const input = await readJson(req, festivalsSchema);
  const saved = await saveFestivals(input);
  await audit({ action: "site.content_updated", actorUserId: admin.id, targetType: "festivals", metadata: { festivals: saved.festivals.length, enabled: saved.enabled }, req });
  return ok(saved);
});
