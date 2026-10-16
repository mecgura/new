import { db } from "@/lib/db";
import { DEFAULT_BRAND } from "@/theme/tokens";

export interface TenantProfile { id: string; name: string; slug: string; timezone: string; phone: string | null; email: string | null; address: string; logoUrl: string | null; color: string; baseUrl: string; viaHost: boolean; status: string }

const appUrl = () => (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
/** The clinic's own address for links: verified custom domain, else its subdomain, else the platform URL (the portal then needs `?clinic=`). */
export async function loadTenantProfile(tenantId: string): Promise<TenantProfile | null> {
  const t = await db.tenant.findFirst({ where: { id: tenantId, deletedAt: null }, include: { branding: true } });
  if (!t) return null;
  const https = appUrl().startsWith("https://"); const root = process.env.TENANT_ROOT_DOMAIN;
  const host = t.customDomain && t.customDomainVerifiedAt ? `https://${t.customDomain}` : t.subdomain && root ? `${https ? "https" : "http"}://${t.subdomain}.${root}` : null;
  const logo = t.branding?.logoUrl ?? null;
  return { id: t.id, name: t.name, slug: t.slug, timezone: t.timezone, phone: t.contactPhone, email: t.contactEmail, address: [t.address, t.city, t.state, t.pincode].filter(Boolean).join(", "), logoUrl: logo ? (logo.startsWith("/") ? appUrl() + logo : logo) : null, color: /^#[0-9a-fA-F]{6}$/.test(t.branding?.primaryColor ?? "") ? t.branding!.primaryColor! : DEFAULT_BRAND.primary, baseUrl: host ?? appUrl(), viaHost: !!host, status: t.status };
}
/** Authenticated portal route only — ids, never medical content. Patients must sign in to open it. */
export function portalLink(t: Pick<TenantProfile, "baseUrl" | "viaHost" | "slug">, path: string): string {
  const p = path.startsWith("/portal") ? path : `/portal${path.startsWith("/") ? "" : "/"}${path}`;
  return `${t.baseUrl}${p}${t.viaHost ? "" : `?clinic=${encodeURIComponent(t.slug)}`}`;
}
