import { handle, ok, readJson } from "@/lib/api";
import { requireSuperAdmin } from "@/lib/session";
import { enforceRateLimit } from "@/lib/rate-limit";
import { searchPlaces, searchSchema } from "@/services/marketing/outreach";

/** Businesses on Google Maps for a category/keyword and city (not stored). */
export const POST = handle(async (req) => {
  const admin = await requireSuperAdmin(req);
  enforceRateLimit(`maps-search:${admin.id}`, 30, 60_000);
  return ok(await searchPlaces(await readJson(req, searchSchema)));
});
