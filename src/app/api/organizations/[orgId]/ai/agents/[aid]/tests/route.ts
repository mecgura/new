import { handle, ok, readJson } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { createCase, listCases, testCaseSchema } from "@/services/ai/evals";

type Ctx = { params: Promise<{ orgId: string; aid: string }> };

export const GET = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "ai:manage");
  return ok(await listCases(access.organizationId, ids.aid));
});

export const POST = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "ai:manage");
  return ok({ case: await createCase(access, ids.aid, await readJson(req, testCaseSchema)) }, { status: 201 });
});
