import { createHmac, timingSafeEqual } from "node:crypto";
import { getRazorpay } from "@/lib/razorpay";
import { GatewayError, type CheckoutRequest, type CheckoutSession, type GatewayEvent, type PaymentGateway, type SubscriptionEvent } from "@/providers/payments/types";

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

type RzpPayment = { id?: string; order_id?: string; amount?: number; currency?: string; method?: string; error_code?: string; error_description?: string };
type RzpSubscription = { id?: string; status?: string; payment_method?: string; paid_count?: number };

/**
 * Razorpay adapter. Needs: key id (Admin → Settings → Razorpay), RAZORPAY_KEY_SECRET and, for webhooks,
 * RAZORPAY_WEBHOOK_SECRET (set the same value on the webhook in the Razorpay dashboard, URL
 * /api/webhooks/payments/razorpay, events payment.captured and payment.failed — and for auto-pay the
 * subscription.* events: authenticated, activated, charged, pending, halted, cancelled, completed, paused, resumed).
 */
export const razorpayGateway: PaymentGateway = {
  id: "razorpay",
  label: "Razorpay (UPI, cards, netbanking)",

  async isConfigured() {
    return Boolean(await getRazorpay());
  },

  async createCheckout(req: CheckoutRequest): Promise<CheckoutSession> {
    const rz = await getRazorpay();
    if (!rz) throw new GatewayError("Razorpay isn't connected yet.", 503);
    const order = await rz.client.orders.create({ amount: req.amount, currency: req.currency, receipt: req.invoiceNumber.slice(0, 40), notes: { invoice: req.invoiceNumber, organization: req.organizationId } });
    return { kind: "client_sdk", gateway: "razorpay", reference: order.id, publicKey: rz.keyId, amount: req.amount, currency: req.currency, name: "MECGURA", description: req.description, prefill: req.customer, mode: rz.mode };
  },

  async parseWebhook(rawBody: string, headers: Headers): Promise<(GatewayEvent | SubscriptionEvent)[]> {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET?.trim();
    if (!secret) throw new GatewayError("Razorpay webhooks aren't configured (RAZORPAY_WEBHOOK_SECRET).", 503);
    const given = headers.get("x-razorpay-signature") ?? "";
    if (!given || !safeEqual(createHmac("sha256", secret).update(rawBody).digest("hex"), given)) throw new GatewayError("Invalid signature.", 401);
    let body: { event?: string; payload?: { payment?: { entity?: RzpPayment }; subscription?: { entity?: RzpSubscription } } };
    try {
      body = JSON.parse(rawBody);
    } catch {
      throw new GatewayError("Invalid payload.");
    }
    const p = body.payload?.payment?.entity;
    const eventId = headers.get("x-razorpay-event-id") ?? "";
    const s = body.payload?.subscription?.entity;
    if (body.event?.startsWith("subscription.")) {
      if (!s?.id || !eventId) return [];
      return [
        {
          eventId,
          type: body.event === "subscription.charged" ? "subscription.charged" : "subscription.status",
          event: body.event,
          subscriptionRef: s.id,
          status: s.status ?? "",
          method: s.payment_method || p?.method || "",
          paidCount: typeof s.paid_count === "number" ? s.paid_count : null,
          paymentId: p?.id ?? "",
          amount: typeof p?.amount === "number" ? p.amount : null,
          currency: p?.currency ?? null,
          failureReason: (p?.error_description ?? "").slice(0, 200),
        },
      ];
    }
    if (!p?.id || !p.order_id || !eventId) return []; // an event type this integration doesn't use
    const base = { eventId, reference: p.order_id, paymentId: p.id, amount: typeof p.amount === "number" ? p.amount : null, currency: p.currency ?? null };
    if (body.event === "payment.captured") return [{ ...base, type: "payment.succeeded" }];
    if (body.event === "payment.failed") return [{ ...base, type: "payment.failed", failureCode: p.error_code ?? "", failureReason: (p.error_description ?? "").slice(0, 200) }];
    return [];
  },

  /** Checkout returns razorpay_order_id|razorpay_payment_id|razorpay_signature — HMAC with the key secret. */
  async verifyClientReturn(data: Record<string, string>, reference: string): Promise<GatewayEvent> {
    const secret = process.env.RAZORPAY_KEY_SECRET?.trim();
    if (!secret) throw new GatewayError("Razorpay isn't connected yet.", 503);
    const { razorpay_order_id: order, razorpay_payment_id: payment, razorpay_signature: sig } = data;
    if (!order || !payment || !sig || order !== reference) throw new GatewayError("Payment verification failed.");
    if (!safeEqual(createHmac("sha256", secret).update(`${order}|${payment}`).digest("hex"), sig)) throw new GatewayError("Payment verification failed.");
    return { eventId: `client:${payment}`, type: "payment.succeeded", reference: order, paymentId: payment, amount: null, currency: null };
  },
};
