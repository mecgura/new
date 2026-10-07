/**
 * Integration catalogue. Phase 0 ships NO working integration, so every entry is shown as
 * "Not configured". A provider only becomes "configured" when real code implementing
 * `IntegrationProvider` is registered AND its env vars are set — never before.
 */
export interface IntegrationDef { key: string; name: string; description: string; requiredEnv: string[] }

export const INTEGRATIONS: readonly IntegrationDef[] = [
  { key: "whatsapp", name: "WhatsApp", description: "Appointment reminders and patient messages.", requiredEnv: ["WHATSAPP_PROVIDER", "WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID"] },
  { key: "sms", name: "SMS", description: "Text-message reminders and OTPs.", requiredEnv: ["SMS_PROVIDER", "SMS_ACCOUNT_SID", "SMS_API_KEY", "SMS_SENDER_ID"] },
  { key: "email", name: "Email", description: "Email notifications.", requiredEnv: ["EMAIL_PROVIDER", "EMAIL_API_KEY", "EMAIL_FROM"] },
  { key: "payments", name: "Payment gateway", description: "Online payments for billing.", requiredEnv: ["PAYMENT_PROVIDER", "PAYMENT_API_KEY"] },
  { key: "calendar", name: "Google Calendar", description: "Sync appointments to the doctor's calendar.", requiredEnv: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"] },
];

export interface IntegrationProvider<TPayload = unknown> {
  readonly key: string;
  isConfigured(): boolean;
  send(payload: TPayload): Promise<{ ok: boolean; reference?: string }>;
}
