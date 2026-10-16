import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Logo } from "@/components/brand/logo";
import { toMetadata } from "@/lib/website/seo";
import { resolveSiteRoute, resolveToolRoute } from "@/lib/website/paths";
import { DisplayBoard } from "@/components/scheduling/display-board";
import { TokenStatus } from "@/components/scheduling/token-status";
import { brandToCssVars } from "@/theme/tokens";
import { getOrigin, getPublicSite } from "@/lib/website/request";
import { resolvePage, SitePage } from "@/website/render";

type Props = { params: Promise<{ path?: string[] }>; searchParams: Promise<{ page?: string; doctor?: string }> };

/** Public website for the clinic that owns the request's host. Content is the PUBLISHED snapshot only. */
export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const [{ path }, sp, loaded] = await Promise.all([params, searchParams, getPublicSite()]);
  if (!loaded) return { title: "Not found", robots: { index: false } };
  const tool = resolveToolRoute(path);
  if (tool) return { title: tool.tool === "display" ? "Waiting room" : "Your token", robots: { index: false, follow: false }, referrer: "no-referrer" };
  if (loaded.load.kind !== "ok") return { title: loaded.load.kind === "unpublished" ? `${loaded.load.name} — coming soon` : "Not found", robots: { index: false, follow: false } };
  const route = resolveSiteRoute(path);
  if (!route) return { title: "Not found", robots: { index: false } };
  const site = loaded.load.site;
  try {
    const resolved = await resolvePage(route, site, loaded.tenantId, sp);
    return toMetadata(resolved.seo, site, await getOrigin());
  } catch {
    return { title: "Not found", robots: { index: false } };
  }
}

export default async function PublicSite({ params, searchParams }: Props) {
  const [{ path }, sp, loaded] = await Promise.all([params, searchParams, getPublicSite()]);
  if (!loaded) notFound();
  // clinic tools work even before the marketing website is published (the queue doesn't depend on the CMS)
  const tool = resolveToolRoute(path);
  if (tool?.tool === "display") return <DisplayBoard displayKey={tool.key} />;
  if (tool?.tool === "token") {
    const brand = loaded.load.kind === "ok" ? loaded.load.site.brand : loaded.load.kind === "unpublished" ? loaded.load.brand : null;
    return (
      <div className="brand-scope min-h-dvh bg-app px-4 py-8" style={(brand ? brandToCssVars(brand) : undefined) as React.CSSProperties | undefined}>
        <main id="content" className="mx-auto max-w-lg"><h1 className="type-page-title mb-4 text-center">Your queue token</h1><TokenStatus token={tool.key} /></main>
      </div>
    );
  }
  if (loaded.load.kind === "missing") notFound();
  if (loaded.load.kind === "unpublished") {
    const u = loaded.load;
    return (
      <div className="brand-scope flex min-h-dvh items-center justify-center bg-app px-4" style={brandToCssVars(u.brand) as React.CSSProperties}>
        <main id="content" className="max-w-md space-y-4 text-center">
          <Logo name={u.name} sub={null} logoUrl={u.logoUrl} className="justify-center" />
          <h1 className="type-page-title">Our website is coming soon</h1>
          <p className="type-secondary">{u.name} is getting its website ready. Please check back shortly.</p>
        </main>
      </div>
    );
  }
  const route = resolveSiteRoute(path);
  if (!route) notFound();
  const site = loaded.load.site;
  const resolved = await resolvePage(route, site, loaded.tenantId, sp);
  return (
    <div className="brand-scope" style={brandToCssVars(site.brand) as React.CSSProperties}>
      <SitePage site={site} basePath="" resolved={resolved} origin={await getOrigin()} doctorSlug={sp.doctor} />
    </div>
  );
}
