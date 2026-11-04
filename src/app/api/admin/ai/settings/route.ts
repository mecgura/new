import { z } from "zod";
import { ApiError, handle, ok, readJson } from "@/lib/api";
import { audit } from "@/lib/audit";
import { requireSuperAdmin } from "@/lib/session";
import { AiError } from "@/providers/anthropic/reply";
import { getAiSettings, saveAiSettings } from "@/providers/ai/router";

const schema = z.object({
  provider: z.enum(["auto", "anthropic", "openai"]).optional(),
  fallback: z.boolean().optional(),
  models: z.object({ anthropic: z.string().max(80).optional(), openai: z.string().max(80).optional() }).strict().optional(),
}).strict().refine((v) => v.provider !== undefined || v.fallback !== undefined || v.models !== undefined, "Nothing to change.");

export const GET = handle(async (req) => {
  await requireSuperAdmin(req);
  return ok({ settings: await getAiSettings() });
});

/** Provider, models and fallback. API keys are never accepted here — they live in Vercel env only. */
export const PUT = handle(async (req) => {
  const admin = await requireSuperAdmin(req);
  const input = await readJson(req, schema);
  try {
    const settings = await saveAiSettings(input);
    await audit({ action: "ai.settings_updated", actorUserId: admin.id, targetType: "ai_settings", targetId: "global", metadata: { provider: settings.provider, fallback: settings.fallback, models: settings.models }, req });
    return ok({ settings });
  } catch (e) {
    if (e instanceof AiError) throw new ApiError("VALIDATION_ERROR", e.message);
    throw e;
  }
});
