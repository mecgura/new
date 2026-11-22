import Anthropic from "@anthropic-ai/sdk";
import { ZodError } from "zod";
import { AiError } from "@/providers/anthropic/reply";
import { complete } from "@/providers/openai/chat";
import { resolveProviders, type ProviderId } from "@/providers/ai/router";
import { CONTENT_SCHEMAS, FIELD_SPECS, GBP_CTAS, cleanTags, type Channel } from "@/lib/onepost";
import { buildPrompt, type GenerateInput } from "@/services/onepost/prompts";
import { demoContent } from "@/services/onepost/demo";

/**
 * OnePost's single door to AI. Everything that writes content goes through `OnePostAi.generate`.
 * - Keys come only from server env (ANTHROPIC_API_KEY / OPENAI_API_KEY); the provider and model are the platform's AI settings
 *   (Super Admin → Integrations), so changing the provider later never touches OnePost.
 * - No key configured: a clearly labelled demo draft built only from the client's own facts (model "demo").
 */
export type Generated = { content: unknown; model: string; inputTokens: number; outputTokens: number };
export const DEMO_MODEL = "demo";

const MAX_TOKENS: Record<Channel, number> = { blog: 6000, instagram: 1500, facebook: 1500, linkedin: 2000, youtube: 2500, gbp: 1500, whatsapp: 1000, ads: 1500, press_release: 3000, pitch_email: 1500 };

type Raw = { text: string; input: number; output: number };

async function callAnthropic(model: string, system: string, user: string, maxTokens: number): Promise<Raw> {
  const client = new Anthropic({ maxRetries: 1, timeout: 120_000 });
  try {
    const res = await client.messages.create({ model, max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] });
    const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    return { text, input: res.usage?.input_tokens ?? 0, output: res.usage?.output_tokens ?? 0 };
  } catch (e) {
    if (e instanceof Anthropic.APIError) throw new AiError(`AI temporarily unavailable: ${e.message}`.slice(0, 300), (e.status ?? 500) >= 500 || e.status === 429);
    throw e;
  }
}

async function callOpenAi(model: string, system: string, user: string, maxTokens: number): Promise<Raw> {
  const c = await complete({ model, max_completion_tokens: maxTokens, messages: [{ role: "system", content: system }, { role: "user", content: user }], response_format: { type: "json_object" } }, 120_000);
  const m = c.choices?.[0]?.message;
  if (m?.refusal) throw new AiError("The AI declined to write this. Try rewording the idea.", false);
  return { text: (m?.content ?? "").trim(), input: c.usage?.prompt_tokens ?? 0, output: c.usage?.completion_tokens ?? 0 };
}

const call = (p: ProviderId, model: string, system: string, user: string, max: number) => (p === "anthropic" ? callAnthropic(model, system, user, max) : callOpenAi(model, system, user, max));

/** Pulls the JSON object out of a model answer (tolerates code fences or a short preface). */
export function extractJson(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(t);
  } catch {
    const a = t.indexOf("{");
    const b = t.lastIndexOf("}");
    if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
    throw new Error("No JSON object in the answer.");
  }
}

const cut = (s: string, max: number) => (s.length <= max ? s : `${s.slice(0, max - 1).replace(/\s+\S*$/, "")}…`);

/** Trims over-long answers to each field's limit, and fixes shapes models commonly get slightly wrong, before strict validation. */
export function tidy(channel: Channel, raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const o = { ...(raw as Record<string, unknown>) };
  for (const f of FIELD_SPECS[channel]) {
    const v = o[f.key];
    if ((f.kind === "text" || f.kind === "textarea") && typeof v === "string") o[f.key] = cut(v.trim(), f.max);
    if (f.kind === "tags") {
      const arr = Array.isArray(v) ? v.map(String) : typeof v === "string" ? v.split(/[\s,]+/) : [];
      o[f.key] = cleanTags(arr, f.max);
    }
    if (f.kind === "pairs" && Array.isArray(v)) o[f.key] = v.slice(0, f.maxItems);
  }
  if (channel === "youtube" && Array.isArray(o.tags)) {
    const kept: string[] = [];
    for (const t of o.tags as string[]) if ([...kept, t].join(",").length <= 500) kept.push(t);
    o.tags = kept;
  }
  if (channel === "gbp" && typeof o.cta === "string" && !(GBP_CTAS as readonly string[]).includes(o.cta)) o.cta = "LEARN_MORE";
  if (channel === "ads" && Array.isArray(o.variations)) o.variations = (o.variations as Record<string, unknown>[]).map((v) => ({ ...v, headline: cut(String(v.headline ?? ""), 80), primaryText: cut(String(v.primaryText ?? ""), 600), cta: cut(String(v.cta ?? "Learn more"), 30) }));
  return o;
}

/** Rules the AI must never be trusted with: the quote, the spokesperson and the contact details come from the client. */
export function enforceFacts(input: GenerateInput, content: Record<string, unknown>): Record<string, unknown> {
  if (input.channel !== "press_release") return content;
  const quote = input.post.spokespersonQuote.trim();
  const out = { ...content };
  out.quoteText = quote;
  out.quoteBy = quote ? input.post.spokespersonName.trim() || String(content.quoteBy ?? "") : "";
  if (!String(out.boilerplate ?? "").trim()) out.boilerplate = input.brand.about;
  if (!String(out.contactName ?? "").trim()) out.contactName = input.brand.contactName;
  if (!String(out.contactEmail ?? "").trim()) out.contactEmail = input.brand.contactEmail;
  if (!String(out.contactPhone ?? "").trim()) out.contactPhone = input.brand.contactPhone;
  return out;
}

function finish(input: GenerateInput, raw: unknown): unknown {
  let c = tidy(input.channel, raw) as Record<string, unknown>;
  c = enforceFacts(input, c);
  return CONTENT_SCHEMAS[input.channel].parse(c);
}

async function viaProvider(p: ProviderId, model: string, input: GenerateInput): Promise<Generated> {
  const { system, user } = buildPrompt(input);
  const max = MAX_TOKENS[input.channel];
  let first = await call(p, model, system, user, max);
  let tokens = { input: first.input, output: first.output };
  try {
    return { content: finish(input, extractJson(first.text)), model, inputTokens: tokens.input, outputTokens: tokens.output };
  } catch (e) {
    // One repair attempt: tell the model exactly what was wrong with its previous answer.
    const why = e instanceof ZodError ? e.issues.slice(0, 5).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ") : "it was not a single valid JSON object";
    first = await call(p, model, system, `${user}\n\nYour previous answer was rejected (${why}). Return the corrected JSON object only.`, max);
    tokens = { input: tokens.input + first.input, output: tokens.output + first.output };
    try {
      return { content: finish(input, extractJson(first.text)), model, inputTokens: tokens.input, outputTokens: tokens.output };
    } catch {
      throw new AiError("The AI returned an answer that could not be used. Please try again.", true);
    }
  }
}

export class OnePostAi {
  /** True when a real AI provider key is configured; false means demo drafts. */
  static async isLive(): Promise<boolean> {
    return Boolean((await resolveProviders()).primary);
  }

  static async generate(input: GenerateInput): Promise<Generated> {
    const { primary, fallback, settings } = await resolveProviders();
    if (!primary) return { content: CONTENT_SCHEMAS[input.channel].parse(enforceFacts(input, tidy(input.channel, demoContent(input)) as Record<string, unknown>)), model: DEMO_MODEL, inputTokens: 0, outputTokens: 0 };
    try {
      return await viaProvider(primary, settings.models[primary], input);
    } catch (e) {
      // The other provider is used only when the Super Admin switched fallback on, and only for outages — never for a refusal.
      if (fallback && e instanceof AiError && e.retryable) return viaProvider(fallback, settings.models[fallback], input);
      throw e;
    }
  }
}
