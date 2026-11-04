import { handle, ok, readJson, readQuery } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { enforceRateLimit } from "@/lib/rate-limit";
import { board, boardQuerySchema, createDeal, createDealSchema } from "@/services/crm/deals";

type Ctx = { params: Promise<{ orgId: string }> };

/** The deals board: stages with their deals (open, plus closed in the last 30 days). */
export const GET = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "deals:read");
  return ok(await board(access.organizationId, readQuery(req, boardQuerySchema)));
});

export const POST = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "deals:write");
  enforceRateLimit(`deal-create:${access.user.id}`, 60, 60_000);
  const deal = await createDeal({ organizationId: access.organizationId, actorUserId: access.user.id, req }, await readJson(req, createDealSchema));
  return ok({ deal }, { status: 201 });
});
