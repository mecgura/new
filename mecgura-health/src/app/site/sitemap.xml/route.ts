import { loadSitemapEntries } from "@/lib/website/data";
import { buildSitemap } from "@/lib/website/seo";
import { getOrigin, getPublicSite } from "@/lib/website/request";

export const dynamic = "force-dynamic";

/** Tenant-aware sitemap: published pages, services, doctors and articles of THIS host's clinic only. */
export async function GET() {
  const loaded = await getPublicSite();
  if (!loaded || loaded.load.kind !== "ok" || !loaded.load.site.content.seo.indexable) return new Response("Not found", { status: 404 });
  const xml = buildSitemap(await getOrigin(), loaded.load.site, await loadSitemapEntries(loaded.tenantId));
  return new Response(xml, { headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=300" } });
}
