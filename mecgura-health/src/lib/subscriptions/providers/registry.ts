import { manualProvider } from "./manual";
import { razorpayProvider } from "./razorpay";
import type { SubscriptionPaymentProvider } from "./types";

const ADAPTERS: Record<string, SubscriptionPaymentProvider> = { razorpay: razorpayProvider, manual: manualProvider };
let override: SubscriptionPaymentProvider | null = null;
export const __setSubscriptionProvider = (p: SubscriptionPaymentProvider | null) => { override = p; };
/** The ONLINE provider selected by SUBSCRIPTION_PAYMENT_PROVIDER, or null when none is set. */
export function onlineProvider(): SubscriptionPaymentProvider | null {
  if (override) return override;
  const k = process.env.SUBSCRIPTION_PAYMENT_PROVIDER; const p = k ? ADAPTERS[k] : undefined;
  return p && p.key !== "manual" && p.configured() ? p : null;
}
export const providerByKey = (k: string): SubscriptionPaymentProvider | null => (override && override.key === k ? override : ADAPTERS[k] ?? null);
export function providerStatusSummary() {
  const k = process.env.SUBSCRIPTION_PAYMENT_PROVIDER ?? null; const a = k ? ADAPTERS[k] : null;
  return { selected: k, supported: !k || !!a, configured: override ? true : !!a && a.configured(), webhookReady: override ? override.webhookReady() : !!a && a.webhookReady(), capabilities: (override ?? a)?.capabilities ?? null, hint: !k ? "Set SUBSCRIPTION_PAYMENT_PROVIDER (e.g. razorpay) and its credentials to accept online payments." : !a ? `Unknown provider “${k}”.` : !a.configured() ? "The provider is selected but its credentials are missing." : !a.webhookReady() ? "Credentials are set; the webhook secret is missing." : "Ready." };
}
