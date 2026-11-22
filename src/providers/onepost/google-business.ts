import { PublishError } from "@/lib/onepost-publish";
import { bearer, http } from "@/providers/onepost/http";
import { oauthConfig } from "@/providers/onepost/config";

export type GoogleTokens = { accessToken: string; expiresIn: number; refreshToken: string; scope: string };

export function googleAuthUrl(state: string) {
  const c = oauthConfig("gbp");
  const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  u.searchParams.set("client_id", c.clientId);
  u.searchParams.set("redirect_uri", c.redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", c.scopes.join(" "));
  u.searchParams.set("access_type", "offline");
  u.searchParams.set("prompt", "consent");
  u.searchParams.set("include_granted_scopes", "true");
  u.searchParams.set("state", state);
  return u.toString();
}

async function tokenRequest(form: Record<string, string>, keepRefresh = ""): Promise<GoogleTokens> {
  const c = oauthConfig("gbp");
  const r = await http<{ access_token?: string; expires_in?: number; refresh_token?: string; scope?: string }>("https://oauth2.googleapis.com/token", {
    label: "Google",
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...form, client_id: c.clientId, client_secret: c.clientSecret }),
  });
  if (!r.json.access_token) throw new PublishError("Google did not return an access token.", false);
  return { accessToken: r.json.access_token, expiresIn: r.json.expires_in ?? 3600, refreshToken: r.json.refresh_token ?? keepRefresh, scope: r.json.scope ?? "" };
}

export const googleExchange = (code: string) => tokenRequest({ grant_type: "authorization_code", code, redirect_uri: oauthConfig("gbp").redirectUri });
export const googleRefresh = (refreshToken: string) => tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken }, refreshToken);

/** Business accounts the person manages, each with its locations. */
export async function googleLocations(token: string): Promise<{ id: string; name: string }[]> {
  const accounts = await http<{ accounts?: { name?: string; accountName?: string }[] }>("https://mybusinessaccountmanagement.googleapis.com/v1/accounts?pageSize=20", { label: "Google Business Profile", headers: bearer(token) });
  const out: { id: string; name: string }[] = [];
  for (const a of (accounts.json.accounts ?? []).slice(0, 10)) {
    if (!a.name) continue;
    const locs = await http<{ locations?: { name?: string; title?: string }[] }>(`https://mybusinessbusinessinformation.googleapis.com/v1/${a.name}/locations?readMask=name,title&pageSize=100`, { label: "Google Business Profile", headers: bearer(token) });
    for (const l of locs.json.locations ?? []) if (l.name) out.push({ id: `${a.name}/${l.name}`, name: `${l.title ?? l.name}${a.accountName ? ` (${a.accountName})` : ""}` });
  }
  return out;
}

export type GbpPost = { summary: string; languageCode: string; cta: string; ctaUrl: string; imageUrl?: string };

/** Creates a "What's new" post on one location. `location` is "accounts/…/locations/…". Returns the post name and its search link. */
export async function googlePublish(token: string, location: string, p: GbpPost) {
  if (!/^accounts\/[^/]+\/locations\/[^/]+$/.test(location)) throw new PublishError("Choose which Google business location to post to.", false);
  const r = await http<{ name?: string; searchUrl?: string }>(`https://mybusiness.googleapis.com/v4/${location}/localPosts`, {
    label: "Google Business Profile",
    method: "POST",
    headers: { ...bearer(token), "content-type": "application/json" },
    body: JSON.stringify({
      languageCode: p.languageCode,
      summary: p.summary.slice(0, 1500),
      topicType: "STANDARD",
      ...(p.cta ? { callToAction: { actionType: p.cta, ...(p.cta !== "CALL" && p.ctaUrl ? { url: p.ctaUrl } : {}) } } : {}),
      ...(p.imageUrl ? { media: [{ mediaFormat: "PHOTO", sourceUrl: p.imageUrl }] } : {}),
    }),
  });
  return { id: r.json.name ?? "", url: r.json.searchUrl ?? "" };
}
