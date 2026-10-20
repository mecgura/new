import { handle, ok } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { getMetaRates } from "@/services/meta-rates";
import { getPriceCard } from "@/services/wallet-pricing";

type Ctx = { params: Promise<{ orgId: string }> };

/** What one message costs this workspace, per category (paise): Meta's charge (estimate) and MECGURA's fee. */
export const GET = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "templates:read");
  const [meta, card] = await Promise.all([getMetaRates(), getPriceCard(access.organizationId)]);
  return ok({ meta: { ...meta, service: 0 }, fees: card.effective });
});
