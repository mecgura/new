import { handle, ok, readJson, readQuery } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { flowCreateSchema, flowListSchema } from "@/lib/validations";
import { createFlowRecord, listFlows } from "@/services/flows/flows";

type Ctx = { params: Promise<{ orgId: string }> };

export const GET = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "flows:read");
  const q = readQuery(req, flowListSchema);
  return ok(await listFlows(access.organizationId, { status: q.status || undefined, q: q.q || undefined }));
});

export const POST = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "flows:manage");
  const input = await readJson(req, flowCreateSchema);
  return ok({ flow: await createFlowRecord(access, input, req) }, { status: 201 });
});
