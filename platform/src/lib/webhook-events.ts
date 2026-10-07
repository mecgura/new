import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

/** Events an endpoint can subscribe to. */
export const WEBHOOK_EVENTS = {
  "message.received": "A customer message arrived",
  "message.sent": "A message was accepted by WhatsApp",
  "message.delivered": "A message reached the customer's phone",
  "message.read": "The customer read a message",
  "message.failed": "A message could not be delivered",
  "contact.created": "A contact was created",
  "contact.updated": "A contact's details changed",
  "conversation.created": "A new conversation started on a number",
  "campaign.completed": "A campaign finished sending",
  "flow.submitted": "A customer submitted a WhatsApp Flow",
} as const;
export type WebhookEvent = keyof typeof WEBHOOK_EVENTS;
export const WEBHOOK_EVENT_LIST = Object.keys(WEBHOOK_EVENTS) as WebhookEvent[];

export const WEBHOOK_LIMITS = {
  maxEndpoints: 10,
  timeoutMs: 10_000,
  /** Delay before attempt 2, 3, … — after the last one the delivery is marked failed. */
  retryDelaysMs: [60_000, 5 * 60_000, 30 * 60_000, 2 * 3_600_000, 6 * 3_600_000],
  /** Failed deliveries in a row before an endpoint is switched off. */
  disableAfterFailures: 10,
  failedPayloadRetentionDays: 7,
  toleranceSec: 300,
} as const;
export const MAX_ATTEMPTS = WEBHOOK_LIMITS.retryDelaysMs.length + 1;

export const webhookEndpointSchema = z.object({
  url: z.string().trim().min(1, "Enter the endpoint URL").max(2000),
  description: z.string().trim().max(200).optional().default(""),
  events: z.array(z.enum(WEBHOOK_EVENT_LIST as [WebhookEvent, ...WebhookEvent[]])).min(1, "Choose at least one event").max(WEBHOOK_EVENT_LIST.length),
});
export const webhookEndpointUpdateSchema = webhookEndpointSchema.partial().extend({ status: z.enum(["active", "disabled"]).optional() });

// ---------------------------------------------------------------------------
// Signing:  X-Mecgura-Signature: t=<unix seconds>,v1=<hex hmac-sha256(secret, "<t>.<raw body>")>
// ---------------------------------------------------------------------------

export function signPayload(secret: string, body: string, timestampSec: number): string {
  const v1 = createHmac("sha256", secret).update(`${timestampSec}.${body}`).digest("hex");
  return `t=${timestampSec},v1=${v1}`;
}

/** What a receiver does: recompute over the RAW body, compare in constant time, reject stale timestamps (replay). */
export function verifySignature(secret: string, body: string, header: string | null | undefined, opts: { toleranceSec?: number; nowSec?: number } = {}): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(",").map((p) => p.trim().split("=", 2) as [string, string]));
  const t = Number(parts.t);
  if (!Number.isFinite(t) || !parts.v1 || !/^[0-9a-f]{64}$/.test(parts.v1)) return false;
  const now = opts.nowSec ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - t) > (opts.toleranceSec ?? WEBHOOK_LIMITS.toleranceSec)) return false;
  const expected = Buffer.from(createHmac("sha256", secret).update(`${t}.${body}`).digest("hex"));
  const given = Buffer.from(parts.v1);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
