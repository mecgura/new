import { z } from "zod";
import { ApiError, handle, ok, readJson } from "@/lib/api";
import { db } from "@/lib/db";
import { enforceRateLimit } from "@/lib/rate-limit";
import { orgRoute } from "@/lib/route-helpers";
import { AiError } from "@/providers/anthropic/reply";
import { CAPTION_LANGUAGES, generateCaptions } from "@/providers/anthropic/social";
import { getSocialSettings } from "@/services/social/workflow";
import { assertServiceEnabled } from "@/services/whatsapp/guards";

type Ctx = { params: Promise<{ orgId: string }> };
const schema = z.object({
  brief: z.string().trim().min(10, "Describe the post in a sentence or two").max(1500),
  platform: z.enum(["instagram", "facebook", "both"]).default("both"),
  tone: z.enum(["friendly", "professional", "festive", "playful", "urgent"]).default("friendly"),
  language: z.enum(Object.keys(CAPTION_LANGUAGES) as [keyof typeof CAPTION_LANGUAGES, ...(keyof typeof CAPTION_LANGUAGES)[]]).default("en"),
});

/** Three caption + hashtag options written by Claude from a short brief. */
export const POST = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "social:manage");
  await assertServiceEnabled(access.organizationId, "SOCIAL_MEDIA");
  enforceRateLimit(`social-ai:${access.organizationId}`, 30, 3_600_000);
  const input = await readJson(req, schema);
  const [org, s] = await Promise.all([db.organization.findUnique({ where: { id: access.organizationId }, select: { name: true } }), getSocialSettings(access.organizationId)]);
  try {
    const r = await generateCaptions({ ...input, businessName: org?.name ?? "", brandVoice: s.brandVoice, defaultHashtags: s.defaultHashtags });
    return ok({ options: r.options });
  } catch (e) {
    if (e instanceof AiError) throw new ApiError(e.retryable ? "SERVICE_UNAVAILABLE" : "CONFLICT", e.message);
    throw e;
  }
});
