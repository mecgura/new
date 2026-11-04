import { handle, ok } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { deleteAsset } from "@/services/social/assets";

type Ctx = { params: Promise<{ orgId: string; assetId: string }> };

export const DELETE = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "social:manage");
  await deleteAsset(access, ids.assetId);
  return ok({ ok: true });
});
