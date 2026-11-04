import { handle, ok, readJson } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { deleteCase, testCaseSchema, updateCase } from "@/services/ai/evals";

type Ctx = { params: Promise<{ orgId: string; aid: string; tid: string }> };

export const PUT = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "ai:manage");
  return ok({ case: await updateCase(access, ids.aid, ids.tid, await readJson(req, testCaseSchema)) });
});

export const DELETE = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "ai:manage");
  await deleteCase(access, ids.aid, ids.tid);
  return ok({ deleted: true });
});
