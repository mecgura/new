import { z } from "zod";
import { handle, ok, readQuery } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { getUsage, getUsageHistory } from "@/services/billing/usage";

type Ctx = { params: Promise<{ orgId: string }> };
const query = z.object({ days: z.coerce.number().int().min(7).max(90).default(30) });

export const GET = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "billing:read");
  const { days } = readQuery(req, query);
  const [usage, history] = await Promise.all([getUsage(access.organizationId), getUsageHistory(access.organizationId, days)]);
  return ok({ ...usage, history });
});
