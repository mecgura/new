/**
 * Online payment gateway abstraction for the patient portal ("Pay now"). No gateway is configured, so the portal shows invoices and
 * says online payment isn't available — it never fabricates a payment. A real gateway implements `PaymentGateway`; success must be
 * confirmed SERVER-SIDE (webhook / signed callback), never from the browser's redirect alone.
 */
export interface PaymentGateway {
  readonly name: string;
  createPayment(input: { tenantId: string; invoiceId: string; amountMinor: number; currency: string; reference: string }): Promise<{ redirectUrl: string; gatewayRef: string }>;
  verifyPayment(input: { gatewayRef: string; payload: unknown }): Promise<{ status: "SUCCESS" | "FAILED" | "PENDING"; amountMinor: number }>;
}
export const paymentGateway: PaymentGateway | null = null;
export const onlinePaymentAvailable = () => paymentGateway !== null;
