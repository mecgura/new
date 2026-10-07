import { handle, ok, readQuery } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { paginationSchema } from "@/lib/validations";
import { listInteractions } from "@/services/ai/agents";

type Ctx = { params: Promise<{ orgId: string; aid: string }> };

export const GET = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "ai:read");
  return ok(await listInteractions(access.organizationId, ids.aid, readQuery(req, paginationSchema)));
});
