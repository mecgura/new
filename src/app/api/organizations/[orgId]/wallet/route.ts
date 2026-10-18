import { handle, ok, readQuery } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { paginationSchema } from "@/lib/validations";
import { getWallet, listWalletEntries } from "@/services/wallet";

type Ctx = { params: Promise<{ orgId: string }> };

/** The client's own balance and ledger (owners and managers). Adding money is done by MECGURA, not here. */
export const GET = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "billing:read");
  const q = readQuery(req, paginationSchema);
  return ok({ wallet: await getWallet(access.organizationId), ...(await listWalletEntries(access.organizationId, q)) });
});
