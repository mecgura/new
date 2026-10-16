import type { Channel } from "../catalog";

/** Result of asking a provider to send. `ok:true` means the provider ACCEPTED the request — it is not proof of delivery. */
export type SendResult = { ok: true; providerMessageId: string } | { ok: false; retryable: boolean; code: string; message: string };
export interface StatusUpdate { providerMessageId: string; status: "SENT" | "DELIVERED" | "READ" | "FAILED"; eventKey: string; at: Date | null; code?: string }
/** Verified, parsed webhook. `verified:false` => the request is rejected and changes nothing. */
export interface ParsedWebhook { verified: boolean; reason?: string; updates: StatusUpdate[] }
export interface WebhookRequest { method: string; url: string; headers: Headers; rawBody: string; query: URLSearchParams }

export interface ProviderBase { readonly name: string; readonly channel: Channel; isConfigured(): boolean; /** webhooks can only be trusted when its signing secret is configured */ webhookReady(): boolean; parseWebhook(req: WebhookRequest): ParsedWebhook; getMessageStatus(providerMessageId: string): Promise<StatusUpdate | null> }

export interface WhatsAppProvider extends ProviderBase {
  channel: "WHATSAPP";
  /** Business-initiated messages MUST be an approved template. */
  sendTemplate(input: { to: string; templateName: string; language: string; params: string[] }): Promise<SendResult>;
  /** Free text — only valid inside a customer-service window; the engine never uses it for automation. */
  sendMessage(input: { to: string; text: string }): Promise<SendResult>;
}
export interface SmsProvider extends ProviderBase {
  channel: "SMS";
  sendSMS(input: { to: string; text: string; senderId?: string | null; templateId?: string | null }): Promise<SendResult>;
}
export interface EmailProvider extends ProviderBase {
  channel: "EMAIL";
  sendEmail(input: { to: string; fromName: string; replyTo?: string | null; subject: string; html: string; text: string }): Promise<SendResult>;
}
export type AnyProvider = WhatsAppProvider | SmsProvider | EmailProvider;
