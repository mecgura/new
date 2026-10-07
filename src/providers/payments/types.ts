/**
 * Payment gateway abstraction. Billing never talks to a specific provider: it asks a PaymentGateway for a
 * checkout, and only ever treats an invoice as paid after the gateway's signed confirmation (a verified
 * webhook, or a verified client return) — never because a browser said so.
 */
export type CheckoutRequest = {
  invoiceId: string;
  invoiceNumber: string;
  amount: number; // paise
  currency: string;
  organizationId: string;
  customer: { name: string; email: string };
  description: string;
};

export type CheckoutSession =
  /** The browser opens the provider's own checkout widget (e.g. Razorpay Checkout). */
  | { kind: "client_sdk"; gateway: string; reference: string; publicKey: string; amount: number; currency: string; name: string; description: string; prefill: { name: string; email: string }; mode: string }
  /** The browser is sent to a hosted payment page. */
  | { kind: "redirect"; gateway: string; reference: string; url: string };

export type GatewayEvent = {
  /** Provider's unique event id — used to process each event once. */
  eventId: string;
  type: "payment.succeeded" | "payment.failed";
  /** What createCheckout returned as `reference` (order / session id). */
  reference: string;
  paymentId: string;
  amount: number | null; // paise, when the provider reports it
  currency: string | null;
  failureCode?: string;
  failureReason?: string;
};

export class GatewayError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 401 | 409 | 503 = 400
  ) {
    super(message);
    this.name = "GatewayError";
  }
}

export interface PaymentGateway {
  readonly id: string;
  readonly label: string;
  /** Credentials present? An unconfigured gateway never offers checkout. */
  isConfigured(): Promise<boolean>;
  createCheckout(req: CheckoutRequest): Promise<CheckoutSession>;
  /** Verifies the provider's signature over the RAW body and returns normalised events. Throws GatewayError when invalid. */
  parseWebhook(rawBody: string, headers: Headers): Promise<GatewayEvent[]>;
  /** For widgets that return proof to the browser: verify that proof server-side. Throws GatewayError when invalid. */
  verifyClientReturn?(data: Record<string, string>, reference: string): Promise<GatewayEvent>;
}
