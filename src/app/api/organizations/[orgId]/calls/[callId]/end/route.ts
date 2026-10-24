import { handle, ok } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { hangUp } from "@/services/calls/whatsapp-calls";

type Ctx = { params: Promise<{ orgId: string; callId: string }> };

/** Hangs up (or declines a ringing call). */
export const POST = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "inbox:reply");
  return ok({ call: await hangUp(access, ids.callId) });
});
