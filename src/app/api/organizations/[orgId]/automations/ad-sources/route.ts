import { handle, ok } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { listAdSources } from "@/services/automations/automations";

type Ctx = { params: Promise<{ orgId: string }> };

/** Ads an "Ad click" trigger can pick: ads made in MECGURA plus any ad customers have already arrived from. */
export const GET = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "automations:read");
  return ok({ ads: await listAdSources(access.organizationId) });
});
