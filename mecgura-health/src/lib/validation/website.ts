import { z } from "zod";
import { imageUrl } from "@/lib/website/content";
import { SLUG_RE } from "@/lib/website/slug";
import { email } from "./fields";

export const SERVICE_ICONS = ["stethoscope", "heart-pulse", "activity", "pill", "syringe", "baby", "bone", "brain", "eye", "ear", "shield-check", "clipboard-list", "microscope", "thermometer"] as const;

const text = (label: string, max: number) => z.string().trim().max(max, `${label} must be ${max} characters or fewer.`).optional().transform((v) => (v ? v : undefined));
const required = (label: string, max: number, min = 1) => z.string({ error: `${label} is required.` }).trim().min(min, min > 1 ? `${label} must be at least ${min} characters.` : `${label} is required.`).max(max, `${label} must be ${max} characters or fewer.`);
const intOpt = (label: string, min: number, max: number) => z.preprocess((v) => (v === "" || v === null ? undefined : v), z.coerce.number({ error: `${label} must be a number.` }).int(`${label} must be a whole number.`).min(min, `${label} must be ${min} or more.`).max(max, `${label} must be ${max} or less.`).optional());
const slugOpt = z.string().trim().toLowerCase().optional().transform((v) => (v ? v : undefined)).refine((v) => v === undefined || (SLUG_RE.test(v) && v.length >= 2 && v.length <= 80), "Use lowercase letters, numbers and hyphens only.");
const img = imageUrl.transform((v) => (v ? v : undefined));
const list = (label: string, maxItems: number, maxLen: number) => z.array(z.string().trim().min(1).max(maxLen, `Each ${label} must be ${maxLen} characters or fewer.`)).max(maxItems, `Up to ${maxItems} items.`).default([]);
const httpsOpt = z.string().trim().max(500).optional().transform((v) => (v ? v : undefined)).refine((v) => v === undefined || /^https:\/\/[^\s]+$/i.test(v), "Use a full https:// link.");
const sort = intOpt("Display order", 0, 9999).transform((v) => v ?? 0);

/** An image needs alt text (accessibility). */
const needAlt = <T extends Record<string, unknown>>(urlKey: keyof T & string, altKey: keyof T & string) => (v: T, ctx: z.RefinementCtx) => {
  if (v[urlKey] && !v[altKey]) ctx.addIssue({ code: "custom", path: [altKey], message: "Describe the image for people using screen readers." });
};

export const serviceSchema = z.object({
  title: required("Title", 120), slug: slugOpt, shortDescription: text("Short description", 300), description: text("Description", 8000), category: text("Category", 60),
  durationMinutes: intOpt("Duration", 5, 600), fee: intOpt("Fee", 0, 1_000_000), showFee: z.boolean().default(false),
  imageUrl: img, imageAlt: text("Image description", 140), icon: z.enum(SERVICE_ICONS).optional().or(z.literal("").transform(() => undefined)),
  sortOrder: sort, seoTitle: text("SEO title", 70), seoDescription: text("SEO description", 180),
}).superRefine(needAlt("imageUrl", "imageAlt")).superRefine((v, ctx) => { if (v.showFee && v.fee === undefined) ctx.addIssue({ code: "custom", path: ["fee"], message: "Enter the fee or switch off “Show fee”." }); });

export const testimonialSchema = z.object({
  displayName: text("Name", 80), text: required("Testimonial", 1500, 10), rating: intOpt("Rating", 1, 5),
  givenOn: z.string().trim().optional().transform((v) => (v ? v : undefined)).refine((v) => v === undefined || /^\d{4}-\d{2}-\d{2}$/.test(v), "Enter a valid date."),
  doctorUserId: text("Doctor", 40), serviceId: text("Service", 40), sortOrder: sort,
});

export const faqSchema = z.object({ question: required("Question", 200), answer: required("Answer", 3000), category: text("Category", 60), sortOrder: sort });

export const articleSchema = z.object({
  title: required("Title", 140), slug: slugOpt, excerpt: text("Excerpt", 300), content: z.string().max(30000, "Content is too long.").default(""),
  featuredImageUrl: img, featuredImageAlt: text("Image description", 140), category: text("Category", 60), tags: list("tag", 10, 30),
  publishAt: z.string().trim().optional().transform((v) => (v ? v : undefined)).refine((v) => v === undefined || /^\d{4}-\d{2}-\d{2}$/.test(v), "Enter a valid date."),
  seoTitle: text("SEO title", 70), seoDescription: text("SEO description", 180), canonicalUrl: httpsOpt, ogImageUrl: img,
}).superRefine(needAlt("featuredImageUrl", "featuredImageAlt"));

export const doctorProfileSchema = z.object({
  slug: slugOpt, photoUrl: img, photoAlt: text("Photo description", 140), shortBio: text("Short bio", 300), bio: text("Bio", 8000), education: text("Education", 4000),
  certifications: list("certification", 20, 120), memberships: list("membership", 20, 120), languages: list("language", 10, 40), philosophy: text("Philosophy", 4000),
  showRegistration: z.boolean().default(false), showFee: z.boolean().default(false), sortOrder: sort, seoTitle: text("SEO title", 70), seoDescription: text("SEO description", 180),
}).superRefine(needAlt("photoUrl", "photoAlt"));

export const itemStatusSchema = z.object({ status: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]) });
export const sectionSchema = z.object({ section: z.string(), data: z.unknown() });
export const publishSchema = z.object({ action: z.enum(["publish", "unpublish"]) });
export const domainRequestSchema = z.object({ domain: z.string().trim().toLowerCase().regex(/^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/, "Enter a domain like clinic.com (no https:// or path).") });

/** Public contact form. */
export const contactSchema = z.object({
  name: required("Name", 100, 2),
  phone: z.string().trim().max(20).optional().transform((v) => (v ? v : undefined)).refine((v) => v === undefined || /^\+?[0-9 ()-]{7,20}$/.test(v), "Enter a valid phone number."),
  email: z.string().trim().max(254).optional().transform((v) => (v ? v : undefined)).pipe(email.optional()),
  message: required("Message", 2000, 10),
  consent: z.literal(true, { error: "Please tick the box to let the clinic contact you." }),
  /** honeypot: real users never see or fill this */
  website_url: z.string().max(200).optional(),
}).superRefine((v, ctx) => { if (!v.phone && !v.email) ctx.addIssue({ code: "custom", path: ["phone"], message: "Give a phone number or an email so the clinic can reply." }); });
export const enquiryStatusSchema = z.object({ status: z.enum(["NEW", "READ", "ARCHIVED"]) });
