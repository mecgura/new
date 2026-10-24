import { handle, ok } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { getCall } from "@/services/calls/whatsapp-calls";

type Ctx = { params: Promise<{ orgId: string; callId: string }> };

export const GET = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "inbox:read");
  return ok({ call: await getCall(access, ids.callId) });
});
