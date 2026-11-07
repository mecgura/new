import type { MetadataRoute } from "next";
import { db } from "@/lib/db";
import { getPublishedResults } from "@/services/site/results";
import { siteConfig } from "@/config/site";
import { CITIES, INDUSTRIES } from "@/config/seo-pages";

export const revalidate = 3600;

/** Pages Google may index: home, blog, published blog posts, legal pages and clients' public landing pages. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteConfig.url;
  const now = new Date();
  const out: MetadataRoute.Sitemap = [
    { url: `${base}/`, lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: `${base}/blog`, lastModified: now, changeFrequency: "weekly", priority: 0.8 },
    { url: `${base}/tools`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    { url: `${base}/tools/whatsapp-link-generator`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    { url: `${base}/tools/whatsapp-qr-code-generator`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    { url: `${base}/tools/whatsapp-message-cost-calculator`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    { url: `${base}/demo`, lastModified: now, changeFrequency: "monthly", priority: 0.9 },
    { url: `${base}/about`, lastModified: now, changeFrequency: "monthly", priority: 0.5 },
    { url: `${base}/refer`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
    { url: `${base}/hi`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${base}/whatsapp-automation`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    ...INDUSTRIES.map((i) => ({ url: `${base}/whatsapp-automation/${i.slug}`, lastModified: now, changeFrequency: "monthly" as const, priority: 0.8 })),
    ...CITIES.map((c) => ({ url: `${base}/whatsapp-automation/in/${c.slug}`, lastModified: now, changeFrequency: "monthly" as const, priority: 0.6 })),
    { url: `${base}/guides/whatsapp-business-app-vs-api`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    { url: `${base}/guides/whatsapp-business-api-price-india`, lastModified: now, changeFrequency: "weekly", priority: 0.8 },
    { url: `${base}/resources/whatsapp-message-templates`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${base}/privacy`, changeFrequency: "yearly", priority: 0.2 },
    { url: `${base}/terms`, changeFrequency: "yearly", priority: 0.2 },
  ];
  try {
    const posts = await db.blogPost.findMany({ where: { status: "published", publishedAt: { lte: now } }, select: { slug: true, updatedAt: true }, orderBy: { publishedAt: "desc" }, take: 5000 });
    for (const p of posts) out.push({ url: `${base}/blog/${p.slug}`, lastModified: p.updatedAt, changeFrequency: "monthly", priority: 0.7 });
    if ((await getPublishedResults()).length) out.push({ url: `${base}/results`, lastModified: now, changeFrequency: "monthly", priority: 0.6 });
    const pages = await db.landingPage.findMany({ where: { status: "published", noIndex: false }, select: { slug: true, updatedAt: true, organization: { select: { slug: true } } }, take: 5000 });
    for (const p of pages) out.push({ url: `${base}/p/${p.organization.slug}/${p.slug}`, lastModified: p.updatedAt, changeFrequency: "monthly", priority: 0.5 });
  } catch {
    /* database unavailable at build time: static entries only */
  }
  return out;
}
