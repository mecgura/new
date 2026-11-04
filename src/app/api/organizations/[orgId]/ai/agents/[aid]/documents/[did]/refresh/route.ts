import { handle, ok } from "@/lib/api";
import { enforceRateLimit } from "@/lib/rate-limit";
import { orgRoute } from "@/lib/route-helpers";
import { refreshWebsitePage } from "@/services/ai/studio";

type Ctx = { params: Promise<{ orgId: string; aid: string; did: string }> };

export const POST = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "ai:manage");
  enforceRateLimit(`ai-import:${access.organizationId}`, 20, 3_600_000);
  return ok({ document: await refreshWebsitePage(access, ids.aid, ids.did) });
});
