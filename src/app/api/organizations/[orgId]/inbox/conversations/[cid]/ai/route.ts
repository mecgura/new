import { handle, ok, readJson } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { aiConversationActionSchema } from "@/lib/validations";
import { getVisibleConversation } from "@/services/inbox/conversations";
import { conversationAiAction, conversationAiState } from "@/services/ai/engine";

type Ctx = { params: Promise<{ orgId: string; cid: string }> };

/** The AI agent's state in this chat (which agent, active / handed off, live or demo). */
export const GET = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "inbox:read");
  const c = await getVisibleConversation(access, ids.cid);
  return ok({ ai: await conversationAiState(access.organizationId, c) });
});

/** pause = AI stops in this chat; resume = hand the chat back to the AI; summarize = internal note. */
export const POST = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "inbox:reply");
  await getVisibleConversation(access, ids.cid);
  const { action } = await readJson(req, aiConversationActionSchema);
  const result = await conversationAiAction(access, ids.cid, action);
  const c = await getVisibleConversation(access, ids.cid);
  return ok({ ...result, ai: await conversationAiState(access.organizationId, c) });
});
