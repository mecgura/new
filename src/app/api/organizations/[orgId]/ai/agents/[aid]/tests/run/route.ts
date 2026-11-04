import { z } from "zod";
import { handle, ok, readJson } from "@/lib/api";
import { enforceRateLimit } from "@/lib/rate-limit";
import { orgRoute } from "@/lib/route-helpers";
import { runCases } from "@/services/ai/evals";

export const maxDuration = 300;
type Ctx = { params: Promise<{ orgId: string; aid: string }> };
const schema = z.object({ mode: z.enum(["live", "demo"]), ids: z.array(z.string().max(40)).max(30).optional() }).strict();

/** Runs the agent's automated tests. Nothing is sent to customers and no CRM record changes. */
export const POST = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "ai:manage");
  enforceRateLimit(`ai-evals:${access.organizationId}`, 10, 60 * 60_000);
  return ok(await runCases(access, ids.aid, await readJson(req, schema)));
});
