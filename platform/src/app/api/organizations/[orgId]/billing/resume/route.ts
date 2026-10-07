import { handle, ok } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { resumeSubscription } from "@/services/billing/billing";

type Ctx = { params: Promise<{ orgId: string }> };

/** Undo a scheduled cancellation or downgrade. */
export const POST = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "billing:manage");
  await resumeSubscription(access, req);
  return ok({ ok: true });
});
