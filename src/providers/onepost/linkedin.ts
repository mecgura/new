import { PublishError } from "@/lib/onepost-publish";
import { bearer, http } from "@/providers/onepost/http";
import { oauthConfig } from "@/providers/onepost/config";

export type LinkedInTokens = { accessToken: string; expiresIn: number; refreshToken: string; scope: string };

export function linkedinAuthUrl(state: string) {
  const c = oauthConfig("linkedin");
  const u = new URL("https://www.linkedin.com/oauth/v2/authorization");
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", c.clientId);
  u.searchParams.set("redirect_uri", c.redirectUri);
  u.searchParams.set("state", state);
  u.searchParams.set("scope", c.scopes.join(" "));
  return u.toString();
}

async function tokenRequest(form: Record<string, string>): Promise<LinkedInTokens> {
  const c = oauthConfig("linkedin");
  const r = await http<{ access_token?: string; expires_in?: number; refresh_token?: string; scope?: string }>("https://www.linkedin.com/oauth/v2/accessToken", {
    label: "LinkedIn",
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...form, client_id: c.clientId, client_secret: c.clientSecret }),
  });
  if (!r.json.access_token) throw new PublishError("LinkedIn did not return an access token.", false);
  return { accessToken: r.json.access_token, expiresIn: r.json.expires_in ?? 5_184_000, refreshToken: r.json.refresh_token ?? "", scope: r.json.scope ?? c.scopes.join(" ") };
}

export const linkedinExchange = (code: string) => tokenRequest({ grant_type: "authorization_code", code, redirect_uri: oauthConfig("linkedin").redirectUri });
export const linkedinRefresh = (refreshToken: string) => tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken });

/** The signed-in person (OpenID Connect userinfo): used as the author for posts on their own profile. */
export async function linkedinProfile(token: string) {
  const r = await http<{ sub?: string; name?: string }>("https://api.linkedin.com/v2/userinfo", { label: "LinkedIn", headers: bearer(token) });
  if (!r.json.sub) throw new PublishError("LinkedIn did not return the profile.", false);
  return { urn: `urn:li:person:${r.json.sub}`, name: r.json.name ?? "LinkedIn profile" };
}

const restHeaders = (token: string) => ({ ...bearer(token), "LinkedIn-Version": oauthConfig("linkedin").apiVersion, "X-Restli-Protocol-Version": "2.0.0" });

/** Company Pages the person administers. Only works once LinkedIn has approved the app for page access; otherwise returns an empty list. */
export async function linkedinOrganizations(token: string): Promise<{ urn: string; name: string }[]> {
  try {
    const acl = await http<{ elements?: { organization?: string }[] }>("https://api.linkedin.com/rest/organizationAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED", { label: "LinkedIn", headers: restHeaders(token) });
    const urns = (acl.json.elements ?? []).map((e) => e.organization).filter((x): x is string => Boolean(x)).slice(0, 20);
    const out: { urn: string; name: string }[] = [];
    for (const urn of urns) {
      const id = urn.split(":").pop();
      const o = await http<{ localizedName?: string }>(`https://api.linkedin.com/rest/organizations/${id}`, { label: "LinkedIn", headers: restHeaders(token) }).catch(() => null);
      out.push({ urn, name: o?.json.localizedName ?? `Company page ${id}` });
    }
    return out;
  } catch {
    return [];
  }
}

/** LinkedIn's "little text" format treats these characters as markup, so plain text must escape them. */
export const escapeCommentary = (s: string) => s.replace(/[\\|{}@[\]()<>*_~]/g, (c) => `\\${c}`);

async function uploadImage(token: string, owner: string, image: { bytes: Uint8Array; contentType: string }) {
  const init = await http<{ value?: { uploadUrl?: string; image?: string } }>("https://api.linkedin.com/rest/images?action=initializeUpload", {
    label: "LinkedIn",
    method: "POST",
    headers: { ...restHeaders(token), "content-type": "application/json" },
    body: JSON.stringify({ initializeUploadRequest: { owner } }),
  });
  const uploadUrl = init.json.value?.uploadUrl;
  const urn = init.json.value?.image;
  if (!uploadUrl || !urn) throw new PublishError("LinkedIn did not accept the image upload.", false);
  await http(uploadUrl, { label: "LinkedIn", method: "PUT", headers: { ...bearer(token), "content-type": image.contentType }, body: image.bytes as BodyInit, timeoutMs: 60_000 });
  return urn;
}

/** Publishes a text post, with one image when given. `author` is a person or organization URN. Returns the post URN and its public link. */
export async function linkedinPublish(token: string, author: string, text: string, image?: { bytes: Uint8Array; contentType: string }) {
  const imageUrn = image ? await uploadImage(token, author, image) : "";
  const r = await http("https://api.linkedin.com/rest/posts", {
    label: "LinkedIn",
    method: "POST",
    headers: { ...restHeaders(token), "content-type": "application/json" },
    body: JSON.stringify({
      author,
      commentary: escapeCommentary(text).slice(0, 3000),
      visibility: "PUBLIC",
      distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
      lifecycleState: "PUBLISHED",
      isReshareDisabledByAuthor: false,
      ...(imageUrn ? { content: { media: { id: imageUrn } } } : {}),
    }),
  });
  const id = r.headers.get("x-restli-id") ?? "";
  return { id, url: id ? `https://www.linkedin.com/feed/update/${id}` : "" };
}
