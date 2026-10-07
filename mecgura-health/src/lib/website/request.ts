import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { getEnv } from "@/lib/env";
import { findTenantByHost } from "@/lib/tenant/resolve-core";
import { loadSite } from "./data";

/** Header set ONLY by proxy.ts when it rewrites a tenant-host request to the public site. */
export const SITE_HEADER = "x-mh-site";

/** Tenant for the current public-site request — derived from the HOST, never from a URL parameter. */
export const getSiteHostTenant = cache(async () => {
  const h = await headers();
  if (h.get(SITE_HEADER) !== "1") return null; // /site/... typed directly on the platform host is not a site
  return findTenantByHost(h.get("x-forwarded-host") ?? h.get("host"));
});

export const getPublicSite = cache(async () => {
  const tenant = await getSiteHostTenant();
  return tenant ? loadSite(tenant.id, "public").then((load) => ({ tenantId: tenant.id, load })) : null;
});

export async function getOrigin() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost";
  const proto = h.get("x-forwarded-proto") ?? (getEnv().isProd ? "https" : "http");
  return `${proto}://${host}`;
}
