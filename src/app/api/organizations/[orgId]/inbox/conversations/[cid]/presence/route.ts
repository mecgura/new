import { z } from "zod";
import { handle, ok, readJson } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { getVisibleConversation } from "@/services/inbox/conversations";
import { heartbeat } from "@/services/inbox/sla";

type Ctx = { params: Promise<{ orgId: string; cid: string }> };

/** "I'm looking at / typing in this chat" — returns teammates doing the same right now (collision warning). */
export const POST = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "inbox:read");
  await getVisibleConversation(access, ids.cid);
  const { typing } = await readJson(req, z.object({ typing: z.boolean().default(false) }).strict());
  return ok({ others: await heartbeat(access, ids.cid, typing) });
});
