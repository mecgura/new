import { z } from "zod";
import { handle, ok, readQuery } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { getAdsSummary } from "@/services/analytics/ads";

type Ctx = { params: Promise<{ orgId: string }> };
const query = z.object({ days: z.coerce.number().int().min(1).max(365).default(30) });

/** Click-to-WhatsApp ad results for this workspace. */
export const GET = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "analytics:read");
  const q = readQuery(req, query);
  return ok(await getAdsSummary(access.organizationId, q.days));
});
