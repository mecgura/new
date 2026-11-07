import type { MetadataRoute } from "next";
import { db } from "@/lib/db";
import { siteConfig } from "@/config/site";

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
    { url: `${base}/privacy`, changeFrequency: "yearly", priority: 0.2 },
    { url: `${base}/terms`, changeFrequency: "yearly", priority: 0.2 },
  ];
  try {
    const posts = await db.blogPost.findMany({ where: { status: "published", publishedAt: { lte: now } }, select: { slug: true, updatedAt: true }, orderBy: { publishedAt: "desc" }, take: 5000 });
    for (const p of posts) out.push({ url: `${base}/blog/${p.slug}`, lastModified: p.updatedAt, changeFrequency: "monthly", priority: 0.7 });
    const pages = await db.landingPage.findMany({ where: { status: "published", noIndex: false }, select: { slug: true, updatedAt: true, organization: { select: { slug: true } } }, take: 5000 });
    for (const p of pages) out.push({ url: `${base}/p/${p.organization.slug}/${p.slug}`, lastModified: p.updatedAt, changeFrequency: "monthly", priority: 0.5 });
  } catch {
    /* database unavailable at build time: static entries only */
  }
  return out;
}
