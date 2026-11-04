import { handle, ok, readJson } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { createConnection, createConnectionSchema, listConnections } from "@/services/integrations/stores";

type Ctx = { params: Promise<{ orgId: string }> };

export const GET = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "webhooks:read");
  return ok({ connections: await listConnections(access) });
});

export const POST = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "webhooks:manage");
  return ok(await createConnection(access, await readJson(req, createConnectionSchema), req), { status: 201 });
});
