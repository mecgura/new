import type { FieldDef, Values } from "@/components/website/fields";
import { SERVICE_ICONS } from "@/lib/validation/website";

/** Field definitions for the CMS forms (plain data, shared by the server pages that render them). */
export const SERVICE_FIELDS: FieldDef[] = [
  { name: "title", label: "Title", type: "text", required: true, max: 120 },
  { name: "category", label: "Category", type: "text", max: 60, hint: "e.g. Consultation, Check-up" },
  { name: "shortDescription", label: "Short description", type: "textarea", rows: 2, max: 300, hint: "Shown on service cards." },
  { name: "description", label: "Detailed description", type: "markdown", hint: "Avoid promises about outcomes." },
  { name: "durationMinutes", label: "Duration (minutes)", type: "number" },
  { name: "fee", label: "Consultation fee (₹)", type: "number" },
  { name: "showFee", label: "Show the fee on the website", type: "toggle" },
  { name: "icon", label: "Icon", type: "select", options: SERVICE_ICONS.map((i) => ({ value: i, label: i.replace(/-/g, " ") })) },
  { name: "imageUrl", label: "Image", type: "image" },
  { name: "imageAlt", label: "Image description (alt text)", type: "text", max: 140, hint: "Required when an image is set." },
  { name: "slug", label: "Page URL name", type: "text", max: 80, hint: "Leave blank to generate from the title." },
  { name: "sortOrder", label: "Display order", type: "number" },
  { name: "seoTitle", label: "SEO title", type: "text", max: 70 },
  { name: "seoDescription", label: "SEO description", type: "textarea", rows: 2, max: 180 },
];
export const SERVICE_BLANK: Values = { title: "", category: "", shortDescription: "", description: "", durationMinutes: "", fee: "", showFee: false, icon: "", imageUrl: "", imageAlt: "", slug: "", sortOrder: "0", seoTitle: "", seoDescription: "" };

export const FAQ_FIELDS: FieldDef[] = [
  { name: "question", label: "Question", type: "text", required: true, max: 200, span: 2 },
  { name: "answer", label: "Answer", type: "markdown", required: true, rows: 6 },
  { name: "category", label: "Category", type: "text", max: 60 },
  { name: "sortOrder", label: "Display order", type: "number" },
];
export const FAQ_BLANK: Values = { question: "", answer: "", category: "", sortOrder: "0" };

export const ARTICLE_FIELDS: FieldDef[] = [
  { name: "title", label: "Title", type: "text", required: true, max: 140, span: 2 },
  { name: "excerpt", label: "Excerpt", type: "textarea", rows: 2, max: 300, hint: "Shown in article lists." },
  { name: "content", label: "Content", type: "markdown", rows: 14, hint: "General information only — no diagnosis or treatment promises." },
  { name: "category", label: "Category", type: "text", max: 60 },
  { name: "tags", label: "Tags", type: "lines", rows: 2, hint: "One per line, up to 10." },
  { name: "featuredImageUrl", label: "Featured image", type: "image" },
  { name: "featuredImageAlt", label: "Image description (alt text)", type: "text", max: 140, hint: "Required when an image is set." },
  { name: "publishAt", label: "Publish date", type: "date", hint: "Optional. Shown on the article once published." },
  { name: "slug", label: "Page URL name", type: "text", max: 80, hint: "Leave blank to generate from the title." },
  { name: "seoTitle", label: "SEO title", type: "text", max: 70 },
  { name: "seoDescription", label: "SEO description", type: "textarea", rows: 2, max: 180 },
  { name: "canonicalUrl", label: "Canonical URL", type: "url", hint: "Only if this article was first published elsewhere." },
  { name: "ogImageUrl", label: "Social sharing image", type: "image" },
];
export const ARTICLE_BLANK: Values = { title: "", excerpt: "", content: "", category: "", tags: [], featuredImageUrl: "", featuredImageAlt: "", publishAt: "", slug: "", seoTitle: "", seoDescription: "", canonicalUrl: "", ogImageUrl: "" };

export const testimonialFields = (doctors: { value: string; label: string }[], services: { value: string; label: string }[]): FieldDef[] => [
  { name: "text", label: "Testimonial", type: "textarea", required: true, rows: 5, max: 1500, hint: "Only add feedback the patient agreed to share." },
  { name: "displayName", label: "Name to display", type: "text", max: 80, hint: "Leave blank to show “Anonymous Patient”." },
  { name: "rating", label: "Rating", type: "select", options: [1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: `${n} / 5` })) },
  { name: "givenOn", label: "Date", type: "date" },
  { name: "doctorUserId", label: "Doctor (optional)", type: "select", options: doctors },
  { name: "serviceId", label: "Service (optional)", type: "select", options: services },
  { name: "sortOrder", label: "Display order", type: "number" },
];
export const TESTIMONIAL_BLANK: Values = { text: "", displayName: "", rating: "", givenOn: "", doctorUserId: "", serviceId: "", sortOrder: "0" };

export const HERO_FIELDS: FieldDef[] = [
  { name: "headline", label: "Headline", type: "text", max: 120, hint: "Blank = doctor name (one doctor) or clinic name." },
  { name: "subheadline", label: "Sub-headline", type: "text", max: 160, hint: "e.g. specialization" },
  { name: "intro", label: "Short introduction", type: "textarea", rows: 3, max: 600 },
  { name: "primaryCtaLabel", label: "Main button label", type: "text", max: 30, hint: "Default: “Book appointment”." },
  { name: "imageUrl", label: "Hero image", type: "image", hint: "Blank = the doctor's photo when there is a single doctor." },
  { name: "imageAlt", label: "Hero image description (alt text)", type: "text", max: 140 },
];
export const HOME_FIELDS: FieldDef[] = [
  { name: "showCredentials", label: "Show credentials strip (single doctor)", type: "toggle" },
  { name: "showServices", label: "Show services", type: "toggle" },
  { name: "showDoctors", label: "Show doctors", type: "toggle" },
  { name: "showTestimonials", label: "Show testimonials", type: "toggle" },
  { name: "showFaq", label: "Show FAQ", type: "toggle" },
  { name: "showArticles", label: "Show articles", type: "toggle" },
];
export const ABOUT_FIELDS: FieldDef[] = [
  { name: "title", label: "Page title", type: "text", max: 100 },
  { name: "body", label: "About text", type: "markdown", rows: 10 },
  { name: "education", label: "Education", type: "markdown", rows: 5 },
  { name: "philosophy", label: "Approach / philosophy", type: "markdown", rows: 5 },
];
export const CLINIC_FIELDS: FieldDef[] = [
  { name: "description", label: "About the clinic", type: "markdown", rows: 6 },
  { name: "facilities", label: "Facilities", type: "lines", hint: "Only what you really offer." },
  { name: "parking", label: "Parking information", type: "textarea", rows: 2, max: 500 },
  { name: "emergencyContact", label: "Emergency contact number", type: "text", max: 40 },
  { name: "mapUrl", label: "Map link", type: "url", hint: "Optional https link (e.g. from Google Maps “Share”). Blank = a search link from the address." },
  { name: "whatsapp", label: "WhatsApp number", type: "text", hint: "With country code, e.g. +91 98xxxxxxxx. Used only as a “chat on WhatsApp” link — no automation.", span: 2 },
  { name: "social.facebook", label: "Facebook", type: "url" }, { name: "social.instagram", label: "Instagram", type: "url" },
  { name: "social.youtube", label: "YouTube", type: "url" }, { name: "social.x", label: "X", type: "url" }, { name: "social.linkedin", label: "LinkedIn", type: "url" },
];
export const CONTACT_FIELDS: FieldDef[] = [
  { name: "intro", label: "Intro text", type: "textarea", rows: 3, max: 1000 },
  { name: "showForm", label: "Show the contact form", type: "toggle", hint: "Enquiries go to the Enquiries tab, visible to your clinic only." },
];
export const LEGAL_FIELDS: FieldDef[] = [
  { name: "privacy", label: "Privacy policy", type: "markdown", rows: 12, hint: "The page appears once there is text. Have it reviewed by a legal adviser." },
  { name: "terms", label: "Terms of use", type: "markdown", rows: 12 },
];
export const FOOTER_FIELDS: FieldDef[] = [{ name: "description", label: "Short footer description", type: "textarea", rows: 2, max: 300 }];
export const PAGES_FIELDS: FieldDef[] = (["about", "services", "doctors", "clinic", "testimonials", "faq", "articles", "contact", "privacy", "terms"] as const).map((k) => ({ name: k, label: `${k[0].toUpperCase()}${k.slice(1)} page`, type: "toggle" as const }));
export const SEO_FIELDS: FieldDef[] = [
  { name: "defaultTitle", label: "Home page title", type: "text", max: 70, hint: "Blank = clinic name and sub-headline." },
  { name: "defaultDescription", label: "Default description", type: "textarea", rows: 3, max: 180 },
  { name: "ogImageUrl", label: "Default social sharing image", type: "image", hint: "Blank = clinic logo." },
  { name: "indexable", label: "Allow search engines to index the website", type: "toggle" },
];
