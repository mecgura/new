export const STATUS: Record<string, [string, "neutral" | "info" | "success" | "warning" | "danger"]> = {
  QUEUED: ["Queued", "neutral"], PROCESSING: ["Sending", "info"], RETRYING: ["Retrying", "warning"], SENT: ["Sent", "info"], DELIVERED: ["Delivered", "success"], READ: ["Read", "success"],
  FAILED: ["Failed", "danger"], CANCELLED: ["Cancelled", "neutral"], SKIPPED: ["Not sent", "neutral"],
};
export const CHANNEL: Record<string, string> = { WHATSAPP: "WhatsApp", SMS: "SMS", EMAIL: "Email" };
export const FAIL_TEXT: Record<string, string> = {
  PROVIDER_NOT_CONFIGURED: "The provider isn't configured on the server.", NO_APPROVED_TEMPLATE: "No approved WhatsApp template.", HTTP_401: "The provider rejected our credentials.", HTTP_403: "The provider refused the request.", HTTP_400: "The provider rejected the message.",
  TIMEOUT: "The provider did not answer in time.", NETWORK_ERROR: "The provider could not be reached.", BOUNCED: "The email address bounced.", COMPLAINED: "The recipient reported the email as spam.", CHANNEL_DISABLED: "The channel was switched off.", ENTITY_CHANGED: "The appointment changed before sending.",
};
export const failText = (code: string | null, fallback: string | null) => (code && FAIL_TEXT[code]) || fallback || (code ? "The provider could not deliver the message." : "");
export const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");
