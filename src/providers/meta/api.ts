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

export async function unsubscribeAppFromWaba(wabaId: string, token: string): Promise<boolean> {
  const r = await graph<{ success?: boolean }>(`${wabaId}/subscribed_apps`, { token, method: "DELETE" });
  return r.success === true;
}

/** "+91 98765 43210" → "+919876543210". */
export function toE164(display: string): string {
  const digits = display.replace(/\D/g, "");
  return `+${digits}`;
}
