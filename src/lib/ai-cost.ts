/**
 * Estimated AI cost from token counts. Prices are Anthropic's list prices in
 * US$ per million tokens (input / output); unknown models fall back to the
 * Haiku rate. Converted to rupees at AI_USD_INR (default 88). Estimates only —
 * the real bill is the provider's invoice.
 */
export const MODEL_PRICES: Record<string, { input: number; output: number }> = {
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-sonnet-5": { input: 2, output: 10 },
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-opus-5": { input: 5, output: 25 },
  "claude-fable-5-1": { input: 10, output: 50 },
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
  return MODEL_PRICES[key ?? "claude-haiku-5-5"];
}

/** Cost in rupees for one call (or a sum of calls on the same model). */
export function tokenCostInr(model: string, inputTokens: number, outputTokens: number): number {
  if (!inputTokens && !outputTokens) return 0;
  const p = priceFor(model);
  return ((inputTokens * p.input + outputTokens * p.output) / 1_000_000) * usdToInr();
}
