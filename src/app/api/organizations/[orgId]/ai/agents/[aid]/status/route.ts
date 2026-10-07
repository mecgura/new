import { handle, ok, readJson } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { aiStatusSchema } from "@/lib/validations";
import { setAgentStatus } from "@/services/ai/agents";

type Ctx = { params: Promise<{ orgId: string; aid: string }> };

/** Activate or pause an agent (only one active agent per WhatsApp number). */
export const POST = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "ai:manage");
  const { status } = await readJson(req, aiStatusSchema);
  return ok({ agent: await setAgentStatus(access, ids.aid, status, req) });
});
