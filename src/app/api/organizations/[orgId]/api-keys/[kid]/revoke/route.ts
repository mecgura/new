import { handle, ok } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { revokeKey } from "@/services/api/keys";

type Ctx = { params: Promise<{ orgId: string; kid: string }> };

export const POST = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "api:manage");
  return ok({ key: await revokeKey(access, ids.kid, req) });
});
