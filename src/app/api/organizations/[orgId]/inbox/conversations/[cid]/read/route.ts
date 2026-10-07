import { handle, ok } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { markConversationRead } from "@/services/inbox/conversations";

type Ctx = { params: Promise<{ orgId: string; cid: string }> };

export const POST = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "inbox:read");
  await markConversationRead(access, ids.cid);
  return ok({ ok: true });
});
