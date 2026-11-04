import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { AI_MODEL, AiError, anthropicConfigured } from "@/providers/anthropic/reply";

export const CAPTION_LANGUAGES = { en: "English", hinglish: "Hinglish (Hindi in Roman letters mixed with English)", hi: "Hindi (Devanagari)", pa: "Punjabi (Gurmukhi)", "pa-roman": "Punjabi in Roman letters" } as const;
export type CaptionLanguage = keyof typeof CAPTION_LANGUAGES;

export type CaptionRequest = {
  businessName: string;
  brief: string;
  platform: "instagram" | "facebook" | "both";
  tone: "friendly" | "professional" | "festive" | "playful" | "urgent";
  language: CaptionLanguage;
  brandVoice: string;
  defaultHashtags: string;
};
export type CaptionOption = { caption: string; hashtags: string[] };

const resultSchema = z.object({ options: z.array(z.object({ caption: z.string().min(1).max(2000), hashtags: z.array(z.string().max(60)).max(15) })).min(1).max(3) });

let client: Anthropic | null = null;
const getClient = () => (client ??= new Anthropic({ maxRetries: 1, timeout: 45_000 }));

/** Three caption options with hashtags. Never invents offers, prices or dates that aren't in the brief. */
export async function generateCaptions(r: CaptionRequest, useModel: string = AI_MODEL): Promise<{ options: CaptionOption[]; model: string; inputTokens: number; outputTokens: number }> {
  if (!anthropicConfigured()) throw new AiError("AI captions need ANTHROPIC_API_KEY or OPENAI_API_KEY on the server (Configuration required).", false);
  const system = [
    `You write social media captions for ${r.businessName || "a small Indian business"}.`,
    `Platform: ${r.platform === "both" ? "Instagram and Facebook" : r.platform}. Tone: ${r.tone}. Language: ${CAPTION_LANGUAGES[r.language]}.`,
    "Write exactly 3 different options. Each caption: a hook in the first line, 2–4 short lines, a clear call to action, up to 3 fitting emojis, under 600 characters, no hashtags inside the caption text.",
    "Give 5–8 relevant hashtags per option (without spaces; mix local and niche tags, no banned or misleading tags).",
    "Only use facts, prices, offers and dates from the brief. Never invent discounts, awards, reviews or claims like 'best in town'.",
    r.brandVoice ? `Brand voice to follow: ${r.brandVoice}` : "",
    r.defaultHashtags ? `Always include these hashtags: ${r.defaultHashtags}` : "",
  ].filter(Boolean).join("\n");
  let res: Anthropic.Beta.BetaMessage;
  try {
    res = await getClient().beta.messages.create({
      model: useModel,
      max_tokens: 4000,
      output_config: {
        effort: "low",
        format: {
          type: "json_schema",
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["options"],
            properties: { options: { type: "array", items: { type: "object", additionalProperties: false, required: ["caption", "hashtags"], properties: { caption: { type: "string" }, hashtags: { type: "array", items: { type: "string" } } } } } },
          },
        },
      },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system,
      messages: [{ role: "user", content: `Brief:\n${r.brief}` }],
    });
  } catch (e) {
    if (e instanceof Anthropic.APIError) throw new AiError(`AI temporarily unavailable: ${e.message}`.slice(0, 300), true);
    throw e;
  }
  if (res.stop_reason === "refusal") throw new AiError("The AI declined this brief. Try rewording it.", false);
  const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  let parsed: z.infer<typeof resultSchema>;
  try {
    parsed = resultSchema.parse(JSON.parse(text));
  } catch {
    throw new AiError("The AI returned an unexpected answer. Try again.", true);
  }
  const tidy = (h: string) => "#" + h.replace(/^#+/, "").replace(/\s+/g, "");
  return {
    options: parsed.options.slice(0, 3).map((o) => ({ caption: o.caption.trim(), hashtags: [...new Set(o.hashtags.map(tidy).filter((h) => h.length > 1))].slice(0, 10) })),
    model: res.model || useModel,
    inputTokens: res.usage.input_tokens ?? 0,
    outputTokens: res.usage.output_tokens ?? 0,
  };
}
