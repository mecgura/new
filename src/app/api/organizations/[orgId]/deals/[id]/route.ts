import { handle, ok, readJson } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { deleteDeal, getDeal, updateDeal, updateDealSchema } from "@/services/crm/deals";

type Ctx = { params: Promise<{ orgId: string; id: string }> };

export const GET = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "deals:read");
  return ok({ deal: await getDeal(access.organizationId, ids.id) });
});

/** Edit a deal or move it to another stage (moving to Won makes the contact a customer). */
export const PATCH = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "deals:write");
  return ok({ deal: await updateDeal({ organizationId: access.organizationId, actorUserId: access.user.id, req }, ids.id, await readJson(req, updateDealSchema)) });
});

export const DELETE = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "deals:manage");
  await deleteDeal({ organizationId: access.organizationId, actorUserId: access.user.id, req }, ids.id);
  return ok({ ok: true });
});
