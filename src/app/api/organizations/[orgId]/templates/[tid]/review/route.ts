import { handle, ok, readJson } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { templateReviewSchema } from "@/lib/validations";
import { simulateReview } from "@/services/templates/templates";

type Ctx = { params: Promise<{ orgId: string; tid: string }> };

/** Demo accounts only: stands in for Meta's review decision. */
export const POST = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "templates:manage");
  const { decision, reason } = await readJson(req, templateReviewSchema);
  return ok({ template: await simulateReview(access, ids.tid, decision, reason, req) });
});
