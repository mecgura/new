import { ProviderError, type SubscriptionPaymentProvider } from "./types";

/** Offline payments (bank transfer, cheque, negotiated plans): recorded by a Super Admin after the money really arrived. It offers no online checkout and never pretends to. */
export const manualProvider: SubscriptionPaymentProvider = {
  key: "manual", displayName: "Offline / manual", capabilities: { onlineCheckout: false, recurringMandates: false, pause: false, proration: false, refunds: false },
  configured: () => true, webhookReady: () => false,
  async createCheckout() { throw new ProviderError("NOT_SUPPORTED", "Offline payments have no online checkout. Pay by bank transfer and ask MECGURA to record it."); },
  async verifyPayment() { throw new ProviderError("NOT_SUPPORTED", "Offline payments are confirmed by a person, not by a gateway."); },
  async getPaymentStatus() { throw new ProviderError("NOT_SUPPORTED", "Offline payments are confirmed by a person, not by a gateway."); },
  verifyWebhook: () => ({ ok: false, reason: "no_webhooks" }), parseWebhook: () => null,
  async refundPayment() { throw new ProviderError("NOT_SUPPORTED", "Offline refunds are paid out by MECGURA and then marked processed."); },
};
