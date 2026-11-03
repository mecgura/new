import { handle, ok, readJson } from "@/lib/api";
import { requireSuperAdmin } from "@/lib/session";
import { enforceRateLimit } from "@/lib/rate-limit";
import { createImage, imageSchema, listImages, providerStatus } from "@/services/marketing/ai-studio";

export const maxDuration = 60;

/** The AI image gallery and which providers have a key. */
export const GET = handle(async (req) => {
  await requireSuperAdmin(req);
  return ok({ providers: providerStatus(), images: await listImages() });
});

/** Make one image with Gemini or OpenAI. */
export const POST = handle(async (req) => {
  const admin = await requireSuperAdmin(req);
  enforceRateLimit(`ai-image:${admin.id}`, 6, 60_000);
  return ok({ image: await createImage(await readJson(req, imageSchema), admin.id, req) }, { status: 201 });
});
