import { handle, ok, readJson } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { adSchema, deleteAd, updateAd } from "@/services/sponsored/sponsored";

type Ctx = { params: Promise<{ orgId: string; id: string }> };

export const PUT = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "sponsored:manage");
  return ok({ ad: await updateAd(access, ids.id, await readJson(req, adSchema), req) });
});

export const DELETE = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "sponsored:manage");
  await deleteAd(access, ids.id, req);
  return ok({ deleted: true });
});
