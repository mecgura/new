import { handle, ok } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { publishFlowRecord } from "@/services/flows/flows";

type Ctx = { params: Promise<{ orgId: string; fid: string }> };

export const POST = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "flows:manage");
  return ok({ flow: await publishFlowRecord(access, ids.fid, req) });
});
