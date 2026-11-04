import { z } from "zod";
import { handle, ok, readJson } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { setFeedback } from "@/services/ai/studio";

type Ctx = { params: Promise<{ orgId: string; aid: string; iid: string }> };

const schema = z.object({ rating: z.enum(["good", "bad", ""]), note: z.string().trim().max(500).optional() });

/** 👍 / 👎 on an AI reply (empty rating clears it). Bad replies show up for the team to fix the knowledge. */
export const POST = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "ai:read");
  return ok({ interaction: await setFeedback(access, ids.aid, ids.iid, await readJson(req, schema)) });
});
