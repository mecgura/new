import { handle, ok, readJson } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { webhookEndpointUpdateSchema } from "@/lib/webhook-events";
import { deleteEndpoint, getEndpoint, updateEndpoint } from "@/services/webhooks/endpoints";

type Ctx = { params: Promise<{ orgId: string; wid: string }> };

export const GET = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "webhooks:read");
  return ok({ endpoint: await getEndpoint(access.organizationId, ids.wid) });
});

export const PATCH = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "webhooks:manage");
  const input = await readJson(req, webhookEndpointUpdateSchema);
  return ok({ endpoint: await updateEndpoint(access, ids.wid, input, req) });
});

export const DELETE = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "webhooks:manage");
  await deleteEndpoint(access, ids.wid, req);
  return ok({ ok: true });
});
