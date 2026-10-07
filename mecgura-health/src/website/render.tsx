import { notFound } from "next/navigation";
import { jsonLdFor, jsonLdString, seoFor, type PageSeo } from "@/lib/website/seo";
import { loadArticle, loadArticlePage, type SiteMode } from "@/lib/website/data";
import { availablePages } from "@/lib/website/pages";
import type { SiteRoute } from "@/lib/website/paths";
import type { PublicArticle, PublicArticleCard, SiteData } from "@/lib/website/types";
import { getTemplate } from "./templates/registry";

export interface Resolved {
  route: SiteRoute;
  seo: PageSeo;
  article?: PublicArticle | null;
  articles?: { cards: PublicArticleCard[]; page: number; pageCount: number };
}

/** Validates a route against what the site actually has (published, enabled) and gathers page-specific data. 404s otherwise. */
export async function resolvePage(route: SiteRoute, site: SiteData, tenantId: string, search: { page?: string; doctor?: string }): Promise<Resolved> {
  const on = availablePages(site);
  const mode: SiteMode = site.mode;
  switch (route.page) {
    case "service": if (!on.has("services") || !site.services.some((s) => s.slug === route.slug)) notFound(); break;
    case "doctor": if (!on.has("doctors") || !site.doctors.some((d) => d.slug === route.slug)) notFound(); break;
    case "article": {
      if (!on.has("articles")) notFound();
      const article = await loadArticle(tenantId, site.identity.name, mode, route.slug);
      if (!article) notFound();
      return { route, article, seo: seoFor(route, site, { article }) };
    }
    case "articles": {
      if (!on.has("articles")) notFound();
      const page = Math.max(1, Number(search.page) || 1);
      const r = await loadArticlePage(tenantId, site.identity.name, mode, page);
      return { route, articles: { cards: r.cards, page, pageCount: r.pageCount }, seo: seoFor(route, site) };
    }
    default: if (!on.has(route.page)) notFound();
  }
  return { route, seo: seoFor(route, site) };
}

/** Renders one page inside the site's template. Used by BOTH the public site and the CMS preview. */
export function SitePage({ site, basePath, resolved, origin, doctorSlug }: { site: SiteData; basePath: string; resolved: Resolved; origin: string; doctorSlug?: string }) {
  const T = getTemplate(site.template).components;
  const { route } = resolved;
  let body: React.ReactNode;
  switch (route.page) {
    case "home": body = <T.Home site={site} basePath={basePath} />; break;
    case "about": body = <T.About site={site} basePath={basePath} />; break;
    case "services": body = <T.Services site={site} basePath={basePath} />; break;
    case "service": body = <T.ServiceDetail site={site} basePath={basePath} service={site.services.find((s) => s.slug === route.slug)!} />; break;
    case "doctors": body = <T.Doctors site={site} basePath={basePath} />; break;
    case "doctor": body = <T.DoctorDetail site={site} basePath={basePath} doctor={site.doctors.find((d) => d.slug === route.slug)!} />; break;
    case "clinic": body = <T.Clinic site={site} basePath={basePath} />; break;
    case "testimonials": body = <T.Testimonials site={site} basePath={basePath} />; break;
    case "faq": body = <T.Faq site={site} basePath={basePath} />; break;
    case "articles": body = <T.Articles site={site} basePath={basePath} {...resolved.articles!} />; break;
    case "article": body = <T.ArticleDetail site={site} basePath={basePath} article={resolved.article!} />; break;
    case "contact": body = <T.Contact site={site} basePath={basePath} />; break;
    case "privacy": body = <T.Legal site={site} basePath={basePath} title="Privacy policy" text={site.content.legal.privacy} />; break;
    case "terms": body = <T.Legal site={site} basePath={basePath} title="Terms of use" text={site.content.legal.terms} />; break;
    case "appointments": body = <T.Appointments site={site} basePath={basePath} doctor={site.doctors.find((d) => d.slug === doctorSlug) ?? null} />; break;
  }
  return (
    <T.Layout site={site} basePath={basePath}>
      {route.page === "home" && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(jsonLdFor(site, origin)) }} />}
      {body}
    </T.Layout>
  );
}
