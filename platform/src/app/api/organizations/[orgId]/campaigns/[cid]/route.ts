import { handle, ok, readJson } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { campaignUpdateSchema } from "@/lib/validations";
import { deleteCampaign, getCampaign, updateCampaign } from "@/services/campaigns/campaigns";

type Ctx = { params: Promise<{ orgId: string; cid: string }> };

export const GET = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "campaigns:read");
  return ok({ campaign: await getCampaign(access, ids.cid) });
});

export const PATCH = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "campaigns:manage");
  const input = await readJson(req, campaignUpdateSchema);
  return ok({ campaign: await updateCampaign(access, ids.cid, input, req) });
});

export const DELETE = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "campaigns:manage");
  await deleteCampaign(access, ids.cid, req);
  return ok({ ok: true });
});
