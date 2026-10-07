import { handle, ok, readQuery } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { submissionListSchema } from "@/lib/validations";
import { listSubmissions } from "@/services/flows/flows";

type Ctx = { params: Promise<{ orgId: string; fid: string }> };

export const GET = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "flows:read");
  const { page } = readQuery(req, submissionListSchema);
  return ok(await listSubmissions(access.organizationId, ids.fid, page));
});
