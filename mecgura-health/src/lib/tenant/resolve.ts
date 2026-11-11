import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { db } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { TENANT_ACCESS_STATUSES } from "@/lib/domain/constants";
import { resolveBrandColors, type BrandColors } from "@/theme/tokens";
import { parseTenantHost } from "./host";
import { findTenantByHost } from "./resolve-core";

export interface PublicTenant {
  id: string;
  name: string;
  slug: string;
  isDemo: boolean;
  logoUrl: string | null;
  faviconUrl: string | null;
  brand: BrandColors;
  /** true when resolved from the real host (subdomain/custom domain), false for the dev fallback */
  fromHost: boolean;
}

/**
 * Tenant for LOGGED-OUT pages (login, invitations), from the request host. Development can pin a tenant
 * with DEV_TENANT_SLUG. Returns only public branding fields.
 */
export const resolvePublicTenant = cache(async (): Promise<PublicTenant | null> => {
  const env = getEnv();
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  let tenant = await findTenantByHost(host);
  let fromHost = !!tenant;
  // Dev convenience only for hosts that carry no tenant (localhost / IP / platform host) — never for an unknown clinic host.
  if (!tenant && env.isDev && env.DEV_TENANT_SLUG && parseTenantHost(host, env.TENANT_ROOT_DOMAIN) === null) {
    tenant = await db.tenant.findFirst({
      where: { slug: env.DEV_TENANT_SLUG, deletedAt: null, status: { in: [...TENANT_ACCESS_STATUSES] } },
      select: { id: true, name: true, slug: true, isDemo: true, branding: true },
    });
    fromHost = false;
  }
  if (!tenant) return null;
  return {
    id: tenant.id, name: tenant.name, slug: tenant.slug, isDemo: tenant.isDemo,
    logoUrl: tenant.branding?.logoUrl ?? null, faviconUrl: tenant.branding?.faviconUrl ?? null,
    brand: resolveBrandColors(tenant.branding), fromHost,
  };
});
