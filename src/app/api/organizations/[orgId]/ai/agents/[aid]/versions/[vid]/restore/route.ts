import { handle, ok } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { getAgent } from "@/services/ai/agents";
import { restoreVersion } from "@/services/ai/studio";

type Ctx = { params: Promise<{ orgId: string; aid: string; vid: string }> };

export const POST = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "ai:manage");
  const r = await restoreVersion(access, ids.aid, ids.vid, req);
  return ok({ restored: r.version, agent: await getAgent(access.organizationId, ids.aid) });
});
