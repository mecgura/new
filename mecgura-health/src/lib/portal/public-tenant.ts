import "server-only";
import { db } from "@/lib/db";
import { TENANT_ACCESS_STATUSES } from "@/lib/domain/constants";
import { resolvePublicTenant, type PublicTenant } from "@/lib/tenant/resolve";
import { resolveBrandColors } from "@/theme/tokens";

/** The clinic a logged-out portal page is for: the HOST's clinic, or (only on a host that has none) the clinic code in the URL. Public branding fields only. */
export async function portalPublicTenant(clinic?: string | null): Promise<PublicTenant | null> {
  const host = await resolvePublicTenant();
  if (host?.fromHost) return host;
  if (clinic && /^[a-z0-9-]{2,60}$/.test(clinic)) {
    const t = await db.tenant.findFirst({ where: { slug: clinic, deletedAt: null, status: { in: [...TENANT_ACCESS_STATUSES] } }, select: { id: true, name: true, slug: true, isDemo: true, branding: true } });
    if (t) return { id: t.id, name: t.name, slug: t.slug, isDemo: t.isDemo, logoUrl: t.branding?.logoUrl ?? null, faviconUrl: t.branding?.faviconUrl ?? null, brand: resolveBrandColors(t.branding), fromHost: false };
  }
  return host;
}
