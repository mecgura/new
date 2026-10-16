/**
 * One-time-password delivery. NO provider is configured in this project, so mobile / email OTP login is not offered and nothing
 * pretends to send a code. A real provider (SMS gateway, WhatsApp Business, e-mail service) implements `OtpProvider` and is assigned
 * to `otpProvider`; the portal login then enables the OTP option.
 */
export interface OtpProvider {
  readonly name: string;
  readonly channels: readonly ("SMS" | "WHATSAPP" | "EMAIL")[];
  send(input: { channel: "SMS" | "WHATSAPP" | "EMAIL"; to: string; code: string; clinicName: string }): Promise<{ delivered: boolean }>;
}
export const otpProvider: OtpProvider | null = null;
export const otpConfigured = () => otpProvider !== null;
