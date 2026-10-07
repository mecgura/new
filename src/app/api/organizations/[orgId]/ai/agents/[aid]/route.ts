import { handle, ok, readJson } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { aiAgentUpdateSchema } from "@/lib/validations";
import { deleteAgent, getAgent, updateAgent } from "@/services/ai/agents";

type Ctx = { params: Promise<{ orgId: string; aid: string }> };

export const GET = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "ai:read");
  return ok({ agent: await getAgent(access.organizationId, ids.aid) });
});

export const PATCH = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "ai:manage");
  const input = await readJson(req, aiAgentUpdateSchema);
  return ok({ agent: await updateAgent(access, ids.aid, input, req) });
});

export const DELETE = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "ai:manage");
  await deleteAgent(access, ids.aid, req);
  return ok({ ok: true });
});
