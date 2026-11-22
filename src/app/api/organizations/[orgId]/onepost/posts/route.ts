import { z } from "zod";
import { handle, ok, readJson, readQuery } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { createPost, listPosts, postInputSchema } from "@/services/onepost/posts";

type Ctx = { params: Promise<{ orgId: string }> };
const query = z.object({ status: z.string().max(30).optional(), q: z.string().max(80).optional() });

export const GET = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "onepost:read");
  return ok(await listPosts(access, readQuery(req, query)));
});

export const POST = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "onepost:write");
  return ok({ post: await createPost(access, await readJson(req, postInputSchema), req) }, { status: 201 });
});
