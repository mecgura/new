import { handle, ok } from "@/lib/api";
import { requireSuperAdmin } from "@/lib/session";
import { CATEGORIES, outreachQueue, placesConfigured } from "@/services/marketing/outreach";

/** Outreach overview: categories, whether Maps is connected, the WhatsApp queue and today's limits. */
export const GET = handle(async (req) => {
  await requireSuperAdmin(req);
  return ok({ categories: CATEGORIES, mapsReady: placesConfigured(), ...(await outreachQueue()) });
});
