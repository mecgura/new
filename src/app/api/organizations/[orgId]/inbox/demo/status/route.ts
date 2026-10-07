import { handle, ok, readJson } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { demoStatusSchema } from "@/lib/validations";
import { simulateStatus } from "@/services/inbox/messaging";

type Ctx = { params: Promise<{ orgId: string }> };

/** Demo numbers only: simulates delivered / read / failed receipts. */
export const POST = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "inbox:reply");
  const { messageId, status } = await readJson(req, demoStatusSchema);
  return ok({ message: await simulateStatus(access, messageId, status) });
});
