import { handle, ok, readJson } from "@/lib/api";
import { apiKeyCreateSchema } from "@/lib/api-keys";
import { enforceRateLimit } from "@/lib/rate-limit";
import { orgRoute } from "@/lib/route-helpers";
import { createKey, listKeys } from "@/services/api/keys";

type Ctx = { params: Promise<{ orgId: string }> };

export const GET = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "api:read");
  return ok({ keys: await listKeys(access.organizationId) });
});

/** The response carries the full secret exactly once. It is never retrievable again. */
export const POST = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "api:manage");
  enforceRateLimit(`api-key-create:${access.user.id}`, 20, 60 * 60_000);
  const input = await readJson(req, apiKeyCreateSchema);
  return ok(await createKey(access, input, req), { status: 201, headers: { "Cache-Control": "no-store" } });
});
