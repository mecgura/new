import { z } from "zod";
import { handle, ok, readJson } from "@/lib/api";
import { MAX_MEDIA_BYTES } from "@/lib/onepost";
import { orgRoute } from "@/lib/route-helpers";
import { addMedia } from "@/services/onepost/posts";

type Ctx = { params: Promise<{ orgId: string; postId: string }> };
const body = z.object({ name: z.string().trim().max(120).default("Image"), image: z.string().max(Math.ceil(MAX_MEDIA_BYTES * 1.4) + 64) });

export const POST = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "onepost:write");
  return ok({ post: await addMedia(access, ids.postId, await readJson(req, body), req) }, { status: 201 });
});
