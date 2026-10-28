import { handle, ok } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { markPosted } from "@/services/social/posts";

type Ctx = { params: Promise<{ orgId: string; postId: string }> };

/** Mark as posted by hand (posted from the phone, no connected account). */
export const POST = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "social:manage");
  return ok({ post: await markPosted(access, ids.postId, req) });
});
