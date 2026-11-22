import { handle, ok, readJson } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { coverageSchema, setCoverage } from "@/services/onepost/pr";

type Ctx = { params: Promise<{ orgId: string; postId: string; pitchId: string }> };

/** Records the link when a journalist published the story. */
export const PATCH = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "onepost:publish");
  return ok(await setCoverage(access, ids.pitchId, await readJson(req, coverageSchema), req));
});
