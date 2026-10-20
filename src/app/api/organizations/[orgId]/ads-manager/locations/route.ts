import { z } from "zod";
import { handle, ok, readQuery } from "@/lib/api";
import { enforceRateLimit } from "@/lib/rate-limit";
import { orgRoute } from "@/lib/route-helpers";
import { findLocations } from "@/services/ads/ads";

type Ctx = { params: Promise<{ orgId: string }> };
const querySchema = z.object({ q: z.string().trim().min(2, "Type at least 2 letters").max(60) });

/** Indian states and cities for ad targeting (looked up on Meta with the workspace's ad token). */
export const GET = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "ads:manage");
  enforceRateLimit(`ads-geo:${access.user.id}`, 120, 60 * 60_000);
  const { q } = readQuery(req, querySchema);
  return ok({ locations: await findLocations(access, q) });
});
