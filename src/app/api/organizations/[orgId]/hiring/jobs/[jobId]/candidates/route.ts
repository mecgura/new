import { handle, ok } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { listCandidates } from "@/services/hiring/ats";

type Ctx = { params: Promise<{ orgId: string; jobId: string }> };

export const GET = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "ats:manage");
  return ok({ candidates: await listCandidates(access, ids.jobId) });
});
