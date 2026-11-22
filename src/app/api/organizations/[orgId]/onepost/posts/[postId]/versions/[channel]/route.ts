import { z } from "zod";
import { ApiError, handle, ok, readJson } from "@/lib/api";
import { CHANNEL_KEYS, isChannel } from "@/lib/onepost";
import { enforceRateLimit } from "@/lib/rate-limit";
import { orgRoute } from "@/lib/route-helpers";
import { generateVersions, saveVersion, versionInputSchema } from "@/services/onepost/posts";

type Ctx = { params: Promise<{ orgId: string; postId: string; channel: string }> };
const regenerateBody = z.object({ instruction: z.string().trim().max(500).optional() });

function channelOf(raw: string) {
  if (!isChannel(raw)) throw new ApiError("NOT_FOUND", `Unknown channel. Use one of: ${CHANNEL_KEYS.join(", ")}.`);
  return raw;
}

/** A person's edit of one version. */
export const PUT = handle<Ctx>(async (req, { params }) => {
  const raw = await params;
  const { access, ids } = await orgRoute(req, params, "onepost:write");
  return ok({ post: await saveVersion(access, ids.postId, channelOf(raw.channel), (await readJson(req, versionInputSchema)).content, req) });
});

/** Writes this one version again (optionally with a note on what to change). */
export const POST = handle<Ctx>(async (req, { params }) => {
  const raw = await params;
  const { access, ids } = await orgRoute(req, params, "onepost:write");
  enforceRateLimit(`onepost-gen:${access.user.id}`, 12, 15 * 60_000);
  const input = await readJson(req, regenerateBody);
  return ok(await generateVersions(access, ids.postId, [channelOf(raw.channel)], { instruction: input.instruction }, req));
});
