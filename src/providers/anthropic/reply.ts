import Anthropic from "@anthropic-ai/sdk";

export const AI_MODEL = "claude-opus-5-5";

/** Names (never values) of what the AI Response step needs. */
export function aiConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export class AiError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean
  ) {
    super(message);
    this.name = "AiError";
  }
}

let client: Anthropic | null = null;
function getClient() {
  // The engine retries steps itself, so the SDK makes a single extra attempt at most.
  client ??= new Anthropic({ maxRetries: 1, timeout: 45_000 });
  return client;
}

export type ChatTurn = { role: "customer" | "business"; text: string };

/**
 * Drafts a short WhatsApp reply from the business's instructions and the
 * recent conversation. Low effort keeps chat replies fast and inexpensive.
 */
export async function generateReply(input: { instructions: string; businessName: string; history: ChatTurn[] }): Promise<string> {
  if (!aiConfigured()) throw new AiError("AI isn't configured on this installation (ANTHROPIC_API_KEY is not set).", false);
  // Collapse into alternating user/assistant turns that start with the customer.
  const messages: Anthropic.Beta.BetaMessageParam[] = [];
  for (const t of input.history) {
    const role = t.role === "customer" ? "user" : "assistant";
    const last = messages.at(-1);
    if (last && last.role === role) last.content = `${String(last.content)}\n${t.text}`;
    else if (messages.length || role === "user") messages.push({ role, content: t.text });
  }
  if (!messages.length || messages.at(-1)!.role !== "user") throw new AiError("There's no customer message to reply to yet.", false);

  try {
    const res = await getClient().beta.messages.create({
      model: AI_MODEL,
      max_tokens: 2000,
      output_config: { effort: "low" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system:
        `You reply to customers on WhatsApp on behalf of ${input.businessName || "the business"}. ` +
        "Write one short, friendly message (at most 3 sentences, plain text, no markdown headings). " +
        "Never invent prices, availability or policies that aren't in the instructions — offer to connect a team member instead.\n\n" +
        `Business instructions:\n${input.instructions}`,
      messages,
    });
    if (res.stop_reason === "refusal") throw new AiError("The AI declined to answer this message.", false);
    const text = res.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    if (!text) throw new AiError("The AI returned an empty reply.", true);
    return text.slice(0, 4096);
  } catch (e) {
    if (e instanceof AiError) throw e;
    if (e instanceof Anthropic.RateLimitError || e instanceof Anthropic.InternalServerError || e instanceof Anthropic.APIConnectionError) {
      throw new AiError(`AI temporarily unavailable: ${e.message}`.slice(0, 300), true);
    }
    if (e instanceof Anthropic.APIError) throw new AiError(`AI request rejected (${e.status ?? "error"}).`, false);
    throw new AiError("AI request failed.", true);
  }
}
