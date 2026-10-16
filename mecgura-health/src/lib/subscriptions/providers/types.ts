/**
 * Provider-agnostic payment gateway for CLINIC → MECGURA subscription payments (NOT the patient payments of Phase 8).
 * Nothing in the application is allowed to call a gateway directly; everything goes through this interface.
 * Methods a provider cannot do honestly (recurring mandates, pause, proration) say so via `capabilities` — they are never faked.
 */
export interface CheckoutInput { tenantId: string; invoiceId: string; invoiceNumber: string; amountMinor: number; currency: string; customer: { name: string; email: string; phone?: string | null }; callbackUrl: string; description: string }
export interface CheckoutResult { providerOrderId: string; checkoutUrl: string }
export interface ProviderPaymentStatus { providerPaymentId: string | null; providerOrderId: string | null; status: "PENDING" | "SUCCEEDED" | "FAILED"; amountMinor: number; currency: string; method: string | null; reference: string | null; failureReason: string | null; invoiceRef: string | null }
export type WebhookKind = "payment.success" | "payment.failed" | "refund.processed" | "subscription.updated" | "ignored";
export interface ParsedWebhook { eventId: string; kind: WebhookKind; rawType: string; providerPaymentId: string | null; providerOrderId: string | null; invoiceRef: string | null; amountMinor: number | null; currency: string | null; method: string | null; reference: string | null; failureReason: string | null; refundId: string | null }
export interface ProviderCapabilities { onlineCheckout: boolean; recurringMandates: boolean; pause: boolean; proration: boolean; refunds: boolean }

export class ProviderError extends Error { constructor(public code: "NOT_CONFIGURED" | "NOT_SUPPORTED" | "UNAVAILABLE" | "REJECTED", message: string) { super(message); } }

export interface SubscriptionPaymentProvider {
  readonly key: string; readonly displayName: string; readonly capabilities: ProviderCapabilities;
  configured(): boolean; webhookReady(): boolean;
  createCustomer?(c: { tenantId: string; name: string; email: string }): Promise<{ customerId: string }>;
  createCheckout(i: CheckoutInput): Promise<CheckoutResult>;
  /** asks the PROVIDER what really happened — the only accepted proof of payment besides a signed webhook */
  verifyPayment(providerPaymentId: string): Promise<ProviderPaymentStatus>;
  getPaymentStatus(providerOrderId: string): Promise<ProviderPaymentStatus>;
  verifyWebhook(rawBody: string, headers: Headers): { ok: boolean; reason?: string };
  parseWebhook(rawBody: string, headers: Headers): ParsedWebhook | null;
  refundPayment(providerPaymentId: string, amountMinor: number, reason: string): Promise<{ providerRefundId: string; status: "PROCESSED" | "PENDING" }>;
  createSubscription?(): Promise<never>; cancelSubscription?(): Promise<never>; pauseSubscription?(): Promise<never>; resumeSubscription?(): Promise<never>;
}
