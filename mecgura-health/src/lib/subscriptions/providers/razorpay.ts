import { createHmac } from "node:crypto";
import { safeEqual } from "@/lib/communications/providers/verify";
import { ProviderError, type CheckoutInput, type ParsedWebhook, type ProviderPaymentStatus, type SubscriptionPaymentProvider } from "./types";

/**
 * Razorpay adapter: hosted PAYMENT LINKS (no card data ever touches this app, no browser script needed).
 *  - checkout:   POST /v1/payment_links → the clinic is redirected to the hosted page
 *  - proof:      a signed webhook (X-Razorpay-Signature = hex HMAC-SHA256 of the raw body with the webhook secret) or GET /v1/payments/{id}
 *  - the redirect back to our callback URL is NEVER treated as proof of payment
 * Env: RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET.
 * Recurring auto-debit (mandates), pause and proration are NOT implemented: renewals are invoices the clinic pays.
 */
const BASE = "https://api.razorpay.com/v1";
const creds = () => ({ id: process.env.RAZORPAY_KEY_ID, secret: process.env.RAZORPAY_KEY_SECRET });
async function call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const { id, secret } = creds(); if (!id || !secret) throw new ProviderError("NOT_CONFIGURED", "The payment provider is not configured.");
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await fetch(`${BASE}${path}`, { method, signal: ctrl.signal, headers: { "content-type": "application/json", authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}` }, body: body ? JSON.stringify(body) : undefined });
    const json = (await res.json().catch(() => ({}))) as T & { error?: { description?: string } };
    if (!res.ok) throw new ProviderError(res.status >= 500 ? "UNAVAILABLE" : "REJECTED", json.error?.description?.slice(0, 200) ?? `The provider refused the request (${res.status}).`);
    return json;
  } catch (e) { if (e instanceof ProviderError) throw e; throw new ProviderError("UNAVAILABLE", "The payment provider could not be reached."); } finally { clearTimeout(t); }
}
type Ent = { id: string; order_id?: string | null; status?: string; amount?: number; currency?: string; method?: string; notes?: Record<string, string> | []; error_description?: string | null; acquirer_data?: { rrn?: string | null; upi_transaction_id?: string | null }; payment_id?: string };
const note = (n: Ent["notes"], k: string) => (n && !Array.isArray(n) ? n[k] ?? null : null);
const toStatus = (p: Ent): ProviderPaymentStatus => ({
  providerPaymentId: p.id, providerOrderId: p.order_id ?? null, status: p.status === "captured" ? "SUCCEEDED" : p.status === "failed" ? "FAILED" : "PENDING",
  amountMinor: p.amount ?? 0, currency: (p.currency ?? "INR").toUpperCase(), method: p.method ?? null, reference: p.acquirer_data?.rrn ?? p.acquirer_data?.upi_transaction_id ?? null, failureReason: p.error_description ?? null, invoiceRef: note(p.notes, "invoice_id"),
});

export const razorpayProvider: SubscriptionPaymentProvider = {
  key: "razorpay", displayName: "Razorpay", capabilities: { onlineCheckout: true, recurringMandates: false, pause: false, proration: false, refunds: true },
  configured: () => !!creds().id && !!creds().secret, webhookReady: () => !!process.env.RAZORPAY_WEBHOOK_SECRET && !!creds().id,
  async createCheckout(i: CheckoutInput) {
    const r = await call<{ id: string; short_url: string }>("POST", "/payment_links", {
      amount: i.amountMinor, currency: i.currency, accept_partial: false, reference_id: i.invoiceNumber, description: i.description.slice(0, 250),
      customer: { name: i.customer.name.slice(0, 80), email: i.customer.email, ...(i.customer.phone ? { contact: i.customer.phone } : {}) }, notify: { sms: false, email: false },
      callback_url: i.callbackUrl, callback_method: "get", notes: { invoice_id: i.invoiceId, tenant_id: i.tenantId },
    });
    return { providerOrderId: r.id, checkoutUrl: r.short_url };
  },
  async verifyPayment(paymentId) { return toStatus(await call<Ent>("GET", `/payments/${encodeURIComponent(paymentId)}`)); },
  async getPaymentStatus(linkId) {
    const l = await call<{ id: string; status: string; amount: number; currency: string; payments?: { payment_id: string; status: string }[]; notes?: Record<string, string> }>("GET", `/payment_links/${encodeURIComponent(linkId)}`);
    const paid = l.payments?.find((p) => p.status === "captured");
    return { providerPaymentId: paid?.payment_id ?? l.payments?.[0]?.payment_id ?? null, providerOrderId: l.id, status: l.status === "paid" ? "SUCCEEDED" : l.status === "expired" || l.status === "cancelled" ? "FAILED" : "PENDING", amountMinor: l.amount, currency: l.currency, method: null, reference: null, failureReason: l.status === "expired" ? "The payment link expired." : null, invoiceRef: note(l.notes, "invoice_id") };
  },
  verifyWebhook(rawBody, headers) {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET; if (!secret) return { ok: false, reason: "no_secret" };
    const sig = headers.get("x-razorpay-signature"); if (!sig) return { ok: false, reason: "missing_signature" };
    return safeEqual(sig, createHmac("sha256", secret).update(rawBody).digest("hex")) ? { ok: true } : { ok: false, reason: "bad_signature" };
  },
  parseWebhook(rawBody, headers): ParsedWebhook | null {
    let b: { event?: string; payload?: { payment?: { entity?: Ent }; refund?: { entity?: Ent & { payment_id?: string } }; payment_link?: { entity?: { id?: string } } } };
    try { b = JSON.parse(rawBody); } catch { return null; }
    const eventId = headers.get("x-razorpay-event-id"); const type = b.event ?? ""; if (!eventId || !type) return null;
    const pay = b.payload?.payment?.entity; const ref = b.payload?.refund?.entity;
    const base = { eventId, rawType: type, providerPaymentId: pay?.id ?? ref?.payment_id ?? null, providerOrderId: pay?.order_id ?? b.payload?.payment_link?.entity?.id ?? null, invoiceRef: note(pay?.notes, "invoice_id"), amountMinor: pay?.amount ?? ref?.amount ?? null, currency: (pay?.currency ?? ref?.currency)?.toUpperCase() ?? null, method: pay?.method ?? null, reference: pay?.acquirer_data?.rrn ?? pay?.acquirer_data?.upi_transaction_id ?? null, failureReason: pay?.error_description ?? null, refundId: ref?.id ?? null };
    if (type === "payment.captured" || type === "payment_link.paid" || type === "order.paid") return { ...base, kind: "payment.success" };
    if (type === "payment.failed") return { ...base, kind: "payment.failed" };
    if (type === "refund.processed") return { ...base, kind: "refund.processed" };
    return { ...base, kind: "ignored" };
  },
  async refundPayment(paymentId, amountMinor, reason) {
    const r = await call<{ id: string; status?: string }>("POST", `/payments/${encodeURIComponent(paymentId)}/refund`, { amount: amountMinor, notes: { reason: reason.slice(0, 200) } });
    return { providerRefundId: r.id, status: r.status === "processed" ? "PROCESSED" : "PENDING" };
  },
};
