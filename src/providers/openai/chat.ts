import { z } from "zod";
import { AiError } from "@/providers/anthropic/reply";
import { agentTools, knownLine, MAX_TOOL_ROUNDS, toAction } from "@/providers/anthropic/agent";
import { CAPTION_LANGUAGES, type CaptionOption, type CaptionRequest } from "@/providers/anthropic/social";
import { relevantPassages, systemPrompt, type AgentConfig, type AiAction, type AiTurn, type ChatTurn, type KnownContact } from "@/lib/ai";

/**
 * OpenAI provider (Chat Completions API, official REST endpoint). Same behaviour as the Anthropic provider:
 * the same system prompt and knowledge, the same tools (strict JSON schema), the same limits. The key is read
 * from OPENAI_API_KEY on the server only; it never reaches the browser.
 */
export const OPENAI_MODEL = process.env.OPENAI_MODEL?.trim() || "gpt-5-mini";
const ENDPOINT = "https://api.openai.com/v1/chat/completions";

export const openaiConfigured = () => Boolean(process.env.OPENAI_API_KEY?.trim());

type Msg =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };
type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };
type Completion = {
  model?: string;
  choices?: { finish_reason?: string; message?: { content?: string | null; refusal?: string | null; tool_calls?: ToolCall[] } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};

/** One Chat Completions call with errors mapped to AiError (retryable for rate limits, 5xx and network). */
export async function complete(body: Record<string, unknown>, timeoutMs = 45_000): Promise<Completion> {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) throw new AiError("OpenAI isn't configured (OPENAI_API_KEY is not set).", false);
  let res: Response;
  try {
    res = await fetch(ENDPOINT, { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    throw new AiError("OpenAI didn't respond (network or timeout).", true);
  }
  if (!res.ok) {
    let detail = "";
    try {
      detail = ((await res.json()) as { error?: { message?: string } }).error?.message ?? "";
    } catch {
      /* not JSON */
    }
    const retryable = res.status === 429 || res.status >= 500;
    throw new AiError(`${retryable ? "AI temporarily unavailable" : "AI request rejected"} (OpenAI ${res.status})${detail ? `: ${detail}` : ""}`.slice(0, 300), retryable);
  }
  return (await res.json()) as Completion;
}

function toMessages(history: ChatTurn[]): Msg[] {
  const out: Msg[] = [];
  for (const t of history) {
    const role = t.role === "customer" ? "user" : "assistant";
    const last = out.at(-1);
    if (last && last.role === role && typeof last.content === "string") last.content = `${last.content}\n${t.text}`;
    else if (out.length || role === "user") out.push(role === "user" ? { role, content: t.text } : { role, content: t.text });
  }
  return out;
}

const textOf = (c: Completion) => (c.choices?.[0]?.message?.content ?? "").trim();
const usage = (c: Completion) => ({ input: c.usage?.prompt_tokens ?? 0, output: c.usage?.completion_tokens ?? 0 });
function refused(c: Completion, what: string) {
  if (c.choices?.[0]?.message?.refusal) throw new AiError(`The AI declined to ${what}.`, false);
}

export async function openaiGenerateReply(input: { instructions: string; businessName: string; history: ChatTurn[] }, model = OPENAI_MODEL): Promise<string> {
  const messages = toMessages(input.history);
  if (!messages.length || messages.at(-1)!.role !== "user") throw new AiError("There's no customer message to reply to yet.", false);
  const c = await complete({
    model,
    max_completion_tokens: 2000,
    messages: [
      {
        role: "system",
        content:
          `You reply to customers on WhatsApp on behalf of ${input.businessName || "the business"}. ` +
          "Write one short, friendly message (at most 3 sentences, plain text, no markdown headings). " +
          "Never invent prices, availability or policies that aren't in the instructions — offer to connect a team member instead.\n\n" +
          `Business instructions:\n${input.instructions}`,
      },
      ...messages,
    ],
  });
  refused(c, "answer this message");
  const text = textOf(c);
  if (!text) throw new AiError("The AI returned an empty reply.", true);
  return text.slice(0, 4096);
}

export async function openaiRespond(cfg: AgentConfig, history: ChatTurn[], known: KnownContact, onAction: (a: AiAction) => Promise<string>, model = OPENAI_MODEL): Promise<AiTurn> {
  const convo = toMessages(history);
  if (!convo.length || convo.at(-1)!.role !== "user") throw new AiError("There's no customer message to reply to.", false);
  const recent = history.filter((h) => h.role === "customer").slice(-3).map((h) => h.text).join("\n");
  const extra = relevantPassages(cfg, recent);
  const messages: Msg[] = [{ role: "system", content: [systemPrompt(cfg), knownLine(known), extra].filter(Boolean).join("\n\n") }, ...convo];
  const tools = agentTools(cfg).map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.input_schema, strict: true } }));
  const actions: AiAction[] = [];
  let inputTokens = 0;
  let outputTokens = 0;
  let used = model;
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const c = await complete({ model, max_completion_tokens: 2000, messages, ...(tools.length ? { tools, parallel_tool_calls: true } : {}) }, 60_000);
    used = c.model || used;
    inputTokens += usage(c).input;
    outputTokens += usage(c).output;
    refused(c, "answer this message");
    const msg = c.choices?.[0]?.message;
    const calls = msg?.tool_calls ?? [];
    if (!calls.length) {
      const text = textOf(c);
      if (!text) throw new AiError("The AI returned an empty reply.", true);
      return { mode: "live", reply: text.slice(0, 4096), actions, handoff: null, model: used, inputTokens, outputTokens };
    }
    messages.push({ role: "assistant", content: msg?.content ?? null, tool_calls: calls });
    let transfer: Extract<AiAction, { type: "transfer" }> | null = null;
    for (const call of calls) {
      let input: Record<string, unknown> = {};
      try {
        input = JSON.parse(call.function.arguments || "{}") as Record<string, unknown>;
      } catch {
        messages.push({ role: "tool", tool_call_id: call.id, content: "Invalid arguments." });
        continue;
      }
      const action = toAction(call.function.name, input);
      if (!action) {
        messages.push({ role: "tool", tool_call_id: call.id, content: "Unknown tool." });
        continue;
      }
      actions.push(action);
      if (action.type === "transfer") {
        transfer = action;
        messages.push({ role: "tool", tool_call_id: call.id, content: "Transferred." });
        continue;
      }
      let result: string;
      try {
        result = (await onAction(action)).slice(0, 1000) || "Done.";
      } catch (e) {
        result = `Error: ${e instanceof Error ? e.message.slice(0, 300) : "Failed."}`;
      }
      messages.push({ role: "tool", tool_call_id: call.id, content: result });
    }
    if (transfer) return { mode: "live", reply: cfg.handoff.message, actions, handoff: { reason: transfer.reason }, model: used, inputTokens, outputTokens };
  }
  throw new AiError(`The AI used tools ${MAX_TOOL_ROUNDS} times without replying — stopped.`, false);
}

export async function openaiSummary(cfg: AgentConfig, history: ChatTurn[], model = OPENAI_MODEL) {
  const transcript = history.map((t) => `${t.role === "customer" ? "Customer" : "Business"}: ${t.text}`).join("\n").slice(-30_000);
  const c = await complete({
    model,
    max_completion_tokens: 1500,
    messages: [
      { role: "system", content: `You summarise WhatsApp conversations for the team at ${cfg.businessName || "the business"}. Write 3–5 short plain-text bullet lines: what the customer wants, details they shared, what was promised, and the next step. No preamble.` },
      { role: "user", content: `Summarise this conversation:\n\n${transcript || "(empty)"}` },
    ],
  });
  refused(c, "summarise this conversation");
  const text = textOf(c);
  if (!text) throw new AiError("The AI returned an empty summary.", true);
  return { text: text.slice(0, 3000), model: c.model || model, inputTokens: usage(c).input, outputTokens: usage(c).output };
}

const captionSchema = z.object({ options: z.array(z.object({ caption: z.string().min(1).max(2000), hashtags: z.array(z.string().max(60)).max(15) })).min(1).max(3) });

export async function openaiCaptions(r: CaptionRequest, model = OPENAI_MODEL): Promise<{ options: CaptionOption[]; model: string; inputTokens: number; outputTokens: number }> {
  const system = [
    `You write social media captions for ${r.businessName || "a small Indian business"}.`,
    `Platform: ${r.platform === "both" ? "Instagram and Facebook" : r.platform}. Tone: ${r.tone}. Language: ${CAPTION_LANGUAGES[r.language]}.`,
    "Write exactly 3 different options. Each caption: a hook in the first line, 2–4 short lines, a clear call to action, up to 3 fitting emojis, under 600 characters, no hashtags inside the caption text.",
    "Give 5–8 relevant hashtags per option (without spaces; mix local and niche tags, no banned or misleading tags).",
    "Only use facts, prices, offers and dates from the brief. Never invent discounts, awards, reviews or claims like 'best in town'.",
    r.brandVoice ? `Brand voice to follow: ${r.brandVoice}` : "",
    r.defaultHashtags ? `Always include these hashtags: ${r.defaultHashtags}` : "",
  ].filter(Boolean).join("\n");
  const c = await complete({
    model,
    max_completion_tokens: 4000,
    messages: [{ role: "system", content: system }, { role: "user", content: `Brief:\n${r.brief}` }],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "captions",
        strict: true,
        schema: { type: "object", additionalProperties: false, required: ["options"], properties: { options: { type: "array", items: { type: "object", additionalProperties: false, required: ["caption", "hashtags"], properties: { caption: { type: "string" }, hashtags: { type: "array", items: { type: "string" } } } } } } },
      },
    },
  });
  refused(c, "write captions for this brief. Try rewording it");
  let parsed: z.infer<typeof captionSchema>;
  try {
    parsed = captionSchema.parse(JSON.parse(textOf(c)));
  } catch {
    throw new AiError("The AI returned an unexpected answer. Try again.", true);
  }
  const tidy = (h: string) => "#" + h.replace(/^#+/, "").replace(/\s+/g, "");
  return {
    options: parsed.options.slice(0, 3).map((o) => ({ caption: o.caption.trim(), hashtags: [...new Set(o.hashtags.map(tidy).filter((h) => h.length > 1))].slice(0, 10) })),
    model: c.model || model,
    inputTokens: usage(c).input,
    outputTokens: usage(c).output,
  };
}
