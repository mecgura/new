import { z } from "zod";
import { handle, ok, readQuery } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { usageSummary } from "@/services/api/keys";

type Ctx = { params: Promise<{ orgId: string }> };
const query = z.object({ days: z.coerce.number().int().min(1).max(30).default(14) });

export const GET = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "api:read");
  return ok(await usageSummary(access.organizationId, readQuery(req, query).days));
});
