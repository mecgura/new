import { handle, ok, readJson } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { commentRuleSchema, deleteCommentRule, updateCommentRule } from "@/services/social/comment-rules";

type Ctx = { params: Promise<{ orgId: string; rid: string }> };

export const PUT = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "channels:manage");
  return ok({ rule: await updateCommentRule(access, ids.rid, await readJson(req, commentRuleSchema), req) });
});

export const DELETE = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "channels:manage");
  await deleteCommentRule(access, ids.rid, req);
  return ok({ deleted: true });
});
