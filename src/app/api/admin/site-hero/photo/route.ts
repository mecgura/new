import { handle, ok, readJson } from "@/lib/api";
import { audit } from "@/lib/audit";
import { requireSuperAdmin } from "@/lib/session";
import { heroPhotoSchema, setHeroPhoto } from "@/services/site/hero";

export const maxDuration = 30;

/** Sets a slide's photo from an upload or an AI studio image, or removes it. */
export const PUT = handle(async (req) => {
  const admin = await requireSuperAdmin(req);
  const input = await readJson(req, heroPhotoSchema);
  const slides = await setHeroPhoto(input, admin.id);
  await audit({ action: "site.content_updated", actorUserId: admin.id, targetType: "home_hero_photo", targetId: input.slide, req });
  return ok({ slides });
});
