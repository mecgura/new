/**
 * Estimated AI cost from token counts. Prices are the providers' list prices in
 * US$ per million tokens (input / output); unknown Claude models fall back to the
 * Haiku rate, unknown OpenAI models to the gpt-5-mini rate. Converted to rupees at AI_USD_INR (default 88). Estimates only —
 * the real bill is the provider's invoice.
 */
export const MODEL_PRICES: Record<string, { input: number; output: number }> = {
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-sonnet-5": { input: 2, output: 10 },
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-opus-5": { input: 5, output: 25 },
  "claude-fable-5-1": { input: 10, output: 50 },
  // OpenAI (list prices; check platform.openai.com/pricing — these are estimates)
  "gpt-5-nano": { input: 0.05, output: 0.4 },
  "gpt-5-mini": { input: 0.25, output: 2 },
  "gpt-5": { input: 1.25, output: 10 },
  "gpt-4.1-nano": { input: 0.1, output: 0.4 },
  "gpt-4.1-mini": { input: 0.4, output: 1.6 },
  "gpt-4.1": { input: 2, output: 8 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "gpt-4o": { input: 2.5, output: 10 },
};

export function usdToInr(): number {
  const v = Number(process.env.AI_USD_INR);
  return Number.isFinite(v) && v > 0 ? v : 88;
}

function priceFor(model: string) {
  const m = model.toLowerCase();
  const key = Object.keys(MODEL_PRICES)
    .sort((a, b) => b.length - a.length)
    .find((k) => m.startsWith(k));
  return MODEL_PRICES[key ?? (m.startsWith("claude") || !m ? "claude-haiku-5-5" : "gpt-5-mini")];
}

/** Cost in rupees for one call (or a sum of calls on the same model). */
export function tokenCostInr(model: string, inputTokens: number, outputTokens: number): number {
  if (!inputTokens && !outputTokens) return 0;
  const p = priceFor(model);
  return ((inputTokens * p.input + outputTokens * p.output) / 1_000_000) * usdToInr();
}
