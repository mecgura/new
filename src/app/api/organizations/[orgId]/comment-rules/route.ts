import { handle, ok, readJson } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { commentRuleSchema, createCommentRule, listCommentRules } from "@/services/social/comment-rules";

type Ctx = { params: Promise<{ orgId: string }> };

export const GET = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "inbox:read");
  return ok(await listCommentRules(access.organizationId));
});

export const POST = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "channels:manage");
  return ok({ rule: await createCommentRule(access, await readJson(req, commentRuleSchema), req) }, { status: 201 });
});
