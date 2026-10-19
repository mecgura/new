import { getMetaConfig } from "@/providers/meta/config";
import { graph, MetaApiError } from "@/providers/meta/graph";

export type MetaWaba = { id: string; name?: string; currency?: string; timezone_id?: string; owner_business_info?: { id?: string; name?: string } };

export type MetaPhoneNumber = {
  id: string;
  display_phone_number: string;
  verified_name?: string;
  quality_rating?: string;
  code_verification_status?: string;
  name_status?: string;
  platform_type?: string;
  status?: string;
  messaging_limit_tier?: string;
};

const PHONE_FIELDS = "id,display_phone_number,verified_name,quality_rating,code_verification_status,name_status,platform_type,status,messaging_limit_tier";

/** Embedded Signup: exchange the short-lived code from FB.login for a business integration token. */
export async function exchangeCodeForToken(code: string): Promise<{ accessToken: string }> {
  const { appId, appSecret } = getMetaConfig();
  const r = await graph<{ access_token?: string }>("oauth/access_token", {
    query: { client_id: appId, client_secret: appSecret, code },
  });
  if (!r.access_token) throw new MetaApiError("Meta didn't return an access token.", 502);
  return { accessToken: r.access_token };
}

export function getWaba(wabaId: string, token: string) {
  return graph<MetaWaba>(wabaId, { token, query: { fields: "id,name,currency,timezone_id,owner_business_info" } });
}

export function getPhoneNumber(phoneNumberId: string, token: string) {
  return graph<MetaPhoneNumber>(phoneNumberId, { token, query: { fields: PHONE_FIELDS } });
}

export async function listPhoneNumbers(wabaId: string, token: string): Promise<MetaPhoneNumber[]> {
  const r = await graph<{ data: MetaPhoneNumber[] }>(`${wabaId}/phone_numbers`, { token, query: { fields: PHONE_FIELDS } });
  return r.data ?? [];
}

/** Subscribes the app that owns `token` to the WABA's webhooks. */
export async function subscribeAppToWaba(wabaId: string, token: string): Promise<boolean> {
  const r = await graph<{ success?: boolean }>(`${wabaId}/subscribed_apps`, { token, method: "POST" });
  return r.success === true;
}

/** Apps currently subscribed to the WABA's webhooks, with the WABA-level callback override if one is set. */
export async function listSubscribedApps(wabaId: string, token: string): Promise<{ id?: string; name?: string; overrideCallbackUri?: string }[]> {
  const r = await graph<{ data?: { whatsapp_business_api_data?: { id?: string; name?: string }; override_callback_uri?: string }[] }>(`${wabaId}/subscribed_apps`, { token });
  return (r.data ?? []).map((d) => ({ ...(d.whatsapp_business_api_data ?? {}), overrideCallbackUri: d.override_callback_uri }));
}

export type MetaTokenDebug = { app_id?: string; application?: string; is_valid?: boolean; expires_at?: number; type?: string };

/** Which app issued a token, whether it is valid and when it expires (0 = never). */
export async function debugToken(token: string): Promise<MetaTokenDebug> {
  const r = await graph<{ data?: MetaTokenDebug }>("debug_token", { token, query: { input_token: token } });
  return r.data ?? {};
}

export type MetaAppSubscription = { object?: string; callback_url?: string; active?: boolean; fields?: { name?: string }[] };

/** An app's own webhook subscriptions. Needs the app access token (`app_id|app_secret`), so it only works when the stored secret belongs to that app. */
export async function getAppSubscriptions(appId: string, appSecret: string): Promise<MetaAppSubscription[]> {
  const r = await graph<{ data?: MetaAppSubscription[] }>(`${appId}/subscriptions`, { token: `${appId}|${appSecret}` });
  return r.data ?? [];
}

export type MetaWebhookConfiguration = { phone_number?: string; whatsapp_business_account?: string; application?: string };

/** Where Meta currently sends events for a number: phone-level override, WABA-level override and the app's own callback. */
export async function getWebhookConfiguration(phoneNumberId: string, token: string): Promise<MetaWebhookConfiguration> {
  const r = await graph<{ webhook_configuration?: MetaWebhookConfiguration }>(phoneNumberId, { token, query: { fields: "webhook_configuration" } });
  return r.webhook_configuration ?? {};
}

/** Registers a phone number for the Cloud API and sets its two-step verification PIN. */
export async function registerPhoneNumber(phoneNumberId: string, token: string, pin: string): Promise<boolean> {
  const r = await graph<{ success?: boolean }>(`${phoneNumberId}/register`, { token, method: "POST", body: { messaging_product: "whatsapp", pin } });
  return r.success === true;
}

export async function unsubscribeAppFromWaba(wabaId: string, token: string): Promise<boolean> {
  const r = await graph<{ success?: boolean }>(`${wabaId}/subscribed_apps`, { token, method: "DELETE" });
  return r.success === true;
}

/** "+91 98765 43210" → "+919876543210". */
export function toE164(display: string): string {
  const digits = display.replace(/\D/g, "");
  return `+${digits}`;
}

// ---- Facebook Pages / Lead Ads -------------------------------------------------------------------

export type MetaLead = { id: string; field_data?: { name: string; values?: string[] }[]; form_id?: string };

/** Checks a Page access token and returns the Page's id and name. */
export function getPageInfo(pageId: string, pageToken: string) {
  return graph<{ id: string; name?: string }>(pageId, { token: pageToken, query: { fields: "id,name" } });
}

/** Subscribes the app to the Page's lead form submissions. */
export async function subscribePageToLeads(pageId: string, pageToken: string): Promise<boolean> {
  const r = await graph<{ success?: boolean }>(`${pageId}/subscribed_apps`, { token: pageToken, method: "POST", body: { subscribed_fields: ["leadgen"] } });
  return r.success === true;
}

/** Reads one submitted lead (needs the leads_retrieval permission on the Page token). */
export function getLead(leadgenId: string, pageToken: string) {
  return graph<MetaLead>(leadgenId, { token: pageToken, query: { fields: "id,field_data,form_id" } });
}
