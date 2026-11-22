import { siteConfig } from "@/config/site";
import type { ConnectionProvider, OAuthProvider } from "@/lib/onepost-publish";

/** OAuth app credentials come from server env only. They are created by MECGURA in each provider's developer console. */
export function oauthConfig(provider: OAuthProvider) {
  const redirectUri = `${siteConfig.url}/api/onepost/oauth/${provider}/callback`;
  if (provider === "linkedin") {
    return {
      clientId: process.env.LINKEDIN_CLIENT_ID?.trim() ?? "",
      clientSecret: process.env.LINKEDIN_CLIENT_SECRET?.trim() ?? "",
      // w_member_social is the self-serve scope (posts on the person's own profile). w_organization_social (Company Pages) needs LinkedIn's Community Management API approval.
      scopes: (process.env.LINKEDIN_SCOPES?.trim() || "openid profile w_member_social").split(/[\s,]+/).filter(Boolean),
      apiVersion: process.env.LINKEDIN_API_VERSION?.trim() || "202606",
      redirectUri,
    };
  }
  // One Google OAuth client serves Business Profile, YouTube and Search Console; each asks only for its own scope.
  const scopes: Record<"gbp" | "youtube" | "gsc", string[]> = {
    gbp: ["https://www.googleapis.com/auth/business.manage"],
    youtube: ["https://www.googleapis.com/auth/youtube.upload", "https://www.googleapis.com/auth/youtube.readonly"],
    gsc: ["https://www.googleapis.com/auth/webmasters.readonly"],
  };
  return { clientId: process.env.GOOGLE_OAUTH_CLIENT_ID?.trim() ?? "", clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim() ?? "", scopes: scopes[provider], apiVersion: "", redirectUri };
}

export const oauthConfigured = (p: OAuthProvider) => {
  const c = oauthConfig(p);
  return Boolean(c.clientId && c.clientSecret);
};

export const MISSING_ENV: Record<ConnectionProvider, string> = {
  linkedin: "LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET",
  gbp: "GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET",
  youtube: "GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET",
  gsc: "GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET",
  wordpress: "",
};
