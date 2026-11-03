import { z } from "zod";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { audit } from "@/lib/audit";

/**
 * AI studio for MECGURA's own ads (Super Admin): images and ad copy from Google Gemini or OpenAI, whichever has a
 * key on the server (GEMINI_API_KEY, OPENAI_API_KEY). Images are kept in a gallery so they can be downloaded later
 * or put into a branded creative. Each image costs a few rupees on the provider's bill, so generation is limited.
 */
export const PROVIDERS = ["gemini", "openai"] as const;
export type Provider = (typeof PROVIDERS)[number];
export const ASPECTS = ["post", "square", "story", "landscape"] as const;
export type Aspect = (typeof ASPECTS)[number];
export const STYLES = ["ad_photo", "product", "festival", "illustration", "people"] as const;

const STYLE_PROMPT: Record<(typeof STYLES)[number], string> = {
  ad_photo: "A high-quality professional advertising photograph, natural light, clean composition with empty space for text, realistic, modern Indian small-business setting",
  product: "A clean studio product shot on a simple background, soft shadows, sharp focus, premium commercial look",
  festival: "A warm, festive Indian celebration scene with diyas, marigold and soft bokeh lights, rich colours, elegant and premium, space for text",
  illustration: "A modern flat vector illustration, simple shapes, friendly, bright colours, plenty of empty space for text",
  people: "A candid, realistic photo of a happy Indian shop owner using WhatsApp on a smartphone in their shop, natural expression, shallow depth of field",
};

export const imageSchema = z
  .object({
    provider: z.enum(PROVIDERS),
    prompt: z.string().trim().min(5, "Describe the image in a few words").max(1000),
    style: z.enum(STYLES).default("ad_photo"),
    aspect: z.enum(ASPECTS).default("post"),
    brand: z.boolean().default(true),
  })
  .strict();

export const copySchema = z
  .object({
    provider: z.enum(PROVIDERS),
    product: z.string().trim().min(3, "What are you advertising?").max(300),
    audience: z.string().trim().max(200).default("small business owners in Punjab"),
    offer: z.string().trim().max(200).default(""),
    language: z.enum(["hinglish", "english", "punjabi_roman", "hindi"]).default("hinglish"),
  })
  .strict();

const keyFor = (p: Provider) => (p === "gemini" ? process.env.GEMINI_API_KEY : process.env.OPENAI_API_KEY) ?? "";
export const providerStatus = () => ({ gemini: Boolean(process.env.GEMINI_API_KEY), openai: Boolean(process.env.OPENAI_API_KEY) });

function requireKey(p: Provider) {
  const key = keyFor(p);
  if (!key) throw new ApiError("CONFLICT", `${p === "gemini" ? "Google Gemini" : "OpenAI"} isn't set up yet. Add ${p === "gemini" ? "GEMINI_API_KEY" : "OPENAI_API_KEY"} in Vercel → Settings → Environment Variables, then redeploy.`);
  return key;
}

/** The whole prompt sent to the model: the admin's idea plus style, brand and ad-safety guidance. */
export function buildImagePrompt(input: z.infer<typeof imageSchema>) {
  const parts = [input.prompt, STYLE_PROMPT[input.style]];
  if (input.brand) parts.push("Colour accents in emerald green and deep dark green (MECGURA brand), a subtle WhatsApp-chat feel where it fits");
  parts.push("No logos, no watermarks, no brand names, no misspelled text. If any text is needed keep it very short and correctly spelled. Suitable for a Facebook and Instagram ad.");
  return parts.join(". ");
}

async function call(url: string, init: RequestInit) {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(55_000) });
  } catch (e) {
    throw new ApiError("SERVICE_UNAVAILABLE", e instanceof Error && e.name === "TimeoutError" ? "The AI took too long. Please try again." : "Couldn't reach the AI service. Please try again.");
  }
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const err = (body.error ?? {}) as { message?: string };
    const msg = String(err.message ?? `The AI service answered ${res.status}.`).slice(0, 300);
    throw new ApiError(res.status === 429 ? "RATE_LIMITED" : "SERVICE_UNAVAILABLE", res.status === 400 && /safety|policy|blocked/i.test(msg) ? "The AI refused this request (safety filter). Try describing it differently." : msg);
  }
  return body;
}

const GEMINI_RATIO: Record<Aspect, string> = { post: "4:5", square: "1:1", story: "9:16", landscape: "16:9" };
const OPENAI_SIZE: Record<Aspect, string> = { post: "1024x1536", square: "1024x1024", story: "1024x1536", landscape: "1536x1024" };

async function generateImage(input: z.infer<typeof imageSchema>): Promise<{ data: Buffer; mimeType: string }> {
  const key = requireKey(input.provider);
  const prompt = buildImagePrompt(input);
  if (input.provider === "gemini") {
    const model = process.env.GEMINI_IMAGE_MODEL || "gemini-2.5-flash-image";
    const body = await call(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: GEMINI_RATIO[input.aspect] } } }),
    });
    const parts = ((body.candidates as { content?: { parts?: { inlineData?: { data?: string; mimeType?: string } }[] } }[] | undefined)?.[0]?.content?.parts ?? []);
    const img = parts.find((p) => p.inlineData?.data)?.inlineData;
    if (!img?.data) throw new ApiError("SERVICE_UNAVAILABLE", "Gemini didn't return an image. Try a different description.");
    return { data: Buffer.from(img.data, "base64"), mimeType: img.mimeType || "image/png" };
  }
  const model = process.env.OPENAI_IMAGE_MODEL || "gpt-image-1";
  const body = await call("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, prompt, size: OPENAI_SIZE[input.aspect], n: 1, quality: "medium" }),
  });
  const b64 = (body.data as { b64_json?: string }[] | undefined)?.[0]?.b64_json;
  if (!b64) throw new ApiError("SERVICE_UNAVAILABLE", "OpenAI didn't return an image. Try a different description.");
  return { data: Buffer.from(b64, "base64"), mimeType: "image/png" };
}

const MAX_PER_DAY = 60;

export async function createImage(input: z.infer<typeof imageSchema>, actorId: string, req?: Request) {
  const today = await db.marketingImage.count({ where: { createdAt: { gte: new Date(Date.now() - 86_400_000) } } });
  if (today >= MAX_PER_DAY) throw new ApiError("RATE_LIMITED", `Up to ${MAX_PER_DAY} AI images a day, to keep the AI bill in check. Try again tomorrow.`);
  const { data, mimeType } = await generateImage(input);
  if (data.length > 8 * 1024 * 1024) throw new ApiError("SERVICE_UNAVAILABLE", "The image was too large to keep.");
  const img = await db.marketingImage.create({ data: { provider: input.provider, prompt: input.prompt, aspect: input.aspect, mimeType, data: new Uint8Array(data), createdById: actorId } });
  await audit({ action: "marketing.post_saved", actorUserId: actorId, targetType: "marketing_image", targetId: img.id, metadata: { provider: input.provider, aspect: input.aspect }, req });
  // Keep the gallery to the latest 200 images.
  const old = await db.marketingImage.findMany({ orderBy: { createdAt: "desc" }, skip: 200, select: { id: true } });
  if (old.length) await db.marketingImage.deleteMany({ where: { id: { in: old.map((o) => o.id) } } });
  return imageDto(img);
}

const imageDto = (i: { id: string; provider: string; prompt: string; aspect: string; createdAt: Date }) => ({ id: i.id, provider: i.provider, prompt: i.prompt, aspect: i.aspect, createdAt: i.createdAt, url: `/api/admin/marketing/images/${i.id}` });

export async function listImages() {
  const rows = await db.marketingImage.findMany({ orderBy: { createdAt: "desc" }, take: 60, select: { id: true, provider: true, prompt: true, aspect: true, createdAt: true } });
  return rows.map(imageDto);
}

export async function imageFile(id: string) {
  const img = await db.marketingImage.findUnique({ where: { id }, select: { data: true, mimeType: true } });
  if (!img) throw new ApiError("NOT_FOUND", "Image not found.");
  return img;
}

export async function deleteImage(id: string) {
  const r = await db.marketingImage.deleteMany({ where: { id } });
  if (!r.count) throw new ApiError("NOT_FOUND", "Image not found.");
}

// ---------------------------------------------------------------------------
// Ad copy
// ---------------------------------------------------------------------------
const LANG: Record<z.infer<typeof copySchema>["language"], string> = {
  hinglish: "Hinglish (Hindi written in English letters, mixed with simple English)",
  english: "simple English",
  punjabi_roman: "Punjabi written in English letters (Roman Punjabi)",
  hindi: "Hindi in Devanagari script",
};
export type AdCopy = { headlines: string[]; primaryTexts: string[]; cta: string; hashtags: string[] };

export function buildCopyPrompt(input: z.infer<typeof copySchema>) {
  return [
    `Write Facebook/Instagram ad copy for MECGURA, an Indian company that sets up and runs WhatsApp automation (official WhatsApp Business API) for small businesses.`,
    `Advertising: ${input.product}. Audience: ${input.audience}.${input.offer ? ` Offer: ${input.offer}.` : ""}`,
    `Language: ${LANG[input.language]}. Tone: friendly, local, confident, no exaggerated or false claims, no guarantees of results, no competitor names.`,
    `Return JSON only: {"headlines": [3 headlines, max 40 characters each], "primaryTexts": [3 primary texts, 2-4 short lines each, with 1-2 emojis], "cta": "a short call to action", "hashtags": [5 hashtags]}.`,
  ].join("\n");
}

function parseCopy(raw: string): AdCopy {
  const json = raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1);
  const p = z
    .object({ headlines: z.array(z.string()).min(1).max(5), primaryTexts: z.array(z.string()).min(1).max(5), cta: z.string().default(""), hashtags: z.array(z.string()).default([]) })
    .safeParse((() => {
      try {
        return JSON.parse(json);
      } catch {
        return null;
      }
    })());
  if (!p.success) throw new ApiError("SERVICE_UNAVAILABLE", "The AI's answer couldn't be read. Please try again.");
  return { headlines: p.data.headlines.map((s) => s.slice(0, 120)), primaryTexts: p.data.primaryTexts.map((s) => s.slice(0, 600)), cta: p.data.cta.slice(0, 80), hashtags: p.data.hashtags.slice(0, 8).map((h) => h.slice(0, 40)) };
}

export async function writeAdCopy(input: z.infer<typeof copySchema>, actorId: string, req?: Request): Promise<AdCopy> {
  const key = requireKey(input.provider);
  const prompt = buildCopyPrompt(input);
  let text = "";
  if (input.provider === "gemini") {
    const model = process.env.GEMINI_TEXT_MODEL || "gemini-2.5-flash";
    const body = await call(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: "application/json", temperature: 0.9 } }),
    });
    text = ((body.candidates as { content?: { parts?: { text?: string }[] } }[] | undefined)?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("");
  } else {
    const model = process.env.OPENAI_TEXT_MODEL || "gpt-4o-mini";
    const body = await call("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, response_format: { type: "json_object" }, temperature: 0.9, messages: [{ role: "user", content: prompt }] }),
    });
    text = (body.choices as { message?: { content?: string } }[] | undefined)?.[0]?.message?.content ?? "";
  }
  const copy = parseCopy(text);
  await audit({ action: "marketing.post_saved", actorUserId: actorId, targetType: "marketing_ad_copy", metadata: { provider: input.provider, language: input.language }, req });
  return copy;
}
