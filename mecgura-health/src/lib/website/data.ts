import "server-only";
import { db } from "@/lib/db";
import { TENANT_ACCESS_STATUSES } from "@/lib/domain/constants";
import { resolveBrandColors } from "@/theme/tokens";
import { parseContent } from "./content";
import type { PublicArticle, PublicArticleCard, PublicDoctor, PublicFaq, PublicService, PublicTestimonial, SiteData } from "./types";
import { whatsappUrl } from "./urls";

/**
 * THE only place public website content is read. Every query is scoped by an explicit `tenantId` that callers get
 * from host resolution (never from the request body/URL) and — in public mode — filtered to PUBLISHED rows.
 */
export type SiteMode = "public" | "preview";
const statusFilter = (mode: SiteMode) => (mode === "public" ? "PUBLISHED" : { in: ["DRAFT", "PUBLISHED"] });
const arr = (json: string): string[] => { try { const v = JSON.parse(json); return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []; } catch { return []; } };

export type SiteLoad = { kind: "ok"; site: SiteData } | { kind: "unpublished"; name: string; brand: SiteData["brand"]; logoUrl: string | null } | { kind: "missing" };

export async function loadSite(tenantId: string, mode: SiteMode): Promise<SiteLoad> {
  const tenant = await db.tenant.findFirst({
    where: { id: tenantId, deletedAt: null, status: { in: [...TENANT_ACCESS_STATUSES] } },
    select: {
      name: true, legalName: true, contactEmail: true, contactPhone: true, address: true, city: true, state: true, pincode: true, country: true, isDemo: true,
      branding: true, subscription: { select: { plan: { select: { requiresAttribution: true } } } },
      website: true,
    },
  });
  if (!tenant) return { kind: "missing" };
  const brand = resolveBrandColors(tenant.branding);
  const w = tenant.website;
  if (mode === "public" && (!w || w.status !== "PUBLISHED" || !w.publishedContent)) return { kind: "unpublished", name: tenant.name, brand, logoUrl: tenant.branding?.logoUrl ?? null };

  const content = parseContent(mode === "public" ? w!.publishedContent : (w?.draftContent ?? "{}"));
  const status = statusFilter(mode);
  const base = { tenantId, status, deletedAt: null as null };
  const now = new Date();
  const [services, doctors, testimonials, faqs, articles, articleTotal] = await Promise.all([
    db.websiteService.findMany({ where: base, orderBy: [{ sortOrder: "asc" }, { title: "asc" }], take: 60 }),
    db.doctorPublicProfile.findMany({
      where: { tenantId, status, user: { deletedAt: null, status: "ACTIVE", tenantId } },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], take: 40,
      include: { user: { select: { name: true, doctorProfile: true } } },
    }),
    db.testimonial.findMany({ where: { tenantId, status }, orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }], take: 30 }),
    db.faqItem.findMany({ where: { tenantId, status }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], take: 80 }),
    db.article.findMany({
      where: { tenantId, status, ...(mode === "public" ? { publishedAt: { lte: now } } : {}) },
      orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }], take: 9,
      select: { slug: true, title: true, excerpt: true, featuredImageUrl: true, featuredImageAlt: true, category: true, tags: true, publishedAt: true, authorUserId: true, status: true },
    }),
    db.article.count({ where: { tenantId, status, ...(mode === "public" ? { publishedAt: { lte: now } } : {}) } }),
  ]);

  // Names for testimonial links / article authors, from the same tenant only.
  const doctorNames = new Map(doctors.map((d) => [d.userId, d.user.name]));
  const serviceTitles = new Map(services.map((s) => [s.id, s.title]));

  const site: SiteData = {
    mode,
    template: w?.template ?? "MODERN_MEDICAL",
    identity: { name: tenant.name, legalName: tenant.legalName, email: tenant.contactEmail, phone: tenant.contactPhone, address: tenant.address, city: tenant.city, state: tenant.state, pincode: tenant.pincode, country: tenant.country, isDemo: tenant.isDemo },
    brand, logoUrl: tenant.branding?.logoUrl ?? null, faviconUrl: tenant.branding?.faviconUrl ?? null,
    attribution: tenant.subscription?.plan.requiresAttribution ?? true,
    content,
    services: services.map(toService),
    doctors: doctors.map((d): PublicDoctor => {
      const p = d.user.doctorProfile;
      return {
        slug: d.slug, name: d.user.name, photoUrl: d.photoUrl, photoAlt: d.photoAlt,
        qualification: p?.qualification ?? null, specialization: p?.specialization ?? null, experienceYears: p?.experienceYears ?? null,
        shortBio: d.shortBio, bio: d.bio, education: d.education, certifications: arr(d.certifications), memberships: arr(d.memberships), languages: arr(d.languages), philosophy: d.philosophy,
        registration: d.showRegistration ? (p?.registrationNumber ?? null) : null, fee: d.showFee ? (p?.consultationFee ?? null) : null,
        seoTitle: d.seoTitle, seoDescription: d.seoDescription, isDraft: d.status !== "PUBLISHED",
      };
    }),
    testimonials: testimonials.map((t): PublicTestimonial => ({
      name: t.displayName?.trim() || "Anonymous Patient", text: t.text, rating: t.rating, date: t.givenOn,
      doctorName: t.doctorUserId ? (doctorNames.get(t.doctorUserId) ?? null) : null, serviceTitle: t.serviceId ? (serviceTitles.get(t.serviceId) ?? null) : null, isDraft: t.status !== "PUBLISHED",
    })),
    faqs: faqs.map((f): PublicFaq => ({ question: f.question, answer: f.answer, category: f.category, isDraft: f.status !== "PUBLISHED" })),
    articles: await toCards(tenantId, tenant.name, articles),
    articleTotal,
    whatsappLink: whatsappUrl(content.clinic.whatsapp || null),
    updatedAt: w?.updatedAt ?? new Date(0),
  };
  return { kind: "ok", site };
}

const toService = (s: { slug: string; title: string; shortDescription: string | null; description: string | null; category: string | null; durationMinutes: number | null; fee: number | null; showFee: boolean; imageUrl: string | null; imageAlt: string | null; icon: string | null; seoTitle: string | null; seoDescription: string | null; status: string }): PublicService => ({
  slug: s.slug, title: s.title, shortDescription: s.shortDescription, description: s.description, category: s.category, durationMinutes: s.durationMinutes,
  fee: s.showFee ? s.fee : null, imageUrl: s.imageUrl, imageAlt: s.imageAlt, icon: s.icon, seoTitle: s.seoTitle, seoDescription: s.seoDescription, isDraft: s.status !== "PUBLISHED",
});

type ArticleRow = { slug: string; title: string; excerpt: string | null; featuredImageUrl: string | null; featuredImageAlt: string | null; category: string | null; tags: string; publishedAt: Date | null; authorUserId: string | null; status: string };
async function toCards(tenantId: string, clinicName: string, rows: ArticleRow[]): Promise<PublicArticleCard[]> {
  const ids = [...new Set(rows.map((r) => r.authorUserId).filter((x): x is string => !!x))];
  const authors = ids.length ? await db.user.findMany({ where: { id: { in: ids }, tenantId, deletedAt: null }, select: { id: true, name: true } }) : [];
  const names = new Map(authors.map((a) => [a.id, a.name]));
  return rows.map((r) => ({ slug: r.slug, title: r.title, excerpt: r.excerpt, imageUrl: r.featuredImageUrl, imageAlt: r.featuredImageAlt, category: r.category, tags: arr(r.tags), publishedAt: r.publishedAt, author: (r.authorUserId && names.get(r.authorUserId)) || clinicName, isDraft: r.status !== "PUBLISHED" }));
}

export async function loadArticlePage(tenantId: string, clinicName: string, mode: SiteMode, page: number, size = 9) {
  const where = { tenantId, status: statusFilter(mode), ...(mode === "public" ? { publishedAt: { lte: new Date() } } : {}) };
  const [total, rows] = await Promise.all([
    db.article.count({ where }),
    db.article.findMany({ where, orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }], skip: (Math.max(1, page) - 1) * size, take: size, select: { slug: true, title: true, excerpt: true, featuredImageUrl: true, featuredImageAlt: true, category: true, tags: true, publishedAt: true, authorUserId: true, status: true } }),
  ]);
  return { total, pageCount: Math.max(1, Math.ceil(total / size)), cards: await toCards(tenantId, clinicName, rows) };
}

export async function loadArticle(tenantId: string, clinicName: string, mode: SiteMode, slug: string): Promise<PublicArticle | null> {
  const a = await db.article.findFirst({ where: { tenantId, slug, status: statusFilter(mode), ...(mode === "public" ? { publishedAt: { lte: new Date() } } : {}) } });
  if (!a) return null;
  const [card] = await toCards(tenantId, clinicName, [a]);
  return { ...card, content: a.content, seoTitle: a.seoTitle, seoDescription: a.seoDescription, canonicalUrl: a.canonicalUrl, ogImageUrl: a.ogImageUrl, updatedAt: a.updatedAt };
}

/** For sitemap: slugs + lastmod of everything public. */
export async function loadSitemapEntries(tenantId: string) {
  const [services, doctors, articles] = await Promise.all([
    db.websiteService.findMany({ where: { tenantId, status: "PUBLISHED", deletedAt: null }, select: { slug: true, updatedAt: true } }),
    db.doctorPublicProfile.findMany({ where: { tenantId, status: "PUBLISHED", user: { deletedAt: null, status: "ACTIVE", tenantId } }, select: { slug: true, updatedAt: true } }),
    db.article.findMany({ where: { tenantId, status: "PUBLISHED", publishedAt: { lte: new Date() } }, select: { slug: true, updatedAt: true } }),
  ]);
  return { services, doctors, articles };
}
