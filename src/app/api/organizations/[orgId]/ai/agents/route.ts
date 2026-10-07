import { handle, ok, readJson } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { aiAgentSchema } from "@/lib/validations";
import { createAgent, listAgents } from "@/services/ai/agents";

type Ctx = { params: Promise<{ orgId: string }> };

export const GET = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "ai:read");
  return ok(await listAgents(access.organizationId));
});

export const POST = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "ai:manage");
  const input = await readJson(req, aiAgentSchema);
  return ok({ agent: await createAgent(access, input, req) }, { status: 201 });
});
