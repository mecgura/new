import { handle, ok } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { getWallet } from "@/services/wallet";
import { getPacks, packageStatus } from "@/services/billing/package";

type Ctx = { params: Promise<{ orgId: string }> };

/** The client's message package: allowance used this month, top-ups left, and packs they can buy. */
export const GET = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "billing:read");
  const status = await packageStatus(access.organizationId);
  const json = (b: typeof status.marketing) => ({ ...b, remaining: Number.isFinite(b.remaining) ? b.remaining : -1 });
  return ok({ package: { ...status, marketing: json(status.marketing), utility: json(status.utility) }, packs: status.active ? await getPacks() : [], walletBalance: (await getWallet(access.organizationId)).balance });
});
