import type { Metadata } from "next";
import { DAYS, schemaOrgDay } from "./content";
import { markdownToText } from "./markdown";
import { PAGE_PATH, type SiteRoute } from "./paths";
import { availablePages } from "./pages";
import type { PublicArticle, SiteData } from "./types";

export interface PageSeo { title: string; description: string; path: string; image?: string | null; noindex?: boolean; ogType?: "website" | "article" }

const TITLES: Record<string, string> = { about: "About", services: "Services", doctors: "Our doctors", clinic: "Clinic", testimonials: "Patient feedback", faq: "Frequently asked questions", articles: "Health articles", contact: "Contact", privacy: "Privacy policy", terms: "Terms of use", appointments: "Book an appointment" };

/** Sensible defaults from real CMS content; any per-page SEO field overrides. Never invents claims. */
export function seoFor(route: SiteRoute, site: SiteData, extra: { article?: PublicArticle | null } = {}): PageSeo {
  const { content: c, identity } = site;
  const place = [identity.city, identity.state].filter(Boolean).join(", ");
  const baseDesc = c.seo.defaultDescription || markdownToText(c.hero.intro || c.clinic.description, 160) || `${identity.name}${place ? ` — ${place}` : ""}`;
  const ogDefault = c.seo.ogImageUrl || site.logoUrl;
  const noindex = site.mode === "preview" || !c.seo.indexable;
  if (route.page === "home") return { title: c.seo.defaultTitle || `${identity.name}${c.hero.subheadline ? ` — ${c.hero.subheadline}` : ""}`, description: baseDesc, path: "/", image: c.hero.imageUrl || ogDefault, noindex };
  if (route.page === "service") {
    const s = site.services.find((x) => x.slug === route.slug);
    return { title: s?.seoTitle || s?.title || "Service", description: s?.seoDescription || s?.shortDescription || markdownToText(s?.description, 160) || baseDesc, path: `/services/${route.slug}`, image: s?.imageUrl || ogDefault, noindex };
  }
  if (route.page === "doctor") {
    const d = site.doctors.find((x) => x.slug === route.slug);
    return { title: d?.seoTitle || [d?.name, d?.specialization].filter(Boolean).join(" — ") || "Doctor", description: d?.seoDescription || d?.shortBio || markdownToText(d?.bio, 160) || baseDesc, path: `/doctors/${route.slug}`, image: d?.photoUrl || ogDefault, noindex };
  }
  if (route.page === "article") {
    const a = extra.article;
    return { title: a?.seoTitle || a?.title || "Article", description: a?.seoDescription || a?.excerpt || markdownToText(a?.content, 160) || baseDesc, path: `/articles/${route.slug}`, image: a?.ogImageUrl || a?.imageUrl || ogDefault, noindex, ogType: "article" };
  }
  return { title: TITLES[route.page] ?? identity.name, description: route.page === "clinic" ? (markdownToText(c.clinic.description, 160) || baseDesc) : baseDesc, path: PAGE_PATH[route.page], image: ogDefault, noindex };
}

/** Absolute URL for an asset/page given the site origin. */
export const absolute = (origin: string, path: string | null | undefined) => (path ? (path.startsWith("http") ? path : `${origin}${path}`) : undefined);

export function toMetadata(seo: PageSeo, site: SiteData, origin: string): Metadata {
  const image = absolute(origin, seo.image);
  const canonical = `${origin}${seo.path}`;
  const name = site.identity.name;
  // `absolute` opts out of the staff app's "· MECGURA HEALTH" title template: visitors only ever see the clinic's own name.
  const title = seo.path === "/" || seo.title.includes(name) ? seo.title : `${seo.title} | ${name}`;
  return {
    title: { absolute: title }, description: seo.description, metadataBase: new URL(origin),
    alternates: { canonical },
    robots: seo.noindex ? { index: false, follow: false } : { index: true, follow: true },
    icons: site.faviconUrl ? { icon: site.faviconUrl } : undefined,
    openGraph: { title, description: seo.description, url: canonical, siteName: site.identity.name, type: seo.ogType ?? "website", images: image ? [image] : undefined },
    twitter: { card: image ? "summary_large_image" : "summary", title, description: seo.description, images: image ? [image] : undefined },
  };
}

/**
 * schema.org structured data from real fields only. No ratings/reviews are ever emitted (we don't aggregate or verify them).
 */
export function jsonLdFor(site: SiteData, origin: string): Record<string, unknown> {
  const { identity: i, content: c } = site;
  const hours = DAYS.filter((d) => c.clinic.hours[d].open).map((d) => ({ "@type": "OpeningHoursSpecification", dayOfWeek: schemaOrgDay(d), opens: c.clinic.hours[d].from, closes: c.clinic.hours[d].to }));
  const onlyDoctor = site.doctors.length === 1 ? site.doctors[0] : null;
  return {
    "@context": "https://schema.org",
    "@type": onlyDoctor ? "Physician" : "MedicalClinic",
    name: onlyDoctor?.name ?? i.name,
    url: origin,
    ...(site.logoUrl ? { image: absolute(origin, site.logoUrl) } : {}),
    ...(i.phone ? { telephone: i.phone } : {}),
    ...(i.email ? { email: i.email } : {}),
    ...(onlyDoctor?.specialization ? { medicalSpecialty: onlyDoctor.specialization } : {}),
    ...(i.address || i.city ? { address: { "@type": "PostalAddress", streetAddress: i.address ?? undefined, addressLocality: i.city ?? undefined, addressRegion: i.state ?? undefined, postalCode: i.pincode ?? undefined, addressCountry: i.country } } : {}),
    ...(hours.length ? { openingHoursSpecification: hours } : {}),
    ...(onlyDoctor ? { worksFor: { "@type": "MedicalClinic", name: i.name } } : {}),
  };
}

/** JSON for an inline <script type="application/ld+json">: "<" is escaped so content can never close the tag. */
export const jsonLdString = (o: unknown) => JSON.stringify(o).replace(/</g, "\\u003c");

/* ---------------- sitemap / robots ---------------- */
const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function buildSitemap(origin: string, site: SiteData, entries: { services: { slug: string; updatedAt: Date }[]; doctors: { slug: string; updatedAt: Date }[]; articles: { slug: string; updatedAt: Date }[] }): string {
  const on = availablePages(site);
  const urls: { loc: string; lastmod: Date }[] = [];
  for (const [k, p] of Object.entries(PAGE_PATH)) {
    if (k === "appointments" || !on.has(k as never)) continue;
    urls.push({ loc: `${origin}${p === "/" ? "" : p}`, lastmod: site.updatedAt });
  }
  if (on.has("services")) for (const s of entries.services) urls.push({ loc: `${origin}/services/${s.slug}`, lastmod: s.updatedAt });
  if (on.has("doctors")) for (const d of entries.doctors) urls.push({ loc: `${origin}/doctors/${d.slug}`, lastmod: d.updatedAt });
  if (on.has("articles")) for (const a of entries.articles) urls.push({ loc: `${origin}/articles/${a.slug}`, lastmod: a.updatedAt });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${xml(u.loc)}</loc><lastmod>${u.lastmod.toISOString()}</lastmod></url>`).join("\n")}\n</urlset>\n`;
}

/** Disallow the app/admin/API areas always; disallow everything when the site is unpublished or not indexable. */
export function buildRobots(origin: string, opts: { indexable: boolean }): string {
  const lines = ["User-agent: *"];
  if (!opts.indexable) lines.push("Disallow: /");
  else lines.push("Allow: /", "Disallow: /api/", "Disallow: /dashboard", "Disallow: /settings", "Disallow: /team", "Disallow: /website", "Disallow: /preview", "Disallow: /platform", "Disallow: /login", "Disallow: /invite/", "Sitemap: " + `${origin}/sitemap.xml`);
  return lines.join("\n") + "\n";
}
