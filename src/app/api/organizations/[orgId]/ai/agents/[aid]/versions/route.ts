import { handle, ok } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { listVersions } from "@/services/ai/studio";

type Ctx = { params: Promise<{ orgId: string; aid: string }> };

export const GET = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "ai:manage");
  return ok({ versions: await listVersions(access.organizationId, ids.aid) });
});
