import Anthropic from "@anthropic-ai/sdk";
import { AI_MODEL, AiError, aiConfigured } from "@/providers/anthropic/reply";
import { systemPrompt, type AgentConfig, type AiAction, type AiTurn, type ChatTurn, type KnownContact } from "@/lib/ai";

/** Most tool rounds per customer message — the loop always ends. */
export const MAX_TOOL_ROUNDS = 4;

let client: Anthropic | null = null;
function getClient() {
  client ??= new Anthropic({ maxRetries: 1, timeout: 60_000 });
  return client;
}

type Tool = Anthropic.Beta.BetaTool;

function tools(cfg: AgentConfig): Tool[] {
  const a = cfg.actions;
  const out: Tool[] = [];
  if (a.collect && a.collectFields.length) {
    out.push({
      name: "save_contact_info",
      description: "Save details the customer has shared about themselves to their CRM record. Only include values the customer actually stated.",
      strict: true,
      input_schema: {
        type: "object",
        properties: {
          fields: {
            type: "array",
            items: {
              type: "object",
              properties: { field: { type: "string", enum: a.collectFields }, value: { type: "string" } },
              required: ["field", "value"],
              additionalProperties: false,
            },
          },
        },
        required: ["fields"],
        additionalProperties: false,
      },
    });
  }
  if (a.qualify) {
    out.push({
      name: "qualify_lead",
      description: "Record how interested the customer is. qualified = wants to buy or book; contacted = browsing or asking general questions; lost = clearly not interested.",
      strict: true,
      input_schema: {
        type: "object",
        properties: {
          status: { type: "string", enum: ["contacted", "qualified", "lost"] },
          interest: { type: "string", description: "What they are interested in, in a few words." },
          reason: { type: "string", description: "One short sentence explaining the judgement." },
        },
        required: ["status", "interest", "reason"],
        additionalProperties: false,
      },
    });
  }
  if (a.book) {
    out.push({
      name: "book_appointment",
      description: "Create an appointment REQUEST for the team to confirm. Call only once the service and the customer's preferred date/time are known.",
      strict: true,
      input_schema: {
        type: "object",
        properties: {
          service: a.bookingServices.length ? { type: "string", enum: a.bookingServices } : { type: "string" },
          preferred_time: { type: "string", description: "The customer's preferred date and time, as they said it." },
          notes: { type: "string" },
        },
        required: ["service", "preferred_time", "notes"],
        additionalProperties: false,
      },
    });
  }
  if (a.transfer) {
    out.push({
      name: "transfer_to_human",
      description: "Hand the conversation to a human team member. The AI stops replying in this chat.",
      strict: true,
      input_schema: { type: "object", properties: { reason: { type: "string" } }, required: ["reason"], additionalProperties: false },
    });
  }
  return out;
}

function toMessages(history: ChatTurn[]): Anthropic.Beta.BetaMessageParam[] {
  const messages: Anthropic.Beta.BetaMessageParam[] = [];
  for (const t of history) {
    const role = t.role === "customer" ? "user" : "assistant";
    const last = messages.at(-1);
    if (last && last.role === role) last.content = `${String(last.content)}\n${t.text}`;
    else if (messages.length || role === "user") messages.push({ role, content: t.text });
  }
  return messages;
}

function wrap(e: unknown): never {
  if (e instanceof AiError) throw e;
  if (e instanceof Anthropic.RateLimitError || e instanceof Anthropic.InternalServerError || e instanceof Anthropic.APIConnectionError) {
    throw new AiError(`AI temporarily unavailable: ${e.message}`.slice(0, 300), true);
  }
  if (e instanceof Anthropic.APIError) throw new AiError(`AI request rejected (${e.status ?? "error"}).`, false);
  throw new AiError("AI request failed.", true);
}

/**
 * One customer message → one reply, using Claude with tools for the agent's
 * enabled actions. `onAction` performs each action (CRM update, booking…) and
 * returns a short result the model sees. A transfer ends the turn with the
 * agent's configured handoff message.
 */
export async function liveRespond(
  cfg: AgentConfig,
  history: ChatTurn[],
  known: KnownContact,
  onAction: (a: AiAction) => Promise<string>
): Promise<AiTurn> {
  if (!aiConfigured()) throw new AiError("AI isn't configured (ANTHROPIC_API_KEY is not set).", false);
  const messages = toMessages(history);
  if (!messages.length || messages.at(-1)!.role !== "user") throw new AiError("There's no customer message to reply to.", false);
  const knownLine = `Known about this customer: name ${known.name || "unknown"}, email ${known.email || "unknown"}${Object.entries(known.customFields)
    .slice(0, 8)
    .map(([k, v]) => `, ${k} ${v}`)
    .join("")}.`;
  const system: Anthropic.Beta.BetaTextBlockParam[] = [
    // The agent's prompt + knowledge base is stable across messages → cached.
    { type: "text", text: systemPrompt(cfg), cache_control: { type: "ephemeral" } },
    { type: "text", text: knownLine },
  ];
  const toolDefs = tools(cfg);
  const actions: AiAction[] = [];
  let inputTokens = 0;
  let outputTokens = 0;
  let model = AI_MODEL;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    let res: Anthropic.Beta.BetaMessage;
    try {
      res = await getClient().beta.messages.create({
        model: AI_MODEL,
        max_tokens: 2000,
        output_config: { effort: "low" },
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        system,
        messages,
        ...(toolDefs.length ? { tools: toolDefs } : {}),
      });
    } catch (e) {
      wrap(e);
    }
    model = res.model || model;
    inputTokens += (res.usage.input_tokens ?? 0) + (res.usage.cache_read_input_tokens ?? 0) + (res.usage.cache_creation_input_tokens ?? 0);
    outputTokens += res.usage.output_tokens ?? 0;
    if (res.stop_reason === "refusal") throw new AiError("The AI declined to answer this message.", false);

    const text = res.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    const calls = res.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    if (res.stop_reason !== "tool_use" || !calls.length) {
      if (!text) throw new AiError("The AI returned an empty reply.", true);
      return { mode: "live", reply: text.slice(0, 4096), actions, handoff: null, model, inputTokens, outputTokens };
    }

    messages.push({ role: "assistant", content: res.content });
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    let transfer: AiAction | null = null;
    for (const c of calls) {
      const input = (c.input ?? {}) as Record<string, unknown>;
      let action: AiAction | null = null;
      if (c.name === "save_contact_info") {
        const fields = Object.fromEntries(((input.fields as { field: string; value: string }[]) ?? []).filter((f) => f.value?.trim()).map((f) => [f.field, f.value.trim().slice(0, 200)]));
        action = { type: "collect", fields };
      } else if (c.name === "qualify_lead") {
        action = { type: "qualify", status: (input.status as "contacted" | "qualified" | "lost") ?? "contacted", interest: String(input.interest ?? "").slice(0, 200), reason: String(input.reason ?? "").slice(0, 300) };
      } else if (c.name === "book_appointment") {
        action = { type: "book", service: String(input.service ?? "").slice(0, 120), requestedFor: String(input.preferred_time ?? "").slice(0, 120), notes: String(input.notes ?? "").slice(0, 500) };
      } else if (c.name === "transfer_to_human") {
        action = { type: "transfer", reason: String(input.reason ?? "Customer needs a person.").slice(0, 300) };
      }
      if (!action) {
        results.push({ type: "tool_result", tool_use_id: c.id, content: "Unknown tool.", is_error: true });
        continue;
      }
      actions.push(action);
      if (action.type === "transfer") {
        transfer = action;
        results.push({ type: "tool_result", tool_use_id: c.id, content: "Transferred." });
        continue;
      }
      try {
        results.push({ type: "tool_result", tool_use_id: c.id, content: (await onAction(action)).slice(0, 1000) || "Done." });
      } catch (e) {
        results.push({ type: "tool_result", tool_use_id: c.id, content: e instanceof Error ? e.message.slice(0, 300) : "Failed.", is_error: true });
      }
    }
    if (transfer && transfer.type === "transfer") {
      return { mode: "live", reply: cfg.handoff.message, actions, handoff: { reason: transfer.reason }, model, inputTokens, outputTokens };
    }
    messages.push({ role: "user", content: results });
  }
  throw new AiError(`The AI used tools ${MAX_TOOL_ROUNDS} times without replying — stopped.`, false);
}

/** Short internal summary of a conversation for the team (live mode). */
export async function liveSummary(cfg: AgentConfig, history: ChatTurn[]): Promise<{ text: string; model: string; inputTokens: number; outputTokens: number }> {
  if (!aiConfigured()) throw new AiError("AI isn't configured (ANTHROPIC_API_KEY is not set).", false);
  const transcript = history.map((t) => `${t.role === "customer" ? "Customer" : "Business"}: ${t.text}`).join("\n").slice(-30_000);
  try {
    const res = await getClient().beta.messages.create({
      model: AI_MODEL,
      max_tokens: 1500,
      output_config: { effort: "low" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: `You summarise WhatsApp conversations for the team at ${cfg.businessName || "the business"}. Write 3–5 short plain-text bullet lines: what the customer wants, details they shared, what was promised, and the next step. No preamble.`,
      messages: [{ role: "user", content: `Summarise this conversation:\n\n${transcript || "(empty)"}` }],
    });
    if (res.stop_reason === "refusal") throw new AiError("The AI declined to summarise this conversation.", false);
    const text = res.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    if (!text) throw new AiError("The AI returned an empty summary.", true);
    return { text: text.slice(0, 3000), model: res.model || AI_MODEL, inputTokens: res.usage.input_tokens ?? 0, outputTokens: res.usage.output_tokens ?? 0 };
  } catch (e) {
    wrap(e);
  }
}
