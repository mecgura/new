import { handle, ok, readJson } from "@/lib/api";
import { enforceRateLimit } from "@/lib/rate-limit";
import { orgRoute } from "@/lib/route-helpers";
import { walletTopupSchema } from "@/lib/validations";
import { createTopupInvoice } from "@/services/billing/billing";

type Ctx = { params: Promise<{ orgId: string }> };

/** Starts an online top-up: returns an open invoice to pay through the normal checkout. */
export const POST = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "billing:manage");
  enforceRateLimit(`topup:${access.user.id}`, 10, 60 * 60_000);
  const input = await readJson(req, walletTopupSchema);
  return ok({ invoice: await createTopupInvoice(access, input.amountRupees, req) }, { status: 201 });
});
