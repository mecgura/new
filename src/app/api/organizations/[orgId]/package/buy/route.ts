import { z } from "zod";
import { handle, ok, readJson } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { buyPack } from "@/services/billing/package";

type Ctx = { params: Promise<{ orgId: string }> };
const body = z.object({ packId: z.string().trim().min(1).max(40), key: z.string().trim().min(8).max(64) });

/** Buy a top-up pack with wallet balance (owner only). */
export const POST = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "billing:manage");
  const { packId, key } = await readJson(req, body);
  const s = await buyPack(access.organizationId, packId, key, { actorUserId: access.user.id, req });
  return ok({ package: { ...s, marketing: { ...s.marketing, remaining: Number.isFinite(s.marketing.remaining) ? s.marketing.remaining : -1 }, utility: { ...s.utility, remaining: Number.isFinite(s.utility.remaining) ? s.utility.remaining : -1 } } });
});
