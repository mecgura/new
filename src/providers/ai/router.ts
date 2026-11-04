import { getSetting, setSetting } from "@/lib/settings";
import type { AgentConfig, AiAction, AiTurn, ChatTurn, KnownContact } from "@/lib/ai";
import { AI_MODEL, AiError, anthropicConfigured, generateReply as anthropicReply } from "@/providers/anthropic/reply";
import { liveRespond as anthropicRespond, liveSummary as anthropicSummary } from "@/providers/anthropic/agent";
import { generateCaptions as anthropicCaptions, type CaptionRequest } from "@/providers/anthropic/social";
import { complete, OPENAI_MODEL, openaiCaptions, openaiConfigured, openaiGenerateReply, openaiRespond, openaiSummary } from "@/providers/openai/chat";

/**
 * Chooses the live AI provider for every AI feature (agent replies, summaries, the automation AI step, social captions).
 *
 * - Keys only come from server env (ANTHROPIC_API_KEY / OPENAI_API_KEY) — never stored in the database or sent to browsers.
 * - Super Admin picks the provider and model (Admin → Integrations); "auto" = Anthropic when configured, else OpenAI.
 * - Fallback to the other provider happens ONLY when the admin switched it on, and only for outages / auth errors —
 *   never for a refusal.
 * - Each call's outcome is remembered per provider as its health (last success / last error).
 */
export type ProviderId = "anthropic" | "openai";
export const PROVIDERS: ProviderId[] = ["anthropic", "openai"];
export const PROVIDER_LABEL: Record<ProviderId, string> = { anthropic: "Anthropic (Claude)", openai: "OpenAI" };

export const providerConfigured = (p: ProviderId) => (p === "anthropic" ? anthropicConfigured() : openaiConfigured());
/** Which provider produced a logged model name (for logs and cost). */
export const providerOf = (model: string): ProviderId | "demo" => (!model || model.startsWith("demo") ? "demo" : model.startsWith("claude") ? "anthropic" : "openai");

export type AiSettings = { provider: "auto" | ProviderId; fallback: boolean; models: Record<ProviderId, string> };

export async function getAiSettings(): Promise<AiSettings> {
  const [provider, fallback, a, o] = await Promise.all([getSetting("ai_provider", process.env.AI_PROVIDER?.trim() || "auto"), getSetting("ai_fallback", "off"), getSetting("ai_model_anthropic"), getSetting("ai_model_openai")]);
  return {
    provider: provider === "anthropic" || provider === "openai" ? provider : "auto",
    fallback: fallback === "on",
    models: { anthropic: a.trim() || AI_MODEL, openai: o.trim() || OPENAI_MODEL },
  };
}

const MODEL_RE = /^[A-Za-z0-9._:-]{2,80}$/;
export async function saveAiSettings(input: Partial<{ provider: string; fallback: boolean; models: Partial<Record<ProviderId, string>> }>) {
  if (input.provider !== undefined) {
    if (!["auto", "anthropic", "openai"].includes(input.provider)) throw new AiError("Unknown provider.", false);
    await setSetting("ai_provider", input.provider);
  }
  if (input.fallback !== undefined) await setSetting("ai_fallback", input.fallback ? "on" : "off");
  for (const p of PROVIDERS) {
    const m = input.models?.[p];
    if (m === undefined) continue;
    if (m && !MODEL_RE.test(m.trim())) throw new AiError("Model names use letters, numbers, dots and dashes only.", false);
    await setSetting(`ai_model_${p}`, m.trim());
  }
  return getAiSettings();
}

/** Primary and (if explicitly enabled) fallback provider, given what's configured. */
export async function resolveProviders(): Promise<{ primary: ProviderId | null; fallback: ProviderId | null; settings: AiSettings }> {
  const settings = await getAiSettings();
  const configured = PROVIDERS.filter(providerConfigured);
  let primary: ProviderId | null = null;
  if (settings.provider === "auto") primary = configured[0] ?? null;
  else if (providerConfigured(settings.provider)) primary = settings.provider;
  const other = primary ? PROVIDERS.find((p) => p !== primary && providerConfigured(p)) ?? null : null;
  // The chosen provider has no key: use the other one only when fallback is switched on.
  if (!primary && settings.provider !== "auto" && settings.fallback) primary = configured[0] ?? null;
  return { primary, fallback: settings.fallback ? other : null, settings };
}

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

export type ProviderHealth = { ok: boolean; at: string; error: string; model: string; source: "call" | "test" };
const lastWritten = new Map<ProviderId, { ok: boolean; at: number }>();
/** Forget the in-memory write throttle (tests). */
export const resetHealthCache = () => lastWritten.clear();

async function recordHealth(p: ProviderId, h: Omit<ProviderHealth, "at">, force = false) {
  const prev = lastWritten.get(p);
  // Writes only when the state flips, or every 10 minutes while unchanged (no DB write per message).
  if (!force && prev && prev.ok === h.ok && Date.now() - prev.at < 10 * 60_000) return;
  lastWritten.set(p, { ok: h.ok, at: Date.now() });
  await setSetting(`ai_health:${p}`, JSON.stringify({ ...h, at: new Date().toISOString() })).catch(() => null);
}

export async function providerHealth(p: ProviderId): Promise<ProviderHealth | null> {
  try {
    const raw = await getSetting(`ai_health:${p}`);
    return raw ? (JSON.parse(raw) as ProviderHealth) : null;
  } catch {
    return null;
  }
}

/** A real, tiny request to the provider. Only a successful answer counts as verified. */
export async function testProvider(p: ProviderId): Promise<ProviderHealth> {
  const { settings } = await resolveProviders();
  const model = settings.models[p];
  if (!providerConfigured(p)) {
    const h = { ok: false, error: `${p === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY"} is not set.`, model, source: "test" as const };
    await recordHealth(p, h, true);
    return { ...h, at: new Date().toISOString() };
  }
  try {
    if (p === "openai") {
      const c = await complete({ model, max_completion_tokens: 200, messages: [{ role: "user", content: "Reply with the single word OK." }] }, 20_000);
      if (!c.choices?.length) throw new AiError("OpenAI returned no answer.", true);
    } else {
      await anthropicReply({ instructions: "Reply with the single word OK.", businessName: "MECGURA health check", history: [{ role: "customer", text: "Health check" }] }, model);
    }
    const h = { ok: true, error: "", model, source: "test" as const };
    await recordHealth(p, h, true);
    return { ...h, at: new Date().toISOString() };
  } catch (e) {
    const h = { ok: false, error: e instanceof Error ? e.message.slice(0, 300) : "Failed.", model, source: "test" as const };
    await recordHealth(p, h, true);
    return { ...h, at: new Date().toISOString() };
  }
}

// ---------------------------------------------------------------------------
// Calls
// ---------------------------------------------------------------------------

const shouldFallBack = (e: unknown) => e instanceof AiError && (e.retryable || /\b(401|403|404)\b/.test(e.message));

async function run<T>(call: (p: ProviderId, model: string) => Promise<T>, canFallBack: () => boolean = () => true): Promise<T> {
  const { primary, fallback, settings } = await resolveProviders();
  if (!primary) throw new AiError(settings.provider === "auto" ? "Configuration required: AI isn't configured on this installation (set ANTHROPIC_API_KEY or OPENAI_API_KEY)." : `Configuration required: ${PROVIDER_LABEL[settings.provider]} is selected but its API key isn't set.`, false);
  try {
    const out = await call(primary, settings.models[primary]);
    await recordHealth(primary, { ok: true, error: "", model: settings.models[primary], source: "call" });
    return out;
  } catch (e) {
    if (e instanceof AiError && shouldFallBack(e)) await recordHealth(primary, { ok: false, error: e.message, model: settings.models[primary], source: "call" });
    if (!fallback || !shouldFallBack(e) || !canFallBack()) throw e;
    const out = await call(fallback, settings.models[fallback]);
    await recordHealth(fallback, { ok: true, error: "", model: settings.models[fallback], source: "call" });
    return out;
  }
}

export function aiReply(input: { instructions: string; businessName: string; history: ChatTurn[] }) {
  return run((p, m) => (p === "openai" ? openaiGenerateReply(input, m) : anthropicReply(input, m)));
}
export function aiRespond(cfg: AgentConfig, history: ChatTurn[], known: KnownContact, onAction: (a: AiAction) => Promise<string>): Promise<AiTurn> {
  // Once an action (CRM update, booking…) has run, never retry on the other provider — it would run it twice.
  let acted = false;
  const act = async (a: AiAction) => {
    acted = true;
    return onAction(a);
  };
  return run((p, m) => (p === "openai" ? openaiRespond(cfg, history, known, act, m) : anthropicRespond(cfg, history, known, act, m)), () => !acted);
}
export function aiSummary(cfg: AgentConfig, history: ChatTurn[]) {
  return run((p, m) => (p === "openai" ? openaiSummary(cfg, history, m) : anthropicSummary(cfg, history, m)));
}
export function aiCaptions(r: CaptionRequest) {
  return run((p, m) => (p === "openai" ? openaiCaptions(r, m) : anthropicCaptions(r, m)));
}
