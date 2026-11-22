import { handle, ok, readJson } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { flowInputSchema, runFlow } from "@/services/onepost/posts";

type Ctx = { params: Promise<{ orgId: string; postId: string }> };

/** Send for review, approve, request changes or reopen. The service checks the person's role against the post's current status. */
export const POST = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "onepost:read");
  const input = await readJson(req, flowInputSchema);
  return ok({ post: await runFlow(access, ids.postId, input.action, input.note, req) });
});
