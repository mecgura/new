import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { db } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { resolveBrandColors, type BrandColors } from "@/theme/tokens";
import { parseTenantHost } from "./host";

export interface PublicTenant {
  name: string;
  slug: string;
  isDemo: boolean;
  logoUrl: string | null;
  brand: BrandColors;
}

/**
 * Tenant for LOGGED-OUT pages (login), from the request host: custom domain or subdomain.
 * Development can pin a tenant with DEV_TENANT_SLUG. Returns only public branding fields.
 */
export const resolvePublicTenant = cache(async (): Promise<PublicTenant | null> => {
  const env = getEnv();
  const host = (await headers()).get("x-forwarded-host") ?? (await headers()).get("host");
  const match = parseTenantHost(host, env.TENANT_ROOT_DOMAIN);
  const where =
    match?.kind === "subdomain" ? { subdomain: match.value }
    : match?.kind === "custom" ? { customDomain: match.value }
    : env.isDev && env.DEV_TENANT_SLUG ? { slug: env.DEV_TENANT_SLUG }
    : null;
  if (!where) return null;
  const tenant = await db.tenant.findFirst({
    where: { ...where, status: "ACTIVE", deletedAt: null },
    select: { name: true, slug: true, isDemo: true, branding: true },
  });
  if (!tenant) return null;
  return {
    name: tenant.name,
    slug: tenant.slug,
    isDemo: tenant.isDemo,
    logoUrl: tenant.branding?.logoUrl ?? null,
    brand: resolveBrandColors(tenant.branding),
  };
});
