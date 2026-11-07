import { handle, ok, readJson } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { adSchema, createAd, listMine } from "@/services/sponsored/sponsored";

type Ctx = { params: Promise<{ orgId: string }> };

export const GET = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "sponsored:read");
  return ok({ ads: await listMine(access.organizationId) });
});

export const POST = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "sponsored:manage");
  return ok({ ad: await createAd(access, await readJson(req, adSchema), req) }, { status: 201 });
});
