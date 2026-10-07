import { z } from "zod";
import { handle, ok, readQuery } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { getClientAnalytics } from "@/services/analytics/client";
import { assertFeature } from "@/services/billing/entitlements";

type Ctx = { params: Promise<{ orgId: string }> };
const query = z.object({ days: z.coerce.number().int().min(7).max(90).default(30), numberId: z.string().max(64).optional().default("") });

export const GET = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "analytics:read");
  await assertFeature(access.organizationId, "analytics");
  const q = readQuery(req, query);
  return ok(await getClientAnalytics(access.organizationId, { days: q.days, numberId: q.numberId || undefined }));
});
