import "server-only";
import { db } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { TENANT_ACCESS_STATUSES } from "@/lib/domain/constants";
import { disabledFeaturesOf } from "@/lib/platform/runtime";
import { parseTenantHost } from "./host";

/**
 * hostname -> tenant. The single domain-resolution service:
 *   - <label>.TENANT_ROOT_DOMAIN  -> tenant with that subdomain
 *   - any other host              -> tenant whose customDomain matches AND is verified by a Super Admin
 * Unverified custom domains never resolve (prevents a mistyped/hijacked domain from serving a clinic).
 * Returns null for the platform host, localhost and unknown hosts.
 */
export async function findTenantByHost(hostHeader: string | null | undefined) {
  const match = parseTenantHost(hostHeader, getEnv().TENANT_ROOT_DOMAIN);
  if (!match) return null;
  const where =
    match.kind === "subdomain"
      ? { subdomain: match.value }
      : { customDomain: match.value, customDomainVerifiedAt: { not: null } };
  const t = await db.tenant.findFirst({
    where: { ...where, deletedAt: null, status: { in: [...TENANT_ACCESS_STATUSES] } },
    select: { id: true, name: true, slug: true, isDemo: true, branding: true },
  });
  if (!t) return null;
  // Phase 15: the public site needs the "publicWebsite" feature, and a custom domain needs "customDomain" (plan ∪ Super Admin switches).
  const off = await disabledFeaturesOf(t.id);
  if (off.includes("publicWebsite") || (match.kind !== "subdomain" && off.includes("customDomain"))) return null;
  return t;
}
