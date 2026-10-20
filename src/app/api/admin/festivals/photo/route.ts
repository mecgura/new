import { handle, ok, readJson } from "@/lib/api";
import { requireSuperAdmin } from "@/lib/session";
import { photoSchema, saveFestivalPhoto } from "@/services/site/festivals";

/** Sets (or clears, with an empty string) one festival's banner photo. */
export const PUT = handle(async (req) => {
  await requireSuperAdmin(req);
  const { id, photo } = await readJson(req, photoSchema);
  await saveFestivalPhoto(id, photo);
  return ok({ id, hasPhoto: Boolean(photo) });
});
