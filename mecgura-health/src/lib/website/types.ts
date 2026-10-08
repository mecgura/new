import type { BrandColors } from "@/theme/tokens";
import type { SiteContent } from "./content";

/** Shapes handed to public templates. Deliberately contain NO internal ids, tenant ids, staff emails or private data. */
export interface PublicService { slug: string; title: string; shortDescription: string | null; description: string | null; category: string | null; durationMinutes: number | null; fee: number | null; imageUrl: string | null; imageAlt: string | null; icon: string | null; seoTitle: string | null; seoDescription: string | null; isDraft: boolean }
export interface PublicDoctor { slug: string; name: string; photoUrl: string | null; photoAlt: string | null; qualification: string | null; specialization: string | null; experienceYears: number | null; shortBio: string | null; bio: string | null; education: string | null; certifications: string[]; memberships: string[]; languages: string[]; philosophy: string | null; registration: string | null; fee: number | null; seoTitle: string | null; seoDescription: string | null; isDraft: boolean }
export interface PublicTestimonial { name: string; text: string; rating: number | null; date: Date | null; doctorName: string | null; serviceTitle: string | null; isDraft: boolean }
export interface PublicFaq { question: string; answer: string; category: string | null; isDraft: boolean }
export interface PublicArticleCard { slug: string; title: string; excerpt: string | null; imageUrl: string | null; imageAlt: string | null; category: string | null; tags: string[]; publishedAt: Date | null; author: string; isDraft: boolean }
export interface PublicArticle extends PublicArticleCard { content: string; seoTitle: string | null; seoDescription: string | null; canonicalUrl: string | null; ogImageUrl: string | null; updatedAt: Date }

export interface SiteIdentity { name: string; legalName: string | null; email: string | null; phone: string | null; address: string | null; city: string | null; state: string | null; pincode: string | null; country: string; isDemo: boolean }

export interface SiteData {
  mode: "public" | "preview";
  template: string;
  identity: SiteIdentity;
  brand: BrandColors;
  logoUrl: string | null;
  faviconUrl: string | null;
  /** footer attribution required by the clinic's plan */
  attribution: boolean;
  content: SiteContent;
  services: PublicService[];
  doctors: PublicDoctor[];
  testimonials: PublicTestimonial[];
  faqs: PublicFaq[];
  articles: PublicArticleCard[];
  articleTotal: number;
  /** wa.me link, only when the clinic configured a number */
  whatsappLink: string | null;
  updatedAt: Date;
}
