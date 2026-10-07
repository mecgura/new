import { handle, ok, readJson } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { demoInboundSchema } from "@/lib/validations";
import { simulateInbound } from "@/services/inbox/messaging";

type Ctx = { params: Promise<{ orgId: string }> };

/** Demo numbers only: simulates a customer message arriving (labelled demo everywhere). */
export const POST = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "inbox:reply");
  const input = await readJson(req, demoInboundSchema);
  return ok(await simulateInbound(access, input), { status: 201 });
});
