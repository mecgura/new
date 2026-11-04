import { handle, ok } from "@/lib/api";
import { requireSuperAdmin } from "@/lib/session";
import { syncAutopay } from "@/services/billing/autopay";

type Ctx = { params: Promise<{ id: string }> };

/** Reconcile one mandate: Razorpay's status and charge count vs what MECGURA recorded. */
export const POST = handle<Ctx>(async (req, { params }) => {
  await requireSuperAdmin(req);
  return ok(await syncAutopay((await params).id));
});
