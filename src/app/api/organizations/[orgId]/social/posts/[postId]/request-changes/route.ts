import { z } from "zod";
import { handle, ok, readJson } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { requestChanges } from "@/services/social/workflow";

type Ctx = { params: Promise<{ orgId: string; postId: string }> };
const schema = z.object({ note: z.string().trim().min(1, "Say what to change").max(500) });

export const POST = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "social:approve");
  const p = await requestChanges(access, ids.postId, (await readJson(req, schema)).note, req);
  return ok({ post: { id: p.id, status: p.status, reviewNote: p.reviewNote } });
});
