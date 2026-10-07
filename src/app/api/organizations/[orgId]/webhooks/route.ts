import { handle, ok, readJson } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { webhookEndpointSchema } from "@/lib/webhook-events";
import { createEndpoint, listEndpoints } from "@/services/webhooks/endpoints";

type Ctx = { params: Promise<{ orgId: string }> };

export const GET = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "webhooks:read");
  return ok({ endpoints: await listEndpoints(access.organizationId) });
});

/** The response carries the signing secret exactly once. */
export const POST = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "webhooks:manage");
  const input = await readJson(req, webhookEndpointSchema);
  return ok(await createEndpoint(access, input, req), { status: 201, headers: { "Cache-Control": "no-store" } });
});
