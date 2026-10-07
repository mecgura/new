import { handle, ok, readJson } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { flowUpdateSchema } from "@/lib/validations";
import type { FlowDefinition } from "@/lib/flows";
import { deleteFlowRecord, getFlow, updateFlowRecord } from "@/services/flows/flows";

type Ctx = { params: Promise<{ orgId: string; fid: string }> };

export const GET = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "flows:read");
  return ok({ flow: await getFlow(access.organizationId, ids.fid) });
});

export const PATCH = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "flows:manage");
  const input = await readJson(req, flowUpdateSchema);
  return ok({ flow: await updateFlowRecord(access, ids.fid, { ...input, definition: input.definition as FlowDefinition | undefined }, req) });
});

export const DELETE = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "flows:manage");
  await deleteFlowRecord(access, ids.fid, req);
  return ok({ ok: true });
});
