import { z } from "zod";
import { handle, ok, readJson } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { cancelDeletion, COOLING_OFF_DAYS, deletionStatus, requestDeletion } from "@/services/account/data";

type Ctx = { params: Promise<{ orgId: string }> };
const schema = z.object({ confirmName: z.string().max(200), reason: z.string().max(500).default("") }).strict();

export const GET = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "org:update");
  return ok({ request: await deletionStatus(access.organizationId), coolingOffDays: COOLING_OFF_DAYS });
});

/** Ask MECGURA to delete the whole workspace (after a cooling-off period the owner can cancel). */
export const POST = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "org:update");
  return ok({ request: await requestDeletion(access, await readJson(req, schema), req) }, { status: 201 });
});

export const DELETE = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "org:update");
  await cancelDeletion(access, req);
  return ok({ cancelled: true });
});
