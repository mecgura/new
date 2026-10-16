import type { Channel } from "../catalog";
import { metaWhatsApp } from "./meta-whatsapp";
import { resendEmail } from "./resend-email";
import { twilioSms } from "./twilio-sms";
import type { AnyProvider, EmailProvider, SmsProvider, WhatsAppProvider } from "./types";

/** All vendor adapters live behind these interfaces; nothing outside `providers/` knows a vendor's name. Credentials are read from the environment at call time. */
const ADAPTERS: Record<Channel, Record<string, AnyProvider>> = { WHATSAPP: { meta: metaWhatsApp }, SMS: { twilio: twilioSms }, EMAIL: { resend: resendEmail } };
const ENV: Record<Channel, string> = { WHATSAPP: "WHATSAPP_PROVIDER", SMS: "SMS_PROVIDER", EMAIL: "EMAIL_PROVIDER" };
const overrides: Partial<Record<Channel, AnyProvider | null>> = {};
/** Tests only: install a stand-in adapter to exercise the engine WITHOUT contacting any vendor. Never called by application code. */
export function __setProvider(channel: Channel, p: AnyProvider | null | undefined) { if (p === undefined) delete overrides[channel]; else overrides[channel] = p; }

export function configuredProvider(channel: Channel): AnyProvider | null {
  if (channel in overrides && overrides[channel] !== undefined) return overrides[channel] ?? null;
  const p = ADAPTERS[channel][process.env[ENV[channel]] ?? ""]; return p?.isConfigured() ? p : null;
}
export const providerFor = (channel: Channel) => ((channel in overrides && overrides[channel] !== undefined) ? overrides[channel] ?? null : ADAPTERS[channel][process.env[ENV[channel]] ?? ""] ?? null);
export const whatsapp = () => configuredProvider("WHATSAPP") as WhatsAppProvider | null;
export const sms = () => configuredProvider("SMS") as SmsProvider | null;
export const email = () => configuredProvider("EMAIL") as EmailProvider | null;

/** Safe status for screens: which provider is selected and whether it is usable. NEVER values of secrets. */
export function providerStatus(channel: Channel) {
  const selected = process.env[ENV[channel]] || null; const known = selected ? !!ADAPTERS[channel][selected] : false; const p = providerFor(channel);
  return { channel, provider: selected, supported: known || (channel in overrides), configured: !!configuredProvider(channel), webhookReady: !!p?.webhookReady(), hint: !selected ? `Set ${ENV[channel]} to enable ${channel.toLowerCase()} sending.` : !known ? `"${selected}" is not a supported ${channel.toLowerCase()} provider.` : p?.isConfigured() ? null : "The provider's credentials are incomplete in the server environment." };
}
