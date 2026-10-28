import { handle, ok, readJson } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { candidateUpdateSchema, deleteCandidate, updateCandidate } from "@/services/hiring/ats";

type Ctx = { params: Promise<{ orgId: string; candidateId: string }> };

/** Move stage, rate, add notes or correct details. */
export const PATCH = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "ats:manage");
  return ok({ candidate: await updateCandidate(access, ids.candidateId, await readJson(req, candidateUpdateSchema), req) });
});

export const DELETE = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "ats:manage");
  await deleteCandidate(access, ids.candidateId, req);
  return ok({ deleted: true });
});
