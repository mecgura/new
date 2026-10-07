import { handle, ok, readJson } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { assignSchema } from "@/lib/validations";
import { assignConversation } from "@/services/inbox/conversations";

type Ctx = { params: Promise<{ orgId: string; cid: string }> };

/** Assign / claim / transfer / unassign — the service enforces who may do which. */
export const POST = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "inbox:read");
  const { toUserId, note } = await readJson(req, assignSchema);
  return ok({ conversation: await assignConversation(access, ids.cid, toUserId, note, req) });
});
