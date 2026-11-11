import { z } from "zod";
import { SITE_PAGE_KEYS, type SitePageKey } from "./paths";
import { SITE_IMAGE_RE } from "./urls";

/**
 * Site-wide website content (one validated JSON document per clinic: a DRAFT copy and a PUBLISHED snapshot).
 * Every field is optional: nothing is invented — an empty field simply isn't shown.
 */
export const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;
export type Day = (typeof DAYS)[number];
export const DAY_LABELS: Record<Day, string> = { monday: "Monday", tuesday: "Tuesday", wednesday: "Wednesday", thursday: "Thursday", friday: "Friday", saturday: "Saturday", sunday: "Sunday" };

const str = (max: number) => z.string().trim().max(max, `Must be ${max} characters or fewer.`).default("");
const bool = (d: boolean) => z.boolean().default(d);
const url = (max = 300) =>
  z.string().trim().max(max).default("").refine((v) => v === "" || /^https:\/\/[^\s]+$/i.test(v), "Use a full https:// link.");
export const imageUrl = z.string().trim().default("").refine((v) => v === "" || SITE_IMAGE_RE.test(v), "Use an image uploaded through the CMS.");

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM (24-hour).");
const range = z.object({ from: hhmm, to: hhmm }).refine((r) => r.from < r.to, "Closing time must be after opening time.");
export const dayHoursSchema = z
  .object({ open: bool(false), from: hhmm.default("09:00"), to: hhmm.default("17:00"), breaks: z.array(range).max(3).default([]) })
  .superRefine((d, ctx) => {
    if (!d.open) return;
    if (d.from >= d.to) ctx.addIssue({ code: "custom", path: ["to"], message: "Closing time must be after opening time." });
    let prevEnd = d.from;
    for (const [i, b] of d.breaks.entries()) {
      if (b.from < prevEnd || b.to > d.to) ctx.addIssue({ code: "custom", path: ["breaks", i], message: "Breaks must be within opening hours and in order." });
      prevEnd = b.to;
    }
  });
export type DayHours = z.infer<typeof dayHoursSchema>;

const dayP = dayHoursSchema.prefault({});
const whatsapp = z.string().trim().default("").transform((v, ctx) => {
  if (!v) return "";
  const d = v.replace(/[\s()-]/g, "").replace(/^\+/, "");
  const digits = /^\d{10}$/.test(d) ? `91${d}` : d;
  if (!/^\d{11,15}$/.test(digits)) { ctx.addIssue({ code: "custom", message: "Enter the number with country code, e.g. +91 98xxxxxxx." }); return z.NEVER; }
  return digits; // wa.me format: digits only
});

export const NAV_KEYS = ["home", "about", "services", "doctors", "clinic", "testimonials", "faq", "articles", "contact"] as const;
export type NavKey = (typeof NAV_KEYS)[number];
export const DEFAULT_NAV: { key: NavKey; label: string; visible: boolean }[] = [
  { key: "home", label: "Home", visible: true }, { key: "about", label: "About", visible: true }, { key: "services", label: "Services", visible: true },
  { key: "doctors", label: "Doctors", visible: true }, { key: "clinic", label: "Clinic", visible: false }, { key: "testimonials", label: "Testimonials", visible: true },
  { key: "faq", label: "FAQ", visible: true }, { key: "articles", label: "Articles", visible: true }, { key: "contact", label: "Contact", visible: true },
];
const navItem = z.object({ key: z.enum(NAV_KEYS), label: z.string().trim().min(1, "Label is required.").max(30), visible: z.boolean() });

const pagesShape = Object.fromEntries(SITE_PAGE_KEYS.filter((k) => k !== "home").map((k) => [k, bool(true)])) as Record<Exclude<SitePageKey, "home">, z.ZodDefault<z.ZodBoolean>>;

export const siteContentSchema = z.object({
  hero: z.object({ headline: str(120), subheadline: str(160), intro: str(600), imageUrl, imageAlt: str(140), primaryCtaLabel: str(30) }).prefault({}),
  home: z.object({ showCredentials: bool(true), showServices: bool(true), showDoctors: bool(true), showTestimonials: bool(true), showFaq: bool(true), showArticles: bool(true) }).prefault({}),
  about: z.object({ title: str(100), body: str(8000), education: str(4000), philosophy: str(4000) }).prefault({}),
  clinic: z.object({
    description: str(2000),
    facilities: z.array(z.string().trim().min(1).max(80)).max(30).default([]),
    parking: str(500),
    emergencyContact: str(40),
    mapUrl: url(500),
    whatsapp,
    hours: z.object({
      monday: dayP, tuesday: dayP, wednesday: dayP, thursday: dayP, friday: dayP, saturday: dayP, sunday: dayP,
    }).prefault({ monday: {}, tuesday: {}, wednesday: {}, thursday: {}, friday: {}, saturday: {}, sunday: {} }),
    social: z.object({ facebook: url(), instagram: url(), youtube: url(), x: url(), linkedin: url() }).prefault({}),
  }).prefault({}),
  contact: z.object({ intro: str(1000), showForm: bool(true) }).prefault({}),
  legal: z.object({ privacy: str(20000), terms: str(20000) }).prefault({}),
  footer: z.object({ description: str(300) }).prefault({}),
  pages: z.object(pagesShape).prefault({}),
  navigation: z.array(navItem).max(NAV_KEYS.length).default(DEFAULT_NAV)
    .refine((n) => new Set(n.map((i) => i.key)).size === n.length, "Each navigation item can appear only once."),
  seo: z.object({ defaultTitle: str(70), defaultDescription: str(180), ogImageUrl: imageUrl, indexable: bool(true) }).prefault({}),
});
export type SiteContent = z.infer<typeof siteContentSchema>;
export const SECTION_KEYS = ["hero", "home", "about", "clinic", "contact", "legal", "footer", "pages", "navigation", "seo"] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];

/** Parses stored JSON; anything missing/invalid falls back to safe defaults (never throws). */
export function parseContent(json: string | null | undefined): SiteContent {
  let raw: unknown = {};
  try { raw = json ? JSON.parse(json) : {}; } catch { raw = {}; }
  const r = siteContentSchema.safeParse(raw);
  return r.success ? r.data : siteContentSchema.parse({});
}

export const emptyContent = (): SiteContent => siteContentSchema.parse({});

/** Stable string form, for "has unpublished changes" comparisons. */
export const serializeContent = (c: SiteContent) => JSON.stringify(c);

/** Human text for a day's hours, e.g. "09:00 – 17:00 (break 13:00 – 14:00)" or "Closed". */
export function describeDay(h: DayHours): string {
  if (!h.open) return "Closed";
  const br = h.breaks.length ? ` (break ${h.breaks.map((b) => `${b.from} – ${b.to}`).join(", ")})` : "";
  return `${h.from} – ${h.to}${br}`;
}

const SCHEMA_ORG_DAY: Record<Day, string> = { monday: "Monday", tuesday: "Tuesday", wednesday: "Wednesday", thursday: "Thursday", friday: "Friday", saturday: "Saturday", sunday: "Sunday" };
export const schemaOrgDay = (d: Day) => `https://schema.org/${SCHEMA_ORG_DAY[d]}`;
