import { handle, ok, readJson } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { conversationStatusSchema } from "@/lib/validations";
import { assignmentHistory, getConversation, setConversationStatus } from "@/services/inbox/conversations";

type Ctx = { params: Promise<{ orgId: string; cid: string }> };

export const GET = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "inbox:read");
  return ok({ conversation: await getConversation(access, ids.cid), assignments: await assignmentHistory(access, ids.cid) });
});

export const PATCH = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "inbox:reply");
  const { status } = await readJson(req, conversationStatusSchema);
  return ok({ conversation: await setConversationStatus(access, ids.cid, status, req) });
});
