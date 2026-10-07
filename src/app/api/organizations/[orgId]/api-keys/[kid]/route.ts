import { handle, ok, readJson } from "@/lib/api";
import { apiKeyUpdateSchema } from "@/lib/api-keys";
import { orgRoute } from "@/lib/route-helpers";
import { updateKey } from "@/services/api/keys";

type Ctx = { params: Promise<{ orgId: string; kid: string }> };

export const PATCH = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "api:manage");
  const input = await readJson(req, apiKeyUpdateSchema);
  return ok({ key: await updateKey(access, ids.kid, input, req) });
});
