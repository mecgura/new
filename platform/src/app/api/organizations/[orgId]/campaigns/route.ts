import { handle, ok, readJson, readQuery } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { campaignCreateSchema, campaignListSchema } from "@/lib/validations";
import { createCampaign, listCampaigns } from "@/services/campaigns/campaigns";

type Ctx = { params: Promise<{ orgId: string }> };

export const GET = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "campaigns:read");
  const q = readQuery(req, campaignListSchema);
  return ok(await listCampaigns(access, { status: q.status || undefined, q: q.q || undefined }));
});

export const POST = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "campaigns:manage");
  const input = await readJson(req, campaignCreateSchema);
  return ok({ campaign: await createCampaign(access, input, req) }, { status: 201 });
});
