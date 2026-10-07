import { handle, ok, readJson } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { flowDemoSubmitSchema } from "@/lib/validations";
import { simulateSubmission } from "@/services/flows/flows";

type Ctx = { params: Promise<{ orgId: string; fid: string }> };

/** Demo Flows only: submits answers as a customer would (through the real inbound path). */
export const POST = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "flows:manage");
  const input = await readJson(req, flowDemoSubmitSchema);
  return ok(await simulateSubmission(access, ids.fid, input), { status: 201 });
});
