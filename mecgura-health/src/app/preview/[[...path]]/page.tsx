import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Eye } from "lucide-react";
import { requireTenantPagePermission } from "@/lib/auth/context";
import { loadSite } from "@/lib/website/data";
import { resolveSiteRoute } from "@/lib/website/paths";
import { getOrigin } from "@/lib/website/request";
import { brandToCssVars } from "@/theme/tokens";
import { resolvePage, SitePage } from "@/website/render";

export const metadata: Metadata = { title: "Website preview", robots: { index: false, follow: false } };

/**
 * Draft preview for signed-in staff only. Shows the DRAFT content and unpublished items of the CALLER's clinic
 * (tenant from the session). Visitors can never reach it: the proxy requires a session and this page re-checks permission.
 */
export default async function Preview({ params, searchParams }: { params: Promise<{ path?: string[] }>; searchParams: Promise<{ page?: string; doctor?: string }> }) {
  const ctx = await requireTenantPagePermission("website.view");
  const [{ path }, sp] = await Promise.all([params, searchParams]);
  const load = await loadSite(ctx.tenantId, "preview");
  if (load.kind !== "ok") notFound();
  const route = resolveSiteRoute(path);
  if (!route) notFound();
  const site = load.site;
  const resolved = await resolvePage(route, site, ctx.tenantId, sp);
  return (
    <div className="brand-scope" style={brandToCssVars(site.brand) as React.CSSProperties}>
      <div role="status" className="sticky top-0 z-40 flex flex-wrap items-center justify-between gap-2 bg-ink px-4 py-2 text-sm text-on-brand">
        <span className="flex items-center gap-2"><Eye aria-hidden className="size-4" /><strong>Preview</strong> — draft content, not public{ctx.viewingAs ? " · viewing as Super Admin" : ""}</span>
        <Link href="/website" className="rounded-md border border-white/40 px-3 py-1 !text-on-brand no-underline hover:bg-white/10">Back to CMS</Link>
      </div>
      <SitePage site={site} basePath="/preview" resolved={resolved} origin={await getOrigin()} doctorSlug={sp.doctor} />
    </div>
  );
}
