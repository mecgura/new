import { z } from "zod";
import { handle, ok, readJson } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { registerBlobMedia } from "@/services/onepost/posts";

type Ctx = { params: Promise<{ orgId: string; postId: string }> };
const body = z.object({ url: z.string().url().max(600), name: z.string().trim().max(120).default("File") });

/** Attaches a file the browser just uploaded to Blob. The server checks the file itself, not what the browser says about it. */
export const POST = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "onepost:write");
  return ok({ post: await registerBlobMedia(access, ids.postId, await readJson(req, body), req) }, { status: 201 });
});
