import { handle, ok, readJson } from "@/lib/api";
import { apiKeyRotateSchema } from "@/lib/api-keys";
import { enforceRateLimit } from "@/lib/rate-limit";
import { orgRoute } from "@/lib/route-helpers";
import { rotateKey } from "@/services/api/keys";

type Ctx = { params: Promise<{ orgId: string; kid: string }> };

export const POST = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "api:manage");
  enforceRateLimit(`api-key-create:${access.user.id}`, 20, 60 * 60_000);
  const { graceHours } = await readJson(req, apiKeyRotateSchema);
  return ok(await rotateKey(access, ids.kid, graceHours, req), { status: 201, headers: { "Cache-Control": "no-store" } });
});
