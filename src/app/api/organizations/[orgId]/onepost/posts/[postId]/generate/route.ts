import { handle, ok, readJson } from "@/lib/api";
import { enforceRateLimit } from "@/lib/rate-limit";
import { orgRoute } from "@/lib/route-helpers";
import { generateInputSchema, generateVersions } from "@/services/onepost/posts";

type Ctx = { params: Promise<{ orgId: string; postId: string }> };

/** Writes all channel versions (or only the channels listed). AI calls cost money, so this is rate-limited per person. */
export const POST = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "onepost:write");
  enforceRateLimit(`onepost-gen:${access.user.id}`, 12, 15 * 60_000);
  const input = await readJson(req, generateInputSchema);
  return ok(await generateVersions(access, ids.postId, input.channels, { instruction: input.instruction }, req));
});
