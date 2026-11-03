import { handle, ok, readJson } from "@/lib/api";
import { audit } from "@/lib/audit";
import { requireSuperAdmin } from "@/lib/session";
import { getHero, heroTextSchema, saveHeroText } from "@/services/site/hero";

/** Home page hero slides (headline, description, on/off, photo). */
export const GET = handle(async (req) => {
  await requireSuperAdmin(req);
  return ok({ slides: await getHero() });
});

export const PUT = handle(async (req) => {
  const admin = await requireSuperAdmin(req);
  const slides = await saveHeroText(await readJson(req, heroTextSchema));
  await audit({ action: "site.content_updated", actorUserId: admin.id, targetType: "home_hero", req });
  return ok({ slides });
});
