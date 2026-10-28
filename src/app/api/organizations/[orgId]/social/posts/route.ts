import { z } from "zod";
import { handle, ok, readJson, readQuery } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { createPost, listPosts, postSchema } from "@/services/social/posts";

type Ctx = { params: Promise<{ orgId: string }> };
const range = z.object({ from: z.string().datetime({ offset: true }), to: z.string().datetime({ offset: true }) });

/** Calendar: posts in a date range plus unscheduled drafts, and which Meta accounts can publish. */
export const GET = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "social:manage");
  const q = readQuery(req, range);
  return ok(await listPosts(access, { from: new Date(q.from), to: new Date(q.to) }));
});

export const POST = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "social:manage");
  return ok({ post: await createPost(access, await readJson(req, postSchema), req) }, { status: 201 });
});
