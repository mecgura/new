import { z } from "zod";
import { handle, ok, readQuery } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { aiUsage } from "@/services/ai/studio";

type Ctx = { params: Promise<{ orgId: string }> };

const query = z.object({ days: z.coerce.number().int().min(1).max(365).default(30) });

export const GET = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "ai:manage");
  return ok(await aiUsage(access.organizationId, readQuery(req, query).days));
});
