import { ApiError, handle, ok } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { toFlowJson, validateFlow } from "@/lib/flows";
import { getFlow } from "@/services/flows/flows";

type Ctx = { params: Promise<{ orgId: string; fid: string }> };

/** The Meta Flow JSON generated from the current definition (for developers / Meta's Flow builder). */
export const GET = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "flows:read");
  const f = await getFlow(access.organizationId, ids.fid);
  const errors = validateFlow(f.definition);
  if (errors.length) throw new ApiError("VALIDATION_ERROR", "Fix the Flow first.", { details: { flow: errors } });
  return ok(toFlowJson(f.definition));
});
