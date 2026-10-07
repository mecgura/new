import { handle, ok, readJson } from "@/lib/api";
import { enforceRateLimit } from "@/lib/rate-limit";
import { orgRoute } from "@/lib/route-helpers";
import { aiTestSchema } from "@/lib/validations";
import { testChat } from "@/services/ai/engine";

type Ctx = { params: Promise<{ orgId: string; aid: string }> };

/** Test chat: nothing is sent to WhatsApp and no CRM record changes. */
export const POST = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "ai:manage");
  enforceRateLimit(`ai-test:${access.user.id}`, 30, 60_000);
  const input = await readJson(req, aiTestSchema);
  return ok({ turn: await testChat(access, ids.aid, input) });
});
